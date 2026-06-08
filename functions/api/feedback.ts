/// <reference types="@cloudflare/workers-types" />

/**
 * POST /api/feedback — Cloudflare Pages Function
 *
 * Receives a tester feedback submission, sanitizes all user fields, and
 * creates a GitHub issue in the private feedback repo (lhocke/zork-feedback).
 *
 * Security model:
 *   - GITHUB_TOKEN must be a fine-grained PAT scoped ONLY to lhocke/zork-feedback
 *     with Issues: write permission. A classic PAT or broader token would reach
 *     the code repo and voids the blast-radius argument (spec §5/§7 review H4).
 *   - All user text is wrapped in fenced code blocks (chooseFence algorithm).
 *   - Issue title is server-generated; category → labels server-side.
 *   - Response echoes nothing sensitive.
 *
 * Spam stack (public endpoint — no access gate, bots can reach it):
 *   Cloudflare Turnstile server-side verify → honeypot → rate limit →
 *   content heuristics → quarantine-not-drop on heuristic hits.
 */

import {
  chooseFence,
  escapeTildes,
  fenceContent,
  sanitizeField,
  MAX_MESSAGE_BYTES,
  MAX_CONTEXT_BYTES,
  MAX_SESSION_ID_BYTES,
  ALLOWED_CATEGORIES,
} from '../lib/sanitize.js';

// Re-export for external consumers (e.g. the inline test handler mirrors this).
export { chooseFence, escapeTildes, fenceContent, sanitizeField };

const RATE_WINDOW_MS = 60_000; // 1-minute window
const RATE_LIMIT = 5;          // submissions per sessionId per window

// In-memory rate map; resets on worker restart (acceptable for low-volume playtest).
const rateMap = new Map<string, { count: number; windowStart: number }>();

interface Env {
  GITHUB_TOKEN: string;      // fine-grained PAT: zork-feedback issues:write only
  TURNSTILE_SECRET: string;  // Cloudflare Turnstile secret key (server-side)
}

interface FeedbackBody {
  category: string;
  message: string;
  sessionId: string;
  turnstileToken: string;
  context?: string;
  browserInfo?: { userAgent?: string; viewport?: string; theme?: string };
  hp?: string; // honeypot — real users never fill this
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = await resp.json() as { success: boolean };
  return data.success === true;
}

async function createGithubIssue(
  token: string,
  repo: string,
  title: string,
  body: string,
  labels: string[],
): Promise<void> {
  const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      // GitHub's REST API rejects requests without a User-Agent (403).
      'User-Agent': 'zork-playtest-feedback',
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status}`);
  }
}

// Heuristic spam detection — quarantine (don't drop) on suspicion.
// Turnstile stops most bots; this catches noise that slips through.
function isSpamSuspected(message: string, context: string | undefined): boolean {
  const combined = (message + ' ' + (context ?? '')).toLowerCase();
  const urlCount = (combined.match(/https?:\/\//g) ?? []).length;
  if (urlCount > 3) return true;
  // Obvious repetition: same word 6+ times consecutively
  if (/\b(\w+)( \1){5,}\b/.test(combined)) return true;
  return false;
}

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: FeedbackBody;
  try {
    body = await request.json() as FeedbackBody;
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // Honeypot: filled → silent success-shaped reject (bot can't distinguish).
  if (body.hp && body.hp.length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Required field presence.
  if (!body.category || !body.message || !body.sessionId || !body.turnstileToken) {
    return new Response('Missing required fields', { status: 400 });
  }

  // Category allow-list — validation and label assignment are both server-side.
  if (!ALLOWED_CATEGORIES.includes(body.category as (typeof ALLOWED_CATEGORIES)[number])) {
    return new Response('Invalid category', { status: 400 });
  }

  // Size caps — fail fast before any external call.
  try {
    sanitizeField(body.message, MAX_MESSAGE_BYTES);
    if (body.context !== undefined) sanitizeField(body.context, MAX_CONTEXT_BYTES);
    sanitizeField(body.sessionId, MAX_SESSION_ID_BYTES);
  } catch {
    return new Response('Field too large', { status: 400 });
  }

  // Per-session rate limit (simple in-memory; fine for a low-volume playtest).
  const now = Date.now();
  const rk = body.sessionId;
  const entry = rateMap.get(rk) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateMap.set(rk, entry);
  if (entry.count > RATE_LIMIT) {
    return new Response('Rate limit exceeded', { status: 429 });
  }

  // Turnstile server-side verify — the actual gate on issue creation.
  if (!env.TURNSTILE_SECRET) {
    return new Response('Server misconfigured', { status: 500 });
  }
  const turnstileOk = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET);
  if (!turnstileOk) {
    return new Response('Turnstile verification failed', { status: 400 });
  }

  // Spam heuristics — quarantine rather than drop (false positives lose real feedback).
  const spamSuspected = isSpamSuspected(body.message, body.context);

  // Build issue body — every user-controlled value inside a fence.
  const parts: string[] = [
    `**Category:** ${body.category}`,
    `**Session ID:**\n${fenceContent(body.sessionId)}`,
    `**Message:**\n${fenceContent(body.message)}`,
  ];
  if (body.context) {
    parts.push(`**Context:**\n${fenceContent(body.context)}`);
  }
  // Browser info only on UI issue reports (the §4 scoped exception).
  if (body.category === 'UI issue' && body.browserInfo) {
    parts.push(`**Browser info:**\n${fenceContent(JSON.stringify(body.browserInfo))}`);
  }

  // Audit trail note for the repo reviewer.
  parts.push(
    '_This issue was created automatically by the playtest feedback form._\n' +
    '_All user text above is inside fenced code blocks._',
  );

  const issueBody = parts.join('\n\n');

  // Title is server-generated — never user-controlled.
  // escapeTildes on sessionId is belt-and-suspenders (title is plain text,
  // not markdown, but GitHub might render some markdown in titles).
  const safeSessionId = escapeTildes(body.sessionId);
  const title = `[playtest] ${body.category} - ${safeSessionId}`;

  // Labels — server-derived; never from user input.
  const categoryLabel = `category:${body.category.replace(/\s+/g, '-').toLowerCase()}`;
  const labels = ['playtest-feedback', categoryLabel];
  if (spamSuspected) labels.push('suspected-spam');

  if (!env.GITHUB_TOKEN) {
    return new Response('Server misconfigured', { status: 500 });
  }

  try {
    await createGithubIssue(
      env.GITHUB_TOKEN,
      'lhocke/zork-feedback',
      title,
      issueBody,
      labels,
    );
  } catch (e) {
    // Surface GitHub's status (e.g. "GitHub API error: 403") — not sensitive,
    // and the only way to diagnose a deploy-time auth/scope problem.
    const detail = e instanceof Error ? e.message : 'unknown error';
    return new Response(`Failed to create issue: ${detail}`, { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Pages Function entry point.
export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return handleFeedback(context.request, context.env);
}
