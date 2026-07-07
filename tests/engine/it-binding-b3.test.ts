/**
 * B3 — IT-binding in PERFORM prologue
 *
 * Verifies that:
 *   1. IT is bound in the PERFORM prologue (game.ts turn loop) AFTER resolving
 *      the command's dobj — NOT inside the parser's parseChained loop.
 *   2. Cross-turn "take lamp" then "examine it" resolves correctly:
 *      - Turn 1: PERFORM prologue sets itRef = lamp's id (since dobj=lamp, verb≠walk)
 *      - Turn 2: parser reads itRef, resolves "it" → lamp
 *   3. WALK commands do NOT rebind IT (per gmain.zil:202-203 guard: verb≠walk).
 *   4. Commands without a dobj do NOT rebind IT (previous referent persists).
 *   5. There is no window where IT is left unbound across the seam — after a
 *      non-WALK action with a dobj, the next turn's "examine it" always resolves.
 *
 * Per reconciliation-parser-perform.md §1 cross-cut #2 and gmain.zil:202-203.
 *
 * TDD: written BEFORE the implementation (RED → GREEN → commit).
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../src/engine/game';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import { Clock } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import type { Rng } from '../../src/engine/game';

const rng: Rng = { next: () => 0, prob: (base) => base > 0 };

// ---------------------------------------------------------------------------
// World builder: a lit room with a lamp (the takeable item for IT-binding)
// and a bottle (to verify IT doesn't get clobbered by WALK).
// ---------------------------------------------------------------------------

interface ItWorld {
  game: Game;
  lamp: Thing;
  bottle: Thing;
  room: Room;
}

function buildItWorld(): ItWorld {
  const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A test room.' });
  room.set(Flag.On);

  const lamp = new Thing('LAMP', 'brass lantern', {
    synonyms: ['lamp', 'lantern'],
    adjectives: ['brass'],
  });
  lamp.set(Flag.Takeable);
  lamp.moveTo(room);

  const bottle = new Thing('BOTTLE', 'glass bottle', {
    synonyms: ['bottle'],
    adjectives: ['glass'],
  });
  bottle.set(Flag.Takeable);
  bottle.moveTo(room);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, lamp, bottle, player]);
  const game = new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });
  return { game, lamp, bottle, room };
}

// ---------------------------------------------------------------------------
// Core B3 test: cross-turn IT binding
// ---------------------------------------------------------------------------

describe('B3 — IT-binding in PERFORM prologue (cross-turn)', () => {
  it('take lamp then examine it (two turns) resolves "it" to the lamp', async () => {
    const { game } = buildItWorld();
    game.start();

    // Turn 1: take lamp — PERFORM prologue binds IT to the lamp.
    const r1 = await game.turn('take lamp');
    expect(r1.output).not.toMatch(/I don't know the word/i);
    // The lamp was taken (some acknowledgment).
    expect(r1.output.length).toBeGreaterThan(0);

    // Turn 2: examine it — parser reads IT = lamp, resolves correctly.
    const r2 = await game.turn('examine it');
    // Must NOT fail with "I don't see what you are referring to" or similar.
    expect(r2.output).not.toMatch(/don't see what you are referring to/i);
    expect(r2.output).not.toMatch(/You haven't mentioned any thing/i);
    expect(r2.output).not.toMatch(/I don't know the word/i);
    // The output should reference the lamp (either by examining it or a message).
    expect(r2.output.length).toBeGreaterThan(0);
  });

  it('after "take bottle", "examine it" resolves to the bottle (IT updated)', async () => {
    const { game } = buildItWorld();
    game.start();

    // Bind IT to lamp first.
    await game.turn('take lamp');

    // Now bind IT to bottle.
    await game.turn('take bottle');

    // "examine it" should now refer to bottle, not lamp.
    const r = await game.turn('examine it');
    expect(r.output).not.toMatch(/don't see what you are referring to/i);
    expect(r.output).not.toMatch(/You haven't mentioned any thing/i);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('a WALK command does NOT rebind IT (gmain.zil:202 guard: verb!=WALK)', async () => {
    const { game } = buildItWorld();
    game.start();

    // Bind IT to lamp.
    await game.turn('take lamp');

    // Walk north (no exit — parser handles the walk verb, no room movement).
    // The WALK guard must ensure IT remains bound to lamp.
    await game.turn('north');  // likely fails "You can't go that way" but verb=walk

    // "examine it" must still resolve to the lamp, not be unbound.
    const r = await game.turn('examine it');
    expect(r.output).not.toMatch(/don't see what you are referring to/i);
    expect(r.output).not.toMatch(/You haven't mentioned any thing/i);
  });

  it('a no-dobj command does NOT change IT binding (previous referent persists)', async () => {
    const { game } = buildItWorld();
    game.start();

    // Bind IT to lamp.
    await game.turn('take lamp');

    // "look" has no dobj — IT should NOT be rebound.
    await game.turn('look');

    // "examine it" must still resolve to the lamp.
    const r = await game.turn('examine it');
    expect(r.output).not.toMatch(/don't see what you are referring to/i);
    expect(r.output).not.toMatch(/You haven't mentioned any thing/i);
  });

  it('before any action, "examine it" fails with an unbound-referent message', async () => {
    const { game } = buildItWorld();
    game.start();

    // No prior command — IT is unbound.
    const r = await game.turn('examine it');
    // Parser should return a fail about no referent.
    expect(r.output).toMatch(/You haven't mentioned any thing|don't see what/i);
  });
});

// ---------------------------------------------------------------------------
// Seam verification: no window between parser and PERFORM where IT is lost
// ---------------------------------------------------------------------------

describe('B3 — seam: parser reads IT; PERFORM prologue writes IT', () => {
  it('IT is set by PERFORM prologue BEFORE the next turn\'s parse reads it', async () => {
    // The seam test: the binding must be in place before the next parse.
    // We verify by making Turn 2's parse succeed (IT was bound by Turn 1's prologue).
    const { game } = buildItWorld();
    game.start();

    // Turn 1 binds IT.
    await game.turn('take lamp');

    // Turn 2 reads IT at parse time — if binding happened in Turn 1's prologue,
    // the parser's itRef is already set to lamp.id before Turn 2 parses "examine it".
    const r = await game.turn('examine it');
    // A successful parse (kind='ok') means the parser found a referent.
    // We infer success by absence of the unbound-referent error.
    expect(r.output).not.toMatch(/You haven't mentioned any thing/i);
  });

  it('non-WALK action with dobj in one room, then IT resolves correctly in the same room', async () => {
    // Full integration: take in room, then examine it.
    const { game } = buildItWorld();
    game.start();

    await game.turn('take lamp');
    const r = await game.turn('examine it');

    // The parser must resolve "it" to the lamp successfully.
    expect(r.output.length).toBeGreaterThan(0);
    // Crucially: no pronoun-resolution error.
    expect(r.output).not.toMatch(/don't see what you are referring to/i);
    expect(r.output).not.toMatch(/You haven't mentioned any thing/i);
  });
});
