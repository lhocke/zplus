/**
 * T1 — Booty/steal helpers (phase-3-thief-cyclops §8 Wave 1)
 *
 * Done-criteria:
 *   TS-B  rob/stealJunk structural: steal only TVALUE==0 TAKEBIT !SACRED items;
 *         rob only TVALUE>0 !INVISIBLE !SACRED items; stolen items go INVISIBLE into thief.
 *   TS-C  dropJunk: drops only TVALUE==0 items at zprob(30); never STILETTO/LARGE-BAG;
 *         clears INVISIBLE on drop.
 *   TS-D  depositBooty + egg-solve: egg deposited → EGG-SOLVE=true, OPENBIT set,
 *         egg NOT converted to BROKEN-EGG.
 *   TS-F  winningFlee: each PS rung (>3, >0, ==0, VS>1, else) forced true/false;
 *         flee branch is purely a probability function (NM-10: not wired into DO-FIGHT).
 *
 * Additional:
 *   STILETTO/LARGE-BAG skip-lists honored in dropJunk and depositBooty.
 *   Two-arg PROBs (stealJunk's zprob(10,T), dropJunk's zprob(30,T)) route through zprob.
 *   recoverStiletto: picks up stiletto from LOC(THIEF) into THIEF + sets NDESCBIT.
 *   hackTreasures: sets thief INVISIBLE, clears INVISIBLE on each TREASURE-ROOM child.
 *   moveAll: clears INVISIBLE and moves each child of `from` to `to`.
 *   stoleLight: returns true; emits darkness message when room just went dark.
 *   robMaze: first TAKEBIT !INVISIBLE child at PROB(40); zprob(60,80) → steal.
 *
 * ZIL citations (1actions.zil):
 *   ROB            :3976–3989
 *   ROB-MAZE       :1917–1933
 *   STEAL-JUNK     :3954–3974
 *   DROP-JUNK      :3933–3947
 *   DEPOSIT-BOOTY  :1897–1909
 *   HACK-TREASURES :1888–1895
 *   RECOVER-STILETTO :3949–3952
 *   MOVE-ALL       :2114–2121
 *   STOLE-LIGHT?   :1875–1880
 *   WINNING?       :3584–3591
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  rob,
  robMaze,
  stealJunk,
  dropJunk,
  depositBooty,
  hackTreasures,
  recoverStiletto,
  moveAll,
  stoleLight,
  winning,
  type ThiefCtx,
} from '../../src/actions/thief.js';
import { Flag } from '../../src/domain/flags.js';
import {
  eggSolve, resetThiefState,
} from '../../src/actions/thief-state.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// Minimal stub object for items/containers
// ---------------------------------------------------------------------------

interface StubItem {
  id: string;
  desc: string;
  parentId: string | null;
  flags: Set<Flag>;
  tvalue: number;
  children: StubItem[];
}

function makeItem(
  id: string,
  parentId: string | null,
  opts: {
    tvalue?: number;
    flags?: Flag[];
    children?: StubItem[];
    desc?: string;
  } = {},
): StubItem {
  return {
    id,
    desc: opts.desc ?? id.toLowerCase().replace(/-/g, ' '),
    parentId,
    flags: new Set(opts.flags ?? []),
    tvalue: opts.tvalue ?? 0,
    children: opts.children ?? [],
  };
}

// ---------------------------------------------------------------------------
// ThiefCtx stub factory
// ---------------------------------------------------------------------------

/** Build a ThiefCtx from a flat list of items, all initially at some location. */
function makeCtx(opts: {
  items?: StubItem[];
  hereId?: string;
  litBefore?: boolean;
  litAfter?: boolean;
  rngDraws?: readonly number[];
  lucky?: boolean;
  thiefStrength?: number;
  playerStrength?: number;
  score?: number;
}): {
  ctx: ThiefCtx;
  emitted: string[];
  objMap: Map<string, StubItem>;
} {
  const { items = [], hereId = 'HERE', rngDraws = [0.5], lucky = true } = opts;
  const emitted: string[] = [];
  const objMap = new Map<string, StubItem>();
  for (const item of items) {
    objMap.set(item.id, item);
  }

  const litBefore = opts.litBefore ?? true;
  let litNow = litBefore;

  const rng = new ScriptedRng(rngDraws);

  const ctx: ThiefCtx = {
    hereId,
    rng,
    getLucky: () => lucky,

    getObj: (id: string) => {
      const item = objMap.get(id);
      if (!item) return undefined;
      return {
        id: item.id,
        desc: item.desc,
        parentId: item.parentId,
        tvalue: item.tvalue,
        hasFlag: (f: Flag) => item.flags.has(f),
        setFlag: (f: Flag) => { item.flags.add(f); },
        clearFlag: (f: Flag) => { item.flags.delete(f); },
        moveTo: (destId: string) => {
          const old = objMap.get(item.parentId ?? '');
          if (old) old.children = old.children.filter(c => c.id !== item.id);
          item.parentId = destId;
          const dest = objMap.get(destId);
          if (dest) dest.children.push(item);
        },
      };
    },

    childrenOf: (containerId: string): string[] => {
      const c = objMap.get(containerId);
      return (c?.children ?? []).map(x => x.id);
    },

    isRoomLit: () => {
      if (opts.litAfter !== undefined) return opts.litAfter;
      return litNow;
    },

    getPrevLit: () => litBefore,

    tell: (s: string) => { emitted.push(s); },

    getThiefStrength: () => opts.thiefStrength ?? 5,
    getScore: () => opts.score ?? 0,
    fightStrength: () => {
      const base = 2 + Math.floor((opts.score ?? 0) / 70);
      return base + (opts.playerStrength ?? 0);
    },
  };

  return { ctx, emitted, objMap };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TS-B: ROB — takes only TVALUE>0 !INVISIBLE !SACRED items
// ---------------------------------------------------------------------------

describe('TS-B: rob()', () => {
  beforeEach(() => { resetThiefState(); });

  it('takes a treasure item (TVALUE>0) from a container into the thief', () => {
    const gem = makeItem('GEM', 'CHEST', { tvalue: 5, flags: [Flag.Takeable] });
    const chest = makeItem('CHEST', 'HERE', { children: [gem] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Invisible, Flag.Actor] });
    const { ctx } = makeCtx({ items: [gem, chest, thief], rngDraws: [0.0] });

    const result = rob(ctx, 'CHEST', 'THIEF');
    expect(result).toBe(true);
    expect(gem.parentId).toBe('THIEF');
    expect(gem.flags.has(Flag.Invisible)).toBe(true);
    expect(gem.flags.has(Flag.Touched)).toBe(true);
  });

  it('skips INVISIBLE items', () => {
    const gem = makeItem('GEM', 'CHEST', { tvalue: 5, flags: [Flag.Takeable, Flag.Invisible] });
    const chest = makeItem('CHEST', 'HERE', { children: [gem] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    const { ctx } = makeCtx({ items: [gem, chest, thief] });

    const result = rob(ctx, 'CHEST', 'THIEF');
    expect(result).toBe(false);
    expect(gem.parentId).toBe('CHEST');
  });

  it('skips SACRED items', () => {
    const gem = makeItem('GEM', 'CHEST', { tvalue: 5, flags: [Flag.Takeable, Flag.Sacred] });
    const chest = makeItem('CHEST', 'HERE', { children: [gem] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    const { ctx } = makeCtx({ items: [gem, chest, thief] });

    const result = rob(ctx, 'CHEST', 'THIEF');
    expect(result).toBe(false);
    expect(gem.parentId).toBe('CHEST');
  });

  it('skips items with TVALUE==0', () => {
    const junk = makeItem('JUNK', 'CHEST', { tvalue: 0, flags: [Flag.Takeable] });
    const chest = makeItem('CHEST', 'HERE', { children: [junk] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    const { ctx } = makeCtx({ items: [junk, chest, thief] });

    const result = rob(ctx, 'CHEST', 'THIEF');
    expect(result).toBe(false);
  });

  it('with prob=75: respects probability gate — force fail', () => {
    const gem = makeItem('GEM', 'CHEST', { tvalue: 3, flags: [Flag.Takeable] });
    const chest = makeItem('CHEST', 'HERE', { children: [gem] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    // draw 0.9 → 0.9*100=90 >= 75 → false (miss)
    const { ctx } = makeCtx({ items: [gem, chest, thief], rngDraws: [0.9] });

    const result = rob(ctx, 'CHEST', 'THIEF', 75);
    expect(result).toBe(false);
    expect(gem.parentId).toBe('CHEST');
  });

  it('with prob=75: force success', () => {
    const gem = makeItem('GEM', 'CHEST', { tvalue: 3, flags: [Flag.Takeable] });
    const chest = makeItem('CHEST', 'HERE', { children: [gem] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    // draw 0.1 → 0.1*100=10 < 75 → true
    const { ctx } = makeCtx({ items: [gem, chest, thief], rngDraws: [0.1] });

    const result = rob(ctx, 'CHEST', 'THIEF', 75);
    expect(result).toBe(true);
    expect(gem.parentId).toBe('THIEF');
  });

  it('robbing into non-THIEF dest does NOT set INVISIBLE', () => {
    // rob to a non-thief location (e.g. LAND-OF-LIVING-DEAD after death)
    const gem = makeItem('GEM', 'HERE', { tvalue: 3, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [gem] });
    const dest = makeItem('LIMBO', null);
    const { ctx } = makeCtx({ items: [gem, here, dest] });

    const result = rob(ctx, 'HERE', 'LIMBO');
    expect(result).toBe(true);
    expect(gem.parentId).toBe('LIMBO');
    expect(gem.flags.has(Flag.Invisible)).toBe(false);  // not moved to THIEF
    expect(gem.flags.has(Flag.Touched)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TS-B: STEAL-JUNK — takes only TVALUE==0 TAKEBIT !SACRED !INVISIBLE items
// ---------------------------------------------------------------------------

describe('TS-B: stealJunk()', () => {
  beforeEach(() => { resetThiefState(); });

  it('steals a junk item (TVALUE==0 TAKEBIT) via the stiletto shortcut', () => {
    // STILETTO always stolen (no prob gate): OR condition in ZIL :3963
    const stiletto = makeItem('STILETTO', 'HERE', { tvalue: 0, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [stiletto] });
    const thief = makeItem('THIEF', null, { flags: [Flag.Actor] });
    // We don't need a forced rng since stiletto bypasses the prob check
    const { ctx } = makeCtx({ items: [stiletto, here, thief], hereId: 'HERE' });

    stealJunk(ctx, 'HERE');
    expect(stiletto.parentId).toBe('THIEF');
    expect(stiletto.flags.has(Flag.Touched)).toBe(true);
    expect(stiletto.flags.has(Flag.Invisible)).toBe(true);
  });

  it('steals non-stiletto junk at zprob(10) gate (force true)', () => {
    const knife = makeItem('KNIFE', 'HERE', { tvalue: 0, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [knife] });
    const thief = makeItem('THIEF', null, { flags: [Flag.Actor] });
    // zprob(10, 100) = 0.05*100=5 < 10 → true (lucky denom=100)
    const { ctx } = makeCtx({ items: [knife, here, thief], hereId: 'HERE', rngDraws: [0.05], lucky: true });

    stealJunk(ctx, 'HERE');
    expect(knife.parentId).toBe('THIEF');
    expect(knife.flags.has(Flag.Invisible)).toBe(true);
  });

  it('leaves non-stiletto junk when zprob(10) fails', () => {
    const knife = makeItem('KNIFE', 'HERE', { tvalue: 0, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [knife] });
    const thief = makeItem('THIEF', null, { flags: [Flag.Actor] });
    // zprob(10, 100) = 0.9*100=90 >= 10 → false
    const { ctx } = makeCtx({ items: [knife, here, thief], hereId: 'HERE', rngDraws: [0.9], lucky: true });

    stealJunk(ctx, 'HERE');
    expect(knife.parentId).toBe('HERE');
  });

  it('skips TVALUE>0 items (those are treasures)', () => {
    const gem = makeItem('GEM', 'HERE', { tvalue: 5, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [gem] });
    const thief = makeItem('THIEF', null);
    const { ctx } = makeCtx({ items: [gem, here, thief], rngDraws: [0.0] });

    stealJunk(ctx, 'HERE');
    expect(gem.parentId).toBe('HERE');
  });

  it('skips SACRED items', () => {
    const scroll = makeItem('SCROLL', 'HERE', { tvalue: 0, flags: [Flag.Takeable, Flag.Sacred] });
    const here = makeItem('HERE', null, { children: [scroll] });
    const thief = makeItem('THIEF', null);
    const { ctx } = makeCtx({ items: [scroll, here, thief], rngDraws: [0.0] });

    stealJunk(ctx, 'HERE');
    expect(scroll.parentId).toBe('HERE');
  });

  it('skips INVISIBLE items', () => {
    const junk = makeItem('JUNK', 'HERE', { tvalue: 0, flags: [Flag.Takeable, Flag.Invisible] });
    const here = makeItem('HERE', null, { children: [junk] });
    const thief = makeItem('THIEF', null);
    const { ctx } = makeCtx({ items: [junk, here, thief], rngDraws: [0.0] });

    stealJunk(ctx, 'HERE');
    expect(junk.parentId).toBe('HERE');
  });

  it('clears DOME-FLAG when ROPE is stolen (ZIL :3968)', () => {
    const rope = makeItem('ROPE', 'HERE', { tvalue: 0, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [rope] });
    const thief = makeItem('THIEF', null);
    let domeFlagCleared = false;
    const { ctx } = makeCtx({ items: [rope, here, thief], hereId: 'HERE', rngDraws: [0.0] });
    ctx.clearDomeFlag = () => { domeFlagCleared = true; };
    // ROPE stolen at zprob(10) with draw=0 → true; DOME-FLAG cleared
    stealJunk(ctx, 'HERE');
    expect(rope.parentId).toBe('THIEF');
    expect(domeFlagCleared).toBe(true);
  });

  it('announces vanish when stolen from HERE (player room)', () => {
    // STILETTO always stolen; announce "vanished" when room == HERE
    const stiletto = makeItem('STILETTO', 'HERE', { tvalue: 0, flags: [Flag.Takeable] });
    const here = makeItem('HERE', null, { children: [stiletto] });
    const thief = makeItem('THIEF', null);
    const { ctx, emitted } = makeCtx({ items: [stiletto, here, thief], hereId: 'HERE' });

    stealJunk(ctx, 'HERE');
    expect(emitted.some(m => m.includes('vanished') || m.includes('STILETTO'))).toBe(true);
  });

  it('does not announce when stolen from a non-player room', () => {
    const stiletto = makeItem('STILETTO', 'SOME-ROOM', { tvalue: 0, flags: [Flag.Takeable] });
    const room = makeItem('SOME-ROOM', null, { children: [stiletto] });
    const thief = makeItem('THIEF', null);
    // hereId is different from 'SOME-ROOM'
    const { ctx, emitted } = makeCtx({ items: [stiletto, room, thief], hereId: 'HERE' });

    stealJunk(ctx, 'SOME-ROOM');
    expect(emitted.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TS-C: DROP-JUNK — drops TVALUE==0 items at zprob(30,T); never STILETTO/LARGE-BAG
// ---------------------------------------------------------------------------

describe('TS-C: dropJunk()', () => {
  beforeEach(() => { resetThiefState(); });

  it('drops a junk item from thief into room at zprob(30) (force true)', () => {
    const knife = makeItem('KNIFE', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [knife] });
    const here = makeItem('HERE', null);
    // draw 0.1 → 0.1*100=10 < 30 → true (zprob lucky)
    const { ctx } = makeCtx({ items: [knife, thief, here], hereId: 'HERE', rngDraws: [0.1], lucky: true });

    dropJunk(ctx, 'HERE');
    expect(knife.parentId).toBe('HERE');
    expect(knife.flags.has(Flag.Invisible)).toBe(false);
  });

  it('does not drop when zprob(30) fails', () => {
    const knife = makeItem('KNIFE', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [knife] });
    const here = makeItem('HERE', null);
    // draw 0.9 → 0.9*100=90 >= 30 → false
    const { ctx } = makeCtx({ items: [knife, thief, here], hereId: 'HERE', rngDraws: [0.9], lucky: true });

    dropJunk(ctx, 'HERE');
    expect(knife.parentId).toBe('THIEF');
  });

  it('skips STILETTO (never dropped)', () => {
    const stiletto = makeItem('STILETTO', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [stiletto] });
    const here = makeItem('HERE', null);
    // Even with always-true rng, stiletto is never dropped
    const { ctx } = makeCtx({ items: [stiletto, thief, here], hereId: 'HERE', rngDraws: [0.0] });

    dropJunk(ctx, 'HERE');
    expect(stiletto.parentId).toBe('THIEF');
  });

  it('skips LARGE-BAG (never dropped)', () => {
    const bag = makeItem('LARGE-BAG', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [bag] });
    const here = makeItem('HERE', null);
    const { ctx } = makeCtx({ items: [bag, thief, here], hereId: 'HERE', rngDraws: [0.0] });

    dropJunk(ctx, 'HERE');
    expect(bag.parentId).toBe('THIEF');
  });

  it('skips TVALUE>0 items (valuables stay in thief)', () => {
    const gem = makeItem('GEM', 'THIEF', { tvalue: 5 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [gem] });
    const here = makeItem('HERE', null);
    const { ctx } = makeCtx({ items: [gem, thief, here], hereId: 'HERE', rngDraws: [0.0] });

    dropJunk(ctx, 'HERE');
    expect(gem.parentId).toBe('THIEF');
  });

  it('clears INVISIBLE when dropping', () => {
    const knife = makeItem('KNIFE', 'THIEF', { tvalue: 0, flags: [Flag.Invisible] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [knife] });
    const here = makeItem('HERE', null);
    const { ctx } = makeCtx({ items: [knife, thief, here], hereId: 'HERE', rngDraws: [0.1], lucky: true });

    dropJunk(ctx, 'HERE');
    expect(knife.parentId).toBe('HERE');
    expect(knife.flags.has(Flag.Invisible)).toBe(false);
  });

  it('announces "rummaging" on first drop into HERE', () => {
    const knife = makeItem('KNIFE', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [knife] });
    const here = makeItem('HERE', null);
    const { ctx, emitted } = makeCtx({ items: [knife, thief, here], hereId: 'HERE', rngDraws: [0.1], lucky: true });

    dropJunk(ctx, 'HERE');
    expect(emitted.some(m => m.includes('rummaging'))).toBe(true);
  });

  it('does not announce when dropping into a non-player room', () => {
    const knife = makeItem('KNIFE', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'OTHER', { flags: [Flag.Actor], children: [knife] });
    const other = makeItem('OTHER', null);
    const { ctx, emitted } = makeCtx({ items: [knife, thief, other], hereId: 'HERE', rngDraws: [0.1], lucky: true });

    dropJunk(ctx, 'OTHER');
    expect(emitted.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TS-D: DEPOSIT-BOOTY + egg-solve hook
// ---------------------------------------------------------------------------

describe('TS-D: depositBooty()', () => {
  beforeEach(() => { resetThiefState(); });

  it('moves treasures (TVALUE>0) from thief to destination', () => {
    const gem = makeItem('GEM', 'THIEF', { tvalue: 5 });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor], children: [gem] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [gem, thief, dest] });

    expect(depositBooty(ctx, 'TREASURE-ROOM')).toBe(true);
    expect(gem.parentId).toBe('TREASURE-ROOM');
  });

  it('skips STILETTO (not deposited)', () => {
    const stiletto = makeItem('STILETTO', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { children: [stiletto] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [stiletto, thief, dest] });

    const result = depositBooty(ctx, 'TREASURE-ROOM');
    expect(result).toBe(false);
    expect(stiletto.parentId).toBe('THIEF');
  });

  it('skips LARGE-BAG (not deposited)', () => {
    const bag = makeItem('LARGE-BAG', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { children: [bag] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [bag, thief, dest] });

    const result = depositBooty(ctx, 'TREASURE-ROOM');
    expect(result).toBe(false);
    expect(bag.parentId).toBe('THIEF');
  });

  it('EGG deposit sets EGG-SOLVE=true and OPENBIT on EGG (1actions.zil:1906–1908)', () => {
    const egg = makeItem('EGG', 'THIEF', { tvalue: 5 });
    const thief = makeItem('THIEF', 'HERE', { children: [egg] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [egg, thief, dest] });

    expect(eggSolve()).toBe(false);
    expect(egg.flags.has(Flag.Open)).toBe(false);

    depositBooty(ctx, 'TREASURE-ROOM');

    expect(eggSolve()).toBe(true);
    expect(egg.flags.has(Flag.Open)).toBe(true);
    // Egg should NOT be converted to BROKEN-EGG — it stays as 'EGG'
    expect(egg.id).toBe('EGG');
    expect(egg.parentId).toBe('TREASURE-ROOM');
  });

  it('EGG deposit does NOT break the egg (thief path is non-destructive)', () => {
    const egg = makeItem('EGG', 'THIEF', { tvalue: 5 });
    const thief = makeItem('THIEF', 'HERE', { children: [egg] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [egg, thief, dest] });

    depositBooty(ctx, 'TREASURE-ROOM');

    // The egg is opened (OPENBIT set) but not replaced by BROKEN-EGG
    expect(egg.id).toBe('EGG');
    expect(egg.flags.has(Flag.Open)).toBe(true);
  });

  it('returns false when thief carries nothing to deposit', () => {
    const thief = makeItem('THIEF', 'HERE', { children: [] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [thief, dest] });

    const result = depositBooty(ctx, 'TREASURE-ROOM');
    expect(result).toBe(false);
  });

  it('skips TVALUE==0 items (junk stays in thief)', () => {
    const knife = makeItem('KNIFE', 'THIEF', { tvalue: 0 });
    const thief = makeItem('THIEF', 'HERE', { children: [knife] });
    const dest = makeItem('TREASURE-ROOM', null);
    const { ctx } = makeCtx({ items: [knife, thief, dest] });

    const result = depositBooty(ctx, 'TREASURE-ROOM');
    expect(result).toBe(false);
    expect(knife.parentId).toBe('THIEF');
  });
});

// ---------------------------------------------------------------------------
// TS-F: WINNING? — flee probability function
// ---------------------------------------------------------------------------

describe('TS-F: winning()', () => {
  it('PS>3: uses prob(90) — force true (flee)', () => {
    // villainStrength=5, fightStrength=1 → PS = 5-1 = 4 > 3 → prob(90)
    // draw 0.0 → 0*100=0 < 90 → true
    const { ctx } = makeCtx({ thiefStrength: 5, rngDraws: [0.0], score: 0, playerStrength: 0 });
    ctx.fightStrength = () => 1;  // VS=5, PS=4 > 3
    expect(winning(ctx, 5)).toBe(true);
  });

  it('PS>3: uses prob(90) — force false (stay)', () => {
    // draw 0.95 → 0.95*100=95 >= 90 → false
    const { ctx } = makeCtx({ thiefStrength: 5, rngDraws: [0.95] });
    ctx.fightStrength = () => 1;  // VS=5, PS=4 > 3
    expect(winning(ctx, 5)).toBe(false);
  });

  it('PS>0 and <=3: uses prob(75) — force true', () => {
    // VS=3, FS=2 → PS=1 → 0<PS<=3 → prob(75)
    // draw 0.1 → 10 < 75 → true
    const { ctx } = makeCtx({ thiefStrength: 3, rngDraws: [0.1] });
    ctx.fightStrength = () => 2;
    expect(winning(ctx, 3)).toBe(true);
  });

  it('PS==0: uses prob(50)', () => {
    // VS=2, FS=2 → PS=0 → prob(50)
    // draw 0.3 → 30 < 50 → true
    const { ctx } = makeCtx({ thiefStrength: 2, rngDraws: [0.3] });
    ctx.fightStrength = () => 2;
    expect(winning(ctx, 2)).toBe(true);
  });

  it('PS<0, VS>1: uses prob(25)', () => {
    // VS=3, FS=4 → PS=-1 < 0; VS=3 > 1 → prob(25)
    // draw 0.1 → 10 < 25 → true
    const { ctx } = makeCtx({ thiefStrength: 3, rngDraws: [0.1] });
    ctx.fightStrength = () => 4;
    expect(winning(ctx, 3)).toBe(true);
  });

  it('PS<0, VS<=1: uses prob(10)', () => {
    // VS=1, FS=3 → PS=-2 < 0; VS=1 not > 1 → prob(10)
    // draw 0.05 → 5 < 10 → true
    const { ctx } = makeCtx({ thiefStrength: 1, rngDraws: [0.05] });
    ctx.fightStrength = () => 3;
    expect(winning(ctx, 1)).toBe(true);
  });

  it('PS<0, VS<=1: force false', () => {
    // draw 0.5 → 50 >= 10 → false
    const { ctx } = makeCtx({ thiefStrength: 1, rngDraws: [0.5] });
    ctx.fightStrength = () => 3;
    expect(winning(ctx, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RECOVER-STILETTO
// ---------------------------------------------------------------------------

describe('recoverStiletto()', () => {
  it('picks up stiletto from LOC(THIEF) into THIEF, sets NDESCBIT', () => {
    const stiletto = makeItem('STILETTO', 'HERE', { flags: [] });
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    const here = makeItem('HERE', null, { children: [stiletto, thief] });
    const { ctx } = makeCtx({ items: [stiletto, thief, here] });

    recoverStiletto(ctx, 'THIEF');
    expect(stiletto.parentId).toBe('THIEF');
    expect(stiletto.flags.has(Flag.NonDescript)).toBe(true);
  });

  it('no-op when stiletto not in LOC(THIEF)', () => {
    const stiletto = makeItem('STILETTO', 'OTHER-ROOM', {});
    const thief = makeItem('THIEF', 'HERE', { flags: [Flag.Actor] });
    const here = makeItem('HERE', null, { children: [thief] });
    const other = makeItem('OTHER-ROOM', null, { children: [stiletto] });
    const { ctx } = makeCtx({ items: [stiletto, thief, here, other] });

    recoverStiletto(ctx, 'THIEF');
    expect(stiletto.parentId).toBe('OTHER-ROOM');  // unchanged
  });
});

// ---------------------------------------------------------------------------
// HACK-TREASURES
// ---------------------------------------------------------------------------

describe('hackTreasures()', () => {
  it('clears INVISIBLE on all TREASURE-ROOM children (incl. thief which is a child)', () => {
    // ZIL 1888–1895: FSET THIEF INVISIBLE; then FCLEAR every TREASURE-ROOM child.
    // THIEF is itself a TREASURE-ROOM child, so it ends up visible (INVISIBLE cleared).
    const gem = makeItem('GEM', 'TREASURE-ROOM', { tvalue: 5, flags: [Flag.Invisible] });
    const coin = makeItem('COIN', 'TREASURE-ROOM', { tvalue: 3, flags: [Flag.Invisible] });
    const stiletto = makeItem('STILETTO', 'THIEF', { flags: [] });
    const thief = makeItem('THIEF', 'TREASURE-ROOM', { flags: [Flag.Actor], children: [stiletto] });
    const treasureRoom = makeItem('TREASURE-ROOM', null, { children: [gem, coin, thief] });
    const { ctx } = makeCtx({ items: [gem, coin, stiletto, thief, treasureRoom] });

    hackTreasures(ctx, 'THIEF', 'TREASURE-ROOM');

    // Treasures revealed
    expect(gem.flags.has(Flag.Invisible)).toBe(false);
    expect(coin.flags.has(Flag.Invisible)).toBe(false);
    // The loop clears INVISIBLE on ALL children including THIEF itself
    expect(thief.flags.has(Flag.Invisible)).toBe(false);
  });

  it('also calls recoverStiletto before hiding thief', () => {
    const stiletto = makeItem('STILETTO', 'TREASURE-ROOM', { flags: [] });
    const thief = makeItem('THIEF', 'TREASURE-ROOM', { flags: [Flag.Actor] });
    const treasureRoom = makeItem('TREASURE-ROOM', null, { children: [stiletto, thief] });
    const { ctx } = makeCtx({ items: [stiletto, thief, treasureRoom] });

    hackTreasures(ctx, 'THIEF', 'TREASURE-ROOM');

    // Stiletto should now be in THIEF (recovered)
    expect(stiletto.parentId).toBe('THIEF');
    expect(stiletto.flags.has(Flag.NonDescript)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MOVE-ALL
// ---------------------------------------------------------------------------

describe('moveAll()', () => {
  it('clears INVISIBLE and moves every child from `from` to `to`', () => {
    const item1 = makeItem('ITEM1', 'FROM', { flags: [Flag.Invisible] });
    const item2 = makeItem('ITEM2', 'FROM', { flags: [Flag.Invisible] });
    const from = makeItem('FROM', null, { children: [item1, item2] });
    const to = makeItem('TO', null);
    const { ctx } = makeCtx({ items: [item1, item2, from, to] });

    moveAll(ctx, 'FROM', 'TO');

    expect(item1.parentId).toBe('TO');
    expect(item2.parentId).toBe('TO');
    expect(item1.flags.has(Flag.Invisible)).toBe(false);
    expect(item2.flags.has(Flag.Invisible)).toBe(false);
  });

  it('no-op when `from` has no children', () => {
    const from = makeItem('FROM', null);
    const to = makeItem('TO', null);
    const { ctx } = makeCtx({ items: [from, to] });

    expect(() => moveAll(ctx, 'FROM', 'TO')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// STOLE-LIGHT? — room just went dark
// ---------------------------------------------------------------------------

describe('stoleLight()', () => {
  it('always returns true', () => {
    const { ctx } = makeCtx({ litBefore: true, litAfter: true });
    expect(stoleLight(ctx)).toBe(true);
  });

  it('emits darkness message when room was lit before and dark now', () => {
    const { ctx, emitted } = makeCtx({ litBefore: true, litAfter: false });
    stoleLight(ctx);
    expect(emitted.some(m => m.includes('dark'))).toBe(true);
  });

  it('does not emit when room was already dark', () => {
    const { ctx, emitted } = makeCtx({ litBefore: false, litAfter: false });
    stoleLight(ctx);
    expect(emitted.length).toBe(0);
  });

  it('does not emit when room is still lit', () => {
    const { ctx, emitted } = makeCtx({ litBefore: true, litAfter: true });
    stoleLight(ctx);
    expect(emitted.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ROB-MAZE
// ---------------------------------------------------------------------------

describe('robMaze()', () => {
  beforeEach(() => { resetThiefState(); });

  it('at PROB(40) true, steals first TAKEBIT !INVISIBLE item at zprob(60) LUCKY denom=100', () => {
    // ZIL <PROB 60 80> → macro expands to <ZPROB 60> discarding 80 → LUCKY denom is 100
    const map = makeItem('MAP', 'MAZE', { tvalue: 0, flags: [Flag.Takeable] });
    const maze = makeItem('MAZE', null, { children: [map] });
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    // Two draws: PROB(40) = 0.1*100=10 < 40 → true; zprob(60,100) = 0.1*100=10 < 60 → true
    const { ctx, emitted } = makeCtx({ items: [map, maze, thief], hereId: 'HERE', rngDraws: [0.1, 0.1], lucky: true });

    robMaze(ctx, 'MAZE');
    expect(map.parentId).toBe('THIEF');
    expect(map.flags.has(Flag.Touched)).toBe(true);
    expect(map.flags.has(Flag.Invisible)).toBe(true);
    expect(emitted.some(m => m.includes('wonder'))).toBe(true);
  });

  it('at PROB(40) true but zprob(60) LUCKY denom=100 false, item stays (only announce)', () => {
    // ZIL <PROB 60 80> → ZPROB 60 → LUCKY ? 60>RANDOM(100). Draw 0.9 → 90 >= 60 → false.
    const map = makeItem('MAP', 'MAZE', { tvalue: 0, flags: [Flag.Takeable] });
    const maze = makeItem('MAZE', null, { children: [map] });
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    // PROB(40) = 0.1 → true; zprob(60,100) = 0.9*100=90 >= 60 → false
    const { ctx, emitted } = makeCtx({ items: [map, maze, thief], hereId: 'HERE', rngDraws: [0.1, 0.9], lucky: true });

    robMaze(ctx, 'MAZE');
    expect(map.parentId).toBe('MAZE');  // not stolen
    expect(emitted.some(m => m.includes('wonder'))).toBe(true);  // but announced
  });

  // Faithfulness: r in [0.60, 0.75) → LUCKY denom=100 does NOT steal; denom=80 WOULD steal.
  // This is the 14.96%-of-seeds divergence the verifier flagged.
  it('LUCKY denom=100 faithfulness: draw in [0.60,0.75) does NOT steal (ZIL nominal P=60/100)', () => {
    const map = makeItem('MAP', 'MAZE', { tvalue: 0, flags: [Flag.Takeable] });
    const maze = makeItem('MAZE', null, { children: [map] });
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    // PROB(40)=0.1→true; zprob second draw=0.65: 0.65*100=65 >= 60 → false (should NOT steal)
    const { ctx } = makeCtx({ items: [map, maze, thief], hereId: 'HERE', rngDraws: [0.1, 0.65], lucky: true });

    robMaze(ctx, 'MAZE');
    expect(map.parentId).toBe('MAZE');  // NOT stolen at r=0.65 with denom=100
  });

  it('at PROB(40) false, skips entirely', () => {
    const map = makeItem('MAP', 'MAZE', { tvalue: 0, flags: [Flag.Takeable] });
    const maze = makeItem('MAZE', null, { children: [map] });
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    // PROB(40) = 0.9*100=90 >= 40 → false
    const { ctx, emitted } = makeCtx({ items: [map, maze, thief], hereId: 'HERE', rngDraws: [0.9] });

    robMaze(ctx, 'MAZE');
    expect(map.parentId).toBe('MAZE');
    expect(emitted.length).toBe(0);
  });

  it('skips INVISIBLE items', () => {
    const map = makeItem('MAP', 'MAZE', { tvalue: 0, flags: [Flag.Takeable, Flag.Invisible] });
    const maze = makeItem('MAZE', null, { children: [map] });
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    // Always true rng
    const { ctx } = makeCtx({ items: [map, maze, thief], hereId: 'HERE', rngDraws: [0.0] });

    robMaze(ctx, 'MAZE');
    expect(map.parentId).toBe('MAZE');
  });

  it('returns false when no items in room', () => {
    const maze = makeItem('MAZE', null);
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    const { ctx } = makeCtx({ items: [maze, thief], hereId: 'HERE' });

    const result = robMaze(ctx, 'MAZE');
    expect(result).toBe(false);
  });

  // ZIL "D .X" emits the DESC string, not the lowercased atom.
  // Hyphenated ids like BRASS-LANTERN → desc "brass lantern", not "brass-lantern".
  it('announce uses obj.desc not id.toLowerCase() (ZIL D .X operator)', () => {
    // desc defaults to id with hyphens replaced by spaces in our stub
    const lantern = makeItem('BRASS-LANTERN', 'MAZE', { tvalue: 0, flags: [Flag.Takeable] });
    const maze = makeItem('MAZE', null, { children: [lantern] });
    const thief = makeItem('THIEF', 'MAZE', { flags: [Flag.Actor] });
    // PROB(40)=0.1→true; zprob denom=100, 0.1→steal; checks announce text
    const { ctx, emitted } = makeCtx({ items: [lantern, maze, thief], hereId: 'HERE', rngDraws: [0.1, 0.1], lucky: true });

    robMaze(ctx, 'MAZE');
    // Must use desc "brass lantern", not atom "brass-lantern"
    expect(emitted.some(m => m.includes('brass lantern'))).toBe(true);
    expect(emitted.some(m => m.includes('brass-lantern'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STEAL-JUNK — obj.desc in vanish announcement
// ---------------------------------------------------------------------------

describe('stealJunk() — object name via desc', () => {
  // ZIL STEAL-JUNK :3970 "You suddenly notice that the " D .X " vanished."
  // D .X emits DESC, e.g. "large bag" not "large-bag".
  it('vanish message uses obj.desc not id.toLowerCase()', () => {
    const bag = makeItem('LARGE-BAG', 'HERE', { tvalue: 0, flags: [Flag.Takeable], desc: 'large bag' });
    const here = makeItem('HERE', null, { children: [bag] });
    const thief = makeItem('THIEF', null);
    // zprob(10,100): draw=0.0 → 0 < 10 → true
    const { ctx, emitted } = makeCtx({ items: [bag, here, thief], hereId: 'HERE', rngDraws: [0.0], lucky: true });

    stealJunk(ctx, 'HERE');
    // desc "large bag" must appear, not "large-bag"
    expect(emitted.some(m => m.includes('large bag'))).toBe(true);
    expect(emitted.some(m => m.includes('large-bag'))).toBe(false);
  });
});
