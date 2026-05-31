/**
 * easter-eggs-d4.test.ts — Task D4
 *
 * Verifies that xyzzy / plugh / frobozz produce VERBATIM ZIL responses
 * instead of falling through to the generic bad-verb message.
 *
 * ZIL sources:
 *   <ROUTINE V-ADVENT ()  <TELL "A hollow voice says \"Fool.\"" CR>>
 *     gverbs.zil:153–154
 *     Triggered by PLUGH and its synonym XYZZY (gsyntax.zil:352–353).
 *
 *   <ROUTINE V-FROBOZZ () <TELL "The FROBOZZ Corporation..." CR>>
 *     gverbs.zil:704–706
 *     Triggered by FROBOZZ (gsyntax.zil:227).
 *
 * Tests cover three layers:
 *   1. executeVerb directly via V-* action id (unit — no parser involved)
 *   2. game.turn() with the word form (integration — full parser + dispatch)
 */

import { describe, it, expect } from 'vitest';
import { executeVerb } from '../../src/engine/verbs/index.js';
import { createGame } from '../../src/engine/bootstrap.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { Clock } from '../../src/engine/clock.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';

// ---------------------------------------------------------------------------
// Verbatim expected strings — copied from messages.json / gverbs.zil
// ---------------------------------------------------------------------------

const XYZZY_RESPONSE   = 'A hollow voice says "Fool."';
const FROBOZZ_RESPONSE = 'The FROBOZZ Corporation created, owns, and operates this dungeon.';

// ---------------------------------------------------------------------------
// Minimal context for unit-level tests
// ---------------------------------------------------------------------------

function makeMinimalCtx(verb: string): VerbContext {
  const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A test room.' });
  room.set(Flag.Light);
  const player = new Actor('ADVENTURER', 'yourself');
  player.moveTo(room);
  const world = World.fromObjects([room, player]);
  return { verb, player, here: room, world };
}

// ---------------------------------------------------------------------------
// 1. Unit tests — executeVerb dispatch via V-* action id
// ---------------------------------------------------------------------------

describe('D4 easter eggs — unit (executeVerb action id dispatch)', () => {
  it('V-ADVENT returns the verbatim xyzzy/plugh response', () => {
    const ctx = makeMinimalCtx('plugh');
    const res = executeVerb(ctx, 'V-ADVENT');
    expect(res.output).toBe(XYZZY_RESPONSE);
    expect(res.moved).toBe(false);
  });

  it('V-FROBOZZ returns the verbatim frobozz response', () => {
    const ctx = makeMinimalCtx('frobozz');
    const res = executeVerb(ctx, 'V-FROBOZZ');
    expect(res.output).toBe(FROBOZZ_RESPONSE);
    expect(res.moved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Unit tests — executeVerb fallback via verb word (HANDLERS table)
// ---------------------------------------------------------------------------

describe('D4 easter eggs — unit (executeVerb verb-word fallback)', () => {
  it('verb "plugh" falls back to verbAdvent via HANDLERS', () => {
    const ctx = makeMinimalCtx('plugh');
    const res = executeVerb(ctx);
    expect(res.output).toBe(XYZZY_RESPONSE);
  });

  it('verb "xyzzy" falls back to verbAdvent via HANDLERS', () => {
    const ctx = makeMinimalCtx('xyzzy');
    const res = executeVerb(ctx);
    expect(res.output).toBe(XYZZY_RESPONSE);
  });

  it('verb "frobozz" falls back to verbFrobozz via HANDLERS', () => {
    const ctx = makeMinimalCtx('frobozz');
    const res = executeVerb(ctx);
    expect(res.output).toBe(FROBOZZ_RESPONSE);
  });
});

// ---------------------------------------------------------------------------
// 3. Integration tests — game.turn() through parser + dispatch
//    Uses the real bootstrapped game so the full parse → action → handler
//    pipeline is exercised.
// ---------------------------------------------------------------------------

describe('D4 easter eggs — integration (game.turn)', () => {
  it('typing "xyzzy" produces the verbatim A-hollow-voice response', () => {
    const g = createGame();
    g.start();
    const r = g.turn('xyzzy');
    expect(r.output).toContain(XYZZY_RESPONSE);
  });

  it('typing "plugh" produces the verbatim A-hollow-voice response', () => {
    const g = createGame();
    g.start();
    const r = g.turn('plugh');
    expect(r.output).toContain(XYZZY_RESPONSE);
  });

  it('typing "frobozz" produces the verbatim FROBOZZ-Corporation response', () => {
    const g = createGame();
    g.start();
    const r = g.turn('frobozz');
    expect(r.output).toContain(FROBOZZ_RESPONSE);
  });

  it('xyzzy does NOT move the player (moved === false)', () => {
    const g = createGame();
    g.start();
    const r = g.turn('xyzzy');
    expect(r.moved).toBe(false);
  });

  it('frobozz does NOT move the player (moved === false)', () => {
    const g = createGame();
    g.start();
    const r = g.turn('frobozz');
    expect(r.moved).toBe(false);
  });

  it('xyzzy does NOT produce the generic bad-verb fallthrough message', () => {
    const g = createGame();
    g.start();
    const r = g.turn('xyzzy');
    expect(r.output).not.toContain("I don't know how to");
    expect(r.output).not.toContain("don't understand");
  });

  it('frobozz does NOT produce the generic bad-verb fallthrough message', () => {
    const g = createGame();
    g.start();
    const r = g.turn('frobozz');
    expect(r.output).not.toContain("I don't know how to");
    expect(r.output).not.toContain("don't understand");
  });
});
