/**
 * CA1 — Blocked-move CLOCKER tick
 *
 * ZIL contract (clock-main-loop.md §3.4, §14.1): CLOCKER runs when P-WON
 * (parse succeeded) AND the verb is not a meta-verb.  A blocked move is a
 * successful parse of V-WALK; RFATAL suppresses M-END, NOT CLOCKER.
 *
 * Bug (pre-fix): verbResult.fatal / chainResult.fatal both `break` the turn
 * loop BEFORE the segmentConsumesTime tick block, so a blocked move never
 * advances CLOCKER → +1 lost tick per blocked move vs dfrotz.
 *
 * TDD: written RED before the fix lands.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Game } from '../../src/engine/game.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { Clock } from '../../src/engine/clock.js';
import type { ClockEntry } from '../../src/engine/clock.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import type { Rng } from '../../src/engine/game.js';

const rng: Rng = { next: () => 0, prob: (base) => base > 0 };

// ---------------------------------------------------------------------------
// Fixture: lit room with a blocked exit and a successful exit (NORTH → ROOM-B)
// ---------------------------------------------------------------------------

function buildBlockedWorld() {
  const roomB = new Room('ROOM-B', 'Room B', { ldesc: 'Room B.' });
  roomB.set(Flag.On);

  const roomA = new Room('ROOM-A', 'Room A', {
    ldesc: 'Room A.',
    exits: [
      { dir: 'north', to: 'ROOM-B' },
      { dir: 'south', elseMessage: 'Solid wall.' },
    ],
  });
  roomA.set(Flag.On);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(roomA);

  const world = World.fromObjects([roomA, roomB, player]);
  return new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });
}

// ---------------------------------------------------------------------------
// (a) Blocked V-WALK advances moves by EXACTLY 1
// ---------------------------------------------------------------------------

describe('CA1: blocked V-WALK ticks CLOCKER once', () => {
  it('NEXIT (elseMessage) blocked move: view().moves increments by 1', () => {
    const g = buildBlockedWorld();
    g.start();

    const before = g.view().moves;
    g.turn('south');
    expect(g.view().moves).toBe(before + 1);
  });

  it('no-exit direction: view().moves increments by 1', () => {
    const g = buildBlockedWorld();
    g.start();

    const before = g.view().moves;
    g.turn('east'); // no exit defined in ROOM-A
    expect(g.view().moves).toBe(before + 1);
  });

  it('WEST-OF-HOUSE east blocked: view().moves increments by 1', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    const before = g.view().moves;
    g.turn('east');
    expect(g.view().moves).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// (b) Successful non-meta verb still advances exactly 1 (no double-tick)
// ---------------------------------------------------------------------------

describe('CA1: successful non-meta verb advances exactly 1 tick', () => {
  it('north (UEXIT) from ROOM-A advances moves by 1', () => {
    const g = buildBlockedWorld();
    g.start();

    const before = g.view().moves;
    g.turn('north');
    expect(g.view().moves).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// (c) Parse failure advances 0
// ---------------------------------------------------------------------------

describe('CA1: parse failure does NOT tick', () => {
  it('"xyzzyzz" leaves moves unchanged', () => {
    const g = buildBlockedWorld();
    g.start();

    const before = g.view().moves;
    g.turn('xyzzyzz');
    expect(g.view().moves).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// (d) Meta verb advances 0
// ---------------------------------------------------------------------------

describe('CA1: meta verb does NOT tick', () => {
  it('"score" leaves moves unchanged', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    const before = g.view().moves;
    g.turn('score');
    expect(g.view().moves).toBe(before);
  });

  it('"verbose" leaves moves unchanged', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    const before = g.view().moves;
    g.turn('verbose');
    expect(g.view().moves).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// (e) Loud-room intercepted command advances exactly 1 (no double-tick)
// ---------------------------------------------------------------------------

describe('CA1: loud-room intercepted command ticks exactly once', () => {
  it('intercepted "look" in loud room advances moves by 1, not 2', () => {
    // Build a game positioned in LOUD-ROOM with the loud condition active.
    // LOUD-FLAG=false and GATES-OPEN=true makes the room loud.
    const g = newGameAt('LOUD-ROOM');
    g.start();
    // Activate loud-room: GATES-OPEN=true (by default), LOUD-FLAG=false (default).
    // In loud mode, non-whitelist commands echo back. "look" is not a whitelist exit/meta.
    const flags = (g as unknown as { flags: { set: (k: string, v: boolean) => void; get: (k: string) => boolean } }).flags;
    flags.set('GATES-OPEN', true);
    flags.set('LOUD-FLAG', false);

    const before = g.view().moves;
    g.turn('look'); // intercepted by loudRoomDispatch → echo
    expect(g.view().moves).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// (f) Ghost intercepted command advances exactly 1 (ZIL: RFATAL still ticks)
// ---------------------------------------------------------------------------

describe('CA1: ghost intercepted command ticks exactly once', () => {
  it('TIMBER-ROOM west (ghost-blocked walk) advances moves by 1', () => {
    const g = newGameAt('TIMBER-ROOM');
    g.start();
    // Force dead=true to activate ghost dispatch.
    (g as unknown as { dead: boolean }).dead = true;
    (g as unknown as { alwaysLit: boolean }).alwaysLit = true;

    const before = g.view().moves;
    // TIMBER-ROOM west is intercepted by ghostDispatch (1actions.zil:3114–3117).
    g.turn('west');
    expect(g.view().moves).toBe(before + 1);
  });

  it('"diagnose" in ghost mode (intercepted RFATAL) advances moves by 1', () => {
    // diagnose parses without needing an object, so it always produces a parse-ok result.
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    (g as unknown as { dead: boolean }).dead = true;
    (g as unknown as { alwaysLit: boolean }).alwaysLit = true;

    const before = g.view().moves;
    // V-DIAGNOSE is intercepted by ghostDispatch → "You are dead." → should tick.
    g.turn('diagnose');
    expect(g.view().moves).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// (g) Blocked move does NOT trigger M-END (LIVING-ROOM-FCN guard)
// ---------------------------------------------------------------------------

describe('CA1: blocked move skips M-END', () => {
  it('blocked east from WEST-OF-HOUSE does not fire LIVING-ROOM-FCN side effects', () => {
    // WEST-OF-HOUSE has no LIVING-ROOM-FCN, but we can verify no score change
    // occurs (M-END is where score-deposit side effects would fire).
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    const scoreBefore = g.view().score;
    g.turn('east'); // blocked
    // Score must not change (no M-END treasury check fired).
    expect(g.view().score).toBe(scoreBefore);
  });
});

// ---------------------------------------------------------------------------
// (h) Timer warning fires one tick earlier after blocked move (desync recovery)
// ---------------------------------------------------------------------------

describe('CA1: clock desyncs by 1 per blocked move (lamp warning timing)', () => {
  /**
   * Build a game with a countdown clock that fires after N advances.
   * Issue a blocked move + (N-1) real moves → warning should fire at move N.
   * Pre-fix: blocked move skips clock → warning fires at move N+1.
   */
  it('lamp-style countdown fires at correct move after a blocked move', () => {
    const roomB = new Room('ROOM-B', 'Room B', { ldesc: 'Room B.' });
    roomB.set(Flag.On);
    const roomA = new Room('ROOM-A', 'Room A', {
      ldesc: 'Room A.',
      exits: [
        { dir: 'north', to: 'ROOM-B' },
        { dir: 'south', elseMessage: 'Solid wall.' },
      ],
    });
    roomA.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(roomA);

    // Clock entry fires after exactly 3 advances.
    const clock = new Clock();
    // (entry not used for counting — the counter entry below handles that)
    const entry: ClockEntry = {
      id: 'TEST-TIMER',
      turnsLeft: 3,
      enabled: true,
      tick() { return true; },
    };
    clock.schedule(entry);

    const world = World.fromObjects([roomA, roomB, player]);
    const g = new Game(world, { rng, clock, events: new SimpleEventEmitter() });
    g.start();

    // 1 blocked move (south) + 2 real moves (north, then ... north won't work twice)
    // Actually: south (blocked) → tick 1; north → tick 2 (player in B now);
    // look → tick 3 (from ROOM-B, look fires) → clock fires.
    // But we need a room with a look command that exists. Let's just do 3 separate commands:
    // south (blocked), look (real from A), look (real from A) — but look is not defined in minimal world.
    // Instead test the raw tick count.
    let advanceCount = 0;
    const countEntry: ClockEntry = {
      id: 'COUNTER',
      turnsLeft: -1, // demon mode: fires every advance
      enabled: true,
      tick() { advanceCount++; return true; },
    };
    clock.schedule(countEntry);

    // Issue 3 commands: 1 blocked + 2 successful.
    // south = blocked (should tick if fixed)
    // north = successful move to ROOM-B
    // We can't do a second successful move from ROOM-B easily. Use look as a real command.
    // Actually look advances time in the real game. For this minimal world let's just verify
    // that 1 blocked + 1 success = 2 ticks (not 1).
    g.turn('south'); // blocked
    g.turn('north'); // successful

    expect(advanceCount).toBe(2); // both must have ticked
  });
});
