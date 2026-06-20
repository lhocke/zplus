/**
 * PB-TEL — PlaytestSink save/restore/restart events (spec §7.2, §9 Wave 2).
 *
 * Done-criteria:
 *   - SaveEvent / RestoreEvent / RestartEvent are in the PlaytestEvent union
 *   - session.submit('save') emits a SaveEvent with ok + turn + slot
 *   - session.submit('restore') emits a RestoreEvent with ok + reason
 *   - session.restart() / submit('restart') emits a RestartEvent
 *   - FileSink renders each as a one-line marker (=== save slot N (ok) ===)
 *   - forced save failure → SaveEvent ok=false
 *   - restore from empty slot → RestoreEvent ok=false, reason='empty'
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PlaytestEvent, PlaytestSink, SaveEvent, RestoreEvent, RestartEvent } from '../../src/shell/sink.js';
import { FileSink } from '../../src/shell/sink.js';
import { createSession } from '../../src/shell/session.js';
import { LocalStorageSavePort } from '../../src/shell/save-port.js';
import type { SavePort, RestoreFailReason } from '../../src/shell/save-port.js';
import type { SaveState } from '../../src/engine/save-state.js';
import type { SaveSlotMeta } from '../../src/shell/save-port.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(n: number): string | null { return [...this.store.keys()][n] ?? null; }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

function captureSink(): PlaytestSink & { events: PlaytestEvent[] } {
  const events: PlaytestEvent[] = [];
  return { events, emit(e) { events.push(e); }, close() {} };
}

function makeSession(storage: MapStorage, sink: PlaytestSink & { events: PlaytestEvent[] }) {
  const port = new LocalStorageSavePort(storage);
  const session = createSession({ sink, savePort: port, seed: 42 });
  session.start();
  return session;
}

// A SavePort that always throws on write() — for testing failed saves.
class FailPort implements SavePort {
  write(_slot: string, _state: SaveState): void { throw new DOMException('QuotaExceededError'); }
  read(_slot: string): SaveState | undefined { return undefined; }
  readWithReason(_slot: string): SaveState | RestoreFailReason { return 'empty'; }
  list(): SaveSlotMeta[] { return []; }
  remove(_slot: string): void {}
}

// ---------------------------------------------------------------------------
// 1. SaveEvent emitted on successful save
// ---------------------------------------------------------------------------

describe('PB-TEL — SaveEvent on successful save', () => {
  it('save emits a SaveEvent with ok=true', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save');
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(ev).toBeDefined();
    expect(ev!.ok).toBe(true);
  });

  it('SaveEvent carries slot "1" for bare "save"', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save');
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(ev!.slot).toBe('1');
  });

  it('SaveEvent carries slot "2" for "save 2"', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save 2');
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(ev!.slot).toBe('2');
  });

  it('SaveEvent has sessionId, buildId, turn, ts', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save');
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(typeof ev!.sessionId).toBe('string');
    expect(typeof ev!.buildId).toBe('string');
    expect(typeof ev!.turn).toBe('number');
    expect(typeof ev!.ts).toBe('string');
  });

  it('SaveEvent turn is 1-based and matches turn count', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('look');   // turn 1
    session.submit('save');   // turn 2
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(ev!.turn).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. SaveEvent ok=false on failure
// ---------------------------------------------------------------------------

describe('PB-TEL — SaveEvent on failed save', () => {
  it('forced save failure → SaveEvent ok=false', () => {
    const sink = captureSink();
    const session = createSession({ sink, savePort: new FailPort(), seed: 42 });
    session.start();
    session.submit('save');
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(ev).toBeDefined();
    expect(ev!.ok).toBe(false);
  });

  it('failed save still emits the slot', () => {
    const sink = captureSink();
    const session = createSession({ sink, savePort: new FailPort(), seed: 42 });
    session.start();
    session.submit('save 3');
    const ev = sink.events.find(e => e.type === 'save') as SaveEvent | undefined;
    expect(ev!.slot).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// 3. RestoreEvent on restore from populated slot
// ---------------------------------------------------------------------------

describe('PB-TEL — RestoreEvent on successful restore', () => {
  it('restore from a written slot → RestoreEvent ok=true, reason="ok"', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save');
    session.submit('restore');
    const ev = sink.events.find(e => e.type === 'restore') as RestoreEvent | undefined;
    expect(ev).toBeDefined();
    expect(ev!.ok).toBe(true);
    expect(ev!.reason).toBe('ok');
  });

  it('RestoreEvent carries slot "2" for "restore 2"', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save 2');
    session.submit('restore 2');
    const ev = sink.events.find(e => e.type === 'restore') as RestoreEvent | undefined;
    expect(ev!.slot).toBe('2');
  });

  it('RestoreEvent has sessionId, buildId, ts', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('save');
    session.submit('restore');
    const ev = sink.events.find(e => e.type === 'restore') as RestoreEvent | undefined;
    expect(typeof ev!.sessionId).toBe('string');
    expect(typeof ev!.buildId).toBe('string');
    expect(typeof ev!.ts).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 4. RestoreEvent ok=false from empty slot
// ---------------------------------------------------------------------------

describe('PB-TEL — RestoreEvent on failed restore (empty slot)', () => {
  it('restore from empty slot → RestoreEvent ok=false, reason="empty"', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    // Nothing saved — slot is empty
    session.submit('restore');
    const ev = sink.events.find(e => e.type === 'restore') as RestoreEvent | undefined;
    expect(ev).toBeDefined();
    expect(ev!.ok).toBe(false);
    expect(ev!.reason).toBe('empty');
  });

  it('RestoreEvent slot matches the attempted slot', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('restore 3');
    const ev = sink.events.find(e => e.type === 'restore') as RestoreEvent | undefined;
    expect(ev!.slot).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// 5. RestartEvent on restart
// ---------------------------------------------------------------------------

describe('PB-TEL — RestartEvent on restart', () => {
  it('restart verb emits a RestartEvent', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('restart');
    const ev = sink.events.find(e => e.type === 'restart') as RestartEvent | undefined;
    expect(ev).toBeDefined();
  });

  it('RestartEvent has sessionId and ts', () => {
    const storage = new MapStorage();
    const sink = captureSink();
    const session = makeSession(storage, sink);
    session.submit('restart');
    const ev = sink.events.find(e => e.type === 'restart') as RestartEvent | undefined;
    expect(typeof ev!.sessionId).toBe('string');
    expect(typeof ev!.ts).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 6. FileSink renders save/restore/restart markers
// ---------------------------------------------------------------------------

describe('PB-TEL — FileSink renders save/restore/restart markers', () => {
  let tmpDir: string;
  let logsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zork-tel-'));
    logsDir = join(tmpDir, 'logs');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function readLog(): string {
    const [f] = readdirSync(logsDir);
    return readFileSync(join(logsDir, f!), 'utf8');
  }

  it('FileSink renders SaveEvent as a one-line marker', () => {
    const sink = new FileSink(logsDir);
    const ev: SaveEvent = {
      type: 'save', sessionId: 'sid', buildId: 'b', turn: 1, slot: '2', ok: true, ts: new Date().toISOString(),
    };
    sink.emit(ev);
    sink.close();
    const content = readLog();
    expect(content).toContain('save');
    expect(content).toContain('slot');
    expect(content).toContain('2');
    // ok marker present
    expect(content.toLowerCase()).toMatch(/ok|success/);
  });

  it('FileSink renders SaveEvent with ok=false', () => {
    const sink = new FileSink(logsDir);
    const ev: SaveEvent = {
      type: 'save', sessionId: 'sid', buildId: 'b', turn: 1, slot: '1', ok: false, ts: new Date().toISOString(),
    };
    sink.emit(ev);
    sink.close();
    const content = readLog();
    expect(content).toContain('save');
    expect(content.toLowerCase()).toMatch(/fail|false/);
  });

  it('FileSink renders RestoreEvent as a one-line marker', () => {
    const sink = new FileSink(logsDir);
    const ev: RestoreEvent = {
      type: 'restore', sessionId: 'sid', buildId: 'b', slot: '1', ok: true, reason: 'ok', ts: new Date().toISOString(),
    };
    sink.emit(ev);
    sink.close();
    const content = readLog();
    expect(content).toContain('restore');
    expect(content).toContain('slot');
  });

  it('FileSink renders RestartEvent as a one-line marker', () => {
    const sink = new FileSink(logsDir);
    const ev: RestartEvent = {
      type: 'restart', sessionId: 'sid', ts: new Date().toISOString(),
    };
    sink.emit(ev);
    sink.close();
    const content = readLog();
    expect(content).toContain('restart');
  });

  it('save/restore markers appear in the transcript (integration via session)', () => {
    const storage = new MapStorage();
    const fileSink = new FileSink(logsDir);
    const port = new LocalStorageSavePort(storage);
    const session = createSession({ sink: fileSink, savePort: port, seed: 42 });
    session.start();
    session.submit('save');
    session.submit('restore');
    session.close();

    const content = readLog();
    expect(content).toContain('save');
    expect(content).toContain('restore');
    // both markers should be visible as boundary lines
    expect(content.split('\n').some(l => l.includes('save') && l.includes('slot'))).toBe(true);
    expect(content.split('\n').some(l => l.includes('restore') && l.includes('slot'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Events are in the PlaytestEvent union (type-level + runtime)
// ---------------------------------------------------------------------------

describe('PB-TEL — type union membership', () => {
  it('SaveEvent type literal is "save"', () => {
    const ev: PlaytestEvent = {
      type: 'save', sessionId: 's', buildId: 'b', turn: 1, slot: '1', ok: true, ts: 't',
    };
    expect(ev.type).toBe('save');
  });

  it('RestoreEvent type literal is "restore"', () => {
    const ev: PlaytestEvent = {
      type: 'restore', sessionId: 's', buildId: 'b', slot: '1', ok: true, reason: 'ok', ts: 't',
    };
    expect(ev.type).toBe('restore');
  });

  it('RestartEvent type literal is "restart"', () => {
    const ev: PlaytestEvent = {
      type: 'restart', sessionId: 's', ts: 't',
    };
    expect(ev.type).toBe('restart');
  });
});
