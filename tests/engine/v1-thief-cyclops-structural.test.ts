/**
 * V1 — Thief/cyclops structural suite (phase-3-thief-cyclops §8 Wave 5, V1)
 *
 * Done-criteria:
 *   - TS-K  Feed puzzle: explicit structural labels (§7.2 TS-K)
 *   - NM-10 Activation-layer re-assertion: flee IS present in I-THIEF
 *     (thiefVsAdventurer), NOT anywhere in the combat engine functions.
 *     The dual assertion closes the invariant: flee exists exactly once,
 *     only via I-THIEF.
 *
 * Coverage manifest — where each TS test lives:
 *   TS-A  wander bounds                 tests/engine/t2-i-thief-demon.test.ts
 *   TS-B  rob/stealJunk structural       tests/engine/t1-booty-helpers.test.ts
 *   TS-C  dropJunk structural            tests/engine/t1-booty-helpers.test.ts
 *   TS-D  depositBooty + egg-solve       tests/engine/t1-booty-helpers.test.ts
 *   TS-E  encounter tree                 tests/engine/t2-i-thief-demon.test.ts
 *   TS-F  WINNING? flee probability      tests/engine/t1-booty-helpers.test.ts
 *   TS-G  treasure-room defense          tests/engine/t4-treasure-room.test.ts
 *   TS-H  ROBBER F-codes                 tests/engine/t3-robber-function.test.ts
 *   TS-I  THIEF-ENGROSSED set-on-give    tests/engine/t3-robber-function.test.ts
 *   TS-J  cyclops wrath escalation       tests/engine/c2-i-cyclops-demon.test.ts
 *   TS-K  feed puzzle (this file)
 *   TS-L  demon iteration order          tests/engine/i1-ts-l-demon-order.test.ts
 *
 * ZIL citations:
 *   CYCLOPS-FCN feed path   1actions.zil:1544–1575
 *   THIEF-VS-ADVENTURER     1actions.zil:1764–1873  (flee branch :1785–1795)
 *   WINNING?                1actions.zil:3584–3591
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Flag } from '../../src/domain/flags.js';
import {
  cyclopsFcn,
  type CyclopsCtx,
} from '../../src/actions/cyclops.js';
import {
  thiefVsAdventurer,
  type IThiefCtx,
} from '../../src/actions/i-thief.js';
import {
  resetThiefState,
} from '../../src/actions/thief-state.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

interface StubObj {
  id: string;
  parentId: string | null;
  flags: Set<Flag>;
}

function makeObj(id: string, parent: string | null, flags: Flag[] = []): StubObj {
  return { id, parentId: parent, flags: new Set(flags) };
}

// CyclopsCtx minimal factory — mirrors the approach in c1-cyclops-fcn.test.ts.
function makeCyclopsCtx(opts: {
  verb?: string;
  action?: string;
  prsoId?: string;
  prsiId?: string;
  objs?: StubObj[];
  cyclopsFlag?: boolean;
  cyclowrath?: number;
  hereId?: string;
} = {}): { ctx: CyclopsCtx; output: string[]; clockCalls: { enable: string[]; disable: string[] } } {
  const hereId = opts.hereId ?? 'CYCLOPS-ROOM';
  const objs = new Map<string, StubObj>();
  for (const o of opts.objs ?? []) objs.set(o.id, o);

  const output: string[] = [];
  const clockCalls = { enable: [] as string[], disable: [] as string[] };

  let cyclopsFlag = opts.cyclopsFlag ?? false;
  let _cyclowrath = opts.cyclowrath ?? 0;

  const verbMap: Record<string, string> = {
    give: 'V-GIVE', examine: 'V-EXAMINE', kick: 'V-KICK', attack: 'V-ATTACK',
  };
  const verbWord = opts.verb ?? 'examine';
  const action = opts.action ?? (verbMap[verbWord] ?? verbWord.toUpperCase());

  const ctx: CyclopsCtx = {
    hereId,
    action,
    verb: verbWord,
    prsoId: opts.prsoId,
    prsiId: opts.prsiId,
    rarg: undefined,
    winner: 'ADVENTURER',

    getCyclopsFlag: () => cyclopsFlag,
    setCyclopsFlag: (v) => { cyclopsFlag = v; },
    getMagicFlag: () => false,
    getCyclowrath: () => _cyclowrath,
    setCyclowrath: (v) => { _cyclowrath = v; },

    getObj: (id) => {
      const o = objs.get(id);
      if (o === undefined) return undefined;
      return {
        id: o.id,
        parentId: o.parentId,
        hasFlag: (f) => o.flags.has(f),
        setFlag: (f) => o.flags.add(f),
        clearFlag: (f) => o.flags.delete(f),
        moveTo: (destId) => { o.parentId = destId; },
        removeFromWorld: () => { o.parentId = null; },
      };
    },

    tell: (s) => output.push(s),
    enableClock: (id) => clockCalls.enable.push(id),
    disableClock: (id) => clockCalls.disable.push(id),
  };

  return { ctx, output, clockCalls };
}

// IThiefCtx minimal factory — only what the flee branch needs.
function makeThiefCtx(opts: {
  hereId?: string;
  fightBit?: boolean;
  isWinning?: boolean;
  stilettoInThief?: boolean;
  rngDraws?: readonly number[];
}): {
  ctx: IThiefCtx;
  emitted: string[];
  thiefState: { invisible: boolean; fightBit: boolean };
  stilettoRecovered: boolean;
} {
  const hereId = opts.hereId ?? 'SOME-ROOM';
  const emitted: string[] = [];
  let invisible = true;
  let fightBit = opts.fightBit ?? false;
  let stilettoRecovered = false;
  const rng = new ScriptedRng(opts.rngDraws ?? [0.5]);

  const ctx: IThiefCtx = {
    hereId,
    getThiefRoomId: () => hereId,
    isDead: () => false,

    isThiefInvisible: () => invisible,
    setThiefInvisible: () => { invisible = true; },
    clearThiefInvisible: () => { invisible = false; },
    isThiefFightBit: () => fightBit,
    clearThiefFightBit: () => { fightBit = false; },

    isRoomLit: () => false,
    isTrollInHere: () => false,
    isTreasureRoom: (id) => id === 'TREASURE-ROOM',
    moveThiefTo: () => {},
    getRooms: () => [hereId],
    isRoomSacred: () => false,
    isRoomLand: () => true,
    isRoomTouched: () => false,
    isRoomMaze: () => false,

    rng,
    getLucky: () => true,

    getObj: () => undefined,
    childrenOf: () => [],
    tell: (s) => { emitted.push(s); },

    hackTreasures: () => {},
    depositBooty: () => false,
    rob: () => false,
    robMaze: () => false,
    stealJunk: () => false,
    dropJunk: () => {},
    recoverStiletto: () => { stilettoRecovered = true; },
    stoleLight: () => true,

    getThiefPStrength: () => 5,
    fightStrength: () => 2,
    isWinning: () => opts.isWinning ?? false,
  };

  return {
    ctx,
    emitted,
    thiefState: {
      get invisible() { return invisible; },
      get fightBit() { return fightBit; },
    },
    get stilettoRecovered() { return stilettoRecovered; },
  };
}

// ---------------------------------------------------------------------------
// TS-K — Feed puzzle structural suite (1actions.zil:1544–1575)
//
// Spec §7.2 TS-K:
//   lunch (rage≥0) → CYCLOWRATH negative + I-CYCLOPS enabled
//   water (rage<0) → CYCLOPS-FLAG true + FIGHTBIT cleared
//   water when not thirsty (rage≥0) → refusal
//   wake-from-sleep restores FIGHTBIT + magnitude
// ---------------------------------------------------------------------------

describe('TS-K: feed puzzle — lunch (rage≥0) → CYCLOWRATH negative, I-CYCLOPS enabled', () => {
  it('give LUNCH when CYCLOWRATH==0: eats, CYCLOWRATH = min(-1, 0) = -1', () => {
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const { ctx, output, clockCalls } = makeCyclopsCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: 0, objs: [lunch],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('hot peppers');
    expect(ctx.getCyclowrath()).toBe(-1);
    expect(clockCalls.enable).toContain('I-CYCLOPS');
    // LUNCH consumed
    expect(lunch.parentId).toBeNull();
  });

  it('give LUNCH when CYCLOWRATH==3: eats, CYCLOWRATH = min(-1, -3) = -3', () => {
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const { ctx, output, clockCalls } = makeCyclopsCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: 3, objs: [lunch],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('hot peppers');
    expect(ctx.getCyclowrath()).toBe(-3);
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  it('give LUNCH when already thirsty (CYCLOWRATH < 0): does NOT eat, I-CYCLOPS still enabled', () => {
    // ZIL: only eats when count >= 0 (NOT (L? .COUNT 0))
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const { ctx, output, clockCalls } = makeCyclopsCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: -2, objs: [lunch],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).not.toContain('hot peppers');
    expect(clockCalls.enable).toContain('I-CYCLOPS');
    expect(lunch.parentId).not.toBeNull();   // not consumed
  });
});

describe('TS-K: feed puzzle — water (rage<0) → CYCLOPS-FLAG set, FIGHTBIT cleared', () => {
  it('give WATER when thirsty (CYCLOWRATH<0): cyclops sleeps, CYCLOPS-FLAG set', () => {
    const water = makeObj('WATER', 'ADVENTURER');
    const bottle = makeObj('BOTTLE', 'SOME-ROOM');
    const { ctx, output } = makeCyclopsCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: -1, objs: [water, bottle],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('falls fast asleep');
    expect(ctx.getCyclopsFlag()).toBe(true);
    expect(water.parentId).toBeNull();          // REMOVE-CAREFULLY WATER
    expect(bottle.flags.has(Flag.Open)).toBe(true); // FSET BOTTLE OPENBIT
  });

  it('give WATER when thirsty: clears FIGHTBIT on cyclops', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM', [Flag.Fight]);
    const water = makeObj('WATER', 'ADVENTURER');
    const bottle = makeObj('BOTTLE', 'CYCLOPS-ROOM');
    const { ctx } = makeCyclopsCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: -1, objs: [cyclops, water, bottle],
    });

    cyclopsFcn(ctx);
    expect(cyclops.flags.has(Flag.Fight)).toBe(false);  // FCLEAR FIGHTBIT
    expect(ctx.getCyclopsFlag()).toBe(true);
  });

  it('give WATER when NOT thirsty (CYCLOWRATH >= 0): refuses', () => {
    const water = makeObj('WATER', 'ADVENTURER');
    const { ctx, output } = makeCyclopsCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: 0, objs: [water],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('not thirsty');
    expect(ctx.getCyclopsFlag()).toBe(false);
  });
});

describe('TS-K: feed puzzle — wake-from-sleep restores FIGHTBIT + magnitude', () => {
  it('KICK sleeping (CYCLOWRATH < 0 from peppers): wakes, FIGHTBIT set, magnitude = -(-count)', () => {
    // ZIL: if COUNT < 0 → CYCLOWRATH = -COUNT
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCyclopsCtx({
      verb: 'kick', cyclopsFlag: true, cyclowrath: -3, objs: [cyclops],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
    expect(cyclops.flags.has(Flag.Fight)).toBe(true);   // FIGHTBIT restored
    expect(ctx.getCyclowrath()).toBe(3);                 // magnitude = -(-3) = 3
  });

  it('KICK sleeping (CYCLOWRATH >= 0 from prior attack): wakes, FIGHTBIT set, magnitude preserved', () => {
    // ZIL: if COUNT >= 0 → CYCLOWRATH = COUNT (no negation)
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCyclopsCtx({
      verb: 'kick', cyclopsFlag: true, cyclowrath: 2, objs: [cyclops],
    });

    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
    expect(cyclops.flags.has(Flag.Fight)).toBe(true);
    expect(ctx.getCyclowrath()).toBe(2);                 // magnitude unchanged
  });

  it('complete closed loop: lunch → thirsty → water → sleep → kick → awake', () => {
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const water = makeObj('WATER', 'ADVENTURER');
    const bottle = makeObj('BOTTLE', 'CYCLOPS-ROOM');
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');

    // Step 1: give lunch (CYCLOWRATH=0 → -1, thirsty)
    const { ctx: ctx1 } = makeCyclopsCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: 0, objs: [lunch, water, bottle, cyclops],
    });
    cyclopsFcn(ctx1);
    expect(ctx1.getCyclowrath()).toBe(-1);

    // Step 2: give water (CYCLOWRATH < 0 → sleeps, FLAG set)
    const { ctx: ctx2 } = makeCyclopsCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: -1, objs: [lunch, water, bottle, cyclops],
      cyclopsFlag: false,
    });
    cyclopsFcn(ctx2);
    expect(ctx2.getCyclopsFlag()).toBe(true);

    // Step 3: kick sleeping (FLAG=true, count=-1 → wakes, CYCLOWRATH=1, FIGHTBIT set)
    const { ctx: ctx3 } = makeCyclopsCtx({
      verb: 'kick', cyclopsFlag: true, cyclowrath: -1, objs: [cyclops],
    });
    cyclopsFcn(ctx3);
    expect(ctx3.getCyclopsFlag()).toBe(false);
    expect(ctx3.getCyclowrath()).toBe(1);     // -(-1) = 1
    expect(cyclops.flags.has(Flag.Fight)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NM-10 activation-layer re-assertion
//
// Spec §7.2 TS-L note + §8 V1 done-criteria:
//   "add a thief-flee-only-in-I-THIEF guard (NM-10 re-asserted at the
//    activation layer)"
//
// The dual invariant:
//   SIDE A (engine): doFight/iFight never call flee — asserted in
//     v1-nm-guard-suite.test.ts NM-10.
//   SIDE B (activation): thiefVsAdventurer IS the unique flee site in the
//     thief activation path; it fires INVISIBLE + FIGHTBIT-clear + stiletto
//     recovery exactly when isWinning()==false with FIGHTBIT set.
//
// Together: flee exists in exactly one place — the THIEF-VS-ADVENTURER branch
// inside I-THIEF.
// ---------------------------------------------------------------------------

describe('NM-10 activation-layer: flee IS present in thiefVsAdventurer, SIDE B', () => {
  beforeEach(() => { resetThiefState(); });

  it('flee branch fires when here? + FIGHTBIT + !isWinning: INVISIBLE set, FIGHTBIT cleared', () => {
    const { ctx, thiefState, emitted } = makeThiefCtx({
      fightBit: true,
      isWinning: false,
    });

    const result = thiefVsAdventurer(ctx, true /* here? = true */);

    expect(result).toBe(true);                       // flee terminates this tick
    expect(thiefState.invisible).toBe(true);          // FSET INVISIBLE
    expect(thiefState.fightBit).toBe(false);          // FCLEAR FIGHTBIT
    expect(emitted.some(m =>
      m.includes('discretion') || m.includes('disappears') || m.includes('valor'),
    )).toBe(true);
  });

  it('flee branch recovers stiletto when it fires', () => {
    const result = makeThiefCtx({ fightBit: true, isWinning: false });

    thiefVsAdventurer(result.ctx, true);

    expect(result.stilettoRecovered).toBe(true);      // RECOVER-STILETTO called
  });

  it('flee does NOT fire when isWinning()==true (thief stays to fight)', () => {
    // here? + FIGHTBIT + winning=true → branch 2c (prob(90) → stay or fight)
    const { ctx, thiefState } = makeThiefCtx({
      fightBit: true,
      isWinning: true,
      rngDraws: [0.05],  // prob(90): 0.05*100=5 < 90 → stay
    });

    thiefVsAdventurer(ctx, true);

    // FIGHTBIT must NOT be cleared (thief is still fighting)
    expect(thiefState.fightBit).toBe(true);
  });

  it('flee does NOT fire when FIGHTBIT is false (thief not in combat)', () => {
    // !FIGHTBIT → skip flee branch (2b skipped); prob(30) leave-empty-handed path
    const { ctx, thiefState, emitted } = makeThiefCtx({
      fightBit: false,
      isWinning: false,
      rngDraws: [0.1],   // prob(30) → leave empty-handed (not flee)
    });

    thiefVsAdventurer(ctx, true);

    // Invisible set (left room) but FIGHTBIT was never set, so clearFightBit not called
    expect(thiefState.fightBit).toBe(false);  // was false, still false
    // The "leave empty-handed" message, not the "discretion/valor" flee message
    expect(emitted.some(m => m.includes('large bag') || m.includes('just left'))).toBe(true);
    expect(emitted.some(m => m.includes('discretion') || m.includes('valor'))).toBe(false);
  });

  it('flee is NOT reachable when !here? (thief not in player room)', () => {
    // Branch 2 only runs flee (2b) when here?=true.
    // With here?=false + !THIEF-HERE, falls to the materialize/idle branches.
    const { ctx, thiefState } = makeThiefCtx({
      fightBit: true,
      isWinning: false,
      rngDraws: [0.9, 0.9],  // prob(30) fail + prob(70) fail → rob path (but no items)
    });

    thiefVsAdventurer(ctx, false /* here? = false */);

    // Flee branch never fired: FIGHTBIT should remain set (not cleared by flee)
    expect(thiefState.fightBit).toBe(true);
  });
});
