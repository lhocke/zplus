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

import { describe, it, expect, beforeEach, assert } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { EngineEvent } from '../../src/engine/events.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';
import type { World } from '../../src/domain/world.js';

type ClockLike = { getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined };
function clockOf(g: ReturnType<typeof createGame>): ClockLike {
  return (g as unknown as { clock: ClockLike }).clock;
}

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

    // Advance 33 wait-commands (~99 clock ticks — just under half-way to first
    // warning at 200 ticks) then turn off.  With multi-CLOCKER each WAIT fires
    // up to 3 CLOCKER ticks, so 33 waits < ceil(200/3) = 67 waits.
    wait(g, 33);
    g.turn('turn off lantern');

    // Advance another 200 wait-commands — no warning fires because the lamp is off.
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

    // Burn 33 wait-commands (~99 clock ticks), freeze, wait 500 frozen, thaw,
    // finish the 200-tick initial period.  With multi-CLOCKER each WAIT fires
    // up to 3 CLOCKER ticks; first warning at 200 ticks fires at ~67 waits, so
    // 33 waits is safely mid-period.
    wait(g, 33);
    g.turn('turn off lantern');
    wait(g, 500);           // frozen — no events
    expect(fuelEvents).toHaveLength(0);

    g.turn('turn on lantern');
    wait(g, 34);            // ~102 more ticks → ~201 total → first warning fires

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

  // BD1 — gverbs.zil:780-781: after clearing ONBIT, if LIT went false, append
  // "It is now pitch black." (DGC-3).
  it('turn off lantern in dark room appends pitch-black line (BD1)', () => {
    // Cellar has no ONBIT — dark without a light source.
    const g = newGameAt('CELLAR');
    g.start();
    const w = worldOf(g);
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);

    const r = g.turn('turn off lantern');
    expect(r.output).toContain('The brass lantern is now off.');
    expect(r.output).toContain('It is now pitch black.');
  });

  it('turn off lantern in a naturally-lit room (ONBIT) does not append pitch-black', () => {
    // Living Room has ONBIT — always lit regardless of lamp state.
    const g = gameWithLamp();
    g.turn('turn on lantern');
    const r = g.turn('turn off lantern');
    expect(r.output).toContain('The brass lantern is now off.');
    expect(r.output).not.toContain('pitch black');
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

// ---------------------------------------------------------------------------
// CA3 — Match burnout re-arm (spec sec 3.3)
// ---------------------------------------------------------------------------

describe('CA3 MATCH: burnout re-arm after relight', () => {
  beforeEach(() => resetMatchCount());

  it('match burns out after 2 ticks', () => {
    const events = new SimpleEventEmitter();
    const g = createGame({ startRoom: 'DAM-LOBBY', events });
    g.start();
    g.turn('take matchbook');
    g.turn('light match');

    // 1 wait = 1 clocker tick (or up to 3 for V-WAIT, but we need exactly 2)
    // Use 'z' (wait) — the multi-CLOCKER loop advances up to 3; match burnout
    // at exactly turnsLeft=2 means it fires on the 2nd tick.  A single 'z' fires
    // up to 3 ticks, so 1 wait is enough to trigger burnout.
    const r = g.turn('z');
    // After 1-3 ticks, the 2-turn match should have burned out.
    expect(r.output).toContain('The match has gone out.');

    const match = worldOf(g).get('MATCH');
    assert(match !== undefined, 'MATCH must exist in world');
    expect(match.has(Flag.OnFire)).toBe(false);
  });

  it('re-lighting a match after burnout re-arms the 2-tick timer', () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    g.turn('take matchbook');

    // First light + burnout
    g.turn('light match');
    g.turn('z'); // match burns out

    // Re-light: queueClock sets turnsLeft=2, then the turn's clock advance
    // decrements it to 1.  What matters: the slot stays registered and enabled.
    g.turn('light match');

    const entry = clockOf(g).getEntry('I-MATCH');
    assert(entry !== undefined, 'I-MATCH must remain registered after burnout');
    expect(entry.enabled).toBe(true);
    // turnsLeft was set to 2 by queueClock; one clock tick fires at end of the
    // light-match turn, decrementing to 1.
    expect(entry.turnsLeft).toBe(1);
  });

  it('re-lit match burns out a second time', () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    g.turn('take matchbook');

    g.turn('light match');
    g.turn('z');  // first burnout

    g.turn('light match');  // re-light
    const r = g.turn('z');  // second burnout
    expect(r.output).toContain('The match has gone out.');
  });

  it('MATCH-COUNT caps: using all 6 matches exhausts supply', () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    g.turn('take matchbook');

    // Light + extinguish 5 times (count stays positive)
    for (let i = 0; i < 5; i++) {
      g.turn('light match');
      g.turn('extinguish match');
    }

    // 6th light succeeds; 7th fails
    g.turn('light match');
    g.turn('extinguish match');
    const r = g.turn('light match');
    expect(r.output).toContain("I'm afraid that you have run out of matches.");
  });
});

// ---------------------------------------------------------------------------
// CA3 — Candle first-touch arming (spec sec 3.4)
// ---------------------------------------------------------------------------

describe('CA3 CANDLES: first-touch arming', () => {
  beforeEach(() => resetMatchCount());

  it('taking already-lit candles enables I-CANDLES (first-touch)', () => {
    // SOUTH-TEMPLE has lit candles. Taking them triggers CANDLES-FCN which
    // must enable I-CANDLES on the first touch (before TOUCHBIT is set).
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();

    // Before take: I-CANDLES must exist but be disabled (GO() queues, no ENABLE)
    const before = clockOf(g).getEntry('I-CANDLES');
    assert(before !== undefined, 'I-CANDLES must be registered at game start');
    expect(before.enabled).toBe(false);

    g.turn('take candles');

    const after = clockOf(g).getEntry('I-CANDLES');
    assert(after !== undefined, 'I-CANDLES must remain registered after take');
    expect(after.enabled).toBe(true);
  });

  it('first-touch arming fires independently of burn/relight path', () => {
    // Candles start lit in SOUTH-TEMPLE. We never call burn or relight —
    // the clock must be armed purely by the take-and-touch path.
    const events = new SimpleEventEmitter();
    const candleEvents: Array<Extract<EngineEvent, { type: 'candle-fuel' }>> = [];
    events.on('candle-fuel', (e) => candleEvents.push(e));

    const g = createGame({ startRoom: 'SOUTH-TEMPLE', events });
    g.start();
    g.turn('take candles');

    // Advance enough ticks to see a fuel warning if I-CANDLES is armed.
    // I-CANDLES starts at 40 ticks; each 'z' fires up to 3 CLOCKER ticks.
    // 14 waits = up to 42 ticks → first warning at 40 should appear.
    wait(g, 14);

    expect(candleEvents.length).toBeGreaterThan(0);
  });

  it('second touch does NOT re-arm (TOUCHBIT set, idempotent)', () => {
    // After first touch TOUCHBIT is set; a second examine/interaction must not
    // double-arm I-CANDLES or reset its countdown.
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();
    g.turn('take candles');

    const afterFirstTouch = clockOf(g).getEntry('I-CANDLES');
    assert(afterFirstTouch !== undefined, 'I-CANDLES must be registered');
    const turnsAfterFirst = afterFirstTouch.turnsLeft;

    // A wait tick will decrement turnsLeft; then examine should not reset it
    wait(g, 1);
    g.turn('examine candles');

    const afterExamine = clockOf(g).getEntry('I-CANDLES');
    assert(afterExamine !== undefined, 'I-CANDLES must remain registered');
    // turnsLeft should be LESS than turnsAfterFirst (it ticked), not reset
    expect(afterExamine.turnsLeft).toBeLessThan(turnsAfterFirst);
  });
});
