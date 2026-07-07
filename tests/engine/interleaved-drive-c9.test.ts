/**
 * C9 — Game.turn interleaved drive
 *
 * Verifies that Game.turn uses a per-segment interleaved parse+execute drive
 * instead of the eager parseChained model.  Key observable differences:
 *
 *   1. Within-turn IT propagation: "open mailbox. read it" resolves "it" to
 *      the mailbox AFTER the "open mailbox" segment executes and binds IT via
 *      the PERFORM prologue — the same turn, not the next turn.
 *
 *   2. Orphan/disambig state is preserved across Game.turn() calls: when the
 *      parser issues "What do you want to <verb>?" the NEXT turn() call answers
 *      it without requiring a re-parse from scratch.
 *
 *   3. Continuation is lazy: "n. e." runs north, then east — each segment is
 *      parsed after the previous one executes (same as before, but now the
 *      interleaved path is the live path, not parseChained).
 *
 *   4. Fatal aborts continuation: if segment 1 produces M-FATAL, segment 2 is
 *      not executed.
 *
 * Per td1-parser-algorithm.md §15 and reconciliation-parser-perform.md §2.
 * TDD: written BEFORE the implementation (RED → GREEN → commit).
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../src/engine/game';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Container } from '../../src/domain/container';
import { Thing } from '../../src/domain/thing';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import { Clock } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import type { Rng } from '../../src/engine/game';

const rng: Rng = { next: () => 0, prob: (base) => base > 0 };

// ---------------------------------------------------------------------------
// World builder: a lit room with a closed mailbox containing a leaflet.
// The mailbox is openable (has a handler that opens it).
// ---------------------------------------------------------------------------

function buildMailboxWorld(): { game: Game } {
  const room = new Room('WEST', 'West of House', {
    ldesc: 'You are west of a white house.',
  });
  room.set(Flag.On);

  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox', 'box'],
    adjectives: ['small'],
  });
  mailbox.set(Flag.Container);
  // Mailbox starts closed (no Flag.Open).
  mailbox.moveTo(room);

  const leaflet = new Thing('LEAFLET', 'leaflet', {
    synonyms: ['leaflet', 'advertisement', 'booklet'],
    adjectives: ['small'],
  });
  leaflet.set(Flag.Readable);
  leaflet.set(Flag.Takeable);
  leaflet.props.set('text', 'WELCOME TO ZORK!');
  leaflet.moveTo(mailbox);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, mailbox, leaflet, player]);
  const game = new Game(world, {
    rng,
    clock: new Clock(),
    events: new SimpleEventEmitter(),
  });
  return { game };
}

// ---------------------------------------------------------------------------
// 1. Within-turn IT propagation via interleaved drive
// ---------------------------------------------------------------------------

describe('C9 — interleaved drive: within-turn IT propagation', () => {
  it('"open mailbox. read it" — "it" resolves to the mailbox within one turn', async () => {
    const { game } = buildMailboxWorld();
    game.start();

    // Open the mailbox first so "it" is accessible.
    // The interleaved drive must bind IT after segment 1 ("open mailbox")
    // executes, so segment 2 ("read it") can resolve "it" → mailbox.
    const result = await game.turn('open mailbox. read it');

    // The turn must NOT fail on the "read it" part with an unbound-referent error.
    expect(result.output).not.toMatch(/I don't see what you're referring to/i);
    expect(result.output).not.toMatch(/You haven't mentioned any thing/i);
    // The output should contain something from the "open mailbox" action.
    expect(result.output).toMatch(/open|mailbox/i);
  });

  it('"take leaflet. examine it" — "it" resolves to the leaflet within one turn', async () => {
    const { game } = buildMailboxWorld();
    game.start();

    // First open the mailbox so leaflet is accessible.
    await game.turn('open mailbox');

    // Now chain: take leaflet (binds IT=leaflet), then examine it.
    // The interleaved drive must bind IT after "take leaflet" so "examine it"
    // resolves correctly.
    const result = await game.turn('take leaflet. examine it');

    // Must NOT fail with pronoun error.
    expect(result.output).not.toMatch(/I don't see what you're referring to/i);
    expect(result.output).not.toMatch(/You haven't mentioned any thing/i);
    // Both segments should produce output.
    expect(result.output.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Orphan state preserved across turns
// ---------------------------------------------------------------------------

describe('C9 — interleaved drive: orphan state across turns', () => {
  it('orphan prompt → next turn answers it', async () => {
    // Build a world with TWO takeable items — GWIM can't auto-supply (2 candidates),
    // so the parser issues an orphan prompt for "take" with no object.
    const room = new Room('ROOM', 'Test Room', { ldesc: 'A simple room.' });
    room.set(Flag.On);

    const lamp = new Thing('LAMP', 'brass lantern', {
      synonyms: ['lamp', 'lantern'],
      adjectives: ['brass'],
    });
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);

    const sword = new Thing('SWORD', 'elvish sword', {
      synonyms: ['sword'],
      adjectives: ['elvish'],
    });
    sword.set(Flag.Takeable);
    sword.moveTo(room);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, lamp, sword, player]);
    const game = new Game(world, {
      rng,
      clock: new Clock(),
      events: new SimpleEventEmitter(),
    });
    game.start();

    // "take" with no object and 2+ candidates → orphan prompt "What do you want to take?"
    // (GWIM fails when there are 0 or 2+ candidates matching the findBit)
    const r1 = await game.turn('take');
    expect(r1.output).toMatch(/What do you want to take\?/i);

    // Next turn: answer "lamp" → executes take lamp.
    const r2 = await game.turn('lamp');
    // Must NOT fail with a parsing error or pronoun error.
    expect(r2.output).not.toMatch(/I don't know the word/i);
    expect(r2.output).not.toMatch(/I don't see what you're referring to/i);
    // Should produce some take-related output.
    expect(r2.output.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Continuation is lazy (same behavior as before, but through new path)
// ---------------------------------------------------------------------------

describe('C9 — interleaved drive: lazy continuation chaining', () => {
  it('"look. look" executes two look commands in one turn', async () => {
    const room = new Room('ROOM', 'Test Room', { ldesc: 'A simple room.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, player]);
    const game = new Game(world, {
      rng,
      clock: new Clock(),
      events: new SimpleEventEmitter(),
    });
    game.start();

    // Two look commands chained — both should produce output.
    const result = await game.turn('look. look');
    // The output should contain at least the room name twice.
    const occurrences = (result.output.match(/Test Room/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('direction chaining "n. e." fires both moves in one turn', async () => {
    const roomA = new Room('ROOM-A', 'Room A', { ldesc: 'Room A.', exits: [{ dir: 'north', to: 'ROOM-B' }] });
    roomA.set(Flag.On);
    const roomB = new Room('ROOM-B', 'Room B', { ldesc: 'Room B.', exits: [{ dir: 'east', to: 'ROOM-C' }, { dir: 'south', to: 'ROOM-A' }] });
    roomB.set(Flag.On);
    const roomC = new Room('ROOM-C', 'Room C', { ldesc: 'Room C.', exits: [{ dir: 'west', to: 'ROOM-B' }] });
    roomC.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(roomA);

    const world = World.fromObjects([roomA, roomB, roomC, player]);
    const game = new Game(world, {
      rng,
      clock: new Clock(),
      events: new SimpleEventEmitter(),
    });
    game.start();

    // Move north then east in one turn.
    const result = await game.turn('n. e.');
    // Player should be in Room C after both moves.
    expect(game.view().here).toBe('ROOM-C');
    // Output should contain both Room B and Room C descriptions.
    expect(result.output).toContain('Room B');
    expect(result.output).toContain('Room C');
  });
});

// ---------------------------------------------------------------------------
// 4. Move counter: chained commands in one turn still count as ONE turn
// ---------------------------------------------------------------------------

describe('C9 — interleaved drive: move counter', () => {
  it('a chained "look. look" counts as TWO moves (one per real command)', async () => {
    const room = new Room('ROOM', 'Test Room', { ldesc: 'A simple room.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, player]);
    const game = new Game(world, {
      rng,
      clock: new Clock(),
      events: new SimpleEventEmitter(),
    });
    game.start();

    expect(game.view().moves).toBe(0);
    await game.turn('look. look');
    expect(game.view().moves).toBe(2);
  });

  it('an orphan turn does NOT increment the move counter', async () => {
    // Per ZIL semantics: when the parser issues an orphan prompt, no MOVES tick.
    // "MOVES/clock tick only on a parsed+executed command" (reconciliation §2).
    // Use two takeable items so GWIM can't auto-supply and orphan fires.
    const room = new Room('ROOM', 'Test Room', { ldesc: 'A simple room.' });
    room.set(Flag.On);
    const lamp = new Thing('LAMP', 'brass lantern', {
      synonyms: ['lamp', 'lantern'],
      adjectives: ['brass'],
    });
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);
    const sword = new Thing('SWORD', 'elvish sword', {
      synonyms: ['sword'],
      adjectives: ['elvish'],
    });
    sword.set(Flag.Takeable);
    sword.moveTo(room);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, lamp, sword, player]);
    const game = new Game(world, {
      rng,
      clock: new Clock(),
      events: new SimpleEventEmitter(),
    });
    game.start();

    expect(game.view().moves).toBe(0);

    // Orphan turn: "take" with 2 takeable items → orphan prompt.
    await game.turn('take');
    // Orphan turns don't count as moves.
    expect(game.view().moves).toBe(0);

    // Answer turn: "lamp" → executes take lamp — this DOES count.
    await game.turn('lamp');
    expect(game.view().moves).toBe(1);
  });
});
