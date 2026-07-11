import { describe, it, expect } from 'vitest';
import { Clock, LanternInterrupt, CandleInterrupt, lampTurnsRemaining, type ClockEntry } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import type { EngineEvent } from '../../src/engine/events';

// ---------------------------------------------------------------------------
// Clock — general timer behaviour
// ---------------------------------------------------------------------------

describe('Clock: basic timer', () => {
  it('fires a 3-turn timer on turn 3', () => {
    const clock = new Clock();
    let fired = false;

    const entry: ClockEntry = {
      id: 'test-timer',
      turnsLeft: 3,
      enabled: true,
      tick() {
        fired = true;
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance(); // turn 1 — not yet
    expect(fired).toBe(false);
    clock.advance(); // turn 2 — not yet
    expect(fired).toBe(false);
    clock.advance(); // turn 3 — fires
    expect(fired).toBe(true);
  });

  it('does not fire a disabled entry', () => {
    const clock = new Clock();
    let fired = false;

    const entry: ClockEntry = {
      id: 'disabled',
      turnsLeft: 1,
      enabled: false,
      tick() {
        fired = true;
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance();
    expect(fired).toBe(false);
  });

  it('fires once per tick expiry (not every turn after)', () => {
    const clock = new Clock();
    let count = 0;

    const entry: ClockEntry = {
      id: 'one-shot',
      turnsLeft: 2,
      enabled: true,
      tick() {
        count++;
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance();
    clock.advance(); // fires here
    clock.advance(); // entry removed, no further fires
    clock.advance();

    expect(count).toBe(1);
  });

  it('enable/disable toggles an entry mid-run', () => {
    const clock = new Clock();
    let fired = false;

    const entry: ClockEntry = {
      id: 'toggle',
      turnsLeft: 2,
      enabled: true,
      tick() {
        fired = true;
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance();
    clock.disable('toggle');
    clock.advance(); // would have fired, but disabled — turnsLeft stays at 1
    expect(fired).toBe(false);

    clock.enable('toggle');
    clock.advance(); // now fires (turnsLeft was still 1)
    expect(fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LanternInterrupt — faithfully mirrors I-LANTERN / LAMP-TABLE from
// 1actions.zil and the initial QUEUE from 1dungeon.zil GO().
//
// Fuel timeline (turns from lamp activation), as verified against dfrotz:
//   200  — "The lamp appears a bit dimmer."
//   300  — "The lamp is definitely dimmer now."
//   370  — "The lamp is nearly out."
//   385  — burnout (dark: true)
//
// These are the real ZIL/dfrotz turn counts; assert against the oracle, never
// against whatever the engine happens to do.
// ---------------------------------------------------------------------------

describe('LanternInterrupt: fuel stages', () => {
  function makeSetup(initialTicks?: number) {
    const emitter = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter.on('lantern-fuel', (e) => fuelEvents.push(e));
    const clock = new Clock();
    const lantern =
      initialTicks === undefined
        ? new LanternInterrupt(clock, emitter)
        : new LanternInterrupt(clock, emitter, initialTicks);
    return { clock, emitter, fuelEvents, lantern };
  }

  it('warns at the dfrotz turn counts (200 / 300 / 370) and goes dark at 385', () => {
    const { clock, fuelEvents } = makeSetup();

    for (let i = 0; i < 199; i++) clock.advance();
    expect(fuelEvents).toHaveLength(0); // nothing before turn 200

    clock.advance(); // turn 200
    expect(fuelEvents[0]!.message).toBe('The lamp appears a bit dimmer.');

    for (let i = 0; i < 100; i++) clock.advance(); // turn 300
    expect(fuelEvents[1]!.message).toBe('The lamp is definitely dimmer now.');

    for (let i = 0; i < 70; i++) clock.advance(); // turn 370
    expect(fuelEvents[2]!.message).toBe('The lamp is nearly out.');
    expect(fuelEvents.some((e) => e.dark)).toBe(false); // not dark yet — 15 turns to go

    for (let i = 0; i < 15; i++) clock.advance(); // turn 385
    const burnout = fuelEvents.find((e) => e.dark);
    expect(burnout?.dark).toBe(true);
    expect(burnout?.remaining).toBe(0);
  });

  it('remaining reports the turns of light left at each warning', () => {
    const { clock, fuelEvents } = makeSetup();
    for (let i = 0; i < 385; i++) clock.advance();

    expect(fuelEvents[0]!.remaining).toBe(185); // 100 + 70 + 15 still to burn
    expect(fuelEvents[1]!.remaining).toBe(85); // 70 + 15
    expect(fuelEvents[2]!.remaining).toBe(15); // 15
  });

  it('emits exactly four events: three warnings then one burnout', () => {
    const { clock, fuelEvents } = makeSetup();
    for (let i = 0; i < 500; i++) clock.advance();

    expect(fuelEvents).toHaveLength(4);
    expect(fuelEvents.filter((e) => e.dark)).toHaveLength(1);
  });

  it('can be disabled to freeze fuel drain (frotz invocation support)', () => {
    const { clock, fuelEvents, lantern } = makeSetup();

    for (let i = 0; i < 100; i++) clock.advance();
    lantern.disable();
    for (let i = 0; i < 500; i++) clock.advance();

    expect(fuelEvents).toHaveLength(0);
  });

  it('re-enabling after a freeze resumes from the same position', () => {
    const { clock, fuelEvents, lantern } = makeSetup();

    for (let i = 0; i < 100; i++) clock.advance(); // 100 of the initial 200
    lantern.disable();
    for (let i = 0; i < 500; i++) clock.advance(); // frozen — no events
    lantern.enable();
    for (let i = 0; i < 100; i++) clock.advance(); // completes the initial 200

    expect(fuelEvents).toHaveLength(1);
    expect(fuelEvents[0]!.remaining).toBe(185);
  });
});

// ---------------------------------------------------------------------------
// AMENDMENT 11 (repair 3R9) — seeded lamp budget ×2. Vanilla's 385-turn lamp
// assumes known routes; blind randomized exploration is structurally
// thirstier, so seeded runs construct the lantern with budgetScale=2: every
// stage budget doubles (400/600/740 warnings, burnout at 770) and the
// emitted `remaining` values double with them. The scale rides in the
// entry's snapshot aux, so a save from a seeded run restores the doubled
// schedule into ANY game instance — including an in-place RESTORE into a
// vanilla-constructed clock, whose baked table would otherwise silently
// revert the budgets. Vanilla (scale omitted) is pinned unchanged by the
// dfrotz-anchored stage tests above. Candles are NOT scaled.
// ---------------------------------------------------------------------------

describe('LanternInterrupt: seeded budget scale (AMENDMENT 11 repair 3R9)', () => {
  function makeScaledSetup() {
    const emitter = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter.on('lantern-fuel', (e) => fuelEvents.push(e));
    const clock = new Clock();
    const lantern = new LanternInterrupt(clock, emitter, undefined, 2);
    return { clock, emitter, fuelEvents, lantern };
  }

  it('warns at doubled turn counts (400 / 600 / 740) and goes dark at 770', () => {
    const { clock, fuelEvents } = makeScaledSetup();

    for (let i = 0; i < 399; i++) clock.advance();
    expect(fuelEvents).toHaveLength(0); // nothing before turn 400

    clock.advance(); // turn 400
    expect(fuelEvents[0]!.message).toBe('The lamp appears a bit dimmer.');
    expect(fuelEvents[0]!.remaining).toBe(370); // (100+70+15) * 2

    for (let i = 0; i < 200; i++) clock.advance(); // turn 600
    expect(fuelEvents[1]!.message).toBe('The lamp is definitely dimmer now.');
    expect(fuelEvents[1]!.remaining).toBe(170); // (70+15) * 2

    for (let i = 0; i < 140; i++) clock.advance(); // turn 740
    expect(fuelEvents[2]!.message).toBe('The lamp is nearly out.');
    expect(fuelEvents[2]!.remaining).toBe(30); // 15 * 2
    expect(fuelEvents.some((e) => e.dark)).toBe(false);

    for (let i = 0; i < 30; i++) clock.advance(); // turn 770
    const burnout = fuelEvents.find((e) => e.dark);
    expect(burnout?.dark).toBe(true);
    expect(burnout?.remaining).toBe(0);
  });

  it('lampTurnsRemaining reads the doubled budget without modification', () => {
    const { clock } = makeScaledSetup();
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(770);
    for (let i = 0; i < 400; i++) clock.advance(); // first warning fired
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(370);
  });

  it('a mid-run seeded schedule survives restore into a freshly constructed vanilla-table clock', () => {
    // The in-place RESTORE path: the session restores a save into whatever
    // Game it currently holds, so a seeded save can land in a clock whose
    // LanternInterrupt was constructed with the default (vanilla) scale.
    // The doubled schedule must come back from the snapshot itself.
    const { clock: seededClock } = makeScaledSetup();
    for (let i = 0; i < 200; i++) seededClock.advance(); // mid-first-stage
    const snaps = seededClock.snapshot();

    const emitter = new SimpleEventEmitter();
    const restoredEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter.on('lantern-fuel', (e) => restoredEvents.push(e));
    const freshClock = new Clock();
    new LanternInterrupt(freshClock, emitter); // vanilla construction
    freshClock.restore(snaps);

    expect(lampTurnsRemaining(freshClock.getEntry('I-LANTERN'))).toBe(570); // 770 - 200

    for (let i = 0; i < 200; i++) freshClock.advance(); // completes the doubled initial 400
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0]!.remaining).toBe(370); // doubled, not vanilla 185
    // And the re-queue after the warning uses the DOUBLED stage tick (200,
    // not vanilla 100) — the whole schedule survived, not just the counter.
    expect(freshClock.getEntry('I-LANTERN')?.turnsLeft).toBe(200);
  });

  it('an unscaled (vanilla) snapshot restores as vanilla — old saves keep their schedule', () => {
    const emitterA = new SimpleEventEmitter();
    const clockA = new Clock();
    new LanternInterrupt(clockA, emitterA);
    for (let i = 0; i < 100; i++) clockA.advance();
    const snaps = clockA.snapshot();

    const emitterB = new SimpleEventEmitter();
    const clockB = new Clock();
    new LanternInterrupt(clockB, emitterB);
    clockB.restore(snaps);
    expect(lampTurnsRemaining(clockB.getEntry('I-LANTERN'))).toBe(285); // vanilla 385 - 100
  });
});

// ---------------------------------------------------------------------------
// lampTurnsRemaining — live fuel readout for the tracker panel. Derives the
// turns of light left from the I-LANTERN entry's snapshot (countdown to the
// next stage + the ticks of every stage still ahead), so it agrees with the
// `remaining` values the fuel events emit at each warning, at every moment
// BETWEEN warnings too. A missing entry means the burnout sentinel fired and
// removed it: 0 turns.
// ---------------------------------------------------------------------------

describe('lampTurnsRemaining: live fuel readout', () => {
  it('reads the full 385-turn budget fresh, tracks between stages, and hits 0 at burnout', () => {
    const emitter = new SimpleEventEmitter();
    const clock = new Clock();
    new LanternInterrupt(clock, emitter);

    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(385);

    for (let i = 0; i < 150; i++) clock.advance(); // mid-first-stage
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(235);

    for (let i = 0; i < 50; i++) clock.advance(); // turn 200 — first warning fired
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(185);

    for (let i = 0; i < 170; i++) clock.advance(); // turn 370 — "nearly out"
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(15);

    for (let i = 0; i < 15; i++) clock.advance(); // turn 385 — burnout, entry removed
    expect(clock.getEntry('I-LANTERN')).toBeUndefined();
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(0);
  });

  it('a frozen (disabled) lantern keeps its readout — fuel does not drain unlit', () => {
    const emitter = new SimpleEventEmitter();
    const clock = new Clock();
    const lantern = new LanternInterrupt(clock, emitter);
    for (let i = 0; i < 100; i++) clock.advance();
    lantern.disable();
    for (let i = 0; i < 50; i++) clock.advance();
    expect(lampTurnsRemaining(clock.getEntry('I-LANTERN'))).toBe(285);
  });
});

// ---------------------------------------------------------------------------
// CandleInterrupt — mirrors I-CANDLES / CANDLE-TABLE from 1actions.zil.
// The candles are QUEUE'd disabled at GO() and only burn once lit, so these
// tests drive the interrupt directly (enabled by construction) to cover the
// firing schedule.
//
// Fuel timeline (turns of active burning):
//   40  — "The candles grow shorter."
//   60  — "The candles are becoming quite short."
//   70  — "The candles won't last long now."
//   75  — burnout (dark: true)
// ---------------------------------------------------------------------------

describe('CandleInterrupt: fuel stages', () => {
  function makeSetup() {
    const emitter = new SimpleEventEmitter();
    const candleEvents: Array<Extract<EngineEvent, { type: 'candle-fuel' }>> = [];
    emitter.on('candle-fuel', (e) => candleEvents.push(e));
    const clock = new Clock();
    const candles = new CandleInterrupt(clock, emitter);
    return { clock, candleEvents, candles };
  }

  it('warns at the ZIL turn counts (40 / 60 / 70) and goes dark at 75', () => {
    const { clock, candleEvents } = makeSetup();

    for (let i = 0; i < 39; i++) clock.advance();
    expect(candleEvents).toHaveLength(0);

    clock.advance(); // turn 40
    expect(candleEvents[0]!.message).toBe('The candles grow shorter.');

    for (let i = 0; i < 20; i++) clock.advance(); // turn 60
    expect(candleEvents[1]!.message).toBe('The candles are becoming quite short.');

    for (let i = 0; i < 10; i++) clock.advance(); // turn 70
    expect(candleEvents[2]!.message).toBe("The candles won't last long now.");

    for (let i = 0; i < 5; i++) clock.advance(); // turn 75
    const burnout = candleEvents.find((e) => e.dark);
    expect(burnout?.dark).toBe(true);
    expect(burnout?.remaining).toBe(0);
  });

  it('remaining reports the turns of light left at each warning', () => {
    const { clock, candleEvents } = makeSetup();
    for (let i = 0; i < 75; i++) clock.advance();

    expect(candleEvents[0]!.remaining).toBe(35); // 20 + 10 + 5
    expect(candleEvents[1]!.remaining).toBe(15); // 10 + 5
    expect(candleEvents[2]!.remaining).toBe(5); // 5
  });

  it('stays dormant while disabled (queued at GO but not yet lit)', () => {
    const { clock, candleEvents, candles } = makeSetup();
    candles.disable();
    for (let i = 0; i < 200; i++) clock.advance();
    expect(candleEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SS2 — FuelInterrupt.tableIndex round-trips through ClockSnapshot.aux
// ---------------------------------------------------------------------------

describe('SS2 fuel-stage round-trip', () => {
  // Spec §3.3 done-criteria: save at "definitely dimmer" stage (tableIndex=1,
  // after the first warning at turn 200), restore onto a fresh clock/lantern,
  // advance 70 turns — the next warning must be "nearly out" not a repeat of
  // "definitely dimmer".

  it('lamp at stage 1 (definitely dimmer): next warning after restore is nearly out', () => {
    const emitter1 = new SimpleEventEmitter();
    const events1: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter1.on('lantern-fuel', (e) => events1.push(e));
    const clock1 = new Clock();
    new LanternInterrupt(clock1, emitter1);

    // Advance through first warning (turn 200) and then through the re-queue
    // period so we're at stage 1 (tableIndex=1) — one warning emitted, next
    // fires 100 turns later at turn 300.
    for (let i = 0; i < 200; i++) clock1.advance();
    expect(events1[0]!.message).toBe('The lamp appears a bit dimmer.'); // confirms stage 0 fired

    // Snapshot mid-stage-1 (turnsLeft is now 100, tableIndex=1).
    const snap = clock1.snapshot();
    const lanternSnap = snap.find((s) => s.id === 'I-LANTERN')!;

    // aux must carry the tableIndex.
    expect(lanternSnap.aux).toBeDefined();
    expect(lanternSnap.aux!['tableIndex']).toBe(1);

    // Fresh clock + lantern, then restore.
    const emitter2 = new SimpleEventEmitter();
    const events2: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter2.on('lantern-fuel', (e) => events2.push(e));
    const clock2 = new Clock();
    new LanternInterrupt(clock2, emitter2);

    clock2.restore(snap);

    // Advance 100 more turns — the next warning fires (stage 1 → "definitely dimmer"
    // interval ends; tableIndex becomes 2 → next stage is "nearly out").
    for (let i = 0; i < 100; i++) clock2.advance();
    expect(events2).toHaveLength(1);
    expect(events2[0]!.message).toBe('The lamp is definitely dimmer now.');

    // Advance 70 more — stage 2 fires ("nearly out").
    for (let i = 0; i < 70; i++) clock2.advance();
    expect(events2).toHaveLength(2);
    expect(events2[1]!.message).toBe('The lamp is nearly out.');
  });

  it('snapshot aux field is absent for non-fuel clock entries', () => {
    const clock = new Clock();
    clock.schedule({ id: 'dummy', turnsLeft: 5, enabled: true, tick: () => false });
    const snap = clock.snapshot();
    const entry = snap.find((s) => s.id === 'dummy')!;
    // Non-fuel entries should not have aux (or have it undefined).
    expect(entry.aux).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SaveState serialisation round-trip
// ---------------------------------------------------------------------------

describe('Clock: serialise / restore', () => {
  it('snapshot captures enabled state and turnsLeft for all entries', () => {
    const clock = new Clock();
    clock.schedule({ id: 'a', turnsLeft: 10, enabled: true, tick: () => false });
    clock.schedule({ id: 'b', turnsLeft: 5, enabled: false, tick: () => false });

    clock.advance(); // turnsLeft: a→9, b unchanged (disabled)
    clock.advance(); // a→8

    const snap = clock.snapshot();
    expect(snap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a', turnsLeft: 8, enabled: true }),
        expect.objectContaining({ id: 'b', turnsLeft: 5, enabled: false }),
      ]),
    );
  });

  it('restore sets entries back to snapshot state and re-fires on cue', () => {
    const clock = new Clock();
    let fired = false;

    clock.schedule({
      id: 'restore-test',
      turnsLeft: 5,
      enabled: true,
      tick() {
        fired = true;
        return false;
      },
    });

    clock.advance();
    clock.advance(); // turnsLeft now 3

    const snap = clock.snapshot();

    // Advance past firing point.
    clock.advance();
    clock.advance();
    clock.advance(); // fires here (turnsLeft → 0)
    expect(fired).toBe(true);
    fired = false;

    // Re-add the entry (it was removed after firing) and restore.
    clock.schedule({
      id: 'restore-test',
      turnsLeft: 5, // will be overwritten by restore
      enabled: true,
      tick() {
        fired = true;
        return false;
      },
    });
    clock.restore(snap); // restores turnsLeft=3

    clock.advance();
    clock.advance();
    clock.advance(); // fires again at restored position
    expect(fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queue() — generic re-arm primitive (F1)
// ---------------------------------------------------------------------------

describe('Clock: queue re-arm', () => {
  it('queue on an existing entry resets turnsLeft and enables it', () => {
    const clock = new Clock();
    let count = 0;

    clock.schedule({ id: 'I-CURE', turnsLeft: 5, enabled: true, tick() { count++; return false; } });
    // advance past fire — entry removed
    for (let i = 0; i < 5; i++) clock.advance();
    expect(count).toBe(1);

    // re-arm: re-schedule then re-queue
    clock.schedule({ id: 'I-CURE', turnsLeft: 0, enabled: false, tick() { count++; return false; } });
    clock.queue('I-CURE', 3, true);

    // should fire again after 3 turns
    clock.advance();
    clock.advance();
    expect(count).toBe(1);
    clock.advance();
    expect(count).toBe(2);
  });

  it('queue enables the entry when enabled=true', () => {
    const clock = new Clock();
    let fired = false;
    clock.schedule({ id: 'X', turnsLeft: 2, enabled: false, tick() { fired = true; return false; } });
    clock.queue('X', 2, true);
    clock.advance();
    clock.advance();
    expect(fired).toBe(true);
  });

  it('queue with enabled=false arms the period but leaves it disabled', () => {
    const clock = new Clock();
    let fired = false;
    clock.schedule({ id: 'Y', turnsLeft: 0, enabled: false, tick() { fired = true; return false; } });
    clock.queue('Y', 2, false);
    clock.advance();
    clock.advance();
    // disabled — must not fire
    expect(fired).toBe(false);
    // enable it and let the original period count down
    clock.enable('Y');
    clock.advance();
    clock.advance();
    expect(fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// killAll() — batch-disable (F1 / KILL-INTERRUPTS)
// ---------------------------------------------------------------------------

describe('Clock: killAll batch-disable', () => {
  it('disables every listed registered slot', () => {
    const clock = new Clock();
    clock.schedule({ id: 'I-LANTERN', turnsLeft: 1, enabled: true, tick() { return true; } });
    clock.schedule({ id: 'I-CANDLES', turnsLeft: 1, enabled: true, tick() { return true; } });

    clock.killAll(['I-LANTERN', 'I-CANDLES']);
    const snap = clock.snapshot();
    const lantern = snap.find((s) => s.id === 'I-LANTERN')!;
    const candles = snap.find((s) => s.id === 'I-CANDLES')!;
    expect(lantern.enabled).toBe(false);
    expect(candles.enabled).toBe(false);
  });

  it('is a safe no-op for unregistered ids', () => {
    const clock = new Clock();
    // These ids are not registered at all — must not throw.
    expect(() => clock.killAll(['I-XB', 'I-XC', 'I-CYCLOPS'])).not.toThrow();
  });

  it('only disables listed ids, leaving others enabled', () => {
    const clock = new Clock();
    clock.schedule({ id: 'A', turnsLeft: 5, enabled: true, tick() { return true; } });
    clock.schedule({ id: 'B', turnsLeft: 5, enabled: true, tick() { return true; } });
    clock.killAll(['A']);
    const snap = clock.snapshot();
    expect(snap.find((s) => s.id === 'A')!.enabled).toBe(false);
    expect(snap.find((s) => s.id === 'B')!.enabled).toBe(true);
  });
});
