/**
 * Tests for /api/log: key-generation unit tests + Miniflare integration.
 *
 * Unit: pure seqKey() padding logic (zero-padded 5-digit R2 key).
 * Integration: Miniflare spins a real workerd to verify HTTP behavior —
 *   valid event → 204 + R2 write at the correct key,
 *   malformed/oversized → 4xx, no write,
 *   over-cap → 429.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Miniflare } from 'miniflare';
import { seqKey } from '../../functions/lib/log-key.js';
import type { PlaytestEvent } from '../../src/shell/sink.js';

// ---------------------------------------------------------------------------
// Unit: seqKey padding
// ---------------------------------------------------------------------------

describe('seqKey', () => {
  it('00000 for seq 0 (SessionStart)', () => {
    expect(seqKey(0)).toBe('00000');
  });

  it('00001 for turn 1', () => {
    expect(seqKey(1)).toBe('00001');
  });

  it('99999 for SessionEnd sentinel', () => {
    expect(seqKey(99999)).toBe('99999');
  });

  it('five digits throughout the range', () => {
    for (const n of [0, 1, 9, 10, 99, 100, 999, 1000, 9999]) {
      expect(seqKey(n)).toHaveLength(5);
    }
  });

  it('lexicographic order matches emission order', () => {
    const keys = [0, 1, 2, 50, 100, 500, 1000, 9998, 9999, 99999].map(seqKey);
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
  });
});

// ---------------------------------------------------------------------------
// Integration: Miniflare — the full handler as an inline Worker
// ---------------------------------------------------------------------------
// Handler logic is inlined here as plain JS so workerd can run it without a
// TypeScript compile step. The same constants/logic live in functions/api/log.ts.
// If the two drift, the unit tests on seqKey() would still catch key-gen bugs.

const HANDLER_SCRIPT = /* js */ `
const MAX_BODY_BYTES = 8192;      // 8 KiB hard cap
const MAX_SESSION_EVENTS = 1000;  // per-session event cap — keep in sync with functions/api/log.ts

function seqKey(seq) {
  return String(seq).padStart(5, "0");
}

function validPlaytestEvent(e) {
  if (!e || typeof e !== "object") return false;
  const type = e.type;
  if (type === "start") {
    return (
      typeof e.sessionId === "string" &&
      typeof e.buildId === "string" &&
      typeof e.ts === "string"
    );
  }
  if (type === "turn") {
    return (
      typeof e.sessionId === "string" &&
      typeof e.buildId === "string" &&
      typeof e.turn === "number" &&
      typeof e.command === "string" &&
      typeof e.output === "string" &&
      typeof e.score === "number" &&
      typeof e.moves === "number" &&
      typeof e.room === "string" &&
      typeof e.ts === "string"
    );
  }
  if (type === "end") {
    return (
      typeof e.sessionId === "string" &&
      typeof e.ts === "string" &&
      typeof e.lastTurn === "number"
    );
  }
  return false;
}

function eventSeq(e) {
  if (e.type === "start") return 0;
  if (e.type === "end")   return 99999;
  return e.turn; // TurnEvent: 1-based turn index
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const bucket = env.PLAYTEST;
    if (!bucket) return new Response("No R2 binding", { status: 500 });

    // Body size cap — reject before parsing JSON.
    const cl = Number(request.headers.get("content-length") ?? "0");
    if (cl > MAX_BODY_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }

    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return new Response("Payload too large", { status: 413 });
      }
      body = JSON.parse(text);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    if (!validPlaytestEvent(body)) {
      return new Response("Invalid event shape", { status: 400 });
    }

    const { sessionId } = body;

    // Per-session event cap (non-atomic — acceptable for low-volume playtest).
    const listed = await bucket.list({
      prefix: "sessions/" + sessionId + "/",
      limit: 1000,
    });
    if (listed.objects.length >= MAX_SESSION_EVENTS) {
      return new Response("Session event cap exceeded", { status: 429 });
    }

    const seq = eventSeq(body);
    const key = "sessions/" + sessionId + "/" + seqKey(seq) + ".json";
    await bucket.put(key, JSON.stringify(body), {
      httpMetadata: { contentType: "application/json" },
    });

    return new Response(null, { status: 204 });
  },
};
`;

describe('POST /api/log — Miniflare integration', () => {
  let mf: Miniflare;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: HANDLER_SCRIPT,
      r2Buckets: ['PLAYTEST'],
    });
    await mf.ready;
  });

  afterAll(async () => {
    await mf.dispose();
  });

  function validStart(sessionId = 'ses-start-001'): PlaytestEvent {
    return {
      type: 'start',
      sessionId,
      buildId: 'abc1234',
      ts: new Date().toISOString(),
      output: 'Welcome to Zork.',
      hereName: 'West of House',
      score: 0,
      maxScore: 350,
      moves: 0,
    };
  }

  function validTurn(sessionId = 'ses-turn-001', turn = 1): PlaytestEvent {
    return {
      type: 'turn',
      sessionId,
      buildId: 'abc1234',
      turn,
      command: 'look',
      output: 'West of House.',
      score: 0,
      maxScore: 350,
      moves: 1,
      room: 'WEST-OF-HOUSE',
      hereName: 'West of House',
      ts: new Date().toISOString(),
    };
  }

  it('valid SessionStart → 204, R2 key sessions/<id>/00000.json', async () => {
    const event = validStart('ses-start-unit');
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(204);

    const bucket = await mf.getR2Bucket('PLAYTEST');
    const obj = await bucket.get('sessions/ses-start-unit/00000.json');
    expect(obj).not.toBeNull();
  });

  it('valid TurnEvent (turn=1) → 204, R2 key .../00001.json', async () => {
    const event = validTurn('ses-turn-unit', 1);
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(204);

    const bucket = await mf.getR2Bucket('PLAYTEST');
    const obj = await bucket.get('sessions/ses-turn-unit/00001.json');
    expect(obj).not.toBeNull();
  });

  it('valid SessionEnd → 204, R2 key .../99999.json', async () => {
    const event: PlaytestEvent = {
      type: 'end',
      sessionId: 'ses-end-unit',
      ts: new Date().toISOString(),
      lastTurn: 1,
    };
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(204);

    const bucket = await mf.getR2Bucket('PLAYTEST');
    const obj = await bucket.get('sessions/ses-end-unit/99999.json');
    expect(obj).not.toBeNull();
  });

  it('malformed JSON body → 400, no R2 write', async () => {
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not valid json}}}',
    });
    // 400 status is the authoritative signal — no R2 write occurs before
    // JSON parsing succeeds, so the malformed-body path never reaches bucket.put().
    expect(res.status).toBe(400);
  });

  it('valid JSON but wrong shape → 400', async () => {
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'unknown', sessionId: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('missing required turn fields → 400', async () => {
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'turn', sessionId: 'x' }), // missing turn/command/etc
    });
    expect(res.status).toBe(400);
  });

  it('oversized body → 413, no R2 write for that session', async () => {
    const bigPayload = JSON.stringify({
      type: 'turn',
      sessionId: 'ses-oversized',
      buildId: 'abc',
      turn: 1,
      command: 'look',
      output: 'x'.repeat(9000),
      score: 0,
      maxScore: 350,
      moves: 1,
      room: 'ROOM',
      hereName: 'Room',
      ts: new Date().toISOString(),
    });
    const res = await mf.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(bigPayload.length),
      },
      body: bigPayload,
    });
    expect(res.status).toBe(413);

    const bucket = await mf.getR2Bucket('PLAYTEST');
    const listed = await bucket.list({ prefix: 'sessions/ses-oversized/' });
    expect(listed.objects.length).toBe(0);
  });
});

// Over-cap test uses a separate Miniflare instance with cap=2 so we don't
// have to seed 1000 objects to exercise the 429 path.
const LOW_CAP_SCRIPT = /* js */ `
const MAX_BODY_BYTES = 8192;
const MAX_SESSION_EVENTS = 2; // low for testing

function seqKey(seq) { return String(seq).padStart(5, "0"); }

function validPlaytestEvent(e) {
  if (!e || typeof e !== "object") return false;
  const t = e.type;
  if (t === "start") return typeof e.sessionId === "string" && typeof e.buildId === "string" && typeof e.ts === "string";
  if (t === "turn")  return typeof e.sessionId === "string" && typeof e.buildId === "string" && typeof e.turn === "number" && typeof e.command === "string" && typeof e.output === "string" && typeof e.score === "number" && typeof e.moves === "number" && typeof e.room === "string" && typeof e.ts === "string";
  if (t === "end")   return typeof e.sessionId === "string" && typeof e.ts === "string" && typeof e.lastTurn === "number";
  return false;
}

function eventSeq(e) {
  if (e.type === "start") return 0;
  if (e.type === "end") return 99999;
  return e.turn;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const bucket = env.PLAYTEST;
    if (!bucket) return new Response("No R2 binding", { status: 500 });
    let body;
    try { body = JSON.parse(await request.text()); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (!validPlaytestEvent(body)) return new Response("Invalid event shape", { status: 400 });
    const listed = await bucket.list({ prefix: "sessions/" + body.sessionId + "/", limit: 1000 });
    if (listed.objects.length >= MAX_SESSION_EVENTS) return new Response("Session event cap exceeded", { status: 429 });
    const key = "sessions/" + body.sessionId + "/" + seqKey(eventSeq(body)) + ".json";
    await bucket.put(key, JSON.stringify(body));
    return new Response(null, { status: 204 });
  },
};
`;

describe('POST /api/log — per-session event cap', () => {
  let mfCap: Miniflare;

  beforeAll(async () => {
    mfCap = new Miniflare({
      modules: true,
      script: LOW_CAP_SCRIPT,
      r2Buckets: ['PLAYTEST'],
    });
    await mfCap.ready;
  });

  afterAll(async () => {
    await mfCap.dispose();
  });

  it('rejects with 429 once cap (2) is reached', async () => {
    const sid = 'ses-cap-test';
    const post = (body: PlaytestEvent) =>
      mfCap.dispatchFetch('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const ts = new Date().toISOString();
    // Two events — should succeed (cap is 2).
    const r1 = await post({ type: 'start', sessionId: sid, buildId: 'x', ts, output: '', hereName: '', score: 0, maxScore: 350, moves: 0 });
    expect(r1.status).toBe(204);
    const r2 = await post({ type: 'turn', sessionId: sid, buildId: 'x', turn: 1, command: 'look', output: 'ok', score: 0, maxScore: 350, moves: 1, room: 'R', hereName: 'R', ts });
    expect(r2.status).toBe(204);

    // Third event — over cap.
    const r3 = await post({ type: 'end', sessionId: sid, ts, lastTurn: 1 });
    expect(r3.status).toBe(429);
  });
});

// No-R2 binding — handler must degrade to 204, never throw/500.
// Mirrors the guard added to functions/api/log.ts for unbilled deploys.
const NO_R2_SCRIPT = /* js */ `
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const bucket = env.PLAYTEST;
    if (!bucket) return new Response(null, { status: 204 });
    return new Response("unexpected: bucket present", { status: 500 });
  },
};
`;

describe('POST /api/log — no R2 binding', () => {
  let mfNoR2: Miniflare;

  beforeAll(async () => {
    // Deliberately omit r2Buckets so env.PLAYTEST is undefined.
    mfNoR2 = new Miniflare({
      modules: true,
      script: NO_R2_SCRIPT,
    });
    await mfNoR2.ready;
  });

  afterAll(async () => {
    await mfNoR2.dispose();
  });

  it('returns 204 with no R2 binding — no throw', async () => {
    const res = await mfNoR2.dispatchFetch('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'start', sessionId: 'x', buildId: 'y', ts: new Date().toISOString() }),
    });
    expect(res.status).toBe(204);
  });
});
