/**
 * Per-command MOVES/clock advancement for chained turns.
 *
 * ZIL CLOCKER fires once per executed command (gclock.zil: CLOCKER does
 * SETG MOVES <+ ,MOVES 1> after each command).  The engine must advance
 * moveCount and clock.advance() inside the segment loop — once per real,
 * non-meta command — not once at end of turn.
 *
 * TDD: written BEFORE the fix (RED → GREEN).
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
import type { ClockEntry } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import { createGame } from '../../src/engine/bootstrap';
import type { Rng } from '../../src/engine/game';

const rng: Rng = { next: () => 0 };

function buildMailboxWorld(): Game {
  const room = new Room('WEST', 'West of House', { ldesc: 'You are west of a white house.' });
  room.set(Flag.On);

  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox', 'box'],
    adjectives: ['small'],
  });
  mailbox.set(Flag.Container);
  mailbox.moveTo(room);

  const leaflet = new Thing('LEAFLET', 'leaflet', {
    synonyms: ['leaflet', 'advertisement'],
    adjectives: ['small'],
  });
  leaflet.set(Flag.Readable);
  leaflet.set(Flag.Takeable);
  leaflet.props.set('text', 'WELCOME TO ZORK!');
  leaflet.moveTo(mailbox);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, mailbox, leaflet, player]);
  return new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });
}

// ---------------------------------------------------------------------------
// 1. "open mailbox. score" — SCORE reads the post-tick count
// ---------------------------------------------------------------------------

describe('chained moves: open mailbox. score', () => {
  it('SCORE line reads "in 1 move" (singular), view().moves === 1', () => {
    const game = buildMailboxWorld();
    game.start();

    const result = game.turn('open mailbox. score');

    expect(result.output).toContain('in 1 move.');
    expect(game.view().moves).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. "open mailbox. read leaflet" → 2 real commands → moves === 2
// ---------------------------------------------------------------------------

describe('chained moves: open mailbox. read leaflet', () => {
  it('view().moves === 2 after two chained real commands', () => {
    const game = buildMailboxWorld();
    game.start();

    game.turn('open mailbox. read leaflet');

    expect(game.view().moves).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. "open mailbox. read leaflet. score" → SCORE reads 2
// ---------------------------------------------------------------------------

describe('chained moves: open mailbox. read leaflet. score', () => {
  it('SCORE line reads "in 2 moves"', () => {
    const game = buildMailboxWorld();
    game.start();

    const result = game.turn('open mailbox. read leaflet. score');

    expect(result.output).toContain('in 2 moves.');
  });
});

// ---------------------------------------------------------------------------
// 4. standalone "score" on turn 1 → "0 moves", moves === 0
// ---------------------------------------------------------------------------

describe('chained moves: standalone score (meta no-tick)', () => {
  it('"score" alone reads "0 moves" and does not increment moves', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();

    const result = game.turn('score');

    expect(result.output).toContain('in 0 moves.');
    expect(game.view().moves).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. "score. open mailbox" — meta first, then real; SCORE reads pre-tick 0,
//    moves === 1 after the turn
// ---------------------------------------------------------------------------

describe('chained moves: score. open mailbox (meta first)', () => {
  it('SCORE reads "0 moves"; view().moves === 1 after', () => {
    const game = buildMailboxWorld();
    game.start();

    const result = game.turn('score. open mailbox');

    expect(result.output).toContain('in 0 moves.');
    expect(game.view().moves).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. separate turns: "open mailbox" then "score" → "1 move" (unchanged)
// ---------------------------------------------------------------------------

describe('chained moves: separate turns cross-check', () => {
  it('"open mailbox" then standalone "score" → "1 move"', () => {
    const game = buildMailboxWorld();
    game.start();

    game.turn('open mailbox');
    const result = game.turn('score');

    expect(result.output).toContain('in 1 move.');
  });
});

// ---------------------------------------------------------------------------
// 7. failed parse does NOT tick (C9 intact)
// ---------------------------------------------------------------------------

describe('chained moves: failed parse does not tick', () => {
  it('"xyzzyblah" leaves view().moves unchanged', () => {
    const game = buildMailboxWorld();
    game.start();

    const before = game.view().moves;
    game.turn('xyzzyblah');
    expect(game.view().moves).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 8. chain with a failed segment: only the valid segment ticks
// ---------------------------------------------------------------------------

describe('chained moves: partial chain with failed segment', () => {
  it('"open mailbox. xyzzyblah" → moves === 1 (only valid segment ticks)', () => {
    const game = buildMailboxWorld();
    game.start();

    game.turn('open mailbox. xyzzyblah');

    expect(game.view().moves).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. clock under-tick guard: 2-real-command chain advances clock by 2
// ---------------------------------------------------------------------------

describe('chained moves: clock advances by N for N real commands', () => {
  it('2-command chain decrements lantern turnsLeft by 2, not 1', () => {
    // Build a game with a countdown clock entry to count advance() calls.
    const room = new Room('ROOM', 'Test Room', { ldesc: 'A simple room.' });
    room.set(Flag.On);

    const mailbox = new Container('MAILBOX', 'small mailbox', {
      synonyms: ['mailbox', 'box'],
      adjectives: ['small'],
    });
    mailbox.set(Flag.Container);
    mailbox.moveTo(room);

    const leaflet = new Thing('LEAFLET', 'leaflet', {
      synonyms: ['leaflet', 'advertisement'],
      adjectives: ['small'],
    });
    leaflet.set(Flag.Readable);
    leaflet.set(Flag.Takeable);
    leaflet.props.set('text', 'WELCOME TO ZORK!');
    leaflet.moveTo(mailbox);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const clock = new Clock();
    let advanceCount = 0;
    const counter: ClockEntry = {
      id: 'COUNTER',
      turnsLeft: -1, // demon mode: fires every advance()
      enabled: true,
      tick() {
        advanceCount++;
        return true;
      },
    };
    clock.schedule(counter);

    const world = World.fromObjects([room, mailbox, leaflet, player]);
    const game = new Game(world, { rng, clock, events: new SimpleEventEmitter() });
    game.start();

    // Two real commands chained — clock must advance twice.
    game.turn('open mailbox. read leaflet');

    expect(advanceCount).toBe(2);
  });
});
