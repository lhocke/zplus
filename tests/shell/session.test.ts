import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PlaytestSink, PlaytestEvent } from '../../src/shell/sink.js';
import { nullSink } from '../../src/shell/sink.js';
import { createSession } from '../../src/shell/session.js';

// Collects emitted events for assertion.
function captureSink(): PlaytestSink & { events: PlaytestEvent[] } {
  const events: PlaytestEvent[] = [];
  return {
    events,
    emit(e) { events.push(e); },
    close() {},
  };
}

describe('nullSink', () => {
  it('emit never throws', () => {
    expect(() => nullSink.emit({
      type: 'start', sessionId: 'x', buildId: 'b', ts: 't',
      output: '', hereName: 'Test Room', score: 0, maxScore: 350, moves: 0,
    })).not.toThrow();
  });

  it('close never throws', () => {
    expect(() => nullSink.close()).not.toThrow();
  });
});

describe('createSession lifecycle', () => {
  it('start emits one SessionStart', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    const starts = sink.events.filter(e => e.type === 'start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.type).toBe('start');
  });

  it('submit emits exactly one TurnEvent per call', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    await session.submit('look');
    await session.submit('north');
    const turns = sink.events.filter(e => e.type === 'turn');
    expect(turns).toHaveLength(2);
  });

  it('close emits one SessionEnd', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.close();
    const ends = sink.events.filter(e => e.type === 'end');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.type).toBe('end');
  });

  it('close is idempotent — second close does not double-emit', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.close();
    session.close();
    const ends = sink.events.filter(e => e.type === 'end');
    expect(ends).toHaveLength(1);
  });

  it('TurnEvent has 1-based turn index', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    await session.submit('look');
    await session.submit('north');
    const turns = sink.events.filter(e => e.type === 'turn');
    expect(turns[0]).toMatchObject({ type: 'turn', turn: 1 });
    expect(turns[1]).toMatchObject({ type: 'turn', turn: 2 });
  });

  it('TurnEvent fields are consistent with submit return + snapshot', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    const output = await session.submit('look');
    const snap = session.snapshot();
    const turns = sink.events.filter(e => e.type === 'turn');
    expect(turns[0]).toMatchObject({
      type: 'turn',
      command: 'look',
      output,
      score: snap.score,
      moves: snap.moves,
      room: snap.here,
    });
  });

  it('SessionEnd lastTurn equals the number of submits', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    await session.submit('look');
    await session.submit('north');
    session.close();
    const end = sink.events.find(e => e.type === 'end');
    expect(end).toMatchObject({ type: 'end', lastTurn: 2 });
  });

  it('empty submit("") emits no TurnEvent, no crash', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    const out = await session.submit('');
    expect(out).toBe('');
    const turns = sink.events.filter(e => e.type === 'turn');
    expect(turns).toHaveLength(0);
  });

  it('whitespace-only submit emits no TurnEvent, no crash', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    await session.submit('   ');
    const turns = sink.events.filter(e => e.type === 'turn');
    expect(turns).toHaveLength(0);
  });

  it('submit returns engine output string', async () => {
    const session = createSession({ sink: nullSink });
    session.start();
    const output = await session.submit('look');
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('start returns intro banner string', () => {
    const session = createSession({ sink: nullSink });
    const banner = session.start();
    expect(typeof banner).toBe('string');
    expect(banner).toContain('ZORK');
  });

  it('snapshot returns a GameView with all required fields', () => {
    const session = createSession({ sink: nullSink });
    session.start();
    const v = session.snapshot();
    expect(typeof v.here).toBe('string');
    expect(typeof v.hereName).toBe('string');
    expect(typeof v.score).toBe('number');
    expect(typeof v.maxScore).toBe('number');
    expect(typeof v.moves).toBe('number');
    expect(typeof v.inMaze).toBe('boolean');
    expect(Array.isArray(v.exits)).toBe(true);
  });
});

describe('createSession determinism', () => {
  it('default seed 42 produces deterministic output', async () => {
    const s1 = createSession({ sink: nullSink });
    const s2 = createSession({ sink: nullSink });
    expect(s1.start()).toBe(s2.start());
    expect(await s1.submit('look')).toBe(await s2.submit('look'));
  });
});

describe('createSession event shapes — no PII fields', () => {
  it('TurnEvent type has no userAgent field', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    await session.submit('look');
    const turn = sink.events.find(e => e.type === 'turn');
    expect(turn).toBeDefined();
    expect(turn).not.toHaveProperty('userAgent');
    expect(turn).not.toHaveProperty('ip');
  });

  it('SessionStart type has no userAgent field', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    const start = sink.events.find(e => e.type === 'start');
    expect(start).toBeDefined();
    expect(start).not.toHaveProperty('userAgent');
    expect(start).not.toHaveProperty('ip');
  });

  it('SessionEnd type has no userAgent field', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.close();
    const end = sink.events.find(e => e.type === 'end');
    expect(end).toBeDefined();
    expect(end).not.toHaveProperty('userAgent');
    expect(end).not.toHaveProperty('ip');
  });
});

describe('module-state reset across two sessions', () => {
  it('two sessions in the same process start clean (rug not moved)', async () => {
    // First session: move the rug.
    const s1 = createSession({ sink: nullSink });
    s1.start();
    // Navigate to living room.
    await s1.submit('north');
    await s1.submit('east');
    await s1.submit('open window');
    await s1.submit('west');
    await s1.submit('west');
    const rugResult = await s1.submit('move rug');
    expect(rugResult).toContain('rug is moved');

    // Second session should start fresh — rug not moved.
    const s2 = createSession({ sink: nullSink });
    s2.start();
    await s2.submit('north');
    await s2.submit('east');
    await s2.submit('open window');
    await s2.submit('west');
    await s2.submit('west');
    const rugResult2 = await s2.submit('move rug');
    // Fresh session: the rug moves again (not "previously moved").
    expect(rugResult2).toContain('rug is moved');
    expect(rugResult2).not.toContain('impossible to move');
  });
});

describe('TurnEvent sessionId consistency', () => {
  it('all events in a session share the same sessionId', async () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    await session.submit('look');
    await session.submit('north');
    session.close();
    const ids = new Set(sink.events.map(e => e.sessionId));
    expect(ids.size).toBe(1);
  });

  it('sessionId is a non-empty string', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    expect(sink.events[0]!.sessionId).toBeTruthy();
  });
});

describe('FileSink', () => {
  let tmpDir: string;
  let logsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zork-filesink-'));
    logsDir = join(tmpDir, 'playtest-logs');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates playtest-logs dir if missing', async () => {
    const { FileSink } = await import('../../src/shell/sink.js');
    // Dir does not yet exist.
    expect(existsSync(logsDir)).toBe(false);
    const sink = new FileSink(logsDir);
    sink.close();
    // Dir created on construction.
    expect(existsSync(logsDir)).toBe(true);
  });

  it('writes human-readable flat-text format (not JSON)', async () => {
    const { FileSink } = await import('../../src/shell/sink.js');
    const sink = new FileSink(logsDir);

    sink.emit({
      type: 'start', sessionId: 'test-sid', buildId: 'abc', ts: '2026-01-01T00:00:00Z',
      output: 'ZORK I banner text here.',
      hereName: 'West of House', score: 0, maxScore: 350, moves: 0,
    });
    sink.emit({
      type: 'turn',
      sessionId: 'test-sid',
      buildId: 'abc',
      turn: 1,
      command: 'look',
      output: 'West of House\nYou are standing.',
      score: 0,
      maxScore: 350,
      moves: 1,
      room: 'WEST-OF-HOUSE',
      hereName: 'West of House',
      ts: '2026-01-01T00:00:01Z',
    });
    sink.emit({ type: 'end', sessionId: 'test-sid', ts: '2026-01-01T00:00:02Z', lastTurn: 1 });
    sink.close();

    const [logFile] = readdirSync(logsDir);
    expect(logFile).toBeDefined();
    const content = readFileSync(join(logsDir, logFile!), 'utf8');

    // Should NOT be JSON.
    expect(() => JSON.parse(content)).toThrow();

    // Should have the banner block right after the header.
    expect(content).toContain('ZORK I banner text here.');

    // Should have the command line.
    expect(content).toContain('> look');

    // Should have verbatim engine output.
    expect(content).toContain('West of House');
    expect(content).toContain('You are standing.');

    // Status lines use the display name (hereName), not the ObjectId.
    expect(content).toMatch(/\[.*West of House.*0.*350.*1.*\]/);
    expect(content).not.toMatch(/WEST-OF-HOUSE/);

    // Should have a terminator on close.
    expect(content).toContain('=== end ===');
  });

  it('uses appendFileSync — crash-safety: each emit lands immediately', async () => {
    // We can only verify the format (synchronous write) indirectly:
    // after each emit, we read the file and verify content is present.
    const { FileSink } = await import('../../src/shell/sink.js');
    const sink = new FileSink(logsDir);
    sink.emit({
      type: 'start', sessionId: 'sid', buildId: 'b', ts: '2026-01-01T00:00:00Z',
      output: 'Banner.', hereName: 'West of House', score: 0, maxScore: 350, moves: 0,
    });

    const [logFile] = readdirSync(logsDir);
    const contentAfterStart = readFileSync(join(logsDir, logFile!), 'utf8');
    expect(contentAfterStart.length).toBeGreaterThan(0);

    sink.emit({
      type: 'turn',
      sessionId: 'sid',
      buildId: 'b',
      turn: 1,
      command: 'go north',
      output: 'North of House',
      score: 0,
      maxScore: 350,
      moves: 1,
      room: 'NORTH-OF-HOUSE',
      hereName: 'North of House',
      ts: '2026-01-01T00:00:01Z',
    });

    const contentAfterTurn = readFileSync(join(logsDir, logFile!), 'utf8');
    expect(contentAfterTurn).toContain('> go north');
    sink.close();
  });
});
