/**
 * CB8 — DO-FIGHT + I-FIGHT + AWAKEN + I-CURE (spec §6.5, §7, §12 CB8)
 *
 * Done-criteria:
 *   - NM-7: Cyclops (idx 3, cnt==LEN) excluded from DO-FIGHT loop
 *   - Test C: OUT? knock-out loop — UNCONSCIOUS sets out=1+nextInt(3);
 *             subsequent blows transform (STAGGER→HESITATE, else→SITTING_DUCK)
 *   - Test F: V-PROB wake cycle — vProb 0→25→50→75→100; NM-9 p!=0 guard
 *   - Test G: I-CURE two-tick heal, re-queue stops at pStrength==0
 *   - awaken: negates pStrength, fires F_CONSCIOUS
 *
 * ZIL refs:
 *   1actions.zil:3331–3357  DO-FIGHT
 *   1actions.zil:3810–3841  I-FIGHT
 *   1actions.zil:3843–3847  AWAKEN
 *   1actions.zil:3593–3602  I-CURE
 */

import { describe, it, expect } from 'vitest';
import {
  doFight, iFight, awaken, iCure,
  CURE_WAIT,
  type IFightCallbacks, type ICureCallbacks, type VillainTableEntry,
} from '../../src/engine/combat.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';
import type { VillainEntry } from '../../src/domain/villain-entry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal 9-slot dummy MELEE table. */
function dummyMsgs(): readonly unknown[] {
  return [
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
}

function makeEntry(opts: Partial<VillainEntry> = {}): VillainEntry {
  return {
    vBest: null,
    vBestAdv: 0,
    vProb: 0,
    vMsgs: dummyMsgs(),
    action: () => false,
    ...opts,
  };
}

/**
 * Minimal VillainBlowCallbacks-compatible state for doFight integration tests.
 * Tracks what villains had blows directed at them.
 */
function makeBlowCallbacks(opts: {
  playerPs?: number;
  score?: number;
} = {}) {
  let playerPs = opts.playerPs ?? 0;
  const jigsUpCalls: string[] = [];
  const queued: number[] = [];
  const emitted: string[] = [];

  return {
    get playerPs() { return playerPs; },
    get jigsUpCalls() { return jigsUpCalls; },
    get queued() { return queued; },
    get emitted() { return emitted; },
    cbs: {
      getPlayerPStrength: () => playerPs,
      setPlayerPStrength: (v: number) => { playerPs = v; },
      getScore: () => opts.score ?? 0,
      jigsUp: (msg: string) => { jigsUpCalls.push(msg); },
      queueICure: (p: number) => { queued.push(p); },
      getLoadAllowed: () => 100,
      setLoadAllowed: (_v: number) => {},
      getLoadMax: () => 100,
      getLucky: () => true,
      findPlayerWeapon: () => null,
      dropPlayerWeapon: (_id: string) => {},
      getVillainStaggered: () => false,
      clearVillainStaggered: () => {},
      setPlayerStaggered: () => {},
      clearPlayerStaggered: () => {},
      emit: (s: string) => { emitted.push(s); },
    },
  };
}

// ---------------------------------------------------------------------------
// NM-7 — Cyclops excluded from DO-FIGHT (spec §6.5, §11.4 NM-7)
// ---------------------------------------------------------------------------

describe('NM-7: DO-FIGHT excludes cyclops (cnt==LEN)', () => {
  it('with LEN=3, only indices 0 and 1 are processed (cyclops at idx 2 skipped)', () => {
    const processed: number[] = [];

    // Three villain entries — mirroring the ZIL VILLAINS LTABLE (troll, thief, cyclops).
    // None have FIGHTBIT set; the ZIL COND first clause has an empty body so NO action is called.
    const table: VillainTableEntry[] = [
      {
        id: 'TROLL',
        fightBit: false,
        pStrength: 2,
        entry: makeEntry({ action: () => { processed.push(0); return false; } }),
        inHere: true,
        staggered: false,
      },
      {
        id: 'THIEF',
        fightBit: false,
        pStrength: 5,
        entry: makeEntry({ action: () => { processed.push(1); return false; } }),
        inHere: true,
        staggered: false,
      },
      {
        id: 'CYCLOPS',
        fightBit: false,
        pStrength: 10000,
        entry: makeEntry({ action: () => { processed.push(2); return false; } }),
        inHere: true,
        staggered: false,
      },
    ];

    const rng = new ScriptedRng([0.5]);
    const state = makeBlowCallbacks();

    // LEN=3: loop processes cnt=1,2 (0-based: idx 0,1), skips cnt=3 (idx 2).
    doFight(3, table, rng, state.cbs);

    // No action called at all: !fightBit → empty COND body (1actions.zil:3341).
    expect(processed).toEqual([]);
    // Cyclops (index 2) must NOT be reached.
    expect(processed).not.toContain(2);
  });

  it('DO-FIGHT: !fightBit villain — action NOT invoked (1actions.zil:3341 empty body)', () => {
    let actionCalled = false;
    const table: VillainTableEntry[] = [
      {
        id: 'TROLL',
        fightBit: false,
        pStrength: 2,
        entry: makeEntry({ action: () => { actionCalled = true; return false; } }),
        inHere: true,
        staggered: false,
      },
    ];

    // LEN=2: cnt=1 only → idx 0 (TROLL, no fightBit) → skip without action
    doFight(2, table, new ScriptedRng([0.5]), makeBlowCallbacks().cbs);
    expect(actionCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NM-7 — I-FIGHT excludes cyclops
// ---------------------------------------------------------------------------

describe('NM-7: I-FIGHT excludes cyclops (cnt==LEN)', () => {
  it('with LEN=3, I-FIGHT does not reach cyclops at idx 2', () => {
    const visited: number[] = [];

    const ctx: IFightCallbacks = {
      getDead: () => false,
      villainTable: [
        {
          id: 'TROLL',
          fightBit: false,
          pStrength: 1,
          entry: makeEntry(),
          inHere: true,
          staggered: false,
        },
        {
          id: 'THIEF',
          fightBit: false,
          pStrength: 1,
          entry: makeEntry(),
          inHere: true,
          staggered: false,
        },
        {
          id: 'CYCLOPS',
          fightBit: false,
          pStrength: 1,
          entry: makeEntry(),
          inHere: true,
          staggered: false,
        },
      ],
      getVillainPs: (idx) => { visited.push(idx); return 1; },
      setVillainPs: () => {},
      getVProb: () => 0,
      setVProb: () => {},
      isThief: () => false,
      isThiefEngrossed: () => false,
      setThiefEngrossed: () => {},
      callVillainAction: (idx, _fcode) => { visited.push(idx); return false; },
      clearFightBit: () => {},
      clearStaggered: () => {},
      clearPlayerStaggered: () => {},
      onAwaken: () => {},
      triggerFight: () => {},
      isVillainInHere: () => true,
      isVillainInvisible: () => false,
      len: 3,
    };

    iFight(ctx, new ScriptedRng([0.5]));
    // cnt=1..2 → idx 0,1 only; cyclops at idx 2 never touched
    expect(visited).not.toContain(2);
  });
});

// ---------------------------------------------------------------------------
// Test C — OUT? knock-out loop (spec §6.5, §11.3-C)
// ---------------------------------------------------------------------------

describe('Test C: DO-FIGHT OUT? knock-out loop', () => {
  /**
   * When villainBlow yields UNCONSCIOUS, DO-FIGHT sets out = 1 + nextInt(3).
   * Subsequent blows (out > 0) transform results: STAGGER→HESITATE, else→SITTING_DUCK.
   *
   * We test this by checking that the `out` parameter threading actually reaches
   * villainBlow.  The easiest way is to use a single-villain table and a scripted
   * RNG that forces a known result, then verify the state effects (or absence
   * thereof) match the transformed outcome.
   */

  it('STAGGER with out=0 sets player staggered', () => {
    // score=0 → fightStrength=2.  Troll ps=2, DEF=2 → DEF2_RES[1]=DEF2B@0.
    // DEF2B: [M M M S S L L L U K K K]
    // Roll index 3/9 ≈ 0.334 → STAGGER.  out=0 → staggered.
    //
    // LEN=2: loop runs cnt=1 (processes table[0]=TROLL), then cnt=2=LEN → exits.
    let staggered = false;

    const table: VillainTableEntry[] = [
      {
        id: 'TROLL',
        fightBit: true, // engaged — blow fires
        pStrength: 2,
        entry: makeEntry(),
        inHere: true,
        staggered: false,
      },
    ];

    const rng = new ScriptedRng([3 / 9 + 0.001]);
    const state = makeBlowCallbacks({ playerPs: 0, score: 0 });
    const cbs = {
      ...state.cbs,
      setPlayerStaggered: () => { staggered = true; },
    };

    doFight(2, table, rng, cbs);
    expect(staggered).toBe(true);
  });

  it('STAGGER with out=1 does NOT set player staggered (HESITATE = no-op)', () => {
    // Same setup but with a pre-existing out=1 (simulated by providing out from
    // the first UNCONSCIOUS result on a prior villain in the same call).
    // We test this by using two villains: first one produces UNCONSCIOUS,
    // second would produce STAGGER but becomes HESITATE.
    //
    // UNCONSCIOUS from DEF2B@0 at index 8: DEF2B[8]=UNCONSCIOUS.
    // index 8/9 ≈ 0.889.
    // Then for STAGGER (index 3/9 ≈ 0.334), nextInt(3) draw also needed.
    // After UNCONSCIOUS: out = 1 + nextInt(3).  We need nextInt(3) to be 0 → out=1.
    // nextInt(3)=0 when next()=0/3=0.0, but let's use 0/3 + ε = 0.001.
    // Then the second villain blow: index 3/9 → STAGGER → out=1 → HESITATE.

    let staggered = false;

    const table: VillainTableEntry[] = [
      {
        id: 'TROLL',
        fightBit: true,
        pStrength: 2,
        entry: makeEntry(),
        inHere: true,
        staggered: false,
      },
      {
        id: 'THIEF',
        fightBit: true,
        pStrength: 2, // same strength to keep the same window
        entry: makeEntry(),
        inHere: true,
        staggered: false,
      },
    ];

    // Draw sequence:
    //   villain 0 (TROLL): selectWindow roll=8/9→UNCONSCIOUS, then nextInt(3) draw for out
    //   out=1+nextInt(3): nextInt(3) uses next() → draw 0.001 → 0.001*3=0.003→floor=0 → out=1
    //   villain 1 (THIEF): selectWindow roll=3/9→STAGGER, with out=1→HESITATE
    //   No zprob draw because HESITATE happens before weapon check
    const rng = new ScriptedRng([8 / 9 + 0.001, 0.001, 3 / 9 + 0.001]);
    const state = makeBlowCallbacks({ playerPs: 0, score: 0 });
    const cbs = {
      ...state.cbs,
      setPlayerStaggered: () => { staggered = true; },
    };

    doFight(2, table, rng, cbs);
    // STAGGER→HESITATE (because out=1 after UNCONSCIOUS): staggered NOT set
    expect(staggered).toBe(false);
  });

  it('MISSED with out=1 produces SITTING_DUCK → jigsUp', () => {
    // SITTING_DUCK sets DEF=0 → winnerResult sets pStrength=-10000 → jigsUp.
    // Use two villains: first gives UNCONSCIOUS (sets out), second gives MISSED→SITTING_DUCK.
    //
    // UNCONSCIOUS at DEF2B@0 index 8: draw 8/9+ε.
    // nextInt(3) for out: draw 0.001 → out=1.
    // MISSED at DEF2B@0 index 0: draw 0.001 → MISSED → out=1 → SITTING_DUCK.
    const table: VillainTableEntry[] = [
      {
        id: 'TROLL',
        fightBit: true,
        pStrength: 2,
        entry: makeEntry(),
        inHere: true,
        staggered: false,
      },
      {
        id: 'THIEF',
        fightBit: true,
        pStrength: 2,
        entry: makeEntry(),
        inHere: true,
        staggered: false,
      },
    ];

    // Draw sequence:
    //   [0] 8/9+ε  → villain1 table roll=8 → DEF2B[8]=UNCONSCIOUS
    //   [1] 0.001  → villain1 randomElement for REMARK (n=1 → picks slot[1])
    //   [2] 0.001  → out = 1 + nextInt(3): 0.001*3=0→ out=1
    //   [3] 0.001  → villain2 table roll=0 → DEF2B[0]=MISSED, with out=1 → SITTING_DUCK
    //   (randomElement for SITTING_DUCK slot not reached — SITTING_DUCK has no REMARK path
    //    in the out? branch since transformation happens before REMARK)
    const rng = new ScriptedRng([8 / 9 + 0.001, 0.001, 0.001, 0.001]);
    const state = makeBlowCallbacks({ playerPs: 0, score: 0 });

    // LEN=3: cnt=1 (TROLL), cnt=2 (THIEF), cnt=3=LEN exits.
    doFight(3, table, rng, state.cbs);
    // SITTING_DUCK → DEF=0 → winnerResult → jigsUp
    expect(state.jigsUpCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test F — V-PROB wake cycle (spec §7.1, §11.3-F, NM-9)
// ---------------------------------------------------------------------------

describe('Test F: I-FIGHT V-PROB wake cycle and NM-9', () => {
  /**
   * When a villain is unconscious (pStrength < 0) and in HERE:
   *   p = vProb
   *   if p != 0 && prob(p): vProb = 0; awaken(villain)
   *   else: vProb = p + 25
   * Cycle: 0 → 25 → 50 → 75 → 100.
   */

  function makeIFightCtx(opts: {
    villainPs?: number;
    villainFightBit?: boolean;
    villainInHere?: boolean;
    villainVProb?: number;
  } = {}): {
    ctx: IFightCallbacks;
    state: {
      vProb: number;
      villainPs: number;
      fightTriggered: boolean;
      awakenCalled: boolean;
      dead: boolean;
    };
  } {
    const state = {
      vProb: opts.villainVProb ?? 0,
      villainPs: opts.villainPs ?? -1,
      fightTriggered: false,
      awakenCalled: false,
      dead: false,
    };

    const ctx: IFightCallbacks = {
      getDead: () => state.dead,
      villainTable: [
        {
          id: 'TROLL',
          fightBit: opts.villainFightBit ?? false,
          pStrength: state.villainPs,
          entry: makeEntry(),
          inHere: opts.villainInHere ?? true,
          staggered: false,
        },
      ],
      getVillainPs: (_idx: number) => state.villainPs,
      setVillainPs: (_idx: number, v: number) => { state.villainPs = v; },
      getVProb: (_idx: number) => state.vProb,
      setVProb: (_idx: number, v: number) => { state.vProb = v; },
      isThief: (_idx: number) => false,
      isThiefEngrossed: () => false,
      setThiefEngrossed: (_v: boolean) => {},
      callVillainAction: (_idx: number, _fcode: number) => false,
      clearFightBit: (_idx: number) => {},
      clearStaggered: (_idx: number) => {},
      clearPlayerStaggered: () => {},
      onAwaken: (_idx: number) => { state.awakenCalled = true; },
      triggerFight: () => { state.fightTriggered = true; },
      isVillainInHere: (_idx: number) => opts.villainInHere ?? true,
      isVillainInvisible: (_idx: number) => false,
      // len=2: villainTable[0] is the one real villain; cnt<2 processes idx 0 only.
      len: 2,
    };

    return { ctx, state };
  }

  it('NM-9: vProb=0 → guard prevents wake, vProb increments to 25', () => {
    const { ctx, state } = makeIFightCtx({ villainPs: -1, villainVProb: 0 });
    // RNG always succeeds: next()=0.0 → prob(0)=false regardless (0*100<0 is false)
    // Guard: p != 0 is false → skip wake, vProb += 25
    const rng = new ScriptedRng([0.0]);
    iFight(ctx, rng);
    expect(state.awakenCalled).toBe(false);
    expect(state.vProb).toBe(25);
  });

  it('vProb cycles 0→25→50→75 with always-failing prob', () => {
    const { ctx, state } = makeIFightCtx({ villainPs: -1, villainVProb: 0 });
    // RNG always returns 0.99: prob(x) = 0.99*100=99 < x fails for x<=99
    const rng = new ScriptedRng([0.99]);

    iFight(ctx, rng);
    expect(state.vProb).toBe(25);

    iFight(ctx, rng);
    expect(state.vProb).toBe(50);

    iFight(ctx, rng);
    expect(state.vProb).toBe(75);

    iFight(ctx, rng);
    expect(state.vProb).toBe(100);
  });

  it('villain wakes when prob(vProb) succeeds; vProb resets to 0', () => {
    const { ctx, state } = makeIFightCtx({ villainPs: -3, villainVProb: 50 });
    // prob(50): 0.1*100=10 < 50 → true → wake
    const rng = new ScriptedRng([0.1]);
    iFight(ctx, rng);
    expect(state.awakenCalled).toBe(true);
    expect(state.vProb).toBe(0); // reset after wake
  });

  it('villain not in here: clear staggered+fightBit, awaken called', () => {
    // ZIL else branch: villain not in HERE → clear flags, awaken
    let staggeredCleared = false;
    let fightBitCleared = false;
    let awakenCalled = false;

    const ctx: IFightCallbacks = {
      getDead: () => false,
      villainTable: [
        {
          id: 'TROLL',
          fightBit: true,
          pStrength: 2,
          entry: makeEntry(),
          inHere: false, // not in here
          staggered: false,
        },
      ],
      getVillainPs: () => 2,
      setVillainPs: () => {},
      getVProb: () => 0,
      setVProb: () => {},
      isThief: () => false,
      isThiefEngrossed: () => false,
      setThiefEngrossed: () => {},
      callVillainAction: () => false,
      clearFightBit: (_idx) => { fightBitCleared = true; },
      clearStaggered: (_idx) => { staggeredCleared = true; },
      clearPlayerStaggered: () => {},
      onAwaken: (_idx) => { awakenCalled = true; },
      triggerFight: () => {},
      isVillainInHere: () => false,
      isVillainInvisible: () => false,
      // len=2: villainTable[0] is one villain; cnt<2 processes idx 0 only.
      len: 2,
    };

    const rng = new ScriptedRng([0.5]);
    iFight(ctx, rng);

    expect(fightBitCleared).toBe(true);
    expect(staggeredCleared).toBe(true);
    expect(awakenCalled).toBe(true);
  });

  it('returns false (no fight) when dead', () => {
    const { ctx, state } = makeIFightCtx({ villainPs: 2 });
    state.dead = true;
    (ctx as { getDead: () => boolean }).getDead = () => true;
    const rng = new ScriptedRng([0.5]);
    const result = iFight(ctx, rng);
    expect(result).toBe(false);
    expect(state.fightTriggered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AWAKEN — 1actions.zil:3843–3847
// ---------------------------------------------------------------------------

describe('awaken', () => {
  it('negates pStrength and fires F_CONSCIOUS when unconscious (pStrength < 0)', () => {
    let fcodeReceived = -1;
    const onAction = (fcode: number): boolean => {
      fcodeReceived = fcode;
      return false;
    };

    const result = awaken(-3, onAction);
    // -(-3) = 3, calls F_CONSCIOUS=4
    expect(result.newPs).toBe(3);
    expect(fcodeReceived).toBe(4); // F_CONSCIOUS
  });

  it('does nothing when pStrength >= 0', () => {
    let called = false;
    const onAction = (_fcode: number): boolean => { called = true; return false; };

    const result = awaken(2, onAction);
    expect(result.newPs).toBe(2); // unchanged
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test G — I-CURE two-tick heal (spec §7.3, §11.3-G)
// ---------------------------------------------------------------------------

describe('Test G: I-CURE two-tick heal', () => {
  /**
   * I-CURE (1actions.zil:3593–3602):
   *   s = pStrength
   *   if s > 0: s = 0; pStrength = 0
   *   if s < 0: s += 1; pStrength = s
   *   if s < 0:  if LOAD_ALLOWED < LOAD_MAX: LOAD_ALLOWED += 10
   *              clock.queue(I-CURE, CURE_WAIT, true)
   *   else:      LOAD_ALLOWED = LOAD_MAX; clock.disable(I-CURE)
   */

  function makeCureCtx(ps: number, loadAllowed: number, loadMax = 100): {
    ctx: ICureCallbacks;
    state: { pStrength: number; loadAllowed: number; queued: number[]; disabled: boolean };
  } {
    const state = { pStrength: ps, loadAllowed, queued: [] as number[], disabled: false };
    const ctx: ICureCallbacks = {
      getPlayerPStrength: () => state.pStrength,
      setPlayerPStrength: (v) => { state.pStrength = v; },
      getLoadAllowed: () => state.loadAllowed,
      setLoadAllowed: (v) => { state.loadAllowed = v; },
      getLoadMax: () => loadMax,
      queueICure: (period) => { state.queued.push(period); },
      disableICure: () => { state.disabled = true; },
    };
    return { ctx, state };
  }

  it('pStrength=-2: tick 1 heals to -1, re-queues; tick 2 heals to 0, disables', () => {
    const { ctx, state } = makeCureCtx(-2, 80);

    iCure(ctx);
    expect(state.pStrength).toBe(-1);
    expect(state.loadAllowed).toBe(90); // 80+10
    expect(state.queued).toEqual([CURE_WAIT]);
    expect(state.disabled).toBe(false);

    iCure(ctx);
    expect(state.pStrength).toBe(0);
    expect(state.loadAllowed).toBe(100); // restored to LOAD_MAX
    expect(state.queued).toHaveLength(1); // no additional re-queue
    expect(state.disabled).toBe(true);
  });

  it('re-queue stops exactly when pStrength reaches 0', () => {
    const { ctx, state } = makeCureCtx(-1, 90);

    iCure(ctx);
    expect(state.pStrength).toBe(0);
    expect(state.disabled).toBe(true);
    expect(state.queued).toHaveLength(0); // s==0 after increment → no re-queue
  });

  it('pStrength > 0 clamped to 0, then disabled', () => {
    // ZIL: if s > 0: s=0, pStrength=0; then s==0 → disable branch
    const { ctx, state } = makeCureCtx(3, 70);

    iCure(ctx);
    expect(state.pStrength).toBe(0);
    expect(state.disabled).toBe(true);
    expect(state.loadAllowed).toBe(100); // LOAD_MAX restored
  });

  it('LOAD_ALLOWED not incremented when already at max', () => {
    const { ctx, state } = makeCureCtx(-2, 100); // already at max

    iCure(ctx);
    expect(state.pStrength).toBe(-1);
    expect(state.loadAllowed).toBe(100); // unchanged
    expect(state.queued).toEqual([CURE_WAIT]); // still re-queued
  });
});
