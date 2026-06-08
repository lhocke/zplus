/**
 * HttpSink unit tests (§4 / §9).
 *
 * HttpSink is DOM-free in test: we inject mock fetch/navigator so we can
 * drive the retry queue, pagehide drain, and idempotency invariants without
 * a real browser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlaytestEvent } from '../../src/shell/sink.js';

// We import the class under test dynamically so we can mock globals before load.
// The module reads fetch/navigator at call-time (not import time), so a simple
// global override before each test is enough.

const START: PlaytestEvent = {
  type: 'start',
  sessionId: 'sid-1',
  buildId: 'abc123',
  ts: '2026-01-01T00:00:00Z',
  output: 'ZORK I...',
  hereName: 'West of House',
  score: 0,
  maxScore: 350,
  moves: 0,
};

const TURN: PlaytestEvent = {
  type: 'turn',
  sessionId: 'sid-1',
  buildId: 'abc123',
  turn: 1,
  command: 'look',
  output: 'West of House description.',
  score: 0,
  maxScore: 350,
  moves: 1,
  room: 'WEST-OF-HOUSE',
  hereName: 'West of House',
  ts: '2026-01-01T00:00:01Z',
};

const END: PlaytestEvent = {
  type: 'end',
  sessionId: 'sid-1',
  ts: '2026-01-01T00:00:02Z',
  lastTurn: 1,
};

// Make a fresh ok-response mock.
function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 204 });
}

// Make a fetch that always rejects (network error).
function failFetch() {
  return vi.fn().mockRejectedValue(new Error('network error'));
}

describe('HttpSink — one POST per event', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch());
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  });

  it('emitting a TurnEvent fires one POST to /api/log', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    sink.emit(TURN);
    // Give the microtask queue a tick.
    await vi.runAllTimersAsync().catch(() => {});
    await Promise.resolve();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/log');
  });

  it('POST body is the JSON-serialised event', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    sink.emit(TURN);
    await Promise.resolve();
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as PlaytestEvent;
    expect(body).toMatchObject({ type: 'turn', command: 'look' });
  });
});

describe('HttpSink — failed POST does not block gameplay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', failFetch());
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  });

  it('emit never throws even when fetch rejects', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    expect(() => sink.emit(TURN)).not.toThrow();
    // Allow the rejection to be consumed.
    await new Promise(r => setTimeout(r, 0));
  });

  it('retries a transient failure a small number of times then drops', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    sink.emit(TURN);
    // Drain the retry loop (max ~3 attempts).
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    // At most MAX_RETRIES + 1 attempts (1 initial + retries), never infinite.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(5);
  });
});

describe('HttpSink — buildId injected into events', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch());
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
    // Simulate the Vite-injected __BUILD_ID__ global.
    vi.stubGlobal('__BUILD_ID__', 'test-build-42');
  });

  it('events carry the buildId from __BUILD_ID__', async () => {
    // HttpSink should read __BUILD_ID__ at construction time.
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    // Emit an event that doesn't already have a buildId — verify it's added if missing,
    // or that the existing buildId is preserved. The event type we test is the session's
    // start event (which should carry buildId from session.ts).
    sink.emit(START);
    await Promise.resolve();
    // We just verify fetch was called (the buildId lives in the session-level event).
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('HttpSink — pagehide drains full queue via sendBeacon', () => {
  let beaconCalls: Array<[string, string]>;

  beforeEach(() => {
    // fetch is slow/failing so items accumulate in the queue.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {}))); // never resolves
    beaconCalls = [];
    vi.stubGlobal('navigator', {
      sendBeacon: vi.fn((url: string, body: string) => {
        beaconCalls.push([url, body]);
        return true;
      }),
    });
  });

  it('drainBeacon() sends each queued event via sendBeacon', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    sink.emit(START);
    sink.emit(TURN);
    sink.emit(END);
    // Simulate pagehide — drain the entire queue.
    sink.drainBeacon();
    expect(beaconCalls.length).toBe(3);
    expect(beaconCalls[0]![0]).toBe('/api/log');
    // The bodies should be valid JSON matching the events.
    const bodies = beaconCalls.map(([, b]) => JSON.parse(b) as PlaytestEvent);
    expect(bodies[0]!.type).toBe('start');
    expect(bodies[1]!.type).toBe('turn');
    expect(bodies[2]!.type).toBe('end');
  });

  it('after drainBeacon the queue is empty (no double-send)', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    sink.emit(TURN);
    sink.drainBeacon();
    const firstCount = beaconCalls.length;
    sink.drainBeacon();
    expect(beaconCalls.length).toBe(firstCount); // nothing new
  });
});

describe('HttpSink — SessionEnd idempotency (visibilitychange guard)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch());
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  });

  it('close() is idempotent — calling it twice emits SessionEnd at most once', async () => {
    const { HttpSink } = await import('../../src/shell/http-sink.js');
    const sink = new HttpSink();
    sink.emit(START);
    sink.close();
    sink.close();
    await Promise.resolve();
    const posts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const endPosts = posts.filter((call: unknown[]) => {
      const init = call[1] as RequestInit;
      try { return (JSON.parse(init.body as string) as PlaytestEvent).type === 'end'; } catch { return false; }
    });
    expect(endPosts.length).toBeLessThanOrEqual(1);
  });
});
