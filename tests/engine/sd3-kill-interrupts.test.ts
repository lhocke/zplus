/**
 * SD3 — KILL-INTERRUPTS
 *
 * 1actions.zil:4125–4135: on death, disable 8 interrupt slots + clear MATCH ONBIT.
 *
 * Spec §9.4 + §12 SD3 done-criteria (D5, updated — I-SWORD now registered):
 *   - The 4 registered slots (I-LANTERN, I-CANDLES, I-MATCH, I-SWORD) are disabled.
 *   - The 4 unregistered slots (I-XB, I-XC, I-CYCLOPS, I-FOREST-ROOM)
 *     are no-ops — killAll does not throw on unknown ids.
 *   - MATCH ONBIT (Flag.OnFire) is cleared.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Clock, LanternInterrupt, CandleInterrupt } from '../../src/engine/clock.js';
import type { ClockEntry } from '../../src/engine/clock.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { Flag } from '../../src/domain/flags.js';
import { killInterrupts } from '../../src/engine/death.js';
import { Rng } from '../../src/engine/rng.js';

// ---------------------------------------------------------------------------
// Unit — killInterrupts on a standalone Clock + bootstrapped World
// ---------------------------------------------------------------------------

describe('SD3-A: registered slots disabled after killInterrupts', () => {
  it('I-LANTERN, I-CANDLES, I-MATCH, and I-SWORD are disabled', () => {
    const emitter = new SimpleEventEmitter();
    const clock = new Clock();

    // Register the four slots that bootstrap.ts now registers.
    new LanternInterrupt(clock, emitter);       // schedules I-LANTERN enabled=true
    new CandleInterrupt(clock, emitter, 40);    // schedules I-CANDLES enabled=true
    const iMatchEntry: ClockEntry = {
      id: 'I-MATCH', turnsLeft: 2, enabled: true,
      tick() { return false; },
    };
    clock.schedule(iMatchEntry);
    const iSwordEntry: ClockEntry = {
      id: 'I-SWORD', turnsLeft: -1, enabled: true,
      tick() { return true; },
    };
    clock.schedule(iSwordEntry);

    const game = createGame();

    killInterrupts(clock, game.world);

    const snap = clock.snapshot();
    expect(snap.find((s) => s.id === 'I-LANTERN')!.enabled).toBe(false);
    expect(snap.find((s) => s.id === 'I-CANDLES')!.enabled).toBe(false);
    expect(snap.find((s) => s.id === 'I-MATCH')!.enabled).toBe(false);
    expect(snap.find((s) => s.id === 'I-SWORD')!.enabled).toBe(false);
  });
});

describe('SD3-B: unregistered slots are safe no-ops', () => {
  it('killInterrupts does not throw for I-XB, I-XC, I-CYCLOPS, I-FOREST-ROOM', () => {
    const clock = new Clock();
    const game = createGame();
    // I-SWORD is now registered; I-XB/I-XC/I-CYCLOPS/I-FOREST-ROOM remain unregistered.
    expect(() => killInterrupts(clock, game.world)).not.toThrow();
  });
});

describe('SD3-C: MATCH ONBIT cleared', () => {
  it('clears Flag.OnFire on the MATCH object', () => {
    const clock = new Clock();
    const game = createGame();
    const match = game.world.get('MATCH')!;

    // Arm it: set OnFire as if a match was lit.
    match.set(Flag.OnFire);
    expect(match.has(Flag.OnFire)).toBe(true);

    killInterrupts(clock, game.world);

    expect(match.has(Flag.OnFire)).toBe(false);
  });

  it('does not throw if MATCH is not in the world', () => {
    const clock = new Clock();
    const fakeWorld = { get: (_id: string) => undefined } as unknown as import('../../src/domain/world.js').World;
    expect(() => killInterrupts(clock, fakeWorld)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration — jigsUp wires killInterrupts: lit lantern is off after death
// ---------------------------------------------------------------------------

describe('SD3-D: jigsUp calls killInterrupts (integration via game.turn)', () => {
  // Grue-triggering RNG: next()=0.5 → 50 < 80 → grue fires.
  const grueRng = (): Rng =>
    ({ next: () => 0.5, prob: (base: number) => 0.5 * 100 < base } as unknown as Rng);

  it('I-LANTERN is disabled in the clock after a grue death', () => {
    const game = createGame({ startRoom: 'MAZE-1', rng: grueRng() });
    game.start();

    // Force I-LANTERN enabled without lighting the room — directly enable in the clock.
    // (Lighting the lamp would make MAZE-1 lit, preventing grue death.)
    const clock = (game as unknown as { clock: Clock }).clock;
    clock.enable('I-LANTERN');

    const snapBefore = clock.snapshot();
    expect(snapBefore.find((s) => s.id === 'I-LANTERN')?.enabled).toBe(true);

    // Die in the dark maze — grue fires.
    game.turn('north');

    const snapAfter = clock.snapshot();
    expect(snapAfter.find((s) => s.id === 'I-LANTERN')?.enabled).toBe(false);
  });

  it('MATCH ONBIT is cleared after death even if the match was lit', () => {
    const game = createGame({ startRoom: 'MAZE-1', rng: grueRng() });
    game.start();

    const match = game.world.get('MATCH')!;
    match.set(Flag.OnFire);

    game.turn('north'); // grue death → jigsUp → killInterrupts

    expect(match.has(Flag.OnFire)).toBe(false);
  });
});
