import { describe, it, expect } from 'vitest';
import { Clock, LanternInterrupt, type ClockEntry } from '../../src/engine/clock';
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
// Fuel timeline (turns from lamp activation):
//   200  — "The lamp appears a bit dimmer."
//   300  — "The lamp is definitely dimmer now."
//   370  — "The lamp is nearly out."  (+ immediate burnout in same turn)
//   370  — burnout (dark: true)
//
// Test uses a shortened initial tick to keep the test fast.
// ---------------------------------------------------------------------------

describe('LanternInterrupt: fuel stages', () => {
  // Use a short initial tick (10) and override so tests run in <385 advances.
  // The LAMP_TABLE entries (100/70/15) are fixed, so test against those.

  function makeSetup(initialTicks = 5) {
    const emitter = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter.on('lantern-fuel', (e) => fuelEvents.push(e));
    const clock = new Clock();
    const lantern = new LanternInterrupt(clock, emitter, initialTicks);
    return { clock, emitter, fuelEvents, lantern };
  }

  it('emits lantern-fuel with remaining counts at each LAMP-TABLE stage', () => {
    // initialTicks=5 → first fire at turn 5 (dimmer msg, remaining=85)
    const { clock, fuelEvents } = makeSetup(5);

    for (let i = 0; i < 5; i++) clock.advance();
    expect(fuelEvents[0]?.message).toContain('a bit dimmer');
    expect(fuelEvents[0]?.remaining).toBe(85);  // 70 + 15 remain

    for (let i = 0; i < 70; i++) clock.advance();
    expect(fuelEvents[1]?.message).toContain('definitely dimmer');
    expect(fuelEvents[1]?.remaining).toBe(15);

    // "nearly out" + burnout fire on the same turn (ZIL I-LANTERN behaviour)
    for (let i = 0; i < 15; i++) clock.advance();
    expect(fuelEvents[2]?.message).toContain('nearly out');
    expect(fuelEvents[3]?.dark).toBe(true);
    expect(fuelEvents[3]?.remaining).toBe(0);
  });

  it('warning messages match ZIL source strings exactly', () => {
    const { clock, fuelEvents } = makeSetup(5);

    for (let i = 0; i < 5 + 70 + 15; i++) clock.advance();

    expect(fuelEvents[0]!.message).toBe('The lamp appears a bit dimmer.');
    expect(fuelEvents[1]!.message).toBe('The lamp is definitely dimmer now.');
    expect(fuelEvents[2]!.message).toBe('The lamp is nearly out.');
  });

  it('burnout event has dark:true and remaining:0', () => {
    const { clock, fuelEvents } = makeSetup(5);

    for (let i = 0; i < 5 + 70 + 15; i++) clock.advance();

    const burnout = fuelEvents.find((e) => e.dark);
    expect(burnout).toBeDefined();
    expect(burnout?.remaining).toBe(0);
    expect(burnout?.dark).toBe(true);
  });

  it('does not emit any more events after burnout', () => {
    const { clock, fuelEvents } = makeSetup(5);

    // Run well past all stages.
    for (let i = 0; i < 500; i++) clock.advance();

    // Exactly 4 events: dimmer, dimmer now, nearly out, burnout.
    expect(fuelEvents.length).toBe(4);
  });

  it('can be disabled to freeze fuel drain (frotz invocation support)', () => {
    const { clock, fuelEvents, lantern } = makeSetup(10);

    // Advance 5 turns, then disable.
    for (let i = 0; i < 5; i++) clock.advance();
    lantern.disable();

    // Advance many more turns — nothing should fire.
    for (let i = 0; i < 500; i++) clock.advance();

    expect(fuelEvents).toHaveLength(0);
  });

  it('re-enabling after freeze continues drain from remaining position', () => {
    const { clock, fuelEvents, lantern } = makeSetup(10);

    // Advance 5 of the initial 10 turns, freeze, then thaw and complete.
    for (let i = 0; i < 5; i++) clock.advance();
    lantern.disable();
    for (let i = 0; i < 100; i++) clock.advance(); // frozen — no events
    lantern.enable();
    for (let i = 0; i < 5; i++) clock.advance(); // completes the initial 10

    // First warning fires only now.
    expect(fuelEvents.length).toBe(1);
    expect(fuelEvents[0]!.remaining).toBe(85);
  });

  it('default initial tick matches GO() in 1dungeon.zil (200 turns)', () => {
    const emitter = new SimpleEventEmitter();
    const fuelEvents: Array<Extract<EngineEvent, { type: 'lantern-fuel' }>> = [];
    emitter.on('lantern-fuel', (e) => fuelEvents.push(e));
    const clock = new Clock();
    new LanternInterrupt(clock, emitter); // no override → 200

    // No warning before 200 turns.
    for (let i = 0; i < 199; i++) clock.advance();
    expect(fuelEvents).toHaveLength(0);

    // First warning fires at exactly 200.
    clock.advance();
    expect(fuelEvents).toHaveLength(1);
    expect(fuelEvents[0]!.message).toContain('a bit dimmer');
    expect(fuelEvents[0]!.remaining).toBe(85);
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
