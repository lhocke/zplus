/**
 * T3 — ROBBER-FUNCTION: F-codes + verb dispatch
 *
 * Done-criteria (spec §8 Wave 2, T3):
 *   TS-H  All five F-codes: F_DEAD, F_UNCONSCIOUS, F_CONSCIOUS, F_BUSY, F_FIRST
 *   TS-I  THIEF-ENGROSSED set-on-give fires the (Phase-2) cap
 *   Golden-diffable: give-treasure and give-junk response strings match verbatim
 *
 * ZIL citation: 1actions.zil:1947–2084
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeRobberFcn,
  type RobberFcnCtx,
} from '../../src/actions/robber-fcn.js';
import { F_BUSY, F_DEAD, F_UNCONSCIOUS, F_CONSCIOUS, F_FIRST } from '../../src/engine/combat.js';
import { Flag } from '../../src/domain/flags.js';
import {
  resetThiefState,
  thiefEngrossed,
  setThiefHere,
  ROBBER_C_DESC,
  ROBBER_U_DESC,
  thiefLdesc,
  setThiefLdesc,
} from '../../src/actions/thief-state.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// Stub objects
// ---------------------------------------------------------------------------

interface StubObj {
  id: string;
  parentId: string | null;
  tvalue: number;
  flags: Set<Flag>;
  ldesc?: string;
}

function makeObj(
  id: string,
  parentId: string | null,
  opts: { tvalue?: number; flags?: Flag[] } = {},
): StubObj {
  return {
    id,
    parentId,
    tvalue: opts.tvalue ?? 0,
    flags: new Set(opts.flags ?? []),
  };
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

// Stiletto override: parentId and flags are overridable; flags passed as Flag[] not Set.
interface StilettoOpts {
  parentId?: string;
  flags?: Flag[];
}

function makeCtx(opts: {
  hereId?: string;
  thiefParentId?: string;
  thief?: Partial<StubObj>;
  stiletto?: StilettoOpts;
  objs?: StubObj[];
  pStrength?: number;          // thief pStrength (negative = unconscious)
  thiefHereFlag?: boolean;
  thiefInvisible?: boolean;
  rngDraws?: readonly number[];
  iThiefEnabled?: boolean;
} = {}): {
  ctx: RobberFcnCtx;
  emitted: string[];
  thiefPStrength: { value: number };
  thiefFlags: Set<Flag>;
  iThiefEnabled: { value: boolean };
  contCleared: { value: boolean };
  deposited: StubObj[];
  stilettoMoved: { to: string | null };
} {
  const hereId = opts.hereId ?? 'HERE';
  const iThiefEnabledRef = { value: opts.iThiefEnabled ?? true };
  const contCleared = { value: false };
  const emitted: string[] = [];
  const deposited: StubObj[] = [];
  const stilettoMoved: { to: string | null } = { to: null };

  const thiefPStrength = { value: opts.pStrength ?? 3 };

  // Build object map
  const objMap = new Map<string, StubObj>();

  // THIEF
  const thiefParentId = opts.thiefParentId ?? hereId;
  const thiefObj: StubObj = {
    id: 'THIEF',
    parentId: thiefParentId,
    tvalue: 0,
    flags: new Set([Flag.Actor]),
    ldesc: ROBBER_C_DESC,
    ...(opts.thief ?? {}),
  };
  if (opts.thiefInvisible) thiefObj.flags.add(Flag.Invisible);
  objMap.set('THIEF', thiefObj);

  // STILETTO
  const stilOpts = opts.stiletto ?? {};
  const stilettoObj: StubObj = makeObj(
    'STILETTO',
    stilOpts.parentId ?? 'THIEF',
    { flags: stilOpts.flags ?? [Flag.NonDescript] },
  );
  objMap.set('STILETTO', stilettoObj);

  // LARGE-BAG
  const largeBagObj: StubObj = makeObj('LARGE-BAG', 'THIEF');
  objMap.set('LARGE-BAG', largeBagObj);

  // Extra objects
  for (const obj of (opts.objs ?? [])) {
    objMap.set(obj.id, obj);
  }

  const rng = new ScriptedRng(opts.rngDraws ?? [0.5]);

  const ctx: RobberFcnCtx = {
    hereId,

    getObj(id: string) {
      const o = objMap.get(id);
      if (o === undefined) return undefined;
      return {
        get id()       { return o.id; },
        get parentId() { return o.parentId; },
        get tvalue()   { return o.tvalue; },
        hasFlag: (f: Flag) => o.flags.has(f),
        setFlag: (f: Flag) => o.flags.add(f),
        clearFlag: (f: Flag) => o.flags.delete(f),
        moveTo: (destId: string) => {
          o.parentId = destId;
          if (o.id === 'STILETTO') stilettoMoved.to = destId;
        },
        setLdesc: (s: string) => { o.ldesc = s; },
        get desc() { return o.id.toLowerCase().replace(/-/g, ' '); },
      };
    },

    childrenOf(containerId: string) {
      return [...objMap.values()]
        .filter(o => o.parentId === containerId)
        .map(o => o.id);
    },

    getThiefPStrength: () => thiefPStrength.value,
    setThiefPStrength: (v: number) => { thiefPStrength.value = v; },

    enableIThief:  () => { iThiefEnabledRef.value = true; },
    disableIThief: () => { iThiefEnabledRef.value = false; },

    isThiefInvisible: () => thiefObj.flags.has(Flag.Invisible),
    setThiefInvisible: () => thiefObj.flags.add(Flag.Invisible),

    isTreasureRoom: (roomId: string) => roomId === 'TREASURE-ROOM',

    recoverStiletto: () => {
      // minimal: pick up stiletto from LOC(THIEF)
      if (stilettoObj.parentId === thiefParentId) {
        stilettoObj.flags.add(Flag.NonDescript);
        stilettoObj.parentId = 'THIEF';
        stilettoMoved.to = 'THIEF';
      }
    },

    depositBooty: (rmId: string) => {
      const booty: StubObj[] = [];
      for (const obj of objMap.values()) {
        if (obj.parentId === 'THIEF' && obj.id !== 'STILETTO' && obj.id !== 'LARGE-BAG') {
          if (obj.tvalue > 0) {
            obj.parentId = rmId;
            deposited.push(obj);
            booty.push(obj);
            if (obj.id === 'EGG') {
              obj.flags.add(Flag.Open);
            }
          }
        }
      }
      return booty.length > 0;
    },

    moveAll: (fromId: string, toId: string) => {
      for (const obj of objMap.values()) {
        if (obj.parentId === fromId) {
          obj.flags.delete(Flag.Invisible);
          obj.parentId = toId;
        }
      }
    },

    rng,

    tell: (s: string) => emitted.push(s),
    clearContinuation: () => { contCleared.value = true; },
  };

  return { ctx, emitted, thiefPStrength, thiefFlags: thiefObj.flags, iThiefEnabled: iThiefEnabledRef, contCleared, deposited, stilettoMoved };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetThiefState();
});

describe('ROBBER-FUNCTION — F_BUSY (1actions.zil:2025–2034)', () => {
  it('stiletto already with THIEF → returns false (no-op)', () => {
    const { ctx } = makeCtx({ stiletto: { parentId: 'THIEF' } });
    const fn = makeRobberFcn(ctx);
    expect(fn(F_BUSY)).toBe(false);
  });

  it('stiletto in LOC(THIEF) → move to THIEF + NDESCBIT, return true', () => {
    const thiefParentId = 'HERE';
    const { ctx, stilettoMoved, emitted } = makeCtx({
      hereId: thiefParentId,
      thiefParentId,
      stiletto: { parentId: thiefParentId, flags: [] },
    });
    const fn = makeRobberFcn(ctx);
    expect(fn(F_BUSY)).toBe(true);
    expect(stilettoMoved.to).toBe('THIEF');
    // THIEF in HERE → prints message
    expect(emitted.join('\n')).toContain('nimbly');
  });

  it('stiletto in LOC(THIEF) but thief not in HERE → no message, still returns true', () => {
    const { ctx, stilettoMoved, emitted } = makeCtx({
      hereId: 'OTHER-ROOM',
      thiefParentId: 'THIEF-ROOM',
      stiletto: { parentId: 'THIEF-ROOM', flags: [] },
    });
    const fn = makeRobberFcn(ctx);
    expect(fn(F_BUSY)).toBe(true);
    expect(stilettoMoved.to).toBe('THIEF');
    expect(emitted).toHaveLength(0);
  });

  it('stiletto elsewhere (not in THIEF, not in LOC(THIEF)) → returns false', () => {
    const { ctx } = makeCtx({
      stiletto: { parentId: 'SOMEWHERE-ELSE' },
    });
    const fn = makeRobberFcn(ctx);
    expect(fn(F_BUSY)).toBe(false);
  });
});

describe('ROBBER-FUNCTION — F_DEAD PRINT-CONTENTS (1actions.zil:2054–2057)', () => {
  // ZIL: after revealing .X in TREASURE-ROOM, if <AND <FIRST? .X> <SEE-INSIDE? .X>>
  // then tell ", with " + <PRINT-CONTENTS .X>.
  // SEE-INSIDE? = !INVISIBLE(X) && (OPENBIT || TRANSBIT).
  // FCLEAR INVISIBLE on .X happens BEFORE the SEE-INSIDE check, so a just-revealed
  // OPENBIT/TRANSBIT container with contents qualifies.

  it('revealed OPEN container with contents → "  A <desc>, with a <child-desc>" line', () => {
    // BROKEN-EGG: Open+Invisible, tvalue>0 (so depositBooty deposits it to TREASURE-ROOM)
    // BROKEN-CANARY inside BROKEN-EGG
    const brokenCanary = makeObj('BROKEN-CANARY', 'BROKEN-EGG', { tvalue: 0 });
    const brokenEgg = makeObj('BROKEN-EGG', 'TREASURE-ROOM', {
      tvalue: 2,
      flags: [Flag.Invisible, Flag.Open],
    });
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [brokenEgg, brokenCanary],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    const out = emitted.join('\n');
    // Must include the container line with its contents
    expect(out).toContain('  A broken egg, with a broken canary');
  });

  it('revealed closed (no OPEN/TRANS) container with contents → no ", with" clause', () => {
    const gem = makeObj('GEM', 'BOX', { tvalue: 0 });
    const box = makeObj('BOX', 'TREASURE-ROOM', {
      tvalue: 3,
      flags: [Flag.Invisible],  // no OPEN, no Transparent
    });
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [box, gem],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    const out = emitted.join('\n');
    expect(out).toContain('  A box');
    expect(out).not.toContain(', with');
  });

  it('revealed OPEN container with NO contents → no ", with" clause', () => {
    const emptyBox = makeObj('EMPTY-BOX', 'TREASURE-ROOM', {
      tvalue: 3,
      flags: [Flag.Invisible, Flag.Open],
    });
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [emptyBox],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    const out = emitted.join('\n');
    expect(out).toContain('  A empty box');
    expect(out).not.toContain(', with');
  });
});

describe('ROBBER-FUNCTION — F_DEAD (1actions.zil:2035–2062)', () => {
  // ZIL 1actions.zil:2046 excludes CHALICE, THIEF, and ADVENTURER from the reveal loop.
  // In this engine the player object id is 'PLAYER' (bootstrap.ts:58, desc='cretin'),
  // and it lives as a room child — so PLAYER must also be excluded, or the reveal
  // prints "  A cretin" for the player.
  it('dead in TREASURE-ROOM with PLAYER present → no "cretin" line in reveal', () => {
    const player = makeObj('PLAYER', 'TREASURE-ROOM', { tvalue: 0 });
    const gem    = makeObj('GEM',    'TREASURE-ROOM', { tvalue: 3, flags: [Flag.Invisible] });
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [player, gem],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    const out = emitted.join('\n');
    // GEM is revealed; player ('cretin') must NOT appear
    expect(out).toContain('treasures reappear');
    expect(out).toContain('  A gem');
    expect(out).not.toContain('cretin');
    expect(out).not.toContain('  A player');
  });

  it('stiletto dropped to HERE, NDESCBIT cleared, depositBooty called, I-THIEF disabled', () => {
    const { ctx, iThiefEnabled, stilettoMoved } = makeCtx({
      hereId: 'DUNGEON',
      stiletto: { parentId: 'THIEF', flags: [Flag.NonDescript] },
      objs: [makeObj('CHALICE', 'THIEF', { tvalue: 5 })],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    // stiletto dropped to HERE
    expect(stilettoMoved.to).toBe('DUNGEON');
    // I-THIEF disabled
    expect(iThiefEnabled.value).toBe(false);
  });

  it('dead in non-treasure-room with booty → "His booty remains."', () => {
    const treasure = makeObj('TREASURE1', 'THIEF', { tvalue: 5 });
    const { ctx, emitted } = makeCtx({
      hereId: 'DUNGEON',
      objs: [treasure],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    expect(emitted.join('\n')).toContain('His booty remains.');
  });

  it('dead in non-treasure-room with no booty → no "booty remains" message', () => {
    const { ctx, emitted } = makeCtx({ hereId: 'DUNGEON' });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    expect(emitted.join('\n')).not.toContain('booty remains');
  });

  it('dead in TREASURE-ROOM → reveals each non-CHALICE/THIEF/ADVENTURER child with list header', () => {
    const gem = makeObj('GEM', 'TREASURE-ROOM', { tvalue: 3, flags: [Flag.Invisible] });
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [gem],
    });
    const fn = makeRobberFcn(ctx);
    fn(F_DEAD);
    const out = emitted.join('\n');
    expect(out).toContain('treasures reappear');
    expect(out).toContain('The chalice is now safe to take.');
    // GEM should have INVISIBLE cleared
    expect(gem.flags.has(Flag.Invisible)).toBe(false);
  });
});

describe('ROBBER-FUNCTION — F_UNCONSCIOUS (1actions.zil:2070–2075)', () => {
  it('disables I-THIEF, clears FIGHTBIT, drops stiletto, sets unconscious LDESC', () => {
    const { ctx, iThiefEnabled, thiefFlags, stilettoMoved } = makeCtx({
      hereId: 'HERE',
      thief: { flags: new Set([Flag.Actor, Flag.Fight]) },
      stiletto: { parentId: 'THIEF', flags: [Flag.NonDescript] },
    });
    const fn = makeRobberFcn(ctx);
    fn(F_UNCONSCIOUS);
    expect(iThiefEnabled.value).toBe(false);
    expect(thiefFlags.has(Flag.Fight)).toBe(false);
    expect(stilettoMoved.to).toBe('HERE');
    expect(thiefLdesc()).toBe(ROBBER_U_DESC);
  });
});

describe('ROBBER-FUNCTION — F_CONSCIOUS (1actions.zil:2076–2084)', () => {
  it('thief in HERE → FSET FIGHTBIT + revive message + enable I-THIEF + conscious LDESC + recoverStiletto', () => {
    setThiefLdesc(ROBBER_U_DESC);  // was unconscious
    const { ctx, iThiefEnabled, thiefFlags, emitted } = makeCtx({
      hereId: 'HERE',
      thiefParentId: 'HERE',
      iThiefEnabled: false,
      stiletto: { parentId: 'HERE', flags: [] },
    });
    const fn = makeRobberFcn(ctx);
    fn(F_CONSCIOUS);
    expect(thiefFlags.has(Flag.Fight)).toBe(true);
    expect(emitted.join('\n')).toContain('revives');
    expect(iThiefEnabled.value).toBe(true);
    expect(thiefLdesc()).toBe(ROBBER_C_DESC);
  });

  it('thief not in HERE → no FIGHTBIT, no message, but enable + LDESC still applied', () => {
    setThiefLdesc(ROBBER_U_DESC);
    const { ctx, iThiefEnabled, thiefFlags, emitted } = makeCtx({
      hereId: 'OTHER-ROOM',
      thiefParentId: 'THIEF-ROOM',
      iThiefEnabled: false,
    });
    const fn = makeRobberFcn(ctx);
    fn(F_CONSCIOUS);
    expect(thiefFlags.has(Flag.Fight)).toBe(false);
    expect(emitted).toHaveLength(0);
    expect(iThiefEnabled.value).toBe(true);
    expect(thiefLdesc()).toBe(ROBBER_C_DESC);
  });
});

describe('ROBBER-FUNCTION — F_FIRST (1actions.zil:2063–2069)', () => {
  it('THIEF-HERE + !INVISIBLE + prob(20) true → FSET FIGHTBIT, clear P-CONT, return true', () => {
    setThiefHere(true);
    // draw=0.10 → 0.10*100=10 < 20 → true
    const { ctx, thiefFlags, contCleared } = makeCtx({ rngDraws: [0.10] });
    const fn = makeRobberFcn(ctx);
    const result = fn(F_FIRST);
    expect(result).toBe(true);
    expect(thiefFlags.has(Flag.Fight)).toBe(true);
    expect(contCleared.value).toBe(true);
  });

  it('THIEF-HERE + !INVISIBLE + prob(20) false → return false', () => {
    setThiefHere(true);
    // draw=0.99 → 0.99*100=99 >= 20 → false
    const { ctx, thiefFlags } = makeCtx({ rngDraws: [0.99] });
    const fn = makeRobberFcn(ctx);
    expect(fn(F_FIRST)).toBe(false);
    expect(thiefFlags.has(Flag.Fight)).toBe(false);
  });

  it('!THIEF-HERE → return false regardless of prob', () => {
    setThiefHere(false);
    const { ctx } = makeCtx({ rngDraws: [0.0] });  // prob always true
    const fn = makeRobberFcn(ctx);
    expect(fn(F_FIRST)).toBe(false);
  });

  it('THIEF-HERE but INVISIBLE → return false', () => {
    setThiefHere(true);
    const { ctx } = makeCtx({ thiefInvisible: true, rngDraws: [0.0] });
    const fn = makeRobberFcn(ctx);
    expect(fn(F_FIRST)).toBe(false);
  });
});

describe('ROBBER-FUNCTION — verb dispatch (1actions.zil:1947–2024)', () => {
  it('TELL → "strong, silent type", clear P-CONT', () => {
    const { ctx, emitted, contCleared } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'TELL' });
    expect(emitted.join('')).toContain('strong, silent type');
    expect(contCleared.value).toBe(true);
  });

  it('HELLO while unconscious LDESC → incapacitated message', () => {
    setThiefLdesc(ROBBER_U_DESC);
    const { ctx, emitted } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'HELLO' });
    expect(emitted.join('')).toContain('incapacitated');
  });

  it('HELLO while conscious LDESC → no incapacitated message (fall through)', () => {
    setThiefLdesc(ROBBER_C_DESC);
    const { ctx, emitted } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'HELLO' });
    expect(emitted.join('')).not.toContain('incapacitated');
  });

  it('TAKE → "what would you do with him?"', () => {
    const { ctx, emitted } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'TAKE' });
    expect(emitted.join('')).toContain('what would you do with him');
  });

  it('EXAMINE → beady-eyes desc', () => {
    const { ctx, emitted } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'EXAMINE' });
    expect(emitted.join('')).toContain('beady eyes');
  });

  it('LOOK-INSIDE → same beady-eyes desc', () => {
    const { ctx, emitted } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'LOOK-INSIDE' });
    expect(emitted.join('')).toContain('beady eyes');
  });

  it('LISTEN → not been formally introduced', () => {
    const { ctx, emitted } = makeCtx();
    const fn = makeRobberFcn(ctx);
    fn(undefined, { verb: 'LISTEN' });
    expect(emitted.join('')).toContain('formally introduced');
  });

  describe('THROW KNIFE (not fighting) — flee + scattered booty branch', () => {
    it('prob(10) true → thief flees, bag contents spill, INVISIBLE', () => {
      // draw=0.05 → 0.05*100=5 < 10 → true (flee)
      const junk = makeObj('JUNK', 'THIEF', { tvalue: 0 });
      const { ctx, emitted, thiefFlags } = makeCtx({
        hereId: 'HERE',
        rngDraws: [0.05],
        objs: [junk, makeObj('KNIFE', 'PLAYER')],
        stiletto: { parentId: 'THIEF' },
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'THROW', prsoId: 'KNIFE', fighting: false });
      expect(thiefFlags.has(Flag.Invisible)).toBe(true);
      expect(emitted.join('')).toContain('frightened the robber');
    });

    // BYTE-EXACT: ZIL 1actions.zil:1961–1975 — successive TELLs with no CR form
    // ONE logical line. The port must emit a single ctx.tell() so game.ts's
    // newline-join can't insert a spurious "\n, but..." or "\n.".
    it('flee with contents → single tell, exact text (no spurious newline before suffix)', () => {
      // draw=0.05 → flee; junk is a non-tvalue child so it spills
      const junk = makeObj('JUNK', 'THIEF', { tvalue: 0 });
      const { ctx, emitted } = makeCtx({
        hereId: 'HERE',
        rngDraws: [0.05],
        objs: [junk, makeObj('KNIFE', 'PLAYER')],
        stiletto: { parentId: 'THIEF' },
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'THROW', prsoId: 'KNIFE', fighting: false });
      // The entire flee+contents message must be ONE entry in emitted (one ctx.tell()).
      const fleeIdx = emitted.findIndex(s => s.includes('evidently frightened'));
      expect(fleeIdx).toBeGreaterThanOrEqual(0);
      expect(emitted[fleeIdx]).toBe(
        "You evidently frightened the robber, though you didn't hit him. He\nflees, but the contents of his bag fall on the floor.",
      );
    });

    it('flee with empty bag → single tell ending with period (no spurious newline before ".")', () => {
      // draw=0.05 → flee; thief has no non-bag/stiletto children → empty bag path
      const { ctx, emitted } = makeCtx({
        hereId: 'HERE',
        rngDraws: [0.05],
        objs: [makeObj('KNIFE', 'PLAYER')],
        stiletto: { parentId: 'THIEF' },
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'THROW', prsoId: 'KNIFE', fighting: false });
      const fleeIdx = emitted.findIndex(s => s.includes('evidently frightened'));
      expect(fleeIdx).toBeGreaterThanOrEqual(0);
      expect(emitted[fleeIdx]).toBe(
        "You evidently frightened the robber, though you didn't hit him. He\nflees.",
      );
    });

    it('prob(10) false → knife missed, angered, FIGHTBIT set', () => {
      // draw=0.99 → flee fails
      const { ctx, emitted, thiefFlags } = makeCtx({
        rngDraws: [0.99],
        objs: [makeObj('KNIFE', 'PLAYER')],
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'THROW', prsoId: 'KNIFE', fighting: false });
      expect(thiefFlags.has(Flag.Fight)).toBe(true);
      expect(emitted.join('')).toContain('angered');
    });
  });

  describe('GIVE/THROW <item> to thief (1actions.zil:1986–2012)', () => {
    it('give treasure (TVALUE>0) → THIEF-ENGROSSED = true, engrossed message (TS-I)', () => {
      const treasure = makeObj('CHALICE', 'PLAYER', { tvalue: 5 });
      const { ctx, emitted } = makeCtx({
        objs: [treasure],
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'GIVE', prsoId: 'CHALICE', prsiId: 'THIEF' });
      expect(thiefEngrossed()).toBe(true);  // TS-I: engrossed flag set
      expect(emitted.join('')).toContain('taken aback by your unexpected generosity');
      expect(emitted.join('')).toContain('stops to admire its beauty');
    });

    it('give junk (TVALUE==0) → "places the X in his bag and thanks you"', () => {
      const junk = makeObj('ROPE', 'PLAYER', { tvalue: 0 });
      const { ctx, emitted } = makeCtx({
        objs: [junk],
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'GIVE', prsoId: 'ROPE', prsiId: 'THIEF' });
      expect(thiefEngrossed()).toBe(false);  // NOT engrossed
      expect(emitted.join('')).toContain('places the');
      expect(emitted.join('')).toContain('in his bag and thanks');
    });

    it('give to unconscious thief → revive first, then give', () => {
      const junk = makeObj('ROPE', 'PLAYER', { tvalue: 0 });
      const { ctx, emitted, iThiefEnabled } = makeCtx({
        pStrength: -3,  // unconscious
        iThiefEnabled: false,
        objs: [junk],
      });
      const fn = makeRobberFcn(ctx);
      fn(undefined, { verb: 'GIVE', prsoId: 'ROPE', prsiId: 'THIEF' });
      expect(emitted.join('')).toContain('recovers consciousness');
      expect(iThiefEnabled.value).toBe(true);
      expect(thiefLdesc()).toBe(ROBBER_C_DESC);
    });
  });
});
