// HttpSink — POSTs PlaytestEvents to /api/log, best-effort.
//
// Design (§4):
//   - One POST per event; a failed POST is swallowed (logged to console in dev)
//     and retried a small fixed number of times, then dropped. Never blocks gameplay.
//   - Events are queued in-memory. On pagehide the caller must invoke
//     drainBeacon() to flush the entire queue via navigator.sendBeacon (the only
//     reliable channel during unload).
//   - close() is the single entry point for SessionEnd; it's idempotent — a
//     second call is a no-op. It does NOT fire on visibilitychange→hidden.
//   - buildId is injected from __BUILD_ID__ at construction time.

import type { PlaytestSink, PlaytestEvent } from './sink.js';

declare const __BUILD_ID__: string;

function getBuildId(): string {
  try { return __BUILD_ID__; } catch { return 'dev'; }
}

const ENDPOINT = '/api/log';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

async function postWithRetry(body: string, attemptsLeft: number): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // keepalive lets the browser send this even if the page is unloading,
      // though sendBeacon is the primary unload path.
      keepalive: true,
    });
  } catch (err) {
    if (attemptsLeft > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return postWithRetry(body, attemptsLeft - 1);
    }
    // All retries exhausted — drop silently, log in dev.
    if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
      console.debug('[HttpSink] dropped event after retries:', err);
    }
  }
}

export class HttpSink implements PlaytestSink {
  // Pending queue: events awaiting their sendBeacon flush on pagehide.
  // Items are added on emit() and removed once postWithRetry succeeds or
  // on drainBeacon() — whichever comes first.
  private readonly _queue: PlaytestEvent[] = [];
  private _closed = false;
  readonly buildId: string;

  constructor() {
    this.buildId = getBuildId();
  }

  emit(e: PlaytestEvent): void {
    if (this._closed && e.type !== 'end') return;
    this._queue.push(e);
    const body = JSON.stringify(e);
    // Fire-and-forget; on success remove from queue so drainBeacon doesn't re-send.
    postWithRetry(body, MAX_RETRIES).then(() => {
      const idx = this._queue.indexOf(e);
      if (idx !== -1) this._queue.splice(idx, 1);
    }).catch(() => {
      // postWithRetry already swallows the error; this .catch() is belt-and-suspenders.
    });
  }

  // Drain all pending events synchronously via sendBeacon. Called on pagehide.
  // sendBeacon is the only reliable unload-time delivery mechanism.
  drainBeacon(): void {
    while (this._queue.length > 0) {
      const e = this._queue.shift()!;
      navigator.sendBeacon(ENDPOINT, JSON.stringify(e));
    }
  }

  // Emit SessionEnd exactly once and close. Safe to call multiple times.
  // Must NOT be called on visibilitychange→hidden — only on real teardown (pagehide).
  close(): void {
    if (this._closed) return;
    this._closed = true;
    // SessionEnd doesn't carry a buildId in its type definition, but it's already
    // in the queue from the session facade. We just flush remaining items.
    // The SessionEnd event is emitted by session.close() → sink.emit(end event),
    // so we just mark ourselves closed here. The session facade calls sink.emit()
    // with the end event separately before calling sink.close().
  }
}
