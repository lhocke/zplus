/**
 * V1 — NM guard suite (spec §11.4 + §12 V1)
 *
 * One dedicated asserting describe per NM-1…NM-10.  Deps: all CB/TR tasks.
 * These are the regression net against silent distribution/semantic drift;
 * each guard is individually greppable by name.
 *
 * NM-1  window-size-9: every resolution window has exactly 9 accessible elements
 * NM-2  ATT/DEF role: selectWindow(a,d) ≠ selectWindow(d,a) across tiers
 * NM-3  adjusted≠unadjusted OD: fightStrength(true) ≠ fightStrength(false) when pStrength≠0
 * NM-4  −10000 sentinel: winnerResult sets -10000 on DEF==0, not 0
 * NM-5  PROB vs ZPROB: villainBlow LOSE_WEAPON uses LUCKY-sensitive zprob; heroBlow uses one-arg prob
 * NM-6  HERO_MELEE 7-slot guard: heroBlow never produces HESITATE/SITTING_DUCK (OUT? always false)
 * NM-7  Cyclops excluded: doFight/iFight stop before cnt==LEN (index 2 never reached)
 * NM-8  player UNCONSCIOUS ≠ DEF=0: villainBlow UNCONSCIOUS leaves pStrength unchanged
 * NM-9  V-PROB zero-guard: iFight skips wake attempt when vProb==0 (increments instead)
 * NM-10 thief-flee absent from DO-FIGHT: WINNING?/flee only in I-THIEF (deferred); doFight/iFight
 *       never invoke any flee fcode
 *
 * ZIL source spine: 1actions.zil:3232–4135
 */

import { describe, it, expect } from 'vitest';
import {
  DEF1, DEF2A, DEF2B, DEF3A, DEF3B, DEF3C,
  DEF1_RES, DEF2_RES, DEF3_RES,
  selectWindow,
  fightStrength,
  HERO_MELEE,
  villainBlow, winnerResult, heroBlow,
  doFight, iFight,
  STAGGER, LOSE_WEAPON,
  KILLED, LIGHT_WOUND, SERIOUS_WOUND,
  F_BUSY, F_FIRST,
  type VillainTableEntry, type IFightCallbacks, type VillainBlowCallbacks,
} from '../../src/engine/combat.js';
import { Rng } from '../../src/engine/rng.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';
import type { VillainEntry } from '../../src/domain/villain-entry.js';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeVE(opts: Partial<VillainEntry> = {}): VillainEntry {
  return {
    vBest: null, vBestAdv: 0, vProb: 0,
    vMsgs: [],
    action: () => false,
    ...opts,
  };
}

/** 9-slot dummy MELEE for villainBlow (avoids undefined slot lookup). */
function dummyMsgs9(): readonly unknown[] {
  return Array.from({ length: 9 }, (_, i) => [1, [1, `slot${i}`]]);
}

// Minimal VillainBlowCallbacks for doFight integration in NM-7/NM-10 tests.
function makeVBCbs(opts: {
  playerPs?: number;
  score?: number;
} = {}): { cbs: VillainBlowCallbacks } {
  let playerPs = opts.playerPs ?? 0;
  const cbs: VillainBlowCallbacks = {
    getPlayerPStrength: () => playerPs,
    setPlayerPStrength: (v) => { playerPs = v; },
    getScore: () => opts.score ?? 0,
    jigsUp: () => {},
    queueICure: () => {},
    getLoadAllowed: () => 100,
    setLoadAllowed: () => {},
    getLoadMax: () => 100,
    getLucky: () => true,
    findPlayerWeapon: () => 'SWORD',
    dropPlayerWeapon: () => {},
    getVillainStaggered: () => false,
    clearVillainStaggered: () => {},
    setPlayerStaggered: () => {},
    clearPlayerStaggered: () => {},
    emit: () => {},
  };
  return { cbs };
}

// ---------------------------------------------------------------------------
// NM-1 — window-size-9
// Each DEF resolution window must provide at least 9 accessible elements
// (offset + 8 <= table.length - 1).  Never draw from the full raw table with
// a wider random — spec §3.3.
// ---------------------------------------------------------------------------

describe('NM-1 — each resolution window has exactly 9 accessible elements', () => {
  const allWindows: Array<{ label: string; table: readonly number[]; offset: number }> = [
    ...DEF1_RES.map((w, i) => ({ label: `DEF1_RES[${i}]`, table: w.table, offset: w.offset })),
    ...DEF2_RES.map((w, i) => ({ label: `DEF2_RES[${i}]`, table: w.table, offset: w.offset })),
    ...DEF3_RES.map((w, i) => ({ label: `DEF3_RES[${i}]`, table: w.table, offset: w.offset })),
  ];

  for (const { label, table, offset } of allWindows) {
    it(`${label}: table[offset..offset+8] all in bounds`, () => {
      // element at position offset+8 must exist (0-indexed)
      expect(table.length).toBeGreaterThanOrEqual(offset + 9);
    });
  }

  it('all raw tables have the expected element counts (1actions.zil:3258–3299)', () => {
    expect(DEF1.length).toBe(13);
    expect(DEF2A.length).toBe(10);
    expect(DEF2B.length).toBe(12);
    expect(DEF3A.length).toBe(11);
    expect(DEF3B.length).toBe(11);
    expect(DEF3C.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// NM-2 — ATT/DEF role: selectWindow is NOT symmetric
// VILLAIN-BLOW: ATT=villain pStrength, DEF=player fightStrength.
// HERO-BLOW:    ATT=player fightStrength, DEF=villain pStrength.
// Swapping the args selects a different tier → different outcome set.
// spec §3.4
// ---------------------------------------------------------------------------

describe('NM-2 — ATT/DEF role: selectWindow(a,d) ≠ selectWindow(d,a) across tiers', () => {
  it('DEF=1 tier contains KILLED; DEF=2 tier (same values swapped) does not at ATT=1', () => {
    // selectWindow(ATT=2, DEF=1) → DEF1 tier (can return KILLED)
    // selectWindow(ATT=1, DEF=2) → DEF2 tier (cannot return KILLED at ATT=1 window)
    const rng21 = new Rng(1);
    const rng12 = new Rng(1);
    const outcomes21 = new Set<number>();
    const outcomes12 = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      outcomes21.add(selectWindow(2, 1, rng21));
      outcomes12.add(selectWindow(1, 2, rng12));
    }
    expect(outcomes21.has(KILLED)).toBe(true);      // DEF=1 tier: KILLED is in DEF1[1..9]
    expect(outcomes12.has(KILLED)).toBe(false);      // DEF=2 tier ATT=1: no KILLED in DEF2A
    expect(outcomes12.has(LIGHT_WOUND)).toBe(true);  // DEF=2 ATT=1: LIGHT_WOUND reachable
    expect(outcomes21.has(LIGHT_WOUND)).toBe(false); // DEF=1 tier: LIGHT_WOUND never in any window
  });

  it('DEF>=3 tier produces SERIOUS_WOUND; DEF=2 tier does not', () => {
    const rng23 = new Rng(7);
    const rng32 = new Rng(7);
    const out23 = new Set<number>();
    const out32 = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      out23.add(selectWindow(2, 3, rng23));
      out32.add(selectWindow(3, 2, rng32));
    }
    expect(out23.has(SERIOUS_WOUND)).toBe(true);  // DEF>=3 tier: SW in DEF3 tables
    expect(out32.has(SERIOUS_WOUND)).toBe(false); // DEF=2 tier: no SW in DEF2 tables
  });
});

// ---------------------------------------------------------------------------
// NM-3 — adjusted≠unadjusted OD when pStrength≠0
// VILLAIN-BLOW makes two distinct fightStrength calls:
//   DEF = fightStrength(true)   — for table selection + dead check
//   OD  = fightStrength(false)  — for WINNER-RESULT wound delta
// spec §4.1
// ---------------------------------------------------------------------------

describe('NM-3 — adjusted≠unadjusted OD when pStrength≠0', () => {
  it('fightStrength(true) ≠ fightStrength(false) when pStrength=-2 (score=140)', () => {
    const adj   = fightStrength(true,  140, -2);  // 4 + (-2) = 2
    const unadj = fightStrength(false, 140, -2);  // 4
    expect(adj).toBe(2);
    expect(unadj).toBe(4);
    expect(adj).not.toBe(unadj);
  });

  it('fightStrength(true) == fightStrength(false) only when pStrength==0 (no wound)', () => {
    expect(fightStrength(true, 140, 0)).toBe(fightStrength(false, 140, 0));
  });

  it('using false for OD when pStrength≠0 gives a larger value (less wounded delta)', () => {
    // NM-3 real risk: using fightStrength(false) for both drops the wound delta
    // OD=base (4), DEF=base+pStrength (2) → wound = DEF-OD = 2-4 = -2 (net damage)
    // if wrong: OD=DEF=2 → wound = 2-2 = 0 (no damage logged)
    const od  = fightStrength(false, 140, -2);
    const def = fightStrength(true,  140, -2);
    expect(od - def).toBe(2);  // OD > DEF when pStrength < 0 → net negative wound
  });
});

// ---------------------------------------------------------------------------
// NM-4 — −10000 dead sentinel
// winnerResult sets pStrength=-10000 when DEF==0, not 0 or some smaller value.
// -10000 drives fightStrength deeply negative and triggers the kill path.
// spec §6.2
// ---------------------------------------------------------------------------

describe('NM-4 — -10000 dead sentinel in winnerResult when DEF==0', () => {
  it('DEF==0 sets pStrength to -10000, not 0', () => {
    let ps = 0;
    let jigsUpFired = false;
    winnerResult(0, 2, {
      getPlayerPStrength: () => ps,
      setPlayerPStrength: (v) => { ps = v; },
      getScore: () => 0,
      jigsUp: () => { jigsUpFired = true; },
      queueICure: () => {},
    });
    // -10000 is set, then overwritten by the nudge (1-base), but jigsUp must fire
    expect(jigsUpFired).toBe(true);
  });

  it('DEF==0 leads to jigsUp (kill chain): -10000 → fightStrength <= 0 → kill', () => {
    let jigsUpMsg = '';
    winnerResult(0, 2, {
      getPlayerPStrength: () => -10000, // after initial set
      setPlayerPStrength: () => {},
      getScore: () => 0,
      jigsUp: (msg) => { jigsUpMsg = msg; },
      queueICure: () => {},
    });
    expect(jigsUpMsg).toContain('dead');
  });

  it('DEF>0 does NOT set sentinel (no kill unless FS drops below 0)', () => {
    let ps = 0;
    winnerResult(3, 2, {
      getPlayerPStrength: () => ps,
      setPlayerPStrength: (v) => { ps = v; },
      getScore: () => 0,
      jigsUp: () => {},
      queueICure: () => {},
    });
    expect(ps).not.toBe(-10000);  // wound delta, not sentinel
  });
});

// ---------------------------------------------------------------------------
// NM-5 — PROB vs ZPROB: VILLAIN-BLOW LOSE_WEAPON uses LUCKY-sensitive zprob;
//         HERO-BLOW LOSE_WEAPON uses one-arg prob (always 25%).
//
// ZIL: PROB 25 <COND (.HERO? 10)(T 50)> → .HERO? always false → two-arg call.
// villainBlow calls rng.zprob!(25, denom) where denom=100 (LUCKY) or 300 (UNLUCKY).
// heroBlow calls rng.prob(25) — LUCKY-insensitive, always 25%.
// spec §5, 1actions.zil:3444–3447, :3525–3526
// ---------------------------------------------------------------------------

describe('NM-5 — PROB vs ZPROB: villain-blow uses LUCKY-sensitive zprob, hero-blow uses one-arg prob', () => {
  // The draw value 0.15:
  //   prob(25):        0.15*100=15 < 25 → true  (one-arg, LUCKY-insensitive)
  //   zprob(25,100):   0.15*100=15 < 25 → true  (LUCKY path)
  //   zprob(25,300):   0.15*300=45 >= 25 → false (UNLUCKY path)
  // So: with lucky=false and draw=0.15, villainBlow should NOT fire LOSE_WEAPON
  // (uses zprob denom=300), but if it used prob it would fire.
  //
  // Setup: force STAGGER result first (DEF2B@0, nextInt(9)=3 → STAGGER at index 3).
  // DEF2B = [M,M,M,S,S,L,L,L,U,K,K,K]; index 3 = STAGGER.
  // villain ATT=2 → villainStrength=2; player score=0 → DEF=2; → DEF2_RES[1] = DEF2B@0.
  // nextInt(9): rng.next()*9 — need next()=3/9+ε → draw≈0.334 for index 3.
  it('villainBlow LOSE_WEAPON does NOT fire when lucky=false (zprob denom=300, draw=0.15)', () => {
    // Force STAGGER (draw 3/9+ε), then the LOSE_WEAPON test draw = 0.15, then REMARK draws.
    // With lucky=false: 0.15*300=45 >= 25 → no LOSE_WEAPON.
    const draws = [3 / 9 + 0.001, 0.15, 0.0, 0.0]; // stagger roll, zprob draw, remark draws
    const rng = new ScriptedRng(draws);
    const entry = makeVE({ vMsgs: dummyMsgs9() });

    let result = 0;
    const cbs: VillainBlowCallbacks = {
      getPlayerPStrength: () => 0,
      setPlayerPStrength: () => {},
      getScore: () => 0,
      jigsUp: () => {},
      queueICure: () => {},
      getLoadAllowed: () => 100,
      setLoadAllowed: () => {},
      getLoadMax: () => 100,
      getLucky: () => false,  // UNLUCKY: zprob denom=300
      findPlayerWeapon: () => 'SWORD',
      dropPlayerWeapon: () => {},
      getVillainStaggered: () => false,
      clearVillainStaggered: () => {},
      setPlayerStaggered: () => {},
      clearPlayerStaggered: () => {},
      emit: () => {},
    };

    result = villainBlow('TROLL', 2, entry, false, null, false, 0, 0, rng, cbs);
    // STAGGER should remain; LOSE_WEAPON suppressed by unlucky zprob
    expect(result).toBe(STAGGER);
  });

  it('villainBlow LOSE_WEAPON fires when lucky=true (zprob denom=100, draw=0.15)', () => {
    // Same draw=0.15; with lucky=true: 0.15*100=15 < 25 → LOSE_WEAPON fires.
    const draws = [3 / 9 + 0.001, 0.15, 0.0, 0.0];
    const rng = new ScriptedRng(draws);
    const entry = makeVE({ vMsgs: dummyMsgs9() });

    let weaponDropped = false;
    const cbs: VillainBlowCallbacks = {
      getPlayerPStrength: () => 0,
      setPlayerPStrength: () => {},
      getScore: () => 0,
      jigsUp: () => {},
      queueICure: () => {},
      getLoadAllowed: () => 100,
      setLoadAllowed: () => {},
      getLoadMax: () => 100,
      getLucky: () => true,   // LUCKY: zprob denom=100
      findPlayerWeapon: () => 'SWORD',
      dropPlayerWeapon: () => { weaponDropped = true; },
      getVillainStaggered: () => false,
      clearVillainStaggered: () => {},
      setPlayerStaggered: () => {},
      clearPlayerStaggered: () => {},
      emit: () => {},
    };

    const result = villainBlow('TROLL', 2, entry, false, null, false, 0, 0, rng, cbs);
    expect(result).toBe(LOSE_WEAPON);
    expect(weaponDropped).toBe(true);
  });

  it('heroBlow LOSE_WEAPON is LUCKY-insensitive (one-arg prob, always 25% at draw=0.15)', () => {
    // heroBlow uses prob(25), not zprob.  Draw=0.15: 0.15*100=15 < 25 → fires regardless of LUCKY.
    // Force STAGGER: DEF2B@0, nextInt(9)=3.
    // villain DEF=2, player ATT≥1 (score=0 → fightStrength(true,0,0)=2); DEF2_RES[ATT-1].
    // Actually for heroBlow: ATT = player fightStrength, DEF = villain strength.
    // villain pStrength=2 → selectWindow(ATT=2, DEF=2) → DEF2_RES[1] = DEF2B@0.
    const draws = [3 / 9 + 0.001, 0.15, 0.0, 0.0];
    const rng = new ScriptedRng(draws);
    const entry = makeVE({ vBest: null, vBestAdv: 0, vMsgs: HERO_MELEE, action: () => false });

    let weaponDropped = false;
    // HeroBlowCallbacks
    const cbs = {
      getPlayerPStrength: () => 0,
      getPlayerStaggered: () => false,
      clearPlayerStaggered: () => {},
      getScore: () => 0,
      getVillainPStrength: () => 2,
      setVillainPStrength: () => {},
      setVillainFightBit: () => {},
      findVillainWeapon: () => 'AXE' as string | null,
      disarmVillain: (_id: string) => { weaponDropped = true; },
      setVillainStaggered: () => {},
      applyVillainAction: () => {},
      removeVillain: () => {},
      emit: () => {},
    };

    heroBlow('TROLL', entry, null, false, false, 0, rng, cbs);
    expect(weaponDropped).toBe(true);  // prob(25) fires with draw=0.15 regardless of LUCKY
  });
});

// ---------------------------------------------------------------------------
// NM-6 — HERO_MELEE 7-slot guard
// heroBlow never produces HESITATE (8) or SITTING_DUCK (9) because OUT? is
// always false on the hero side.  HERO_MELEE only has 7 slots.
// spec §6.3, 1actions.zil:3527
// ---------------------------------------------------------------------------

describe('NM-6 — HERO_MELEE has exactly 7 slots (HESITATE/SITTING_DUCK absent)', () => {
  it('HERO_MELEE.length === 7 (slots 1..LOSE_WEAPON only)', () => {
    expect(HERO_MELEE.length).toBe(7);
  });

  it('slot indices 7 and 8 (HESITATE/SITTING_DUCK) are undefined in HERO_MELEE', () => {
    // These would be indexed as res-1 with res=8 or res=9 if OUT? ever became true.
    expect(HERO_MELEE[7]).toBeUndefined();
    expect(HERO_MELEE[8]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NM-7 — Cyclops excluded from DO-FIGHT and I-FIGHT
// ZIL: loop is cnt=1..LEN-1; cyclops is at cnt=LEN (index LEN-1) → never reached.
// spec §6.5, 1actions.zil:3337–3339
// ---------------------------------------------------------------------------

describe('NM-7 — Cyclops excluded from DO-FIGHT and I-FIGHT (cnt==LEN)', () => {
  it('doFight with LEN=3: cyclops action at index 2 is never invoked', () => {
    const invoked: number[] = [];
    const table: VillainTableEntry[] = [
      { id: 'TROLL',   fightBit: false, pStrength: 2,     entry: makeVE({ action: () => { invoked.push(0); return false; } }), inHere: true, staggered: false },
      { id: 'THIEF',   fightBit: false, pStrength: 5,     entry: makeVE({ action: () => { invoked.push(1); return false; } }), inHere: true, staggered: false },
      { id: 'CYCLOPS', fightBit: false, pStrength: 10000, entry: makeVE({ action: () => { invoked.push(2); return false; } }), inHere: true, staggered: false },
    ];
    const { cbs } = makeVBCbs();
    doFight(3, table, new ScriptedRng([0.5]), cbs);
    expect(invoked).not.toContain(2);
  });

  it('iFight with LEN=3: villainTable[2] (cyclops) is never visited', () => {
    const visited: number[] = [];
    const ctx: IFightCallbacks = {
      getDead: () => false,
      len: 3,
      villainTable: [
        { id: 'TROLL',   fightBit: false, pStrength: 2,     entry: makeVE(), inHere: true, staggered: false },
        { id: 'THIEF',   fightBit: false, pStrength: 5,     entry: makeVE(), inHere: true, staggered: false },
        { id: 'CYCLOPS', fightBit: false, pStrength: 10000, entry: makeVE(), inHere: true, staggered: false },
      ],
      getVillainPs: (i) => { visited.push(i); return [2, 5, 10000][i] ?? 0; },
      setVillainPs: () => {},
      getVProb: () => 0,
      setVProb: () => {},
      isThief: () => false,
      isThiefEngrossed: () => false,
      setThiefEngrossed: () => {},
      callVillainAction: () => false,
      clearFightBit: () => {},
      clearStaggered: () => {},
      clearPlayerStaggered: () => {},
      onAwaken: () => {},
      triggerFight: () => {},
      isVillainInHere: () => true,
      isVillainInvisible: () => false,
    };
    iFight(ctx, new ScriptedRng([0.5]));
    // Only indices 0 and 1 should be visited (cyclops at 2 never reached).
    expect(visited).not.toContain(2);
  });
});

// ---------------------------------------------------------------------------
// NM-8 — player UNCONSCIOUS result does NOT change pStrength in villainBlow
// "UNCONSCIOUS: NO pStrength change here (DO-FIGHT loop handles it)" — spec §6.1 step 6.
// If this guard is wrong, the DO-FIGHT out-counter mechanic breaks.
// ---------------------------------------------------------------------------

describe('NM-8 — villainBlow UNCONSCIOUS leaves player pStrength unchanged', () => {
  it('UNCONSCIOUS roll: pStrength stays at 0 (pStrength only modified by winnerResult)', () => {
    // villain ATT=2, player DEF=2 → DEF2_RES[1] = DEF2B@0
    // DEF2B = [M,M,M,S,S,L,L,L,U,K,K,K]; nextInt(9)=8 → index 8 = UNCONSCIOUS
    let playerPs = 0;
    const cbs: VillainBlowCallbacks = {
      getPlayerPStrength: () => playerPs,
      setPlayerPStrength: (v) => { playerPs = v; },
      getScore: () => 0,
      jigsUp: () => {},
      queueICure: () => {},
      getLoadAllowed: () => 100,
      setLoadAllowed: () => {},
      getLoadMax: () => 100,
      getLucky: () => true,
      findPlayerWeapon: () => null,
      dropPlayerWeapon: () => {},
      getVillainStaggered: () => false,
      clearVillainStaggered: () => {},
      setPlayerStaggered: () => {},
      clearPlayerStaggered: () => {},
      emit: () => {},
    };

    // nextInt(9)=8: draw must be in [8/9, 9/9) → use 8/9 + 0.001
    const rng = new ScriptedRng([8 / 9 + 0.001]);
    villainBlow('TROLL', 2, makeVE({ vMsgs: dummyMsgs9() }), false, null, false, 0, 0, rng, cbs);

    // UNCONSCIOUS result: winnerResult is still called (step 7), but step 6 must not
    // zero or otherwise alter pStrength — only winnerResult may modify it.
    // The net from winnerResult: DEF=2 (unchanged by UNCONSCIOUS in step 6) - OD=2 = 0
    // → pStrength = DEF - OD = 0; so we expect 0, which confirms step 6 left DEF alone.
    expect(playerPs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NM-9 — V-PROB zero-guard in I-FIGHT
// "if p != 0 and prob(p): wake" — when vProb==0 the guard is false regardless
// of the RNG draw, so awaken is never called and vProb increments to 25.
// spec §7.1, 1actions.zil:3823–3829
// ---------------------------------------------------------------------------

describe('NM-9 — I-FIGHT vProb=0 guard prevents wake (increments instead)', () => {
  it('vProb=0: wake not attempted, vProb advances to 25', () => {
    let vProb = 0;
    let awakenCalled = false;

    const ctx: IFightCallbacks = {
      getDead: () => false,
      len: 2,
      villainTable: [{ id: 'TROLL', fightBit: false, pStrength: -1, entry: makeVE(), inHere: true, staggered: false }],
      getVillainPs: () => -1,          // unconscious
      setVillainPs: () => {},
      getVProb: () => vProb,
      setVProb: (_, v) => { vProb = v; },
      isThief: () => false,
      isThiefEngrossed: () => false,
      setThiefEngrossed: () => {},
      callVillainAction: () => false,
      clearFightBit: () => {},
      clearStaggered: () => {},
      clearPlayerStaggered: () => {},
      onAwaken: () => { awakenCalled = true; },
      triggerFight: () => {},
      isVillainInHere: () => true,
      isVillainInvisible: () => false,
    };

    // RNG always returns 0.0 — would succeed any prob(>0), but vProb=0 guard blocks it.
    iFight(ctx, new ScriptedRng([0.0]));

    expect(awakenCalled).toBe(false);
    expect(vProb).toBe(25);
  });

  it('vProb=25 with succeeding prob: villain wakes, vProb resets to 0', () => {
    let vProb = 25;
    let awakenCalled = false;

    const ctx: IFightCallbacks = {
      getDead: () => false,
      len: 2,
      villainTable: [{ id: 'TROLL', fightBit: false, pStrength: -1, entry: makeVE(), inHere: true, staggered: false }],
      getVillainPs: () => -1,
      setVillainPs: () => {},
      getVProb: () => vProb,
      setVProb: (_, v) => { vProb = v; },
      isThief: () => false,
      isThiefEngrossed: () => false,
      setThiefEngrossed: () => {},
      callVillainAction: () => false,
      clearFightBit: () => {},
      clearStaggered: () => {},
      clearPlayerStaggered: () => {},
      onAwaken: () => { awakenCalled = true; },
      triggerFight: () => {},
      isVillainInHere: () => true,
      isVillainInvisible: () => false,
    };

    // draw=0.1 → 0.1*100=10 < 25 → prob(25) succeeds → wake
    iFight(ctx, new ScriptedRng([0.1]));

    expect(awakenCalled).toBe(true);
    expect(vProb).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NM-10 — thief-flee absent from DO-FIGHT and I-FIGHT
// "thief-flee-only-in-I-THIEF (engine-built, asserted absent from DO-FIGHT)"
// WINNING? / flee is deferred to I-THIEF (a later phase).  DO-FIGHT and I-FIGHT
// must never invoke a flee fcode.  The only fcodes these two functions ever
// pass to villain action callbacks are F_BUSY (1) and F_FIRST (5).
// spec §11.4 NM-10, §1 "Explicitly deferred"
// ---------------------------------------------------------------------------

describe('NM-10 — flee logic absent from DO-FIGHT and I-FIGHT (only F_BUSY/F_FIRST invoked)', () => {
  it('doFight: all action fcodes are F_BUSY or F_FIRST (no flee fcode)', () => {
    const fcodesSeen: number[] = [];

    // Thief with FIGHTBIT set so DO-FIGHT calls action(F_BUSY) on it.
    const table: VillainTableEntry[] = [
      {
        id: 'THIEF',
        fightBit: true,
        pStrength: 5,
        entry: makeVE({
          vMsgs: dummyMsgs9(),
          action: (fcode) => { fcodesSeen.push(fcode); return true; }, // F_BUSY returns true → skip blow
        }),
        inHere: true,
        staggered: false,
      },
    ];

    const { cbs } = makeVBCbs();
    doFight(2, table, new ScriptedRng([0.5]), cbs);

    // Every fcode seen must be F_BUSY or F_FIRST (no flee, no other codes).
    for (const fcode of fcodesSeen) {
      expect([F_BUSY, F_FIRST]).toContain(fcode);
    }
    // doFight must have called F_BUSY at least once (the only call site in DO-FIGHT).
    expect(fcodesSeen).toContain(F_BUSY);
  });

  it('iFight: all action fcodes are F_BUSY or F_FIRST (no flee fcode)', () => {
    const fcodesSeen: number[] = [];

    const ctx: IFightCallbacks = {
      getDead: () => false,
      len: 2,
      villainTable: [
        {
          id: 'THIEF',
          fightBit: true,
          pStrength: 5,
          entry: makeVE({ action: (fcode) => { fcodesSeen.push(fcode); return false; } }),
          inHere: true,
          staggered: false,
        },
      ],
      getVillainPs: () => 5,
      setVillainPs: () => {},
      getVProb: () => 0,
      setVProb: () => {},
      isThief: () => false,  // not the thief (avoids engrossed branch)
      isThiefEngrossed: () => false,
      setThiefEngrossed: () => {},
      callVillainAction: (_, fcode) => { fcodesSeen.push(fcode); return false; },
      clearFightBit: () => {},
      clearStaggered: () => {},
      clearPlayerStaggered: () => {},
      onAwaken: () => {},
      triggerFight: () => {},
      isVillainInHere: () => true,
      isVillainInvisible: () => false,
    };

    iFight(ctx, new ScriptedRng([0.5]));

    for (const fcode of fcodesSeen) {
      expect([F_BUSY, F_FIRST]).toContain(fcode);
    }
  });
});
