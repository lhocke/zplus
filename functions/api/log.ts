/// <reference types="@cloudflare/workers-types" />

/**
 * POST /api/log — Cloudflare Pages Function
 *
 * Receives a PlaytestEvent, validates shape + size, writes one R2 object:
 *   sessions/<sessionId>/<seq>.json
 * where seq is zero-padded to 5 digits (00000 = SessionStart, 1-based turn
 * index for TurnEvents, 99999 = SessionEnd sentinel).
 *
 * Returns 204 quickly. Best-effort — errors are server-side problems, not
 * client problems; the HttpSink swallows failures to keep gameplay unblocked.
 */

import { seqKey } from '../lib/log-key.js';

const MAX_BODY_BYTES = 8192;     // 8 KiB hard cap
const MAX_SESSION_EVENTS = 1000; // per-session event cap (1 R2 list page)

interface Env {
  PLAYTEST: R2Bucket;
}

// Type-narrowing validators for each PlaytestEvent discriminant.
// Only checks the fields the Function needs — the client is trusted to send
// well-formed data, but we still guard against junk/abuse.

function isStartEvent(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    o['type'] === 'start' &&
    typeof o['sessionId'] === 'string' &&
    o['sessionId'].length > 0 &&
    typeof o['buildId'] === 'string' &&
    typeof o['ts'] === 'string'
  );
}

function isTurnEvent(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    o['type'] === 'turn' &&
    typeof o['sessionId'] === 'string' &&
    o['sessionId'].length > 0 &&
    typeof o['buildId'] === 'string' &&
    typeof o['turn'] === 'number' &&
    typeof o['command'] === 'string' &&
    typeof o['output'] === 'string' &&
    typeof o['score'] === 'number' &&
    typeof o['moves'] === 'number' &&
    typeof o['room'] === 'string' &&
    typeof o['ts'] === 'string'
  );
}

function isEndEvent(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    o['type'] === 'end' &&
    typeof o['sessionId'] === 'string' &&
    o['sessionId'].length > 0 &&
    typeof o['ts'] === 'string' &&
    typeof o['lastTurn'] === 'number'
  );
}

function validPlaytestEvent(e: unknown): boolean {
  return isStartEvent(e) || isTurnEvent(e) || isEndEvent(e);
}

function eventSeq(e: Record<string, unknown>): number {
  if (e['type'] === 'start') return 0;
  if (e['type'] === 'end') return 99999;
  return e['turn'] as number; // TurnEvent: 1-based
}

export async function handleLog(request: Request, env: Env): Promise<Response> {
  const bucket = env.PLAYTEST;
  // R2 not bound (e.g. no billing / early deploy) — degrade gracefully.
  if (!bucket) return new Response(null, { status: 204 });

  // Body size cap — reject before parsing, using Content-Length if present.
  const cl = Number(request.headers.get('content-length') ?? '0');
  if (cl > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  if (!validPlaytestEvent(body)) {
    return new Response('Invalid event shape', { status: 400 });
  }

  const event = body as Record<string, unknown>;
  const sessionId = event['sessionId'] as string;

  // Per-session event cap: one R2 list page (≤ 1000 items).
  // Non-atomic — acceptable for a small playtest.
  const listed = await bucket.list({ prefix: `sessions/${sessionId}/`, limit: 1000 });
  if (listed.objects.length >= MAX_SESSION_EVENTS) {
    return new Response('Session event cap exceeded', { status: 429 });
  }

  const seq = eventSeq(event);
  const key = `sessions/${sessionId}/${seqKey(seq)}.json`;
  await bucket.put(key, JSON.stringify(body), {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(null, { status: 204 });
}

// Pages Function entry point — only POST is accepted.
export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return handleLog(context.request, context.env);
}
