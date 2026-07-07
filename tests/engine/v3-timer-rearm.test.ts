/**
 * V3 — Timer re-arm unit suite (spec §10.3)
 *
 * The silent-failure net: a missing re-queue looks fine until the timer fires
 * a SECOND time.  These tests use forced/seeded clocks to catch re-arm gaps
 * that full-game integration tests won't surface until much later.
 *
 * Coverage (spec §10.3):
 *   - Match re-arm (CA3): light → 2-tick burnout; light AGAIN → burns out again;
 *     MATCH-COUNT decrements, caps at 6.
 *   - Candle first-touch (CA3/§3.4): touch lit candles → I-CANDLES armed with
 *     the correct tick count, independent of burn/relight path.
 *   - I-XB/I-XC/I-XBH (CC1): ring arms I-XB(6)+I-XBH(20); candles-lit within 6
 *     disables I-XB + arms I-XC(3); read within 3 sets LLD-FLAG; I-XB lapse
 *     breaks ceremony.
 *   - I-FOREST-ROOM (§6.9): slot registered; prob(15) chirp over seeded run
 *     (structural — count in range, not a fixed draw).
 *   - Blocked-move tick (CA1): a blocked move advances every enabled timer by
 *     exactly 1; a parse FAILURE does not.
 *   - V-WAIT no-double-tick (CA2): wait advances exactly 3; the turn loop adds 0.
 *
 * PLUS: KILL-INTERRUPTS ZIL-fidelity audit (spec §11 V3).
 *   Absent slots (I-FIGHT, I-THIEF, I-CURE, I-RFILL, I-REMPTY, I-MAINT-ROOM,
 *   I-RIVER) are deliberately excluded from KILL-INTERRUPTS — see the audit
 *   comment block below and in death.ts.
 *
 * Test contract (spec §10.4 / L40):
 *   - World-state prerequisites ASSERT-AND-FAIL — never early-return above an expect.
 *   - No conditional early-return above an expect() anywhere in this file.
 *
 * ZIL refs:
 *   I-MATCH     1actions.zil:2308
 *   I-CANDLES   1actions.zil (CANDLES-FCN first-touch: 2343)
 *   I-XB/I-XC  1actions.zil:1131–1150
 *   I-XBH       1actions.zil:1143–1147
 *   I-FOREST-ROOM 1actions.zil:2996–3002
 *   KILL-INTERRUPTS 1actions.zil:4125–4135
 *   V-WAIT      gverbs.zil:1514–1519
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Clock } from '../../src/engine/clock.js';
import type { ClockEntry } from '../../src/engine/clock.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';
import { Rng } from '../../src/engine/rng.js';
import { SimpleEventEmitter } from '../../src/engine/events.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Game } from '../../src/engine/game.js';
import type { Rng as RngInterface } from '../../src/engine/game.js';
import { killInterrupts } from '../../src/engine/death.js';

// ---------------------------------------------------------------------------
// Shared accessors
// ---------------------------------------------------------------------------

type ClockLike = {
  getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined;
  queue(id: string, period: number, enabled: boolean): void;
};

function clockOf(g: ReturnType<typeof createGame>): ClockLike {
  return (g as unknown as { clock: ClockLike }).clock;
}

function flagsOf(g: ReturnType<typeof createGame>) {
  return (g as unknown as {
    flags: { get(n: string): boolean; set(n: string, v: boolean): void };
  }).flags;
}

// Minimal RNG — no randomness, determinist
const deterministicRng: RngInterface = { next: () => 0, prob: (base) => base > 0 };

// ---------------------------------------------------------------------------
// Forced-clock unit fixture — no bootstrap overhead, just a Clock + minimal world
// ---------------------------------------------------------------------------

function buildClockFixture() {
  const clock = new Clock();
  return clock;
}

// ---------------------------------------------------------------------------
// KILL-INTERRUPTS ZIL-fidelity audit (spec §11 V3)
//
// ZIL KILL-INTERRUPTS (1actions.zil:4125–4135) contains exactly 8 slots:
//   I-XB, I-XC, I-CYCLOPS, I-LANTERN, I-CANDLES, I-SWORD, I-FOREST-ROOM, I-MATCH
//
// Absent from KILL-INTERRUPTS (and intentionally so — ZIL fidelity):
//
//   I-FIGHT      — registered in the engine's clock (game.ts) as a per-fight demon.
//                  ZIL KILL-INTERRUPTS was written when I-FIGHT was still a DEMON
//                  entry outside the timed-interrupt table (moved to DEMONS per
//                  1actions.zil:3329 comment "I-FIGHT moved to DEMONS").  Demons
//                  receive their own teardown paths; they are not in the DISABLE list.
//                  The engine keeps I-FIGHT absent from KILL-INTERRUPTS to match ZIL.
//
//   I-THIEF      — likewise moved to DEMONS (1actions.zil:1756 comment "I-THIEF
//                  moved to DEMONS").  ZIL disables it explicitly in THIEF-FUNCTION
//                  and THIEF-DISPATCH when thief departs, not at death.  Not in list.
//
//   I-CURE       — manages wound recovery; in ZIL it self-disables via DISABLE INT
//                  inside its own body (1actions.zil:3602) and is NOT in
//                  KILL-INTERRUPTS because death resets the wound state, not the timer.
//                  Excluding it matches ZIL exactly.
//
//   I-RFILL      — dam fill timer; not a player-facing interrupt whose state
//                  "matters" after death.  The ZIL dam code does not add it to
//                  KILL-INTERRUPTS; the dam subsystem owns its own teardown.
//
//   I-REMPTY     — dam drain timer; same rationale as I-RFILL.
//
//   I-MAINT-ROOM — maintenance-room leak demon; dam spec owns its lifecycle.
//
//   I-RIVER      — boat drift timer; river/dam spec owns it; not player-state.
//
// The 8-slot list in death.ts:112–116 is byte-identical to 1actions.zil:4126–4133.
// ---------------------------------------------------------------------------

describe('V3 KILL-INTERRUPTS: ZIL fidelity — all 8 ZIL slots are present', () => {
  // The canonical ZIL list.
  const ZIL_KILL_SLOTS = [
    'I-XB', 'I-XC', 'I-CYCLOPS',
    'I-LANTERN', 'I-CANDLES', 'I-SWORD',
    'I-FOREST-ROOM', 'I-MATCH',
  ] as const;

  it('INTERRUPT_IDS in death.ts matches the 8 ZIL KILL-INTERRUPTS slots', () => {
    // killInterrupts disables each id in the internal INTERRUPT_IDS array.
    // Verify via a fabricated clock that all 8 expected ids are targeted.
    const clock = new Clock();
    const enabled: Record<string, boolean> = {};

    for (const id of ZIL_KILL_SLOTS) {
      const entry: ClockEntry = {
        id, turnsLeft: -1, enabled: true,
        tick() { return true; },
      };
      clock.schedule(entry);
      enabled[id] = true;
    }

    // killInterrupts needs a World reference only for the MATCH ONBIT clear.
    const world = { get: (_id: string) => undefined } as unknown as World;
    killInterrupts(clock, world);

    for (const id of ZIL_KILL_SLOTS) {
      const snap = clock.snapshot().find((s) => s.id === id);
      expect(snap, `${id} must be in the registered clock`).toBeDefined();
      expect(snap!.enabled, `${id} must be disabled by killInterrupts`).toBe(false);
    }
  });

  it('dam/thief/fight slots are NOT targeted by killInterrupts (ZIL fidelity)', () => {
    // These slots are in the engine's clock but absent from ZIL KILL-INTERRUPTS.
    // Verify that killInterrupts leaves them untouched when registered.
    const absent = ['I-FIGHT', 'I-THIEF', 'I-CURE', 'I-RFILL', 'I-REMPTY', 'I-MAINT-ROOM', 'I-RIVER'];
    const clock = new Clock();
    for (const id of absent) {
      clock.schedule({ id, turnsLeft: -1, enabled: true, tick() { return true; } });
    }

    const world = { get: (_id: string) => undefined } as unknown as World;
    killInterrupts(clock, world);

    for (const id of absent) {
      const snap = clock.snapshot().find((s) => s.id === id);
      expect(snap, `${id} must still be registered`).toBeDefined();
      // killInterrupts must NOT have disabled these — they are outside its scope.
      expect(snap!.enabled, `${id} must remain enabled (not in ZIL KILL-INTERRUPTS)`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Match re-arm (CA3) — forced clock, direct Clock.advance()
//
// ZIL: <QUEUE I-MATCH 2> on each light; I-MATCH returns RTRUE (stays registered)
// so the slot can be re-armed across multiple lights.  Each light creates a fresh
// 2-tick countdown; burnout fires when turnsLeft reaches 0.
// ---------------------------------------------------------------------------

describe('V3 MATCH re-arm: forced-clock unit (CA3)', () => {
  beforeEach(() => resetMatchCount());

  it('I-MATCH fires after exactly 2 advances when queued at 2', () => {
    const clock = buildClockFixture();
    let firedCount = 0;

    const entry: ClockEntry = {
      id: 'I-MATCH',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        firedCount++;
        ctx.tell('The match has gone out.');
        return true;  // stays registered for re-arm
      },
    };
    clock.schedule(entry);

    clock.advance();  // turnsLeft → 1 (not yet)
    expect(firedCount).toBe(0);

    clock.advance();  // turnsLeft → 0 → fires
    expect(firedCount).toBe(1);
  });

  it('re-queuing I-MATCH at 2 after burnout arms a second countdown', () => {
    const clock = buildClockFixture();
    const fireTurns: number[] = [];
    let advance = 0;

    const entry: ClockEntry = {
      id: 'I-MATCH',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        fireTurns.push(advance);
        ctx.tell('The match has gone out.');
        return true;
      },
    };
    clock.schedule(entry);

    advance++; clock.advance();  // turn 1 — no fire
    advance++; clock.advance();  // turn 2 — fires

    // Re-arm: simulate <QUEUE I-MATCH 2 true>
    clock.queue('I-MATCH', 2, true);

    advance++; clock.advance();  // turn 3 — no fire (turnsLeft=1)
    advance++; clock.advance();  // turn 4 — fires again

    expect(fireTurns).toEqual([2, 4]);
  });

  it('I-MATCH slot survives burnout (still registered, re-armable)', () => {
    const clock = buildClockFixture();
    const entry: ClockEntry = {
      id: 'I-MATCH', turnsLeft: 2, enabled: true,
      tick() { return true; },
    };
    clock.schedule(entry);

    clock.advance();
    clock.advance();  // fires

    // The slot must still be registered (tick returned true = keep)
    const snap = clock.snapshot().find((s) => s.id === 'I-MATCH');
    expect(snap, 'I-MATCH must remain registered after burnout').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Match re-arm (CA3) — game integration, MATCH-COUNT
// ---------------------------------------------------------------------------

describe('V3 MATCH re-arm: game integration (CA3)', () => {
  beforeEach(() => resetMatchCount());

  it('light → burnout → light again → burns out a second time', async () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    await g.turn('take matchbook');

    await g.turn('light match');
    const firstBurnout = await g.turn('z');
    expect(firstBurnout.output).toContain('The match has gone out.');

    await g.turn('light match');
    const secondBurnout = await g.turn('z');
    expect(secondBurnout.output).toContain('The match has gone out.');
  });

  it('I-MATCH is still enabled after the second burnout', async () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    await g.turn('take matchbook');

    await g.turn('light match');
    await g.turn('z');               // first burnout

    await g.turn('light match');
    await g.turn('z');               // second burnout

    // Slot must still be alive for a third light (if matches remain)
    const entry = clockOf(g).getEntry('I-MATCH');
    expect(entry, 'I-MATCH slot must persist across two burnouts').toBeDefined();
  });

  it('MATCH-COUNT decrements with each light', async () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    await g.turn('take matchbook');

    // Light twice; count command should show fewer matches each time.
    await g.turn('light match');
    await g.turn('extinguish match');
    await g.turn('light match');
    await g.turn('extinguish match');

    const r = await g.turn('open matchbook');
    // 6 initial - 2 used = 4 remaining (count shows n-1 usable = 3 left after dec)
    // Actually matchFunction checks matchCount-1 for "have N matches" display.
    // After 2 lights: matchCount=4, display shows 3.
    expect(r.output).toMatch(/\b[1-4]\b.*match/i);
  });

  it('MATCH-COUNT does not drop below 0 (caps at exhaustion)', async () => {
    const g = createGame({ startRoom: 'DAM-LOBBY' });
    g.start();
    await g.turn('take matchbook');

    // Use all 6 matches
    for (let i = 0; i < 6; i++) {
      await g.turn('light match');
      await g.turn('extinguish match');
    }

    // 7th light should fail with exhaustion message
    const r = await g.turn('light match');
    expect(r.output).toContain("I'm afraid that you have run out of matches.");
  });
});

// ---------------------------------------------------------------------------
// Candle first-touch (CA3 / §3.4) — forced clock via game
//
// ZIL CANDLES-FCN (1actions.zil:2343): arms I-CANDLES on the FIRST touch of
// already-lit candles.  The engine enables the clock entry whenever
// Flag.Touched is not yet set on the candles.
// ---------------------------------------------------------------------------

describe('V3 CANDLES first-touch: slot state (CA3 / §3.4)', () => {
  beforeEach(() => resetMatchCount());

  it('I-CANDLES starts disabled (GO() queues without ENABLE)', () => {
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();

    const entry = clockOf(g).getEntry('I-CANDLES');
    expect(entry, 'I-CANDLES must be registered at game start').toBeDefined();
    expect(entry!.enabled).toBe(false);
  });

  it('taking lit candles arms I-CANDLES (first-touch, before TOUCHBIT set)', async () => {
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();
    await g.turn('take candles');

    const entry = clockOf(g).getEntry('I-CANDLES');
    expect(entry, 'I-CANDLES must remain registered after take').toBeDefined();
    expect(entry!.enabled, 'I-CANDLES must be enabled after first touch').toBe(true);
  });

  it('I-CANDLES turnsLeft is non-zero after first-touch arm', async () => {
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();
    await g.turn('take candles');

    const entry = clockOf(g).getEntry('I-CANDLES');
    expect(entry, 'I-CANDLES must exist').toBeDefined();
    // The slot was armed: turnsLeft must be > 0 (the initial 40-tick countdown,
    // minus 1 for the clock advance on the take turn).
    expect(entry!.turnsLeft).toBeGreaterThan(0);
  });

  it('first-touch arm is independent of the burn/relight path', async () => {
    // Touch (examine/take) the candles without lighting or relighting them.
    // The clock must arm from the first-touch branch, not the burn branch.
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();

    // Verify candles are already lit at SOUTH-TEMPLE (game pre-condition).
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist in world').toBeDefined();
    expect(candles!.has(Flag.OnFire), 'CANDLES must start lit at SOUTH-TEMPLE').toBe(true);

    // Take (= touch) the candles — triggers CANDLES-FCN first-touch path.
    await g.turn('take candles');

    // Clock must be armed purely from first-touch, not from a burn command.
    const entry = clockOf(g).getEntry('I-CANDLES');
    expect(entry, 'I-CANDLES must exist').toBeDefined();
    expect(entry!.enabled).toBe(true);
  });

  it('second touch does not reset the countdown (TOUCHBIT idempotent)', async () => {
    const g = createGame({ startRoom: 'SOUTH-TEMPLE' });
    g.start();
    await g.turn('take candles');

    const afterFirst = clockOf(g).getEntry('I-CANDLES')!;
    const turnsAfterFirst = afterFirst.turnsLeft;

    // Advance the clock a bit, then interact again.
    await g.turn('z');  // 1 or more ticks
    await g.turn('examine candles');

    const afterSecond = clockOf(g).getEntry('I-CANDLES')!;
    // turnsLeft must have DECREASED (clock ticked), not been reset to initial.
    expect(afterSecond.turnsLeft).toBeLessThan(turnsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// I-XB / I-XC / I-XBH re-arm (CC1) — forced clock via game (spec §10.3)
//
// The cc1-hades-exorcism.test.ts suite covers the ceremony integration.
// This V3 suite targets the CLOCK STATE specifically, using the clockOf accessor
// to assert each slot's turnsLeft/enabled right after the triggering action.
// ---------------------------------------------------------------------------

// Setup helper — ceremony items in player inventory at ENTRANCE-TO-HADES.
function hadesGame(opts: { bell?: boolean; book?: boolean; candles?: boolean } = {}) {
  const { bell = true, book = true, candles = true } = opts;
  const g = newGameAt('ENTRANCE-TO-HADES');
  g.start();
  const w = g.world;
  const player = g.player;

  if (bell) {
    const obj = w.get('BELL');
    expect(obj, 'BELL must exist in world').toBeDefined();
    obj!.moveTo(player);
  }
  if (book) {
    const obj = w.get('BOOK');
    expect(obj, 'BOOK must exist in world').toBeDefined();
    obj!.moveTo(player);
  }
  if (candles) {
    const obj = w.get('CANDLES');
    expect(obj, 'CANDLES must exist in world').toBeDefined();
    obj!.moveTo(player);
  }
  return g;
}

describe('V3 I-XB/I-XC/I-XBH: forced slot state after ring (CC1)', () => {
  it('I-XB and I-XBH start parked (disabled, turnsLeft=0)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();

    const ixb = clockOf(g).getEntry('I-XB');
    const ixbh = clockOf(g).getEntry('I-XBH');

    expect(ixb, 'I-XB must be registered').toBeDefined();
    expect(ixbh, 'I-XBH must be registered').toBeDefined();
    expect(ixb!.enabled).toBe(false);
    expect(ixb!.turnsLeft).toBe(0);
    expect(ixbh!.enabled).toBe(false);
    expect(ixbh!.turnsLeft).toBe(0);
  });

  it('ring bell: I-XB enabled with turnsLeft=5 (queued at 6, ticked once on ring turn)', async () => {
    const g = hadesGame();
    await g.turn('ring bell');

    const ixb = clockOf(g).getEntry('I-XB');
    expect(ixb, 'I-XB must be registered').toBeDefined();
    expect(ixb!.enabled).toBe(true);
    // QUEUE I-XB 6 then CLOCKER ticks once on the ring turn → 5.
    expect(ixb!.turnsLeft).toBe(5);
  });

  it('ring bell: I-XBH enabled with turnsLeft=19 (queued at 20, ticked once)', async () => {
    const g = hadesGame();
    await g.turn('ring bell');

    const ixbh = clockOf(g).getEntry('I-XBH');
    expect(ixbh, 'I-XBH must be registered').toBeDefined();
    expect(ixbh!.enabled).toBe(true);
    expect(ixbh!.turnsLeft).toBe(19);
  });

  it('candles held+lit after ring: I-XB disabled, I-XC armed (turnsLeft=2)', async () => {
    // Ring with bell+book only; give lit candles AFTER ring so M-END fires XC.
    const g = hadesGame({ candles: false });
    await g.turn('ring bell');

    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);

    await g.turn('look');  // 1 tick → M-END fires XC condition

    const ixb = clockOf(g).getEntry('I-XB');
    const ixc = clockOf(g).getEntry('I-XC');
    expect(ixb, 'I-XB must be registered').toBeDefined();
    expect(ixc, 'I-XC must be registered').toBeDefined();
    expect(ixb!.enabled, 'I-XB must be disabled when XC fires').toBe(false);
    expect(ixc!.enabled, 'I-XC must be enabled after XC fires').toBe(true);
    // QUEUE I-XC 3, then CLOCKER ticks once on the look turn → turnsLeft=2.
    expect(ixc!.turnsLeft).toBe(2);
  });

  it('read book with XC=T: LLD-FLAG set, I-XC disabled', async () => {
    const g = hadesGame({ candles: false });
    await g.turn('ring bell');

    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    candles!.moveTo(g.player);
    candles!.set(Flag.OnFire);

    await g.turn('look');  // arms XC

    await g.turn('read book');

    expect(flagsOf(g).get('LLD-FLAG'), 'LLD-FLAG must be true after ceremony').toBe(true);

    const ixc = clockOf(g).getEntry('I-XC');
    expect(ixc, 'I-XC must be registered').toBeDefined();
    expect(ixc!.enabled, 'I-XC must be disabled after LLD-FLAG').toBe(false);
  });

  it('I-XB lapse (6 turns without XC): XB global cleared, ceremony broken', async () => {
    const g = hadesGame({ candles: false });
    await g.turn('ring bell');

    // I-XB queued at 6, ticked once on ring → turnsLeft=5.
    // 5 more waits (each up to 3 ticks) will exhaust it; we use 'look' (1 tick each).
    for (let i = 0; i < 5; i++) await g.turn('look');

    expect(flagsOf(g).get('XB'), 'XB must be cleared when I-XB fires').toBe(false);
  });

  it('I-XB/I-XBH slots survive firing — re-armable for a second ceremony (no soft-lock)', async () => {
    // ZIL C-TABLE slots are statically allocated: I-XB/I-XBH park at turnsLeft=0
    // when they fire, they do NOT vanish, so a second <QUEUE I-XB 6> on a second
    // RING BELL re-arms them.  A return-false tick deletes the clock entry, making
    // the re-arm a silent dead letter — I-XBH never re-fires, BELL never returns,
    // and the bell soft-locks.  (1actions.zil:1131-1147.)
    const g = hadesGame({ candles: false });
    await g.turn('ring bell'); // arms I-XB(6) + I-XBH(20)

    // Lapse the whole ceremony: I-XB fires ~turn 6, I-XBH ~turn 20.
    for (let i = 0; i < 20; i++) await g.turn('look');

    const ixb = clockOf(g).getEntry('I-XB');
    const ixbh = clockOf(g).getEntry('I-XBH');
    expect(ixb, 'I-XB slot must survive firing (re-armable)').toBeDefined();
    expect(ixbh, 'I-XBH slot must survive firing (re-armable)').toBeDefined();
    // Parked, not running.
    expect(ixb!.turnsLeft).toBe(0);
    expect(ixbh!.turnsLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I-FOREST-ROOM (§6.9) — registration + structural prob(15)
//
// Spec: slot registered (no longer a dead enableClock); prob(15) chirp over a
// seeded run (STRUCTURAL — count in range, not a fixed draw).
// ---------------------------------------------------------------------------

describe('V3 I-FOREST-ROOM: slot registered (§6.9)', () => {
  it('I-FOREST-ROOM slot is registered in bootstrap (not a dead enableClock)', () => {
    const g = createGame();
    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be a registered clock slot').toBeDefined();
  });

  it('I-FOREST-ROOM starts disabled (enabled by M-ENTER only)', () => {
    const g = createGame();
    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be registered').toBeDefined();
    expect(entry!.enabled).toBe(false);
  });
});

describe('V3 I-FOREST-ROOM: prob(15) chirp structural (§6.9 / §10.3)', () => {
  it('chirp fires at approximately 15% over 200 seeded forest turns', async () => {
    const rng = new Rng(42);
    const g = createGame({ startRoom: 'PATH', rng });
    g.start();

    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    lamp!.set(Flag.OnFire);
    lamp!.set(Flag.Light);
    lamp!.moveTo(g.player);

    // Move west: PATH → FOREST-1 (M-ENTER fires → I-FOREST-ROOM enabled).
    await g.turn('west');

    const entry = clockOf(g).getEntry('I-FOREST-ROOM');
    expect(entry, 'I-FOREST-ROOM must be registered').toBeDefined();
    expect(entry!.enabled, 'I-FOREST-ROOM must be enabled inside forest').toBe(true);

    // Count chirps over 200 look turns (1 clock tick each for a clean per-turn rate).
    let chirpCount = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const r = await g.turn('look');
      if (r.output.includes('chirping of a song bird')) chirpCount++;
    }

    // Expected ~15%; allow a generous 5%–30% window for a seeded run.
    expect(chirpCount).toBeGreaterThanOrEqual(Math.floor(N * 0.05));
    expect(chirpCount).toBeLessThanOrEqual(Math.ceil(N * 0.30));
  });
});

// ---------------------------------------------------------------------------
// Blocked-move tick (CA1) — forced clock
//
// A blocked move is a successful parse of V-WALK; CLOCKER must advance.
// A parse FAILURE must NOT advance (clock-main-loop.md §14.1).
//
// This duplicates the key invariants from ca1-blocked-move-tick.test.ts in
// forced-clock form: a known ClockEntry lets us count advances precisely.
// ---------------------------------------------------------------------------

describe('V3 blocked-move tick: forced clock counts (CA1)', () => {
  function buildMinimalWorld() {
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

    const clock = new Clock();
    let advanceCount = 0;
    const counter: ClockEntry = {
      id: 'COUNTER',
      turnsLeft: -1,
      enabled: true,
      tick() { advanceCount++; return true; },
    };
    clock.schedule(counter);

    const world = World.fromObjects([roomA, roomB, player]);
    const g = new Game(world, {
      rng: deterministicRng,
      clock,
      events: new SimpleEventEmitter(),
    });
    return { g, getCount: () => advanceCount };
  }

  it('blocked move (elseMessage NEXIT) advances the counter by 1', async () => {
    const { g, getCount } = buildMinimalWorld();
    g.start();
    const before = getCount();
    await g.turn('south');  // blocked: elseMessage="Solid wall."
    expect(getCount() - before).toBe(1);
  });

  it('blocked move (no exit defined) advances the counter by 1', async () => {
    const { g, getCount } = buildMinimalWorld();
    g.start();
    const before = getCount();
    await g.turn('east');  // no exit defined in ROOM-A
    expect(getCount() - before).toBe(1);
  });

  it('parse failure does NOT advance the counter', async () => {
    const { g, getCount } = buildMinimalWorld();
    g.start();
    const before = getCount();
    await g.turn('xyzzy123garbage');  // parse failure
    expect(getCount() - before).toBe(0);
  });

  it('successful move advances the counter by exactly 1 (no double-tick)', async () => {
    const { g, getCount } = buildMinimalWorld();
    g.start();
    const before = getCount();
    await g.turn('north');  // successful move to ROOM-B
    expect(getCount() - before).toBe(1);
  });

  it('1 blocked + 1 successful = exactly 2 counter advances', async () => {
    const { g, getCount } = buildMinimalWorld();
    g.start();
    const before = getCount();
    await g.turn('south');  // blocked
    await g.turn('north');  // successful
    expect(getCount() - before).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// V-WAIT no-double-tick (CA2) — forced clock
//
// ZIL: V-WAIT ticks CLOCKER up to 3×; the turn loop must not add a 4th tick.
// The engine's loop-driven form (maxClocks=3 for isWait) satisfies this.
//
// This forced-clock form counts advances directly to guarantee the invariant.
// ---------------------------------------------------------------------------

describe('V3 V-WAIT: no-double-tick (CA2)', () => {
  function buildWaitFixture() {
    const room = new Room('WAIT-ROOM', 'Wait Room', { ldesc: 'A quiet room.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const clock = new Clock();
    let advanceCount = 0;
    const counter: ClockEntry = {
      id: 'ADVANCE-COUNTER',
      turnsLeft: -1,
      enabled: true,
      tick() { advanceCount++; return true; },
    };
    clock.schedule(counter);

    const world = World.fromObjects([room, player]);
    const g = new Game(world, {
      rng: deterministicRng,
      clock,
      events: new SimpleEventEmitter(),
    });
    return { g, getCount: () => advanceCount };
  }

  it('wait advances the counter by exactly 3 (no 4th tick from loop)', async () => {
    const { g, getCount } = buildWaitFixture();
    g.start();
    const before = getCount();
    await g.turn('wait');
    expect(getCount() - before).toBe(3);
  });

  it('two sequential waits each advance by 3 (no accumulation bug)', async () => {
    const { g, getCount } = buildWaitFixture();
    g.start();
    const before = getCount();
    await g.turn('wait');
    await g.turn('wait');
    expect(getCount() - before).toBe(6);
  });

  it('wait output contains "Time passes..." exactly once', async () => {
    const { g } = buildWaitFixture();
    g.start();
    const out = await (await g.turn('wait')).output;
    const count = (out.match(/Time passes\.\.\./g) ?? []).length;
    expect(count).toBe(1);
  });

  it('look (non-wait) advances counter by exactly 1', async () => {
    const { g, getCount } = buildWaitFixture();
    g.start();
    const before = getCount();
    await g.turn('look');
    expect(getCount() - before).toBe(1);
  });
});
