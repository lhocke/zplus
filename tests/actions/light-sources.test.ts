/**
 * Integration tests for the light-source action routines.
 *
 * All tests drive the real extracted world through createGame / newGameAt so
 * that handler wiring, flag state, and clock gating are exercised end-to-end —
 * no mocking.
 *
 * Coverage:
 *   - LANTERN: turn on → fuel interrupt enabled, turn off → disabled.
 *   - LANTERN: low-fuel warning messages fire at exact ZIL thresholds.
 *   - LANTERN: burnout marks the lamp as burned out (Flag.Burned).
 *   - MATCH:   lighting a match, exact ZIL text, count, examine.
 *   - CANDLES: light with match, extinguish, examine.
 *   - TORCH:   examine and attempted extinguish.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { EngineEvent } from '../../src/engine/events.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';
import type { World } from '../../src/domain/world.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance the game N turns by issuing N "wait" (z) commands. */
function wait(g: ReturnType<typeof createGame>, n: number): void {
  for (let i = 0; i < n; i++) g.turn('z');
}

/** Retrieve the World from the game (private but accessible via bracket notation). */
function worldOf(g: ReturnType<typeof createGame>): World {
  return (g as unknown as { world: World }).world;
}

/**
 * Start a game with the player in LIVING-ROOM (where the lamp lives),
 * take the lamp, and return the game.
 */
function gameWithLamp(): ReturnType<typeof createGame> {
  const g = newGameAt('LIVING-ROOM');
  g.start();
  g.turn('take brass lantern');
  return g;
}

/**
 * Start a game with the player in SOUTH-TEMPLE, with the MATCH already
 * in their inventory (the match normally lives in DAM-LOBBY).
 */
function gameWithCandlesAndMatch(): ReturnType<typeof createGame> {
  const g = newGameAt('SOUTH-TEMPLE');
  g.start();
  const w = worldOf(g);
  // Move the MATCH into the player's inventory directly — the two items live
  // in different rooms and navigating the long path would bloat the test.
  const match = w.get('MATCH')!;
  const player = w.get('PLAYER')!;
  match.moveTo(player);
  g.turn('take candles');
  return g;
}

// ---------------------------------------------------------------------------
// LANTERN — fuel interrupt gating
// ---------------------------------------------------------------------------

describe('LANTERN: fuel interrupt gating', () => {
  beforeEach(() => resetMatchCount());

  it('no lantern-fuel event fires while the lamp is off', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');

    // Advance well past the first threshold (200 turns) without turning on.
    wait(g, 210);

    expect(fuelEvents).toHaveLength(0);
  });

  it('turning the lamp on starts the fuel countdown', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');

    // Advance exactly 200 turns — the first warning should fire.
    wait(g, 200);

    expect(fuelEvents.length).toBeGreaterThanOrEqual(1);
    expect(fuelEvents[0]!.message).toBe('The lamp appears a bit dimmer.');
  });

  it('turning the lamp off stops the fuel countdown', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');

    // Advance 100 turns (half-way to first warning) then turn off.
    wait(g, 100);
    g.turn('turn off lantern');

    // Advance another 200 turns — no warning fires because the lamp is off.
    wait(g, 200);

    expect(fuelEvents).toHaveLength(0);
  });

  it('re-enabling after a pause resumes drain from where it stopped', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');

    // Burn 100 turns, freeze, wait 500 turns frozen, thaw, finish the 200.
    wait(g, 100);
    g.turn('turn off lantern');
    wait(g, 500);           // frozen — no events
    expect(fuelEvents).toHaveLength(0);

    g.turn('turn on lantern');
    wait(g, 100);           // completes the original 200-turn initial period

    expect(fuelEvents.length).toBeGreaterThanOrEqual(1);
    expect(fuelEvents[0]!.message).toBe('The lamp appears a bit dimmer.');
  });
});

// ---------------------------------------------------------------------------
// LANTERN — low-fuel warning messages at ZIL thresholds (exact text)
// ---------------------------------------------------------------------------

describe('LANTERN: low-fuel warning messages', () => {
  beforeEach(() => resetMatchCount());

  it('first warning fires at turn 200 of burn time: exact ZIL text', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');
    wait(g, 200);

    expect(fuelEvents[0]?.message).toBe('The lamp appears a bit dimmer.');
  });

  it('second warning fires at turn 300 of burn time: exact ZIL text', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');
    wait(g, 300); // 200 initial + 100 from first stage

    expect(fuelEvents[1]?.message).toBe('The lamp is definitely dimmer now.');
  });

  it('third warning fires at turn 370 of burn time: exact ZIL text', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');
    wait(g, 370); // 200 + 100 + 70

    expect(fuelEvents[2]?.message).toBe('The lamp is nearly out.');
  });

  it('burnout fires at turn 385 with dark:true and remaining:0', () => {
    const events = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    events.on('lantern-fuel', (e) => fuelEvents.push(e));

    const g = createGame({ startRoom: 'LIVING-ROOM', events });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');
    wait(g, 385); // 200 + 100 + 70 + 15

    const burnout = fuelEvents.find((e) => e.dark);
    expect(burnout).toBeDefined();
    expect(burnout?.remaining).toBe(0);
    expect(burnout?.dark).toBe(true);
  });

  it('burnout marks the lamp Flag.Burned', () => {
    const g = createGame({ startRoom: 'LIVING-ROOM' });
    g.start();
    g.turn('take brass lantern');
    g.turn('turn on lantern');
    wait(g, 385);

    const lamp = worldOf(g).get('LAMP');
    expect(lamp?.has(Flag.Burned)).toBe(true);
    expect(lamp?.has(Flag.OnFire)).toBe(false);
  });

  it('examine after burnout prints burned-out message', () => {
    const g = gameWithLamp();
    g.turn('turn on lantern');
    wait(g, 385);

    const r = g.turn('examine lantern');
    expect(r.output).toContain('burned out');
  });

  it('turning on a burned-out lamp: exact ZIL text', () => {
    const g = gameWithLamp();
    g.turn('turn on lantern');
    wait(g, 385);

    const r = g.turn('turn on lantern');
    expect(r.output).toContain("A burned-out lamp won't light.");
  });

  it('turning off a burned-out lamp: exact ZIL text', () => {
    const g = gameWithLamp();
    g.turn('turn on lantern');
    wait(g, 385);

    const r = g.turn('turn off lantern');
    expect(r.output).toContain('The lamp has already burned out.');
  });
});

// ---------------------------------------------------------------------------
// LANTERN — basic verb responses (non-fuel)
// ---------------------------------------------------------------------------

describe('LANTERN: verb responses', () => {
  beforeEach(() => resetMatchCount());

  it('turn on lantern confirms with message and sets OnFire flag', () => {
    const g = gameWithLamp();
    const r = g.turn('turn on lantern');
    // ZIL: V-LAMP-ON "The [PRSO] is now on." (gverbs.zil:792), PRSO.desc = "brass lantern"
    expect(r.output).toContain('The brass lantern is now on.');

    const lamp = worldOf(g).get('LAMP');
    expect(lamp?.has(Flag.OnFire)).toBe(true);
  });

  it('turn off lantern confirms with message and clears OnFire flag', () => {
    const g = gameWithLamp();
    g.turn('turn on lantern');
    const r = g.turn('turn off lantern');
    // ZIL: V-LAMP-OFF "The [PRSO] is now off." (gverbs.zil:779), PRSO.desc = "brass lantern"
    expect(r.output).toContain('The brass lantern is now off.');

    const lamp = worldOf(g).get('LAMP');
    expect(lamp?.has(Flag.OnFire)).toBe(false);
  });

  it('examine lit lamp reports on', () => {
    const g = gameWithLamp();
    g.turn('turn on lantern');
    const r = g.turn('examine lantern');
    expect(r.output).toContain('is on');
  });

  it('examine unlit lamp reports off', () => {
    const g = gameWithLamp();
    const r = g.turn('examine lantern');
    expect(r.output).toContain('is turned off');
  });
});

// ---------------------------------------------------------------------------
// MATCH — lighting and exact ZIL messages
// ---------------------------------------------------------------------------

describe('MATCH: lighting and messages', () => {
  beforeEach(() => resetMatchCount());

  it('lighting a match outputs exact ZIL text', () => {
    // Use "light match" (LIGHT verb, V-LAMP-ON action) — 1-object form,
    // no GWIM iobj needed. MATCH-FUNCTION handles <VERB? LAMP-ON BURN>.
    const g = newGameAt('DAM-LOBBY');
    g.start();
    g.turn('take matchbook');

    const r = g.turn('light match');
    expect(r.output).toContain('One of the matches starts to burn.');
  });

  it('lighting a match sets OnFire and Light flags', () => {
    const g = newGameAt('DAM-LOBBY');
    g.start();
    g.turn('take matchbook');
    g.turn('light match');

    const match = worldOf(g).get('MATCH');
    expect(match?.has(Flag.OnFire)).toBe(true);
    expect(match?.has(Flag.Light)).toBe(true);
  });

  it('examine burning match: exact ZIL text', () => {
    const g = newGameAt('DAM-LOBBY');
    g.start();
    g.turn('take matchbook');
    g.turn('light match');

    const r = g.turn('examine match');
    expect(r.output).toContain('The match is burning.');
  });

  it('examine unlit matchbook: exact ZIL text', () => {
    const g = newGameAt('DAM-LOBBY');
    g.start();
    g.turn('take matchbook');

    const r = g.turn('examine match');
    expect(r.output).toContain(
      "The matchbook isn't very interesting, except for what's written on it.",
    );
  });

  it('extinguishing a burning match: exact ZIL text', () => {
    const g = newGameAt('DAM-LOBBY');
    g.start();
    g.turn('take matchbook');
    g.turn('light match');

    const r = g.turn('extinguish match');
    expect(r.output).toContain('The match is out.');
  });

  it('running out of matches: exact ZIL text', () => {
    // MATCH-COUNT starts at 6.  Each light call decrements by 1.
    // Light 5 times (extinguishing each time so the auto-quench interrupt
    // does not re-decrement).  On the 6th attempt the count is 0.
    const g = newGameAt('DAM-LOBBY');
    g.start();
    g.turn('take matchbook');

    for (let i = 0; i < 5; i++) {
      g.turn('light match');
      g.turn('extinguish match');
    }

    const r = g.turn('light match');
    expect(r.output).toContain("I'm afraid that you have run out of matches.");
  });
});

// ---------------------------------------------------------------------------
// CANDLES — lighting, extinguishing, and exact ZIL messages
// ---------------------------------------------------------------------------

describe('CANDLES: behavior and messages', () => {
  beforeEach(() => resetMatchCount());

  it('examine lit candles reports burning', () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    g.turn('take candles');

    const r = g.turn('examine candles');
    expect(r.output).toContain('The candles are burning.');
  });

  it('extinguish candles: exact ZIL text', () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    g.turn('take candles');

    const r = g.turn('extinguish candles');
    expect(r.output).toContain('The flame is extinguished.');
  });

  it('examine extinguished candles reports out', () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    g.turn('take candles');
    g.turn('extinguish candles');

    const r = g.turn('examine candles');
    expect(r.output).toContain('The candles are out.');
  });

  it('extinguishing already-unlit candles: exact ZIL text', () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    g.turn('take candles');
    g.turn('extinguish candles');

    const r = g.turn('extinguish candles');
    expect(r.output).toContain('The candles are not lighted.');
  });

  it('lighting unlit candles with a burning match: GWIM parenthetical + "The candles are lit."', () => {
    // Start in SOUTH-TEMPLE with candles; teleport MATCH into inventory.
    // Use "light match" (LIGHT verb, 1-object form) to avoid C7 orphan for BURN 2-obj.
    // With C7: "burn candles" → GWIM finds burning match as iobj →
    //   parenthetical "(with the matchbook)" printed by GWIM, then "The candles are lit."
    // ZIL: MATCH.desc = "matchbook" so the parenthetical uses that string.
    const g = gameWithCandlesAndMatch();
    g.turn('extinguish candles'); // candles now unlit
    g.turn('light match');         // light the match (LIGHT = V-LAMP-ON, handled by MATCH-FUNCTION)

    const r = g.turn('burn candles');
    // GWIM auto-supplies the burning match as iobj → parenthetical with MATCH's desc
    expect(r.output).toContain('(with the matchbook)');
    expect(worldOf(g).get('CANDLES')?.has(Flag.OnFire)).toBe(true);
  });

  it('lighting unlit candles with a burning match: "The candles are lit."', () => {
    const g = gameWithCandlesAndMatch();
    g.turn('extinguish candles');
    g.turn('light match');

    const r = g.turn('burn candles');
    expect(r.output).toContain('The candles are lit.');
  });

  it('lighting already-lit candles reports already lit', () => {
    const g = gameWithCandlesAndMatch();
    // Candles are still lit at this point (not extinguished).
    g.turn('light match');

    const r = g.turn('burn candles');
    // The ZIL text: "The candles are already lit."
    expect(r.output).toContain('The candles are already lit.');
  });
});

// ---------------------------------------------------------------------------
// TORCH — permanently burning ivory torch
// ---------------------------------------------------------------------------

describe('TORCH: burning ivory torch', () => {
  beforeEach(() => resetMatchCount());

  it('examine torch: exact ZIL text', () => {
    const g = newGameAt('TORCH-ROOM');
    g.start();

    const r = g.turn('examine torch');
    expect(r.output).toContain('The torch is burning.');
  });

  it('attempting to extinguish the torch: exact ZIL text', () => {
    const g = newGameAt('TORCH-ROOM');
    g.start();
    g.turn('take torch');

    const r = g.turn('extinguish torch');
    expect(r.output).toContain(
      'You nearly burn your hand trying to extinguish the flame.',
    );
  });
});

// ---------------------------------------------------------------------------
// CANDLES — I-CANDLES fuel interrupt events
// ---------------------------------------------------------------------------

describe('CANDLES: fuel interrupt events', () => {
  it('candles do not burn down until lit, even sitting in the temple', () => {
    const events = new SimpleEventEmitter();
    const candleEvents: Array<Extract<EngineEvent, { type: 'candle-fuel' }>> = [];
    events.on('candle-fuel', (e) => candleEvents.push(e));

    // I-CANDLES is QUEUE'd at GO() but left disabled (1dungeon.zil:2641 has no
    // <ENABLE>); merely standing in the temple must not consume the candles.
    const g = createGame({ startRoom: 'SOUTH-TEMPLE', events });
    g.start();

    wait(g, 75); // past every candle-table threshold

    expect(candleEvents).toHaveLength(0);
  });

  it('extinguishing candles stops the candle-fuel countdown', () => {
    const events = new SimpleEventEmitter();
    const candleEvents: Array<Extract<EngineEvent, { type: 'candle-fuel' }>> = [];
    events.on('candle-fuel', (e) => candleEvents.push(e));

    const g = createGame({ startRoom: 'SOUTH-TEMPLE', events });
    g.start();
    g.turn('take candles');
    g.turn('extinguish candles');

    // Advance well past the first threshold — no events since extinguished.
    wait(g, 100);

    expect(candleEvents).toHaveLength(0);
  });
});
