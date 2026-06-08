/**
 * Seam integration tests (§2) — proves the session facade drives the engine
 * identically to the oracle harness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nullSink } from '../../src/shell/sink.js';
import { createSession } from '../../src/shell/session.js';
import type { PlaytestSink, PlaytestEvent } from '../../src/shell/sink.js';

// ---------------------------------------------------------------------------
// The 218-command golden sequence (copied from walkthrough-master.test.ts so
// both sides compare the exact same input against the exact same golden file).
// ---------------------------------------------------------------------------

const COMMANDS: readonly string[] = [
  // ── West of House — opening ─────────────────────────────────────────────
  'look',
  'examine mailbox',
  'open mailbox',
  'take leaflet',
  'read leaflet',
  'close mailbox',
  'examine mailbox',
  'inventory',
  'score',
  'diagnose',
  // ── North of House ────────────────────────────────────────────────────────
  'north',
  'look',
  'examine house',
  'south',
  // ── East of House (Behind House) ─────────────────────────────────────────
  'west',
  'north',
  'east',
  'look',
  'examine window',
  'open window',
  'examine window',
  // ── South of House (quick visit) ─────────────────────────────────────────
  'south',
  'look',
  'examine house',
  'north',
  'east',
  // ── Enter Kitchen via open window ─────────────────────────────────────────
  'west',
  'look',
  'examine table',
  'examine bottle',
  'take bottle',
  'examine sandwich bag',
  'take sandwich bag',
  'examine chimney',
  'inventory',
  'drop bottle',
  'drop sandwich bag',
  // ── Attic (dark — lit→dark, no grue since Kitchen was lit) ───────────────
  'up',
  'look',
  'down',
  // ── Living Room ───────────────────────────────────────────────────────────
  'west',
  'look',
  'examine trophy case',
  'examine rug',
  'examine trap door',
  'examine sword',
  'examine door',
  'take sword',
  'west',
  'take lamp',
  'inventory',
  'score',
  // ── meta-verbs ────────────────────────────────────────────────────────────
  'verbose',
  'brief',
  // ── easter eggs ───────────────────────────────────────────────────────────
  'xyzzy',
  'plugh',
  'frobozz',
  // ── error / edge cases ────────────────────────────────────────────────────
  'zorkify',
  'take',
  'frotz lamp',
  'examine',
  // ── chained multi-command turns ──────────────────────────────────────────
  'look. score',
  'inventory. diagnose',
  // ── underground descent ───────────────────────────────────────────────────
  'move rug',
  'open trap door',
  'turn on lamp',
  'look',
  'down',
  'look',
  'score',
  'examine ramp',
  // ── Troll Room ────────────────────────────────────────────────────────────
  'north',
  'look',
  'examine troll',
  'east',
  'west',
  'south',
  // ── East of Chasm + Gallery + Studio ─────────────────────────────────────
  'south',
  'look',
  'examine chasm',
  'east',
  'look',
  'examine painting',
  'take painting',
  'score',
  'inventory',
  'drop painting',
  'take painting',
  'north',
  'look',
  'examine studio',
  'south',
  'west',
  'examine east of chasm',
  'north',
  'look',
  'inventory',
  // ── Troll Room (second visit) ─────────────────────────────────────────────
  'north',
  'look',
  'south',
  // ── GRUE DEATH ────────────────────────────────────────────────────────────
  'turn off lamp',
  'look',
  'south',
  // ── Post-resurrection at FOREST-1 ─────────────────────────────────────────
  'look',
  'inventory',
  'diagnose',
  'score',
  'examine forest',
  // ── Forest Path ───────────────────────────────────────────────────────────
  'east',
  'look',
  'examine tree',
  'examine path',
  'up',
  'look',
  'examine view',
  'examine birds',
  'down',
  // ── Grating Clearing ──────────────────────────────────────────────────────
  'north',
  'look',
  'examine grate',
  'open grate',
  // ── Forest 1 ─────────────────────────────────────────────────────────────
  'south',
  'west',
  'look',
  'north',
  'south',
  // ── Forest 3 → South of House ─────────────────────────────────────────────
  'south',
  'look',
  'examine forest',
  'examine trees',
  'north',
  'look',
  'south',
  'nw',
  'look',
  'examine house',
  // ── East of House → Clearing ──────────────────────────────────────────────
  'east',
  'east',
  'look',
  'examine clearing',
  // ── Forest 2 + Mountains ──────────────────────────────────────────────────
  'north',
  'look',
  'east',
  'look',
  'examine mountain',
  'up',
  'west',
  'west',
  'north',
  'west',
  'east',
  'east',
  'south',
  // ── Canyon area ───────────────────────────────────────────────────────────
  'east',
  'look',
  'examine canyon',
  'examine river',
  'examine view',
  'south',
  'down',
  'look',
  'examine cliff',
  'examine falls',
  'down',
  'look',
  'up',
  'down',
  'north',
  'look',
  'examine rainbow',
  'examine beach',
  'examine falls',
  'ne',
  'look',
  'east',
  'look',
  'west',
  'west',
  'sw',
  'up',
  'up',
  'nw',
  // ── Return to house ───────────────────────────────────────────────────────
  'west',
  'south',
  'look',
  'west',
  'look',
  'east',
  'north',
  'east',
  'look',
  'west',
  'look',
  'examine sandwich bag',
  'east',
  'west',
  'west',
  // ── Trophy case deposit + scoring ─────────────────────────────────────────
  'open trap door',
  'open trophy case',
  'put painting in trophy case',
  'score',
  'examine trophy case',
  'diagnose',
  'look',
  // ── More Living Room verbs ────────────────────────────────────────────────
  'close trophy case',
  'open trophy case',
  'take painting',
  'drop painting',
  'put painting in trophy case',
  'score',
  // ── Lamp off / dark in Living Room ───────────────────────────────────────
  'turn off lamp',
  'look',
  'turn on lamp',
  'look',
  // ── Chained commands ─────────────────────────────────────────────────────
  'look. score. inventory',
  // ── Final stats ──────────────────────────────────────────────────────────
  'score',
  'diagnose',
  'inventory',
];

const GOLDEN_PATH = join(import.meta.dirname, '../golden/walkthrough-master.txt');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureSink(): PlaytestSink & { events: PlaytestEvent[] } {
  const events: PlaytestEvent[] = [];
  return { events, emit(e) { events.push(e); }, close() {} };
}

// Build a transcript from the session in the same format runEngine() uses:
//   - intro banner (start())
//   - for each command: "\n> <cmd>\n" then output (if non-empty)
// This is what the committed golden was generated from.
function replayThroughFacade(): string {
  const session = createSession({ sink: nullSink, seed: 42 });
  const lines: string[] = [];

  lines.push(session.start());

  for (const cmd of COMMANDS) {
    lines.push('');
    lines.push(`> ${cmd}`);
    const output = session.submit(cmd);
    if (output.length > 0) {
      lines.push(output);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seam test — golden through facade', () => {
  it('replaying 218 commands via createSession produces byte-identical output to the committed golden', () => {
    const run1 = replayThroughFacade();
    const run2 = replayThroughFacade();
    // Determinism: two replays must be identical (createSession resets state on construction).
    expect(run1).toBe(run2);

    const golden = readFileSync(GOLDEN_PATH, 'utf8');
    expect(run1).toBe(golden);
  });
});

describe('seam test — snapshot contract', () => {
  it('snapshot() exposes all seven GameView fields with correct types', () => {
    const session = createSession({ sink: nullSink });
    session.start();
    // Check initial snapshot.
    const v0 = session.snapshot();
    expect(typeof v0.here).toBe('string');
    expect(v0.here.length).toBeGreaterThan(0);
    expect(typeof v0.hereName).toBe('string');
    expect(v0.hereName.length).toBeGreaterThan(0);
    expect(Array.isArray(v0.exits)).toBe(true);
    expect(typeof v0.score).toBe('number');
    expect(typeof v0.maxScore).toBe('number');
    expect(typeof v0.moves).toBe('number');
    expect(typeof v0.inMaze).toBe('boolean');

    // Check after a turn.
    session.submit('north');
    const v1 = session.snapshot();
    expect(typeof v1.here).toBe('string');
    expect(typeof v1.hereName).toBe('string');
    expect(Array.isArray(v1.exits)).toBe(true);
    expect(typeof v1.score).toBe('number');
    expect(typeof v1.maxScore).toBe('number');
    expect(typeof v1.moves).toBe('number');
    expect(typeof v1.inMaze).toBe('boolean');
  });

  it('exits[] entries have dir and known fields (known is always a boolean, not a discovery signal)', () => {
    const session = createSession({ sink: nullSink });
    session.start();
    const v = session.snapshot();
    for (const exit of v.exits) {
      expect(typeof exit.dir).toBe('string');
      // known is static (computed from whether exit.to is defined) — not a discovery signal.
      // We pin the type without asserting any specific transition behavior.
      expect(typeof exit.known).toBe('boolean');
    }
  });

  it('maxScore is the full-game total (350)', () => {
    const session = createSession({ sink: nullSink });
    session.start();
    expect(session.snapshot().maxScore).toBe(350);
  });

  it('moves increments each submit', () => {
    const session = createSession({ sink: nullSink });
    session.start();
    const m0 = session.snapshot().moves;
    session.submit('look');
    expect(session.snapshot().moves).toBe(m0 + 1);
  });
});

describe('seam test — sink emission lifecycle', () => {
  it('start() emits exactly one SessionStart', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    expect(sink.events.filter(e => e.type === 'start')).toHaveLength(1);
  });

  it('each submit() emits exactly one TurnEvent with correct fields', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    const output = session.submit('look');
    const snap = session.snapshot();
    const turns = sink.events.filter(e => e.type === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      type: 'turn',
      turn: 1,
      command: 'look',
      output,
      score: snap.score,
      moves: snap.moves,
      room: snap.here,
    });
  });

  it('close() emits exactly one SessionEnd', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.close();
    expect(sink.events.filter(e => e.type === 'end')).toHaveLength(1);
  });

  it('full lifecycle: one SessionStart, N TurnEvents, one SessionEnd', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.submit('look');
    session.submit('north');
    session.close();

    expect(sink.events.filter(e => e.type === 'start')).toHaveLength(1);
    expect(sink.events.filter(e => e.type === 'turn')).toHaveLength(2);
    expect(sink.events.filter(e => e.type === 'end')).toHaveLength(1);
  });

  it('SessionEnd.lastTurn equals the number of submit() calls', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.submit('look');
    session.submit('north');
    session.submit('east');
    session.close();
    const end = sink.events.find(e => e.type === 'end');
    expect(end).toMatchObject({ type: 'end', lastTurn: 3 });
  });

  it('TurnEvent sessionId is consistent across the session', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.submit('look');
    session.close();
    const ids = new Set(sink.events.map(e => e.sessionId));
    expect(ids.size).toBe(1);
  });

  it('second close() does not emit a second SessionEnd', () => {
    const sink = captureSink();
    const session = createSession({ sink });
    session.start();
    session.close();
    session.close();
    expect(sink.events.filter(e => e.type === 'end')).toHaveLength(1);
  });
});
