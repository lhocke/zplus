/**
 * TR1 — TROLL-FCN F-code callbacks (spec §10.1, §10.2, §12 TR1)
 *
 * Done-criteria:
 *   F_DEAD:        drop AXE→HERE, restore axe flags, trollFlag=true
 *   F_UNCONSCIOUS: clear FIGHTBIT, drop AXE→HERE, update LDESC, trollFlag=true
 *   F_CONSCIOUS:   troll in HERE → FSET FIGHTBIT + message; axe recovery; trollFlag=false
 *   F_FIRST:       prob(33) → FSET FIGHTBIT, clear P-CONT, return T; else F
 *   F_BUSY:        axe in troll → no-op (false); axe in HERE → zprob(75) pick up,
 *                  message, return T; axe unavailable → cowering message, return T
 *
 * ZIL ref: 1actions.zil:640–764
 */

import { describe, it, expect } from 'vitest';
import {
  makeTrollFcn,
  type TrollFcnContext,
} from '../../src/actions/troll-fcn.js';
import { F_BUSY, F_DEAD, F_UNCONSCIOUS, F_CONSCIOUS, F_FIRST } from '../../src/engine/combat.js';
import { Flag } from '../../src/domain/flags.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// Minimal in-memory world stub for testing trollFcn in isolation.
// Models AXE, TROLL, TROLL-ROOM, HERE (player room) as plain objects.
// ---------------------------------------------------------------------------

interface StubObj {
  id: string;
  parentId: string | null;
  flags: Set<Flag>;
  ldesc: string | null;
}

function makeStubWorld(trollParent = 'TROLL-ROOM', axeParent = 'TROLL') {
  const troll: StubObj = {
    id: 'TROLL',
    parentId: trollParent,
    flags: new Set([Flag.Fight]),
    ldesc: 'A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the room.',
  };
  const axe: StubObj = {
    id: 'AXE',
    parentId: axeParent,
    flags: new Set([Flag.NonDescript, Flag.Weapon]),  // NDESCBIT + WEAPONBIT when carried
    ldesc: null,
  };

  const objs: Record<string, StubObj> = { TROLL: troll, AXE: axe };

  return {
    troll,
    axe,
    get: (id: string) => objs[id],
  };
}

/** Build a TrollFcnContext from the stub world. */
function makeCtx(opts: {
  trollParent?: string;
  axeParent?: string;
  hereId?: string;
  luck?: boolean;
  rngDraws?: readonly number[];
} = {}): {
  ctx: TrollFcnContext;
  troll: StubObj;
  axe: StubObj;
  trollFlag: { value: boolean };
  clearCalled: { value: boolean };
  emitted: string[];
} {
  const hereId = opts.hereId ?? 'TROLL-ROOM';
  const world = makeStubWorld(opts.trollParent ?? 'TROLL-ROOM', opts.axeParent ?? 'TROLL');
  const trollFlagRef = { value: false };
  const clearCalled = { value: false };
  const emitted: string[] = [];
  const rng = new ScriptedRng(opts.rngDraws ?? [0.5]);

  const ctx: TrollFcnContext = {
    hereId,
    getObj: (id) => {
      const obj = world.get(id);
      if (obj === undefined) return undefined;
      return {
        parentId: obj.parentId,
        hasFlag: (f: Flag) => obj.flags.has(f),
        setFlag: (f: Flag) => { obj.flags.add(f); },
        clearFlag: (f: Flag) => { obj.flags.delete(f); },
        moveTo: (destId: string) => { obj.parentId = destId; },
        setLdesc: (s: string) => { obj.ldesc = s; },
      };
    },
    getTrollFlag: () => trollFlagRef.value,
    setTrollFlag: (v: boolean) => { trollFlagRef.value = v; },
    getLucky: () => opts.luck ?? true,
    rng,
    tell: (s: string) => { emitted.push(s); },
    clearContinuation: () => { clearCalled.value = true; },
  };

  return { ctx, troll: world.troll, axe: world.axe, trollFlag: trollFlagRef, clearCalled, emitted };
}

// ---------------------------------------------------------------------------

describe('TROLL-FCN — F_DEAD', () => {
  it('drops AXE to HERE when axe is held by troll', () => {
    const { ctx, axe } = makeCtx({ axeParent: 'TROLL', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_DEAD);
    expect(axe.parentId).toBe('TROLL-ROOM');
  });

  it('restores axe flags: NDESCBIT cleared, WEAPONBIT set', () => {
    const { ctx, axe } = makeCtx({ axeParent: 'TROLL', hereId: 'TROLL-ROOM' });
    // NDESCBIT = NonDescript; WEAPONBIT = Weapon
    axe.flags.add(Flag.NonDescript);
    axe.flags.delete(Flag.Weapon);
    makeTrollFcn(ctx)(F_DEAD);
    expect(axe.flags.has(Flag.NonDescript)).toBe(false);
    expect(axe.flags.has(Flag.Weapon)).toBe(true);
  });

  it('sets trollFlag=true', () => {
    const { ctx, trollFlag } = makeCtx({ axeParent: 'TROLL' });
    makeTrollFcn(ctx)(F_DEAD);
    expect(trollFlag.value).toBe(true);
  });

  it('no-ops if axe not in troll (axe already dropped)', () => {
    const { ctx, axe } = makeCtx({ axeParent: 'TROLL-ROOM' });
    const origParent = axe.parentId;
    makeTrollFcn(ctx)(F_DEAD);
    // Axe stays where it was; trollFlag still set
    expect(axe.parentId).toBe(origParent);
    expect(axe.flags.has(Flag.Weapon)).toBe(true);
  });
});

describe('TROLL-FCN — F_UNCONSCIOUS', () => {
  it('clears FIGHTBIT on troll', () => {
    const { ctx, troll } = makeCtx({ axeParent: 'TROLL' });
    troll.flags.add(Flag.Fight);
    makeTrollFcn(ctx)(F_UNCONSCIOUS);
    expect(troll.flags.has(Flag.Fight)).toBe(false);
  });

  it('drops AXE to HERE when axe is held by troll', () => {
    const { ctx, axe } = makeCtx({ axeParent: 'TROLL', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_UNCONSCIOUS);
    expect(axe.parentId).toBe('TROLL-ROOM');
  });

  it('restores axe flags: NDESCBIT cleared, WEAPONBIT set', () => {
    const { ctx, axe } = makeCtx({ axeParent: 'TROLL' });
    axe.flags.add(Flag.NonDescript);
    axe.flags.delete(Flag.Weapon);
    makeTrollFcn(ctx)(F_UNCONSCIOUS);
    expect(axe.flags.has(Flag.NonDescript)).toBe(false);
    expect(axe.flags.has(Flag.Weapon)).toBe(true);
  });

  it('updates troll LDESC to unconscious message (exact wording, no embedded newline)', () => {
    const { ctx, troll } = makeCtx({ axeParent: 'TROLL', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_UNCONSCIOUS);
    expect(troll.ldesc).toBe(CANONICAL_UNCONSCIOUS);
  });

  it('sets trollFlag=true', () => {
    const { ctx, trollFlag } = makeCtx({ axeParent: 'TROLL' });
    makeTrollFcn(ctx)(F_UNCONSCIOUS);
    expect(trollFlag.value).toBe(true);
  });
});

describe('TROLL-FCN — F_CONSCIOUS', () => {
  it('sets FIGHTBIT and emits revival message when troll is in HERE', () => {
    const { ctx, troll, emitted } = makeCtx({ trollParent: 'TROLL-ROOM', hereId: 'TROLL-ROOM' });
    troll.flags.delete(Flag.Fight);
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.flags.has(Flag.Fight)).toBe(true);
    expect(emitted.some(s => s.toLowerCase().includes('stirs'))).toBe(true);
  });

  it('does NOT set FIGHTBIT when troll is NOT in HERE', () => {
    const { ctx, troll } = makeCtx({ trollParent: 'OTHER-ROOM', hereId: 'TROLL-ROOM' });
    troll.flags.delete(Flag.Fight);
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.flags.has(Flag.Fight)).toBe(false);
  });

  it('recovers axe to troll when axe is in TROLL-ROOM', () => {
    const { ctx, axe } = makeCtx({ trollParent: 'TROLL-ROOM', axeParent: 'TROLL-ROOM', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(axe.parentId).toBe('TROLL');
    // Axe should have NDESCBIT set and WEAPONBIT cleared (carried by troll)
    expect(axe.flags.has(Flag.NonDescript)).toBe(true);
    expect(axe.flags.has(Flag.Weapon)).toBe(false);
  });

  it('updates troll LDESC to brandishing message when axe in troll after recovery', () => {
    const { ctx, troll } = makeCtx({ trollParent: 'TROLL-ROOM', axeParent: 'TROLL-ROOM', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.ldesc).toContain('brandishing');
  });

  it('sets LDESC to brandishing message when axe already in troll', () => {
    const { ctx, troll } = makeCtx({ trollParent: 'TROLL-ROOM', axeParent: 'TROLL', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.ldesc).toContain('brandishing');
  });

  it('sets LDESC to bare troll message when axe is elsewhere', () => {
    const { ctx, troll } = makeCtx({ trollParent: 'TROLL-ROOM', axeParent: 'OTHER-ROOM', hereId: 'TROLL-ROOM' });
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.ldesc).toContain('troll');
    expect(troll.ldesc).not.toContain('brandishing');
  });

  it('sets trollFlag=false', () => {
    const { ctx, trollFlag } = makeCtx({ trollParent: 'TROLL-ROOM', hereId: 'TROLL-ROOM' });
    trollFlag.value = true;
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(trollFlag.value).toBe(false);
  });
});

describe('TROLL-FCN — F_FIRST', () => {
  it('returns true, sets FIGHTBIT, clears P-CONT when prob(33) succeeds', () => {
    // draw < 0.33 → prob(33) succeeds
    const { ctx, troll, clearCalled } = makeCtx({ rngDraws: [0.1] });
    troll.flags.delete(Flag.Fight);
    const result = makeTrollFcn(ctx)(F_FIRST);
    expect(result).toBe(true);
    expect(troll.flags.has(Flag.Fight)).toBe(true);
    expect(clearCalled.value).toBe(true);
  });

  it('returns false when prob(33) fails', () => {
    // draw >= 0.33 → prob(33) fails (0.33*100 = 33, not < 33)
    const { ctx, troll, clearCalled } = makeCtx({ rngDraws: [0.9] });
    troll.flags.delete(Flag.Fight);
    const result = makeTrollFcn(ctx)(F_FIRST);
    expect(result).toBe(false);
    expect(troll.flags.has(Flag.Fight)).toBe(false);
    expect(clearCalled.value).toBe(false);
  });
});

describe('TROLL-FCN — F_BUSY', () => {
  it('returns false (no-op) when axe is already in troll', () => {
    const { ctx } = makeCtx({ axeParent: 'TROLL' });
    const result = makeTrollFcn(ctx)(F_BUSY);
    expect(result).toBe(false);
  });

  it('picks up axe from HERE when zprob(75) succeeds (lucky)', () => {
    // draw=0.1 → next()*100 = 10 < 75 → zprob(75, 100) succeeds
    const { ctx, axe, emitted } = makeCtx({
      axeParent: 'TROLL-ROOM',
      hereId: 'TROLL-ROOM',
      luck: true,
      rngDraws: [0.1],
    });
    const result = makeTrollFcn(ctx)(F_BUSY);
    expect(result).toBe(true);
    expect(axe.parentId).toBe('TROLL');
    // Axe should have NDESCBIT set and WEAPONBIT cleared (now carried by troll)
    expect(axe.flags.has(Flag.NonDescript)).toBe(true);
    expect(axe.flags.has(Flag.Weapon)).toBe(false);
    expect(emitted).toContain(CANONICAL_AXE_RECOVER);
  });

  it('shows cowering message when zprob(75) fails (axe in HERE)', () => {
    // draw=0.9 → next()*100 = 90 >= 75 → zprob(75, 100) fails
    const { ctx, axe, emitted } = makeCtx({
      axeParent: 'TROLL-ROOM',
      hereId: 'TROLL-ROOM',
      luck: true,
      rngDraws: [0.9],
    });
    const result = makeTrollFcn(ctx)(F_BUSY);
    expect(result).toBe(true);
    expect(axe.parentId).toBe('TROLL-ROOM');  // not moved
    expect(emitted).toContain(CANONICAL_COWER);
  });

  it('unlucky: higher threshold for axe recovery (zprob 75 with denom=300)', () => {
    // draw=0.1 → next()*300 = 30 < 75 → zprob(75, 300) succeeds even unlucky
    const { ctx, axe } = makeCtx({
      axeParent: 'TROLL-ROOM',
      hereId: 'TROLL-ROOM',
      luck: false,
      rngDraws: [0.1],
    });
    const result = makeTrollFcn(ctx)(F_BUSY);
    expect(result).toBe(true);
    expect(axe.parentId).toBe('TROLL');
  });

  it('shows cowering when axe is not in troll and not in HERE', () => {
    const { ctx, emitted } = makeCtx({ axeParent: 'OTHER-ROOM', hereId: 'TROLL-ROOM' });
    const result = makeTrollFcn(ctx)(F_BUSY);
    expect(result).toBe(true);
    expect(emitted).toContain(CANONICAL_COWER);
  });

  it('updates troll LDESC to brandishing when troll gets axe back', () => {
    const { ctx, troll } = makeCtx({
      axeParent: 'TROLL-ROOM',
      hereId: 'TROLL-ROOM',
      luck: true,
      rngDraws: [0.1],
    });
    makeTrollFcn(ctx)(F_BUSY);
    expect(troll.ldesc).toContain('brandishing');
  });
});

describe('TROLL-FCN — TROLL-FLAG double-duty (spec §10.2)', () => {
  it('F_BUSY: AXE in TROLL short-circuits (trollFlag stays false)', () => {
    const { ctx, trollFlag } = makeCtx({ axeParent: 'TROLL' });
    trollFlag.value = false;
    makeTrollFcn(ctx)(F_BUSY);
    // No-op: false return, trollFlag unchanged
    expect(trollFlag.value).toBe(false);
  });
});

// objects.json:2257 canonical LDESC — no embedded newline (player-visible wording check).
const CANONICAL_BRANDISHING =
  'A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the room.';
// 1actions.zil:659 — ZIL line-wrap collapses to single space.
const CANONICAL_UNCONSCIOUS =
  'An unconscious troll is sprawled on the floor. All passages out of the room are open.';
// 1actions.zil:649 — ZIL line-wrap collapses to single space.
const CANONICAL_AXE_RECOVER =
  'The troll, angered and humiliated, recovers his weapon. He appears to have an axe to grind with you.';
// 1actions.zil:655 — ZIL line-wrap collapses to single space.
const CANONICAL_COWER =
  'The troll, disarmed, cowers in terror, pleading for his life in the guttural tongue of the trolls.';

describe('TROLL-FCN — LDESC exact wording (player-visible)', () => {
  it('F_BUSY pickup sets brandishing LDESC with no embedded newline', () => {
    const { ctx, troll } = makeCtx({
      axeParent: 'TROLL-ROOM',
      hereId: 'TROLL-ROOM',
      luck: true,
      rngDraws: [0.1],
    });
    makeTrollFcn(ctx)(F_BUSY);
    expect(troll.ldesc).toBe(CANONICAL_BRANDISHING);
  });

  it('F_CONSCIOUS (axe in troll) sets brandishing LDESC with no embedded newline', () => {
    const { ctx, troll } = makeCtx({
      trollParent: 'TROLL-ROOM',
      axeParent: 'TROLL',
      hereId: 'TROLL-ROOM',
    });
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.ldesc).toBe(CANONICAL_BRANDISHING);
  });

  it('F_CONSCIOUS recovery (axe in TROLL-ROOM) sets brandishing LDESC with no embedded newline', () => {
    const { ctx, troll } = makeCtx({
      trollParent: 'TROLL-ROOM',
      axeParent: 'TROLL-ROOM',
      hereId: 'TROLL-ROOM',
    });
    makeTrollFcn(ctx)(F_CONSCIOUS);
    expect(troll.ldesc).toBe(CANONICAL_BRANDISHING);
  });
});
