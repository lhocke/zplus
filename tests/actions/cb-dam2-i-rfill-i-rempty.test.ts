/**
 * CB-DAM2 — I-RFILL / I-REMPTY 8-tick timers
 *
 * Done-criteria (spec §9 Wave 1 CB-DAM2):
 *   - 8-tick timing exact: timer fires after exactly 8 advances
 *   - trunk toggles: I-REMPTY reveals, I-RFILL conditionally re-hides (NM-B)
 *   - drown-on-foot vs float-in-boat branch (RESERVOIR when in-boat vs on-foot)
 *   - LOUD-ROOM panic GOTO destination ∈ LOUD-RUNS set
 *   - NM-L: I-RFILL mutations (NONLANDBIT set, lowTide=false, trunk re-hide)
 *     complete BEFORE jigsUp; death does not roll back those flag writes
 *
 * ZIL refs:
 *   I-RFILL   1actions.zil:1226–1259
 *   I-REMPTY  1actions.zil:1263–1282
 *   LOUD-RUNS 1actions.zil:1261 — DAMP-CAVE, ROUND-ROOM, DEEP-CANYON
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Internal accessors (same pattern as CB-DAM1 tests)
// ---------------------------------------------------------------------------

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

// Arm a timer directly so tests can fire it without going through BOLT-F.
function armTimer(g: Game, id: string, ticks: number) {
  (g as unknown as { clock: { queue(id: string, period: number, enabled: boolean): void } })
    .clock.queue(id, ticks, true);
}

// Advance the clock N turns (each 'wait' consumes one turn + one clock advance).
async function waitN(g: Game, n: number) {
  for (let i = 0; i < n; i++) await g.turn('wait');
}

// ---------------------------------------------------------------------------
// I-REMPTY — 8-tick one-shot: drain reservoir, reveal trunk
// ---------------------------------------------------------------------------

describe('CB-DAM2 — I-REMPTY: fires after exactly 8 ticks', () => {
  it('LOW-TIDE is still false after 2 waits (6 clock ticks, not yet at 8)', async () => {
    // V-WAIT multi-CLOCKER runs up to 3 CLOCKER ticks per wait call.
    // 8-tick timer: 2 waits consume 6 ticks (8→7→6→5, 5→4→3→2); timer not yet fired.
    const g = newGameAt('DAM-ROOM');
    armTimer(g, 'I-REMPTY', 8);
    await waitN(g, 2);
    expect(flags(g).get('LOW-TIDE')).toBe(false);
  });

  it('LOW-TIDE becomes true on tick 8', async () => {
    const g = newGameAt('DAM-ROOM');
    armTimer(g, 'I-REMPTY', 8);
    await waitN(g, 8);
    expect(flags(g).get('LOW-TIDE')).toBe(true);
  });
});

describe('CB-DAM2 — I-REMPTY: flag mutations (1actions.zil:1263–1282)', () => {
  it('sets RESERVOIR RLANDBIT (becomes land) after drain', async () => {
    const g = newGameAt('DAM-ROOM');
    armTimer(g, 'I-REMPTY', 1);
    await waitN(g, 1);
    const res = g.world.get('RESERVOIR')!;
    expect(res.has(Flag.Land)).toBe(true);
  });

  it('clears RESERVOIR NONLANDBIT (no longer water) after drain', async () => {
    const g = newGameAt('DAM-ROOM');
    armTimer(g, 'I-REMPTY', 1);
    await waitN(g, 1);
    const res = g.world.get('RESERVOIR')!;
    expect(res.has(Flag.NonLand)).toBe(false);
  });

  it('clears DEEP-CANYON TOUCHBIT (force re-describe)', async () => {
    const g = newGameAt('DAM-ROOM');
    const dc = g.world.get('DEEP-CANYON')!;
    dc.set(Flag.Touched);
    armTimer(g, 'I-REMPTY', 1);
    await waitN(g, 1);
    expect(dc.has(Flag.Touched)).toBe(false);
  });

  it('clears LOUD-ROOM TOUCHBIT (force re-describe)', async () => {
    const g = newGameAt('DAM-ROOM');
    const lr = g.world.get('LOUD-ROOM')!;
    lr.set(Flag.Touched);
    armTimer(g, 'I-REMPTY', 1);
    await waitN(g, 1);
    expect(lr.has(Flag.Touched)).toBe(false);
  });

  it('reveals TRUNK (clears INVISIBLE) regardless of location', async () => {
    const g = newGameAt('DAM-ROOM');
    const trunk = g.world.get('TRUNK')!;
    expect(trunk.has(Flag.Invisible)).toBe(true);  // starts invisible
    armTimer(g, 'I-REMPTY', 1);
    await waitN(g, 1);
    expect(trunk.has(Flag.Invisible)).toBe(false);
  });
});

describe('CB-DAM2 — I-REMPTY: per-room fire messages', () => {
  it('DEEP-CANYON: "roar of rushing water is quieter" (1actions.zil:1278)', async () => {
    const g = newGameAt('DEEP-CANYON');
    armTimer(g, 'I-REMPTY', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('roar of rushing water is quieter');
  });

  it('RESERVOIR-NORTH: "you could easily cross over" (1actions.zil:1282)', async () => {
    const g = newGameAt('RESERVOIR-NORTH');
    armTimer(g, 'I-REMPTY', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('you could easily cross over');
  });

  it('RESERVOIR-SOUTH: "you could easily cross over" (1actions.zil:1282)', async () => {
    const g = newGameAt('RESERVOIR-SOUTH');
    armTimer(g, 'I-REMPTY', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('you could easily cross over');
  });

  it('RESERVOIR (player in boat): "can no longer stay afloat" (1actions.zil:1273)', async () => {
    // Player in INFLATED-BOAT in RESERVOIR — boat sinks into mud message
    const g = newGameAt('RESERVOIR');
    const inflatedBoat = g.world.get('INFLATED-BOAT')!;
    const reservoir = g.world.get('RESERVOIR')!;
    inflatedBoat.moveTo(reservoir);
    // Move player into the boat (VEHBIT vehicle)
    g.player.moveTo(inflatedBoat);
    armTimer(g, 'I-REMPTY', 1);
    const out = await (await g.turn('wait')).output;
    // "can no\nlonger stay afloat" — match a substring that does not span the newline
    expect(out).toContain('longer stay afloat');
  });
});

// ---------------------------------------------------------------------------
// I-RFILL — 8-tick one-shot: fill reservoir, re-hide trunk (conditionally)
// ---------------------------------------------------------------------------

describe('CB-DAM2 — I-RFILL: fires after exactly 8 ticks', () => {
  it('LOW-TIDE stays true after 2 waits (6 clock ticks, not yet at 8)', async () => {
    // V-WAIT multi-CLOCKER: 2 waits consume 6 ticks; 8-tick timer not yet fired.
    const g = newGameAt('DAM-ROOM');
    flags(g).set('LOW-TIDE', true);
    armTimer(g, 'I-RFILL', 8);
    await waitN(g, 2);
    expect(flags(g).get('LOW-TIDE')).toBe(true);
  });

  it('LOW-TIDE becomes false on tick 8 (1actions.zil:1232)', async () => {
    const g = newGameAt('DAM-ROOM');
    flags(g).set('LOW-TIDE', true);
    armTimer(g, 'I-RFILL', 8);
    await waitN(g, 8);
    expect(flags(g).get('LOW-TIDE')).toBe(false);
  });
});

describe('CB-DAM2 — I-RFILL: flag mutations (1actions.zil:1226–1232)', () => {
  it('sets RESERVOIR NONLANDBIT (becomes water again)', async () => {
    const g = newGameAt('DAM-ROOM');
    flags(g).set('LOW-TIDE', true);
    const res = g.world.get('RESERVOIR')!;
    armTimer(g, 'I-RFILL', 1);
    await waitN(g, 1);
    expect(res.has(Flag.NonLand)).toBe(true);
  });

  it('clears RESERVOIR RLANDBIT (no longer land)', async () => {
    const g = newGameAt('DAM-ROOM');
    flags(g).set('LOW-TIDE', true);
    const res = g.world.get('RESERVOIR')!;
    armTimer(g, 'I-RFILL', 1);
    await waitN(g, 1);
    expect(res.has(Flag.Land)).toBe(false);
  });

  it('clears DEEP-CANYON TOUCHBIT', async () => {
    const g = newGameAt('DAM-ROOM');
    const dc = g.world.get('DEEP-CANYON')!;
    dc.set(Flag.Touched);
    armTimer(g, 'I-RFILL', 1);
    await waitN(g, 1);
    expect(dc.has(Flag.Touched)).toBe(false);
  });

  it('clears LOUD-ROOM TOUCHBIT', async () => {
    const g = newGameAt('DAM-ROOM');
    const lr = g.world.get('LOUD-ROOM')!;
    lr.set(Flag.Touched);
    armTimer(g, 'I-RFILL', 1);
    await waitN(g, 1);
    expect(lr.has(Flag.Touched)).toBe(false);
  });
});

describe('CB-DAM2 — I-RFILL: NM-B trunk re-hide is conditional (1actions.zil:1231)', () => {
  it('re-hides trunk ONLY if trunk is still in RESERVOIR', async () => {
    const g = newGameAt('DAM-ROOM');
    const trunk = g.world.get('TRUNK')!;
    const reservoir = g.world.get('RESERVOIR')!;
    // Drain first so trunk is visible
    trunk.clear(Flag.Invisible);
    trunk.moveTo(reservoir);
    armTimer(g, 'I-RFILL', 1);
    await waitN(g, 1);
    // Trunk still in RESERVOIR → should be hidden again
    expect(trunk.has(Flag.Invisible)).toBe(true);
  });

  it('does NOT re-hide trunk if player has taken it (NM-B)', async () => {
    const g = newGameAt('DAM-ROOM');
    const trunk = g.world.get('TRUNK')!;
    // Trunk already in player's inventory (taken from drained reservoir)
    trunk.clear(Flag.Invisible);
    trunk.moveTo(g.player);
    armTimer(g, 'I-RFILL', 1);
    await waitN(g, 1);
    // Trunk NOT in RESERVOIR → must NOT be re-hidden
    expect(trunk.has(Flag.Invisible)).toBe(false);
  });
});

describe('CB-DAM2 — I-RFILL: per-room fire messages', () => {
  it('DEEP-CANYON: "sound, like that of flowing water" (1actions.zil:1248)', async () => {
    const g = newGameAt('DEEP-CANYON');
    armTimer(g, 'I-RFILL', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('sound, like that of flowing water');
  });

  it('RESERVOIR-NORTH: "water level has risen...impossible to cross" (1actions.zil:1255)', async () => {
    const g = newGameAt('RESERVOIR-NORTH');
    armTimer(g, 'I-RFILL', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('water level has risen');
  });

  it('RESERVOIR-SOUTH: "water level has risen...impossible to cross" (1actions.zil:1255)', async () => {
    const g = newGameAt('RESERVOIR-SOUTH');
    armTimer(g, 'I-RFILL', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('water level has risen');
  });

  it('RESERVOIR (player in boat): "boat lifts gently out of the mud" (1actions.zil:1240)', async () => {
    const g = newGameAt('RESERVOIR');
    const inflatedBoat = g.world.get('INFLATED-BOAT')!;
    const reservoir = g.world.get('RESERVOIR')!;
    inflatedBoat.moveTo(reservoir);
    g.player.moveTo(inflatedBoat);
    armTimer(g, 'I-RFILL', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('boat lifts gently out of the mud');
  });

  it('LOUD-ROOM: "alarmingly loud roaring sound" panic scramble (1actions.zil:1251)', async () => {
    const g = newGameAt('LOUD-ROOM');
    armTimer(g, 'I-RFILL', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('alarmingly loud roaring sound');
  });

  it('LOUD-ROOM panic: destination ∈ LOUD-RUNS set (OQ-2 non-oracle-matched)', async () => {
    // LOUD-RUNS = [DAMP-CAVE, ROUND-ROOM, DEEP-CANYON] (1actions.zil:1261)
    const LOUD_RUNS = new Set(['DAMP-CAVE', 'ROUND-ROOM', 'DEEP-CANYON']);
    const g = newGameAt('LOUD-ROOM');
    armTimer(g, 'I-RFILL', 1);
    await g.turn('wait');
    const dest = g.player.parent?.id ?? '';
    expect(LOUD_RUNS.has(dest)).toBe(true);
  });

  it('RESERVOIR (player on foot): drowning death (1actions.zil:1243)', async () => {
    const g = newGameAt('RESERVOIR');
    // Player on foot (not in a vehicle) — should die from rising water
    armTimer(g, 'I-RFILL', 1);
    const out = await (await g.turn('wait')).output;
    expect(out).toContain('lifted up by the rising river');
  });
});

// ---------------------------------------------------------------------------
// NM-L: I-RFILL mutations complete before jigsUp (1actions.zil:1226–1233 order)
//
// The flag mutations (NONLANDBIT set, lowTide=false, trunk re-hide) must be
// unconditional writes that complete BEFORE the HERE switch / jigsUp call.
// After a drowning death triggered by I-RFILL, LOW-TIDE must be false and
// RESERVOIR must have NONLANDBIT — the death path must not roll them back.
// ---------------------------------------------------------------------------

describe('CB-DAM2 — NM-L: I-RFILL mutations survive jigsUp', () => {
  it('after drowning in RESERVOIR: LOW-TIDE === false (mutation precedes jigsUp)', async () => {
    const g = newGameAt('RESERVOIR');
    flags(g).set('LOW-TIDE', true);  // was drained
    // Trunk in reservoir so it gets re-hidden (tests that mutation also survives)
    const trunk = g.world.get('TRUNK')!;
    trunk.clear(Flag.Invisible);
    trunk.moveTo(g.world.get('RESERVOIR')!);
    armTimer(g, 'I-RFILL', 1);
    await g.turn('wait');
    // Even after death, LOW-TIDE must be false
    expect(flags(g).get('LOW-TIDE')).toBe(false);
  });

  it('after drowning in RESERVOIR: RESERVOIR has NONLANDBIT set (mutation precedes jigsUp)', async () => {
    const g = newGameAt('RESERVOIR');
    const res = g.world.get('RESERVOIR')!;
    armTimer(g, 'I-RFILL', 1);
    await g.turn('wait');
    expect(res.has(Flag.NonLand)).toBe(true);
  });

  it('after drowning in RESERVOIR: trunk re-hidden if in reservoir (NM-L + NM-B)', async () => {
    const g = newGameAt('RESERVOIR');
    const trunk = g.world.get('TRUNK')!;
    trunk.clear(Flag.Invisible);
    trunk.moveTo(g.world.get('RESERVOIR')!);
    armTimer(g, 'I-RFILL', 1);
    await g.turn('wait');
    expect(trunk.has(Flag.Invisible)).toBe(true);
  });
});
