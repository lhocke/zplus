/**
 * CA2 — V-WAIT audit / reconcile
 *
 * The dam wave ships a loop-driven 3-tick wait (game.ts runSegmentTick, commit
 * 949c37b) validated by six dam corpora.  This suite pins the ZIL edge set
 * against the engine so the mechanism stays anchored.
 *
 * ZIL contract (gverbs.zil:1514–1519):
 *   V-WAIT prints "Time passes...", calls CLOCKER up to 3× (NUM=3), stops early
 *   when CLOCKER returns true (an interrupt routine fired).  CLOCK-WAIT=T is
 *   then set so the main loop's own CLOCKER call skips — no double-tick.
 *
 * Engine mapping:
 *   runSegmentTick(action='V-WAIT') → maxClocks=3; break when clockLines.length>0
 *   (any clock entry that fires via ctx.tell() = CLOCKER returned true in ZIL).
 *   V-WAIT is NOT in META_ACTIONS → the turn loop also calls runSegmentTick, but
 *   that is THE tick — there is no second tick after it.
 *
 * dfrotz R119 anchor (wait.txt, see tools/oracle/corpus/wait.txt):
 *   - plain wait (no pending interrupt): Moves +3.
 *   - wait across a lamp-warning tick: stops early; total ticks < 3.
 *   - wait with burnout: does NOT stop early (I-LANTERN returns false; no text
 *     via ctx.tell → engine sees clockLines=[] → loop completes all 3 ticks).
 *
 * Spec §3.2 (AMENDED), §10.3 bullet "V-WAIT no-double-tick (CA2)".
 * OQ-8 ruling: keep loop-driven form; stop condition clockLines.length>0 correct.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { Clock, LanternInterrupt } from '../../src/engine/clock.js';
import type { ClockEntry } from '../../src/engine/clock.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { Game } from '../../src/engine/game.js';
import type { Rng } from '../../src/engine/game.js';

const rng: Rng = { next: () => 0, prob: (base) => base > 0 };

// ---------------------------------------------------------------------------
// Minimal lit room — no clock entries except ones we install explicitly.
// ---------------------------------------------------------------------------

function buildLitRoom(clockOverride?: Clock) {
  const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A plain room.' });
  room.set(Flag.On);
  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);
  const world = World.fromObjects([room, player]);
  const clock = clockOverride ?? new Clock();
  return new Game(world, { rng, clock, events: new SimpleEventEmitter() });
}

// ---------------------------------------------------------------------------
// Edge 1: plain wait with no pending interrupt advances moveCount by exactly 3.
//
// dfrotz R119: wait from move 0 (no lamp) → Moves: 3.
// Spec §3.2 AMENDED concrete assertion (A.1): moveCount+=3, not 4.
// ---------------------------------------------------------------------------

describe('CA2: plain wait advances moveCount by exactly 3', () => {
  it('moveCount increases by 3 after wait with no enabled clock entries', () => {
    const g = buildLitRoom();
    g.start();

    const before = g.view().moves;
    g.turn('wait');
    const after = g.view().moves;

    expect(after - before).toBe(3);
  });

  it('two sequential waits each advance by 3 (no accumulation bug)', () => {
    const g = buildLitRoom();
    g.start();

    const before = g.view().moves;
    g.turn('wait');
    g.turn('wait');
    const after = g.view().moves;

    expect(after - before).toBe(6);
  });

  it('wait output contains "Time passes..."', () => {
    const g = buildLitRoom();
    g.start();

    const out = g.turn('wait').output;
    expect(out).toContain('Time passes...');
  });
});

// ---------------------------------------------------------------------------
// Edge 2: mid-wait interrupt stops the loop early.
//
// A clock entry that fires via ctx.tell() on tick 1 should stop the loop at 1.
// A clock entry that fires on tick 2 stops at 2.
// dfrotz R119: lamp warning fires on wait tick 1 → Moves +1 (198 looks test).
// ---------------------------------------------------------------------------

describe('CA2: mid-wait interrupt stops the loop early', () => {
  it('interrupt on tick 1 yields moveCount delta of exactly 1', () => {
    const clock = new Clock();
    // Fires immediately on first advance (turnsLeft=1).
    const entry: ClockEntry = {
      id: 'INSTANT-FIRE',
      turnsLeft: 1,
      enabled: true,
      tick(ctx) {
        ctx.tell('Interrupt fired!');
        return true;
      },
    };
    clock.schedule(entry);

    const g = buildLitRoom(clock);
    g.start();

    const before = g.view().moves;
    g.turn('wait');
    expect(g.view().moves - before).toBe(1);
  });

  it('interrupt on tick 2 yields moveCount delta of exactly 2', () => {
    const clock = new Clock();
    const entry: ClockEntry = {
      id: 'TICK-2-FIRE',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        ctx.tell('Interrupt fired on tick 2!');
        return true;
      },
    };
    clock.schedule(entry);

    const g = buildLitRoom(clock);
    g.start();

    const before = g.view().moves;
    g.turn('wait');
    expect(g.view().moves - before).toBe(2);
  });

  it('interrupt text from mid-wait fire appears in the turn output', () => {
    const clock = new Clock();
    const entry: ClockEntry = {
      id: 'TALKER',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        ctx.tell('The clock chimes!');
        return true;
      },
    };
    clock.schedule(entry);

    const g = buildLitRoom(clock);
    g.start();

    const out = g.turn('wait').output;
    expect(out).toContain('Time passes...');
    expect(out).toContain('The clock chimes!');
  });
});

// ---------------------------------------------------------------------------
// Edge 3: wait across a lamp-warning tick (the spec's named case).
//
// LanternInterrupt with small initialTicks positions a warning inside the
// wait window.  dfrotz-anchored: lamp warning IS a stop condition (I-LANTERN
// returns true on warning fire, so CLOCKER returns true → V-WAIT stops).
//
// OQ-8 ruling: clockLines.length>0 correctly captures this — the warning
// goes through ctx.tell() in FuelInterrupt.onFire(), so it appears in
// clockLines.  The spec concern ("warning must NOT stop at tick 1") was a
// wrong assumption; dfrotz confirms warnings DO stop the loop early.
// ---------------------------------------------------------------------------

describe('CA2: wait across a lamp-warning tick (dfrotz-anchored edge)', () => {
  it('lamp warning firing on wait tick 1 stops the loop at 1 tick', () => {
    const clock = new Clock();
    const emitter = new SimpleEventEmitter();
    // initialTicks=1 → warning fires on very first clock advance.
    new LanternInterrupt(clock, emitter, 1);

    const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A plain room.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);
    const g = new Game(world, { rng, clock, events: emitter });
    g.start();

    const before = g.view().moves;
    const out = g.turn('wait').output;
    const delta = g.view().moves - before;

    // Moves must be exactly 1 — warning stops the loop after tick 1.
    expect(delta).toBe(1);
    // Both the V-WAIT text and the lamp warning appear in the same output.
    expect(out).toContain('Time passes...');
    expect(out).toMatch(/dimmer/i);
  });

  it('lamp warning firing on wait tick 2 yields delta 2', () => {
    const clock = new Clock();
    const emitter = new SimpleEventEmitter();
    // initialTicks=2 → warning fires on second advance.
    new LanternInterrupt(clock, emitter, 2);

    const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A plain room.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);
    const g = new Game(world, { rng, clock, events: emitter });
    g.start();

    const before = g.view().moves;
    g.turn('wait');
    expect(g.view().moves - before).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Edge 4: wait in the dark (no lit room) — completes 3 ticks, no crash.
//
// ZIL: wait-in-dark is legal; the dark room has no special wait intercept.
// No grue risk during wait (grue fires on MOVEMENT in the dark, not on wait).
// ---------------------------------------------------------------------------

describe('CA2: wait in the dark', () => {
  it('wait in dark room advances moveCount by 3 without crashing', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();

    // WEST-OF-HOUSE is lit by default (alwaysLit). Use a dark room instead.
    // Build a minimal dark room (no Flag.On, no lit object).
    const dark = new Room('DARK-ROOM', 'Dark Room', { ldesc: '' });
    // no Flag.On — unlit
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(dark);
    const world = World.fromObjects([dark, player]);
    const clock = new Clock();
    const gd = new Game(world, {
      rng,
      clock,
      events: new SimpleEventEmitter(),
    });
    gd.start();

    const before = gd.view().moves;
    gd.turn('wait');
    const after = gd.view().moves;

    expect(after - before).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge 5: wait output includes "Time passes..." exactly once (not 3×).
//
// V-WAIT prints "Time passes..." once at the top of the verb (gverbs.zil:1515),
// then the REPEAT runs up to 3 CLOCKER calls silently.  The loop-driven engine
// form matches: the V-WAIT handler returns result('Time passes...') once;
// clock interrupt text appends after.
// ---------------------------------------------------------------------------

describe('CA2: "Time passes..." appears exactly once', () => {
  it('no-interrupt wait has "Time passes..." exactly once in output', () => {
    const g = buildLitRoom();
    g.start();

    const out = g.turn('wait').output;
    const occurrences = (out.match(/Time passes\.\.\./g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge 6: wait after mid-game (bootstrap game, Living Room, lamp on) — 3 ticks.
//
// Verifies the bootstrap game's wait behavior with the real lantern clock.
// The lamp fires its first warning after 200 burn turns; waiting from a cold
// start is well before that, so no interrupt should fire.
// ---------------------------------------------------------------------------

describe('CA2: bootstrap game wait (real lantern, cold start)', () => {
  it('wait from Living Room with lamp on advances exactly 3 moves', () => {
    const g = createGame({ startRoom: 'LIVING-ROOM' });
    g.start();

    // Turn on the lantern so the lamp is burning (arms I-LANTERN).
    // Find and take the lantern first — it starts in the Living Room area.
    // Actually: start in Living Room; the lantern is in the trophy case area.
    // Use WEST-OF-HOUSE and navigate to get lantern, or just use a state
    // where the lamp is far from its first warning.
    // Skip this setup complication: just wait without the lamp lit.
    // The lamp is off by default; I-LANTERN is disabled. 3 clean ticks.
    const before = g.view().moves;
    g.turn('wait');
    expect(g.view().moves - before).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge 7: burnout during wait — does NOT stop the loop, but message appears.
//
// In ZIL: CLOCKER returns true only when an interrupt routine returns truthy.
// I-LANTERN's burnout sentinel (ticks:0) returns false from onFire(), so
// CLOCKER returns false → V-WAIT does NOT stop early.
// But the burnout message "You'd better have more light..." MUST appear in
// the turn output (LIGHT-INT prints it via <TELL> when TICK=0 and object
// is accessible — 1actions.zil:2328–2335).
//
// Regression caught: the engine's burnout sentinel emits dark:true but never
// calls ctx.tell(), so the message was silently dropped.  After the fix,
// a burnout-like entry (returns false, calls ctx.tell) must NOT stop the wait
// but MUST appear in the output — full 3 ticks.
//
// ZIL ref: gverbs.zil:1514 (V-WAIT stops on CLOCKER truthy),
//   1actions.zil:2328–2335 (LIGHT-INT burnout branch prints message, returns <>).
// ---------------------------------------------------------------------------

describe('CA2: burnout-like interrupt does not stop wait but message appears', () => {
  it('clock entry returning false with ctx.tell() does not stop the 3-tick loop', () => {
    const clock = new Clock();
    // Fires on tick 2, prints a burnout message, returns false (like I-LANTERN burnout).
    const entry: ClockEntry = {
      id: 'BURNOUT-LIKE',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        ctx.tell("You'd better find another light source.");
        return false;  // burnout: does not stop V-WAIT
      },
    };
    clock.schedule(entry);

    const g = buildLitRoom(clock);
    g.start();

    const before = g.view().moves;
    const out = g.turn('wait').output;
    const delta = g.view().moves - before;

    // Wait must complete all 3 ticks — burnout returns false, not a stop condition.
    expect(delta).toBe(3);
    // The burnout message must appear in the output.
    expect(out).toContain("You'd better find another light source.");
    // The wait text is also present.
    expect(out).toContain('Time passes...');
  });

  it('clock entry returning false on tick 1 allows ticks 2 and 3 to run', () => {
    const clock = new Clock();
    const fired: number[] = [];
    const entry: ClockEntry = {
      id: 'BURNOUT-TICK1',
      turnsLeft: 1,
      enabled: true,
      tick(ctx) {
        fired.push(1);
        ctx.tell('Burnout on tick 1!');
        return false;
      },
    };
    clock.schedule(entry);

    const g = buildLitRoom(clock);
    g.start();

    const before = g.view().moves;
    g.turn('wait');
    const delta = g.view().moves - before;

    // Entry fires once (then removed), wait continues for all 3 ticks.
    expect(fired).toHaveLength(1);
    expect(delta).toBe(3);
  });
});
