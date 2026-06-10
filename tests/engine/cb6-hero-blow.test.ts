/**
 * CB6 — HERO-BLOW + VILLAIN-RESULT (spec §6.3, §6.4, §12 CB6)
 *
 * Done-criteria:
 *   - NM-6: HERO_MELEE 7-slot guard (HERO-BLOW never produces HESITATE/SITTING_DUCK)
 *   - villain death → F_DEAD fired + removal (villainResult DEF==0 branch)
 *   - unarmed villain (no DWEAPON) → instant KILLED, "cannot defend" message
 *   - KO'd villain (DEF < 0) → instant KILLED, "unconscious ... cannot defend" message
 *   - villain UNCONSCIOUS result → DEF = -DEF (KO, not death)
 *   - STAGGER result → villain FSET STAGGERED
 *   - LIGHT_WOUND / SERIOUS_WOUND reduce villain DEF (clamped to 0)
 *   - LOSE_WEAPON: villain's weapon cleared NDESC, set WEAPONBIT, moved to HERE (THIS-IS-IT)
 *   - player STAGGERED → "still recovering" message, clear STAGGERED, no damage
 *   - DEF == 0 (villain already dead) → "pointless" message
 *   - killing-blow chain: KILLED → DEF=0 → villainResult → F_DEAD + removal
 *
 * ZIL refs:
 *   1actions.zil:3476–3548  HERO-BLOW
 *   1actions.zil:3566–3580  VILLAIN-RESULT
 */

import { describe, it, expect } from 'vitest';
import {
  heroBlow,
  villainResult,
  KILLED, MISSED, UNCONSCIOUS, LIGHT_WOUND,
  HERO_MELEE,
  F_DEAD, F_UNCONSCIOUS,
} from '../../src/engine/combat.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';
import type { VillainEntry } from '../../src/domain/villain-entry.js';
import type { ObjectId } from '../../src/domain/game-object.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(opts: Partial<VillainEntry> = {}): VillainEntry {
  return {
    vBest: null,
    vBestAdv: 0,
    vProb: 0,
    vMsgs: TROLL_DUMMY_MSGS,
    action: opts.action ?? ((_f: number) => false),
    ...opts,
  };
}

// 7-slot dummy MELEE table (matches HERO_MELEE slot count — NM-6)
const HERO_DUMMY_MSGS: readonly unknown[] = [
  [1, [1, 'missed']],
  [1, [1, 'knocked out']],
  [1, [1, 'killed']],
  [1, [1, 'light wound']],
  [1, [1, 'serious wound']],
  [1, [1, 'stagger']],
  [1, [1, 'lose weapon']],
];

// 9-slot dummy MELEE for villain (TROLL_MELEE is 9 slots)
const TROLL_DUMMY_MSGS: readonly unknown[] = [
  [1, [1, 'missed']],
  [1, [1, 'knocked out']],
  [1, [1, 'killed']],
  [1, [1, 'light wound']],
  [1, [1, 'serious wound']],
  [1, [1, 'stagger']],
  [1, [1, 'lose weapon']],
  [1, [1, 'hesitate']],
  [1, [1, 'sitting duck']],
];

// ---------------------------------------------------------------------------
// Callback bundle for heroBlow
// ---------------------------------------------------------------------------

interface HeroBlowState {
  vilPs: number;             // villain pStrength (mutable)
  playerPs: number;          // player pStrength
  score: number;
  playerStaggered: boolean;
  villainStaggered: boolean;
  villainWeaponId: string | null;
  emitted: string[];
  fdeadCalled: boolean;
  funconsciousCalled: boolean;
  villainRemoved: boolean;
  fightBitSet: boolean;
  staggerSet: boolean;        // villain staggered flag set
  staggerCleared: boolean;    // player staggered cleared
  villainWeaponDisarmed: boolean;  // weapon moved to HERE
}

function makeState(overrides: Partial<HeroBlowState> = {}): HeroBlowState {
  return {
    vilPs: 2,
    playerPs: 0,
    score: 0,
    playerStaggered: false,
    villainStaggered: false,
    villainWeaponId: 'AXE',
    emitted: [],
    fdeadCalled: false,
    funconsciousCalled: false,
    villainRemoved: false,
    fightBitSet: false,
    staggerSet: false,
    staggerCleared: false,
    villainWeaponDisarmed: false,
    ...overrides,
  };
}

function makeCbs(s: HeroBlowState) {
  return {
    getPlayerPStrength: () => s.playerPs,
    getPlayerStaggered: () => s.playerStaggered,
    clearPlayerStaggered: () => { s.playerStaggered = false; s.staggerCleared = true; },
    getScore: () => s.score,
    // villain pStrength access
    getVillainPStrength: () => s.vilPs,
    setVillainPStrength: (v: number) => { s.vilPs = v; },
    // villain's weapon (DWEAPON = FIND-WEAPON on villain)
    findVillainWeapon: () => s.villainWeaponId,
    // LOSE_WEAPON: clear NDESC, set WEAPONBIT, move to HERE
    disarmVillain: (wepId: string) => {
      s.villainWeaponDisarmed = true;
      s.villainWeaponId = null;
      void wepId;
    },
    setVillainFightBit: () => { s.fightBitSet = true; },
    setVillainStaggered: () => { s.staggerSet = true; },
    emit: (text: string) => { s.emitted.push(text); },
    // villain action (F_DEAD / F_UNCONSCIOUS)
    applyVillainAction: (fcode: number, villainId: ObjectId) => {
      void villainId;
      if (fcode === F_DEAD)        s.fdeadCalled = true;
      if (fcode === F_UNCONSCIOUS) s.funconsciousCalled = true;
    },
    removeVillain: (villainId: ObjectId) => {
      void villainId;
      s.villainRemoved = true;
    },
  };
}

// ---------------------------------------------------------------------------
// NM-6 — HERO_MELEE has exactly 7 slots; heroBlow never accesses index >= 7
// ---------------------------------------------------------------------------

describe('NM-6 — HERO_MELEE has exactly 7 slots', () => {
  it('HERO_MELEE length is 7', () => {
    expect(HERO_MELEE.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// villainResult — DEF == 0: villain killed (F_DEAD + removal)
// ---------------------------------------------------------------------------

describe('villainResult — DEF==0: villain killed (spec §6.4, 1actions.zil:3568–3576)', () => {
  it('DEF==0: villain pStrength set to 0', () => {
    const s = makeState({ vilPs: 2 });
    const cbs = makeCbs(s);
    villainResult('TROLL', 0, KILLED, cbs);
    expect(s.vilPs).toBe(0);
  });

  it('DEF==0: F_DEAD callback fired', () => {
    const s = makeState({ vilPs: 2 });
    villainResult('TROLL', 0, KILLED, makeCbs(s));
    expect(s.fdeadCalled).toBe(true);
  });

  it('DEF==0: villain removed from world', () => {
    const s = makeState({ vilPs: 2 });
    villainResult('TROLL', 0, KILLED, makeCbs(s));
    expect(s.villainRemoved).toBe(true);
  });

  it('DEF==0: emits fog death message (1actions.zil:3570–3573)', () => {
    const s = makeState({ vilPs: 2 });
    villainResult('TROLL', 0, KILLED, makeCbs(s));
    const text = s.emitted.join(' ');
    expect(text).toContain('breathes his last breath');
    expect(text).toContain('carcass has disappeared');
  });
});

// ---------------------------------------------------------------------------
// villainResult — RES==UNCONSCIOUS: F_UNCONSCIOUS fired, villain not removed
// ---------------------------------------------------------------------------

describe('villainResult — RES==UNCONSCIOUS: F_UNCONSCIOUS fired (spec §6.4, 1actions.zil:3577–3579)', () => {
  it('RES==UNCONSCIOUS: F_UNCONSCIOUS callback fired', () => {
    const s = makeState({ vilPs: -2 });
    villainResult('TROLL', -2, UNCONSCIOUS, makeCbs(s));
    expect(s.funconsciousCalled).toBe(true);
  });

  it('RES==UNCONSCIOUS: villain NOT removed', () => {
    const s = makeState({ vilPs: -2 });
    villainResult('TROLL', -2, UNCONSCIOUS, makeCbs(s));
    expect(s.villainRemoved).toBe(false);
  });

  it('RES==UNCONSCIOUS: F_DEAD NOT fired', () => {
    const s = makeState({ vilPs: -2 });
    villainResult('TROLL', -2, UNCONSCIOUS, makeCbs(s));
    expect(s.fdeadCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// villainResult — other results: villain pStrength updated, no callbacks
// ---------------------------------------------------------------------------

describe('villainResult — other results: pStrength updated (spec §6.4)', () => {
  it('MISSED: pStrength set to DEF (no change to living villain)', () => {
    const s = makeState({ vilPs: 2 });
    villainResult('TROLL', 2, MISSED, makeCbs(s));
    expect(s.vilPs).toBe(2);
    expect(s.fdeadCalled).toBe(false);
    expect(s.funconsciousCalled).toBe(false);
  });

  it('LIGHT_WOUND: pStrength updated to reduced DEF', () => {
    const s = makeState({ vilPs: 2 });
    villainResult('TROLL', 1, LIGHT_WOUND, makeCbs(s));
    expect(s.vilPs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — player STAGGERED: recovery path (spec §6.3 step 3)
// ---------------------------------------------------------------------------

describe('heroBlow — player staggered: "still recovering" + no damage (spec §6.3 step 3)', () => {
  it('player staggered: emits recovery message', () => {
    const s = makeState({ playerStaggered: true });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', true, true, s.score, rng, makeCbs(s));
    expect(s.emitted.some(e => e.includes('still recovering'))).toBe(true);
  });

  it('player staggered: clears stagger flag', () => {
    const s = makeState({ playerStaggered: true });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', true, true, s.score, rng, makeCbs(s));
    expect(s.staggerCleared).toBe(true);
  });

  it('player staggered: villain pStrength unchanged', () => {
    const s = makeState({ playerStaggered: true, vilPs: 2 });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', true, true, s.score, rng, makeCbs(s));
    expect(s.vilPs).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — DEF==0 (villain already dead/non-combatant): "pointless" message
// (spec §6.3 step 6)
// ---------------------------------------------------------------------------

describe('heroBlow — DEF==0: "pointless" message (spec §6.3 step 6)', () => {
  it('villain pStrength=0 → "Attacking the X is pointless." emitted', () => {
    const s = makeState({ vilPs: 0 });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.emitted.some(e => e.includes('pointless'))).toBe(true);
  });

  it('villain pStrength=0 → no F_DEAD callback', () => {
    const s = makeState({ vilPs: 0 });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.fdeadCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — unarmed villain: instant KILLED
// (spec §6.3 step 8: "!DWEAPON or DEF < 0")
// ---------------------------------------------------------------------------

describe('heroBlow — unarmed villain: instant KILLED (spec §6.3 step 8)', () => {
  it('no villain weapon → villain receives KILLED, removed', () => {
    const s = makeState({ vilPs: 2, villainWeaponId: null });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(true);
    expect(s.fdeadCalled).toBe(true);
  });

  it('no villain weapon → "unarmed ... cannot defend himself: He dies."', () => {
    const s = makeState({ vilPs: 2, villainWeaponId: null });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', false, false, s.score, rng, makeCbs(s));
    const text = s.emitted.join(' ');
    expect(text).toContain('unarmed');
    expect(text).toContain('cannot defend himself');
  });
});

// ---------------------------------------------------------------------------
// heroBlow — KO'd villain (DEF < 0): instant KILLED
// (spec §6.3 step 8: "DEF < 0")
// ---------------------------------------------------------------------------

describe('heroBlow — KO\'d villain (DEF < 0): instant KILLED (spec §6.3 step 8)', () => {
  it('pStrength=-2 → villain receives KILLED, removed', () => {
    // villainStrength returns pStrength as-is when negative → DEF=-2 < 0 → instant kill
    const s = makeState({ vilPs: -2, villainWeaponId: 'AXE' });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(true);
    expect(s.fdeadCalled).toBe(true);
  });

  it('KO\'d villain → "unconscious ... cannot defend himself: He dies."', () => {
    const s = makeState({ vilPs: -2, villainWeaponId: 'AXE' });
    const rng = new ScriptedRng([0.5]);
    heroBlow('TROLL', makeEntry(), 'SWORD', false, false, s.score, rng, makeCbs(s));
    const text = s.emitted.join(' ');
    expect(text).toContain('unconscious');
    expect(text).toContain('cannot defend himself');
  });
});

// ---------------------------------------------------------------------------
// heroBlow — UNCONSCIOUS result: DEF = -DEF (KO, not death)
// (spec §6.3 step 9)
// ---------------------------------------------------------------------------

describe('heroBlow — UNCONSCIOUS result: DEF negated (KO, not death) (spec §6.3 step 9)', () => {
  // villain ATT=2, DEF=2 (troll pStrength=2, score=0 → ATT=max(1,2)=2, DEF=2)
  // DEF2_RES[1] = DEF2B@0: [M,M,M,S,S,L,L,L,U,K,K,K]
  // nextInt(9)=8 → index 8 → UNCONSCIOUS
  it('UNCONSCIOUS roll: villain pStrength = -DEF (negated)', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    // score=0 → fightStrength(true,0,0)=2 → ATT=max(1,2)=2
    // DEF=villainStrength()=2 → DEF2B@0; roll=8→UNCONSCIOUS
    const rng = new ScriptedRng([8 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.vilPs).toBe(-2);  // DEF=2 → -2
  });

  it('UNCONSCIOUS roll: F_UNCONSCIOUS fired', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const rng = new ScriptedRng([8 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.funconsciousCalled).toBe(true);
  });

  it('UNCONSCIOUS roll: villain NOT removed (not dead)', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const rng = new ScriptedRng([8 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — KILLED result: villain removed + F_DEAD fired
// ---------------------------------------------------------------------------

describe('heroBlow — KILLED result: DEF=0, villain removed + F_DEAD (spec §6.3/§6.4)', () => {
  // villain pStrength=1, score=0 → ATT=max(1,2)=2, DEF=1 → DEF1_RES[1] = DEF1@1
  // DEF1 = [M,M,M,M,S,S,U,U,K,K,K,K,K]; from offset 1: [M,M,M,S,S,U,U,K,K] (9 elems)
  // nextInt(9)=7 → DEF1[1+7]=DEF1[8]=KILLED
  it('KILLED roll: villain removed and F_DEAD fired', () => {
    const s = makeState({ vilPs: 1, score: 0 });
    const rng = new ScriptedRng([7 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(true);
    expect(s.fdeadCalled).toBe(true);
  });

  it('KILLED roll: villain pStrength = 0', () => {
    const s = makeState({ vilPs: 1, score: 0 });
    const rng = new ScriptedRng([7 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.vilPs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — STAGGER: villain STAGGERED flag set (spec §6.3 step 9)
// ---------------------------------------------------------------------------

describe('heroBlow — STAGGER: villain STAGGERED set (spec §6.3 step 9)', () => {
  // villain pStrength=2, score=0 → ATT=2, DEF=2 → DEF2B@0
  // DEF2B = [M,M,M,S,S,L,L,L,U,K,K,K]; nextInt(9)=3 → STAGGER
  it('STAGGER roll: villain stagger flag set', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const rng = new ScriptedRng([3 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.staggerSet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — LIGHT_WOUND: villain pStrength reduced (spec §6.3 step 9)
// ---------------------------------------------------------------------------

describe('heroBlow — LIGHT_WOUND: villain DEF reduced by 1 (spec §6.3 step 9)', () => {
  // villain pStrength=2, score=0 → ATT=2, DEF=2 → DEF2B@0
  // nextInt(9)=5 → DEF2B[5]=LIGHT_WOUND
  it('LIGHT_WOUND: villain pStrength = max(0, DEF-1)', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const rng = new ScriptedRng([5 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.vilPs).toBe(1);  // max(0, 2-1)
  });
});

// ---------------------------------------------------------------------------
// heroBlow — FIGHTBIT set on villain (spec §6.3 step 2)
// ---------------------------------------------------------------------------

describe('heroBlow — FIGHTBIT set on villain (spec §6.3 step 2, 1actions.zil:3484)', () => {
  it('normal blow: FIGHTBIT set on villain', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    // MISSED roll: nextInt(9)=0 → MISSED
    const rng = new ScriptedRng([0 / 9 + 0.001]);
    heroBlow('TROLL', makeEntry({ vMsgs: HERO_DUMMY_MSGS }), 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.fightBitSet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// heroBlow — vBest DEF reduction (VILLAIN-STRENGTH 1actions.zil:3391–3396)
//
// TROLL entry: vBest=SWORD, vBestAdv=1 (1actions.zil:3802)
// Attacking with SWORD (prsiIsWeapon=true): OD = max(1, OD - vBestAdv)
// pStrength=2 → DEF normally 2; with SWORD → DEF = max(1, 2-1) = 1
// ---------------------------------------------------------------------------

describe('heroBlow — vBest DEF reduction: player weapon matches villain vBest (1actions.zil:3391–3396)', () => {
  // With DEF=1 and ATT=2 → DEF1_RES[1] = DEF1@1; roll=7/9 → KILLED
  it('attacking with vBest weapon reduces DEF by vBestAdv', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const entry = makeEntry({ vBest: 'SWORD' as ObjectId, vBestAdv: 1, vMsgs: HERO_DUMMY_MSGS });
    // DEF without vBest reduction = 2; with SWORD → DEF = 1
    // ATT=2, DEF=1 → DEF1_RES[1]; roll 7/9 → KILLED
    const rng = new ScriptedRng([7 / 9 + 0.001]);
    heroBlow('TROLL', entry, 'SWORD', true, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(true);
    expect(s.fdeadCalled).toBe(true);
  });

  it('attacking with non-vBest weapon does NOT reduce DEF', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const entry = makeEntry({ vBest: 'SWORD' as ObjectId, vBestAdv: 1, vMsgs: HERO_DUMMY_MSGS });
    // DEF = 2 (no reduction), ATT=2 → DEF2B@0; roll 7/9 → LIGHT_WOUND (not KILLED)
    const rng = new ScriptedRng([7 / 9 + 0.001]);
    heroBlow('TROLL', entry, 'AXE', true, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(false);
    expect(s.fdeadCalled).toBe(false);
    expect(s.vilPs).toBe(1);  // LIGHT_WOUND: DEF=2 → pStr = max(0, 2-1) = 1
  });

  it('prsiIsWeapon=false does NOT trigger reduction even with matching id', () => {
    const s = makeState({ vilPs: 2, score: 0 });
    const entry = makeEntry({ vBest: 'SWORD' as ObjectId, vBestAdv: 1, vMsgs: HERO_DUMMY_MSGS });
    // prsiIsWeapon=false → no reduction → DEF=2, same outcome as non-vBest case
    const rng = new ScriptedRng([7 / 9 + 0.001]);
    heroBlow('TROLL', entry, 'SWORD', false, false, s.score, rng, makeCbs(s));
    expect(s.villainRemoved).toBe(false);
    expect(s.vilPs).toBe(1);  // LIGHT_WOUND, not KILLED
  });
});
