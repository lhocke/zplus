/**
 * C8 — AGAIN/G replay + lastWon bookkeeping.
 *
 * Red→Green TDD for:
 *   1. AGAIN/G with no prior command → "Beg pardon?"  (gparser.zil:193-195)
 *   2. AGAIN during orphan state → "It's difficult to repeat fragments." (gparser.zil:196-198)
 *   3. AGAIN after a failed parse → "That would just repeat a mistake." (gparser.zil:199-201)
 *   4. AGAIN with unexpected trailing tokens → "I couldn't understand that sentence." (gparser.zil:202-218)
 *   5. AGAIN after a success → replays the last command (gparser.zil:226-233)
 *   6. G is a synonym for AGAIN (gsyntax.zil:9)
 *   7. Repeated AGAIN/G replays the SAME original command (not "again" itself)
 *   8. "repeat a mistake": AGAIN after a failed parse refuses, even after a prior success
 *
 * Messages are verbatim from td1-parser-algorithm.md §17(f):
 *   "Beg pardon?"
 *   "It's difficult to repeat fragments."
 *   "That would just repeat a mistake."
 *   "I couldn't understand that sentence."
 *
 * Oracle: gparser.zil:192-233.
 */

import { describe, it, expect } from 'vitest';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { World } from '../../src/domain/world.js';
import { Parser } from '../../src/engine/parser/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoom(id: string, desc: string, light = true): Room {
  const r = new Room(id, desc);
  if (light) r.set(Flag.Light);
  return r;
}

function makeThing(
  id: string,
  desc: string,
  synonyms: string[],
  adjectives: string[] = [],
  flags: Flag[] = [],
): Thing {
  const t = new Thing(id, desc, { synonyms, adjectives });
  for (const f of flags) t.set(f);
  return t;
}

function makeActor(id: string, synonyms: string[] = []): Actor {
  return new Actor(id, 'actor', { synonyms });
}

/** Build a minimal world: lit room, player, one lamp. */
function makeWorld(): { room: Room; player: Actor; lamp: Thing; world: World } {
  const room = makeRoom('ROOM', 'A room');
  const player = makeActor('PLAYER');
  player.moveTo(room);
  const lamp = makeThing('LAMP', 'brass lantern', ['lamp', 'lantern', 'brass'], ['brass'], [Flag.Takeable]);
  lamp.moveTo(room);
  const world = World.fromObjects([room, player, lamp]);
  return { room, player, lamp, world };
}

// ---------------------------------------------------------------------------
// §1. AGAIN with no prior command → "Beg pardon?"
// ---------------------------------------------------------------------------

describe('C8 — AGAIN: no prior command', () => {
  it('"again" at session start → "Beg pardon?"', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    const result = parser.parse('again', room, player, world);
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      expect(result.message).toBe('Beg pardon?');
    }
  });

  it('"g" at session start → "Beg pardon?" (G synonym)', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    const result = parser.parse('g', room, player, world);
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      expect(result.message).toBe('Beg pardon?');
    }
  });
});

// ---------------------------------------------------------------------------
// §2. AGAIN during orphan state → "It's difficult to repeat fragments."
// ---------------------------------------------------------------------------

describe('C8 — AGAIN during orphan', () => {
  it('"take" → orphan; then "again" → "It\'s difficult to repeat fragments."', () => {
    // First, establish an orphan (bare "take" with no objects typed).
    // "take" has 1-object syntax with SOG|SIR|SMANY scope bits (52).
    // With one takeable lamp in the room, GWIM supplies it automatically.
    // We need GWIM to FAIL so we get an orphan. Use an empty room.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    // "take" with nothing in scope → orphan (GWIM finds 0 candidates for STAKE)
    const r1 = parser.parse('take', room, player, world);
    expect(r1.kind).toBe('orphan');

    // Now AGAIN → "It's difficult to repeat fragments."
    // Guard: orphan is set, so AGAIN refuses before checking lastWon.
    // Note: r1 was 'orphan' kind so setLastWon(false) was called, but the orphan
    // guard (guard 2) fires BEFORE the lastWon guard (guard 3) in ZIL.
    const r2 = parser.parse('again', room, player, world);
    expect(r2.kind).toBe('fail');
    if (r2.kind === 'fail') {
      expect(r2.message).toBe("It's difficult to repeat fragments.");
    }
  });
});

// ---------------------------------------------------------------------------
// §3. AGAIN after a failed parse → "That would just repeat a mistake."
// ---------------------------------------------------------------------------

describe('C8 — AGAIN after failed parse (repeat a mistake)', () => {
  it('unknown-word parse failure → AGAIN refuses with "That would just repeat a mistake."', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    // Parse an unknown word → fail.
    const r1 = parser.parse('frobnicate the lamp', room, player, world);
    expect(r1.kind).toBe('fail');

    // Simulate the game reporting the parse failed (setLastWon(false)).
    parser.setLastWon(false);

    // AGAIN → "That would just repeat a mistake."
    const r2 = parser.parse('again', room, player, world);
    expect(r2.kind).toBe('fail');
    if (r2.kind === 'fail') {
      expect(r2.message).toBe('That would just repeat a mistake.');
    }
  });

  it('parse fails → setLastWon(false) → AGAIN refuses; then success → setLastWon(true) → AGAIN replays', () => {
    const { room, player, lamp, world } = makeWorld();
    const parser = new Parser();

    // 1. Fail: unknown word
    parser.parse('frobnicate lamp', room, player, world);
    parser.setLastWon(false);
    const r_fail = parser.parse('again', room, player, world);
    expect(r_fail.kind).toBe('fail');
    if (r_fail.kind === 'fail') {
      expect(r_fail.message).toBe('That would just repeat a mistake.');
    }

    // 2. Succeed: take lamp
    const r_ok = parser.parse('take lamp', room, player, world);
    expect(r_ok.kind).toBe('ok');
    parser.setLastWon(true);

    // 3. AGAIN → replays "take lamp"
    const r_again = parser.parse('again', room, player, world);
    expect(r_again.kind).toBe('ok');
    if (r_again.kind === 'ok') {
      expect(r_again.command.verb).toBe('take');
      expect(r_again.command.dobjIds).toEqual([lamp.id]);
    }
  });
});

// ---------------------------------------------------------------------------
// §4. AGAIN with unexpected trailing tokens
// ---------------------------------------------------------------------------

describe('C8 — AGAIN with trailing tokens', () => {
  it('"again lamp" → "I couldn\'t understand that sentence."', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    // First, make a successful parse so lastInput is set and lastWon is true.
    parser.parse('take lamp', room, player, world);
    parser.setLastWon(true);

    // AGAIN with a non-separator trailing token → error.
    const result = parser.parse('again lamp', room, player, world);
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      expect(result.message).toBe("I couldn't understand that sentence.");
    }
  });

  it('"again then" (separator-only trailing) → replays last command', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    // Establish lastInput and lastWon=true.
    parser.parse('take lamp', room, player, world);
    parser.setLastWon(true);

    // "again then" — "then" is a structural separator; port simplification
    // replays rather than chaining (deferred per spec §1).
    // The tokenizer/tokenizeSegment stops at SIBREAK tokens (period/comma),
    // but "then" is a word token. tokenizeSegment does NOT split on "then" —
    // it's the splitSegments() function inside parseChained that splits on "then".
    // In parse(), "then" appears as a normal token after "again".
    // Per port simplification: separators (then/and) after AGAIN → replay anyway.
    const result = parser.parse('again then', room, player, world);
    // The replay of "take lamp" should succeed.
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.verb).toBe('take');
    }
  });
});

// ---------------------------------------------------------------------------
// §5. AGAIN after a success → replays last command
// ---------------------------------------------------------------------------

describe('C8 — AGAIN after success: replay', () => {
  it('"look" succeeds → AGAIN replays "look"', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    // LOOK is a 0-object verb that always succeeds.
    const r1 = parser.parse('look', room, player, world);
    expect(r1.kind).toBe('ok');
    parser.setLastWon(true);

    // AGAIN → replays "look"
    const r2 = parser.parse('again', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.verb).toBe('look');
      expect(r2.command.action).toBe('V-LOOK');
    }
  });

  it('"take lamp" succeeds → AGAIN replays "take lamp" with same dobj', () => {
    const { room, player, lamp, world } = makeWorld();
    const parser = new Parser();

    const r1 = parser.parse('take lamp', room, player, world);
    expect(r1.kind).toBe('ok');
    parser.setLastWon(true);

    const r2 = parser.parse('again', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.verb).toBe('take');
      expect(r2.command.dobjIds).toEqual([lamp.id]);
    }
  });
});

// ---------------------------------------------------------------------------
// §6. G is a synonym for AGAIN
// ---------------------------------------------------------------------------

describe('C8 — G as AGAIN synonym', () => {
  it('"g" after a success → replays last command (same as "again")', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    parser.parse('look', room, player, world);
    parser.setLastWon(true);

    const result = parser.parse('g', room, player, world);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.verb).toBe('look');
    }
  });
});

// ---------------------------------------------------------------------------
// §7. Repeated AGAIN replays the SAME original command (not "again" itself)
// ---------------------------------------------------------------------------

describe('C8 — Repeated AGAIN replays the same command', () => {
  it('look → again → again → all produce the same look command', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    const r1 = parser.parse('look', room, player, world);
    expect(r1.kind).toBe('ok');
    parser.setLastWon(true);

    // First AGAIN replays "look"
    const r2 = parser.parse('again', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') expect(r2.command.verb).toBe('look');
    // AGAIN itself does NOT overwrite lastInput, so setLastWon(true) still refers to "look"
    parser.setLastWon(true);

    // Second AGAIN also replays "look" (not "again")
    const r3 = parser.parse('again', room, player, world);
    expect(r3.kind).toBe('ok');
    if (r3.kind === 'ok') expect(r3.command.verb).toBe('look');
  });
});

// ---------------------------------------------------------------------------
// §8. Integration: AGAIN after direction fast-path
// ---------------------------------------------------------------------------

describe('C8 — AGAIN after direction', () => {
  it('"n" (direction fast-path) succeeds → "again" replays the direction', () => {
    const { room, player, world } = makeWorld();
    const parser = new Parser();

    // Direction fast-path: "n" → ok with verb='walk', prep='north'
    const r1 = parser.parse('n', room, player, world);
    expect(r1.kind).toBe('ok');
    if (r1.kind === 'ok') {
      expect(r1.command.verb).toBe('walk');
    }
    parser.setLastWon(true);

    // AGAIN → replays "n"
    const r2 = parser.parse('again', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.verb).toBe('walk');
      expect(r2.command.prep).toBe('north');
    }
  });
});
