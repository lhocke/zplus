/**
 * C1 — CYCLOPS-FCN + CYCLOPS-ROOM-FCN
 *
 * Done-criteria (spec §8 Wave 3, C1):
 *   - give lunch → pepper message, CYCLOWRATH goes negative, enableClock('I-CYCLOPS') called
 *   - give water (thirsty, CYCLOWRATH<0) → sleep message, CYCLOPS-FLAG set, FIGHTBIT cleared
 *   - give water (not thirsty, CYCLOWRATH≥0) → refusal message
 *   - give garlic → limit message
 *   - give other food → "not so stupid" message
 *   - CYCLOPS-ROOM-FCN M-LOOK: 5 state branches (flag/magic/zero/pos/neg CYCLOWRATH)
 *   - CYCLOPS-ROOM-FCN M-ENTER: enableClock when CYCLOWRATH != 0
 *   - sleeping cyclops EXAMINE → "sleeping like a baby"
 *   - sleeping cyclops ALARM/KICK/ATTACK/BURN/MUNG → wakes, FIGHTBIT set, CYCLOPS-FLAG cleared
 *   - EXAMINE (awake, not sleeping) → "hungry cyclops"
 *   - TAKE → "doesn't take kindly"
 *   - TIE → "fit to be tied"
 *   - LISTEN → "stomach rumbling"
 *   - THROW/MUNG → I-CYCLOPS enabled; MUNG dodge message; THROW → shrugs + moves PRSO to HERE
 *
 * ZIL citations:
 *   CYCLOPS-FCN       1actions.zil:1515–1594
 *   CYCLOPS-ROOM-FCN  1actions.zil:1616–1642
 *   CYCLOMAD          1actions.zil:1644–1652
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Flag } from '../../src/domain/flags.js';
import { M_LOOK, M_ENTER } from '../../src/engine/messages.js';
import {
  cyclopsFcn,
  cyclopsRoomFcn,
  type CyclopsCtx,
} from '../../src/actions/cyclops.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { setCyclowrath } from '../../src/actions/thief-state.js';

// Minimal type shim so we can poke the private FlagStore in tests.
type Flags = { set(k: string, v: boolean): void };

// ---------------------------------------------------------------------------
// Minimal object stub
// ---------------------------------------------------------------------------

interface StubObj {
  id: string;
  parentId: string | null;
  flags: Set<Flag>;
}

function makeObj(id: string, parent: string | null, flags: Flag[] = []): StubObj {
  return { id, parentId: parent, flags: new Set(flags) };
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

// Derive default action from verb word when not explicitly supplied.
// Mirrors the syntax.json mapping for the verbs used in tests.
function defaultAction(verb: string): string {
  const map: Record<string, string> = {
    examine: 'V-EXAMINE', look: 'V-EXAMINE',
    attack: 'V-ATTACK', kill: 'V-ATTACK', stab: 'V-ATTACK',
    strike: 'V-ATTACK', knock: 'V-ATTACK',
    throw: 'V-THROW',
    mung: 'V-MUNG', destroy: 'V-MUNG', poke: 'V-MUNG', puncture: 'V-MUNG',
    alarm: 'V-ALARM', wake: 'V-ALARM',
    kick: 'V-KICK',
    burn: 'V-BURN',
    give: 'V-GIVE',
    take: 'V-TAKE',
    tie: 'V-TIE',
    listen: 'V-LISTEN',
    odysseus: 'V-ODYSSEUS',
  };
  return map[verb] ?? verb.toUpperCase();
}

function makeCtx(opts: {
  hereId?: string;
  verb?: string;
  /** ZIL PRSA — defaults to the action implied by verb. */
  action?: string;
  prsoId?: string;
  prsiId?: string;
  rarg?: number;
  objs?: StubObj[];
  cyclopsFlag?: boolean;
  magicFlag?: boolean;
  cyclowrath?: number;
  winner?: string;
} = {}): { ctx: CyclopsCtx; output: string[]; clockCalls: { enable: string[]; disable: string[] } } {
  const hereId = opts.hereId ?? 'CYCLOPS-ROOM';
  const objs = new Map<string, StubObj>();
  for (const o of opts.objs ?? []) objs.set(o.id, o);

  const output: string[] = [];
  const clockCalls = { enable: [] as string[], disable: [] as string[] };

  let cyclopsFlag = opts.cyclopsFlag ?? false;
  let magicFlag = opts.magicFlag ?? false;
  let _cyclowrath = opts.cyclowrath ?? 0;

  const verbWord = opts.verb ?? 'examine';
  const action = opts.action ?? defaultAction(verbWord);

  const ctx: CyclopsCtx = {
    hereId,
    action,
    verb: verbWord,
    prsoId: opts.prsoId,
    prsiId: opts.prsiId,
    rarg: opts.rarg,
    winner: opts.winner ?? 'ADVENTURER',

    getCyclopsFlag: () => cyclopsFlag,
    setCyclopsFlag: (v) => { cyclopsFlag = v; },
    getMagicFlag: () => magicFlag,
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
        moveTo: (destId) => {
          o.parentId = destId;
        },
        removeFromWorld: () => {
          o.parentId = null;
        },
      };
    },

    tell: (s) => output.push(s),
    enableClock: (id) => clockCalls.enable.push(id),
    disableClock: (id) => clockCalls.disable.push(id),
  };

  return { ctx, output, clockCalls };
}

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — give lunch (1actions.zil:1544–1552)
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: give lunch', () => {
  it('when CYCLOWRATH >= 0: eats peppers, CYCLOWRATH → min(-1, -count), I-CYCLOPS enabled', () => {
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: 0, objs: [lunch],
    });

    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('hot peppers');
    expect(ctx.getCyclowrath()).toBeLessThan(0);
    // REMOVE-CAREFULLY LUNCH
    expect(lunch.parentId).toBeNull();
    // I-CYCLOPS enabled unconditionally on give-lunch path
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  it('give lunch when CYCLOWRATH > 0: still eats (count >= 0)', () => {
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const { ctx, output } = makeCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: 2, objs: [lunch],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('hot peppers');
    // CYCLOWRATH = min(-1, -2) = -2
    expect(ctx.getCyclowrath()).toBe(-2);
  });

  it('give lunch when already thirsty (CYCLOWRATH < 0): does NOT eat; I-CYCLOPS still enabled', () => {
    // ZIL: <COND (<NOT <L? .COUNT 0>> ...)> — only eats when count >= 0
    const lunch = makeObj('LUNCH', 'ADVENTURER');
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'give', prsoId: 'LUNCH', prsiId: 'CYCLOPS',
      cyclowrath: -1, objs: [lunch],
    });
    cyclopsFcn(ctx);
    // No pepper message when already thirsty
    expect(output.join('\n')).not.toContain('hot peppers');
    // But I-CYCLOPS is still enabled (outer ENABLE is unconditional)
    expect(clockCalls.enable).toContain('I-CYCLOPS');
    // LUNCH NOT removed
    expect(lunch.parentId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — give water (1actions.zil:1553–1568)
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: give water', () => {
  it('give WATER when thirsty (CYCLOWRATH<0): cyclops sleeps, CYCLOPS-FLAG set', () => {
    const water = makeObj('WATER', 'ADVENTURER');
    const bottle = makeObj('BOTTLE', 'SOME-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: -1, objs: [water, bottle],
      hereId: 'CYCLOPS-ROOM',
    });

    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('falls fast asleep');
    expect(ctx.getCyclopsFlag()).toBe(true);
    // WATER removed, BOTTLE moved to HERE, BOTTLE OPENBIT set
    expect(water.parentId).toBeNull();
    expect(bottle.parentId).toBe('CYCLOPS-ROOM');
    expect(bottle.flags.has(Flag.Open)).toBe(true);
  });

  it('give BOTTLE containing WATER when thirsty: cyclops sleeps', () => {
    const water = makeObj('WATER', 'BOTTLE');
    const bottle = makeObj('BOTTLE', 'ADVENTURER');
    const { ctx, output } = makeCtx({
      verb: 'give', prsoId: 'BOTTLE', prsiId: 'CYCLOPS',
      cyclowrath: -2, objs: [water, bottle],
      hereId: 'CYCLOPS-ROOM',
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('falls fast asleep');
    expect(ctx.getCyclopsFlag()).toBe(true);
  });

  it('give WATER when NOT thirsty (CYCLOWRATH >= 0): refuses', () => {
    const water = makeObj('WATER', 'ADVENTURER');
    const { ctx, output } = makeCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: 0, objs: [water],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('not thirsty');
    expect(ctx.getCyclopsFlag()).toBe(false);
  });

  it('give water clears FIGHTBIT on cyclops', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM', [Flag.Fight]);
    const water = makeObj('WATER', 'ADVENTURER');
    const bottle = makeObj('BOTTLE', 'CYCLOPS-ROOM');
    const { ctx } = makeCtx({
      verb: 'give', prsoId: 'WATER', prsiId: 'CYCLOPS',
      cyclowrath: -1, objs: [cyclops, water, bottle],
    });
    cyclopsFcn(ctx);
    expect(cyclops.flags.has(Flag.Fight)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — give garlic / other
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: give garlic / other food', () => {
  it('give GARLIC: "there is a limit" — 1actions.zil:1569–1571', () => {
    const garlic = makeObj('GARLIC', 'ADVENTURER');
    const { ctx, output } = makeCtx({
      verb: 'give', prsoId: 'GARLIC', prsiId: 'CYCLOPS',
      objs: [garlic],
    });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('limit');
  });

  it('give other item: "not so stupid" — 1actions.zil:1572–1574', () => {
    const coin = makeObj('BAG-OF-COINS', 'ADVENTURER');
    const { ctx, output } = makeCtx({
      verb: 'give', prsoId: 'BAG-OF-COINS', prsiId: 'CYCLOPS',
      objs: [coin],
    });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('not so stupid');
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — sleeping cyclops branches (1actions.zil:1527–1539)
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: sleeping cyclops (CYCLOPS-FLAG=true)', () => {
  it('EXAMINE sleeping: "sleeping like a baby"', () => {
    const { ctx, output } = makeCtx({ verb: 'examine', cyclopsFlag: true });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('sleeping like a baby');
  });

  // LOOK AT → V-EXAMINE (same action); ZIL <VERB? EXAMINE> catches both.
  it('LOOK AT sleeping: "sleeping like a baby" (V-EXAMINE covers look-at)', () => {
    const { ctx, output } = makeCtx({ verb: 'look', action: 'V-EXAMINE', cyclopsFlag: true });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('sleeping like a baby');
  });

  it('KICK sleeping: wakes, FIGHTBIT set, CYCLOPS-FLAG cleared', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'kick', cyclopsFlag: true, cyclowrath: 0, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
    expect(cyclops.flags.has(Flag.Fight)).toBe(true);
  });

  // V-ALARM covers wake/awake/surprise/startle (gsyntax.zil:527-529).
  // Original code compared ctx.verb === 'alarm' which never matched a player command.
  it('WAKE sleeping (V-ALARM): wakes the cyclops', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'wake', action: 'V-ALARM', cyclopsFlag: true, cyclowrath: 0, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
    expect(cyclops.flags.has(Flag.Fight)).toBe(true);
  });

  it('ALARM sleeping: wakes (preserves magnitude from negative count)', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    // count was -3 before sleeping; test with canonical V-ALARM action
    const { ctx } = makeCtx({
      verb: 'wake', action: 'V-ALARM', cyclopsFlag: true, cyclowrath: -3, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    // ZIL: if COUNT < 0 → CYCLOWRATH = -COUNT → 3
    expect(ctx.getCyclowrath()).toBe(3);
    expect(ctx.getCyclopsFlag()).toBe(false);
  });

  it('ATTACK sleeping: wakes (count >= 0 → keep count)', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx } = makeCtx({
      verb: 'attack', cyclopsFlag: true, cyclowrath: 2, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(ctx.getCyclowrath()).toBe(2);
  });

  // KILL → V-ATTACK (same action as ATTACK); sleeping cyclops must wake.
  it('KILL sleeping (V-ATTACK): wakes the cyclops', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'kill', action: 'V-ATTACK', cyclopsFlag: true, cyclowrath: 0, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
  });

  // DESTROY → V-MUNG (gsyntax.zil:158-163; synonym: damage/break/block/smash).
  // Original code compared ctx.verb === 'mung' which never matched any player command.
  it('DESTROY sleeping (V-MUNG): wakes the cyclops', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'destroy', action: 'V-MUNG', cyclopsFlag: true, cyclowrath: 0, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
  });

  it('BURN sleeping: wakes', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'burn', cyclopsFlag: true, cyclowrath: 0, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
  });

  it('MUNG (direct V-MUNG action): wakes sleeping cyclops', () => {
    const cyclops = makeObj('CYCLOPS', 'CYCLOPS-ROOM');
    const { ctx, output } = makeCtx({
      verb: 'destroy', action: 'V-MUNG', cyclopsFlag: true, cyclowrath: 0, objs: [cyclops],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('yawns');
    expect(ctx.getCyclopsFlag()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — WINNER == CYCLOPS (talk-to-cyclops path) — 1actions.zil:1517–1526
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: WINNER == CYCLOPS (player addressing it)', () => {
  it('sleeping: "fast asleep"', () => {
    const { ctx, output } = makeCtx({ winner: 'CYCLOPS', cyclopsFlag: true });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('fast asleep');
  });

  it('awake: "prefers eating to making conversation"', () => {
    const { ctx, output } = makeCtx({ winner: 'CYCLOPS', cyclopsFlag: false });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('prefers eating');
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — EXAMINE (awake) — 1actions.zil:1540–1542
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: EXAMINE awake cyclops', () => {
  it('shows hungry cyclops at foot of stairs', () => {
    const { ctx, output } = makeCtx({ verb: 'examine', cyclopsFlag: false });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('hungry cyclops');
    expect(output.join('\n')).toContain('foot of the stairs');
  });

  // "look at cyclops" → V-EXAMINE (gsyntax.zil:301); ZIL <VERB? EXAMINE> catches both.
  it('LOOK AT (V-EXAMINE): shows hungry cyclops at foot of stairs', () => {
    const { ctx, output } = makeCtx({ verb: 'look', action: 'V-EXAMINE', cyclopsFlag: false });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('hungry cyclops');
    expect(output.join('\n')).toContain('foot of the stairs');
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — THROW/ATTACK/MUNG (awake) — 1actions.zil:1575–1585
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: THROW/ATTACK/MUNG awake', () => {
  it('MUNG (V-MUNG via destroy): dodge message + I-CYCLOPS enabled', () => {
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'destroy', action: 'V-MUNG', cyclopsFlag: false,
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain("stupid as my father");
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  it('POKE (V-MUNG): dodge message + I-CYCLOPS enabled', () => {
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'poke', action: 'V-MUNG', cyclopsFlag: false,
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain("stupid as my father");
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  it('ATTACK (V-ATTACK): shrugs message + I-CYCLOPS enabled', () => {
    const { ctx, output, clockCalls } = makeCtx({ verb: 'attack', cyclopsFlag: false });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('shrugs');
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  // KILL → V-ATTACK; ZIL <VERB? ATTACK> matches all synonyms via PRSA.
  it('KILL (V-ATTACK): shrugs message + I-CYCLOPS enabled', () => {
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'kill', action: 'V-ATTACK', cyclopsFlag: false,
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('shrugs');
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  // STAB X WITH WEAPON → V-ATTACK (gsyntax.zil:269-270).
  it('STAB (V-ATTACK): shrugs message + I-CYCLOPS enabled', () => {
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'stab', action: 'V-ATTACK', cyclopsFlag: false,
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('shrugs');
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  // STRIKE X WITH WEAPON → V-ATTACK (gsyntax.zil:455-456).
  it('STRIKE (V-ATTACK): shrugs message + I-CYCLOPS enabled', () => {
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'strike', action: 'V-ATTACK', cyclopsFlag: false,
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('shrugs');
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  it('THROW: shrugs message, PRSO moved to HERE, I-CYCLOPS enabled', () => {
    const prso = makeObj('KNIFE', 'ADVENTURER');
    const { ctx, output, clockCalls } = makeCtx({
      verb: 'throw', prsoId: 'KNIFE', cyclopsFlag: false,
      hereId: 'CYCLOPS-ROOM', objs: [prso],
    });
    cyclopsFcn(ctx);
    expect(output.join('\n')).toContain('shrugs');
    expect(prso.parentId).toBe('CYCLOPS-ROOM');
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-FCN — TAKE / TIE / LISTEN — 1actions.zil:1586–1594
// ---------------------------------------------------------------------------

describe('CYCLOPS-FCN: TAKE/TIE/LISTEN', () => {
  it('TAKE: "doesn\'t take kindly"', () => {
    const { ctx, output } = makeCtx({ verb: 'take' });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain("doesn't take kindly");
  });

  it('TIE (V-TIE): "fit to be tied"', () => {
    const { ctx, output } = makeCtx({ verb: 'tie' });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('fit to be tied');
  });

  // ZIL 1actions.zil:1589 only checks <VERB? TIE> — V-TIE-UP is a distinct action
  // (gsyntax.zil:498, gverbs.zil:1471) that CYCLOPS-FCN does NOT intercept.
  // Returning false lets the default V-TIE-UP routine run ("You could certainly
  // never tie it with that!") — gverbs.zil:1471.
  it('TIE-UP (V-TIE-UP): falls through (returns false)', () => {
    const { ctx, output } = makeCtx({ verb: 'tie', action: 'V-TIE-UP' });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(false);
    expect(output).toHaveLength(0);
  });

  it('LISTEN: "stomach rumbling"', () => {
    const { ctx, output } = makeCtx({ verb: 'listen' });
    const r = cyclopsFcn(ctx);
    expect(r).toBe(true);
    expect(output.join('\n')).toContain('stomach rumbling');
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-ROOM-FCN — M-LOOK: 5 state branches (1actions.zil:1617–1640)
// ---------------------------------------------------------------------------

describe('CYCLOPS-ROOM-FCN: M-LOOK state branches', () => {
  // Branch 1: CYCLOPS-FLAG=true, MAGIC-FLAG=false → sleeping blissfully
  it('CYCLOPS-FLAG=true, MAGIC-FLAG=false → sleeping blissfully', () => {
    const { ctx, output } = makeCtx({
      rarg: M_LOOK, cyclopsFlag: true, magicFlag: false, cyclowrath: 0,
    });
    cyclopsRoomFcn(ctx);
    expect(output.join('\n')).toContain('sleeping blissfully');
  });

  // Branch 2: MAGIC-FLAG=true → east wall opening
  it('MAGIC-FLAG=true → east wall opening', () => {
    const { ctx, output } = makeCtx({
      rarg: M_LOOK, cyclopsFlag: false, magicFlag: true,
    });
    cyclopsRoomFcn(ctx);
    expect(output.join('\n')).toContain('cyclops-sized opening');
  });

  // Branch 3: CYCLOWRATH == 0 → default cyclops description (blocking staircase)
  it('CYCLOWRATH==0 → cyclops blocking staircase', () => {
    const { ctx, output } = makeCtx({
      rarg: M_LOOK, cyclopsFlag: false, magicFlag: false, cyclowrath: 0,
    });
    cyclopsRoomFcn(ctx);
    expect(output.join('\n')).toContain('eat horses');
    expect(output.join('\n')).toContain('blocks the staircase');
  });

  // Branch 4: CYCLOWRATH > 0 → eyeing you closely
  it('CYCLOWRATH>0 → eyeing you closely', () => {
    const { ctx, output } = makeCtx({
      rarg: M_LOOK, cyclopsFlag: false, magicFlag: false, cyclowrath: 2,
    });
    cyclopsRoomFcn(ctx);
    expect(output.join('\n')).toContain('eyeing you closely');
  });

  // Branch 5: CYCLOWRATH < 0 → gasping from hot peppers
  it('CYCLOWRATH<0 → gasping (ate peppers)', () => {
    const { ctx, output } = makeCtx({
      rarg: M_LOOK, cyclopsFlag: false, magicFlag: false, cyclowrath: -2,
    });
    cyclopsRoomFcn(ctx);
    expect(output.join('\n')).toContain('hot peppers');
    expect(output.join('\n')).toContain('gasping');
  });

  // All M-LOOK branches emit the base room description first
  it('M-LOOK always emits the base room line first', () => {
    const { ctx, output } = makeCtx({ rarg: M_LOOK, cyclowrath: 0 });
    cyclopsRoomFcn(ctx);
    expect(output[0]).toContain('exit on the northwest');
    expect(output[0]).toContain('staircase leading up');
  });

  it('returns true for M-LOOK', () => {
    const { ctx } = makeCtx({ rarg: M_LOOK });
    expect(cyclopsRoomFcn(ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-ROOM-FCN — M-ENTER: enable I-CYCLOPS when CYCLOWRATH != 0
// ---------------------------------------------------------------------------

describe('CYCLOPS-ROOM-FCN: M-ENTER', () => {
  it('M-ENTER with CYCLOWRATH != 0: enables I-CYCLOPS', () => {
    const { ctx, clockCalls } = makeCtx({
      rarg: M_ENTER, cyclowrath: 3,
    });
    cyclopsRoomFcn(ctx);
    expect(clockCalls.enable).toContain('I-CYCLOPS');
  });

  it('M-ENTER with CYCLOWRATH == 0: does NOT enable I-CYCLOPS', () => {
    const { ctx, clockCalls } = makeCtx({
      rarg: M_ENTER, cyclowrath: 0,
    });
    cyclopsRoomFcn(ctx);
    expect(clockCalls.enable).not.toContain('I-CYCLOPS');
  });

  it('M-ENTER returns false (fall-through)', () => {
    const { ctx } = makeCtx({ rarg: M_ENTER, cyclowrath: 0 });
    expect(cyclopsRoomFcn(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CYCLOPS-ROOM-FCN — non M-LOOK/M-ENTER rargs
// ---------------------------------------------------------------------------

describe('CYCLOPS-ROOM-FCN: other rargs', () => {
  it('returns false for non-M-LOOK/M-ENTER rarg', () => {
    const { ctx } = makeCtx({ rarg: 99 });
    expect(cyclopsRoomFcn(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end look through game.turn('look') — exercises the full look path.
//
// This is the regression guard for the H2-interim ldesc bug: CYCLOPS-ROOM had
// a static ldesc that short-circuited the mlookRunner (verbs/index.ts:259).
// With the ldesc removed, look falls through to CYCLOPS-ROOM-FCN, which owns
// the description for all five states (ZIL 1actions.zil:1616–1642).
// ---------------------------------------------------------------------------

// Minimal type shim for world object access in setup callbacks.
type WorldHandle = { get(id: string): { set(f: unknown): void; moveTo(d: unknown): void } | undefined };

/** Light the lamp and put it in the player's hand so underground rooms aren't dark. */
function litLamp(g: ReturnType<typeof createGame>): void {
  const w = (g as unknown as { world: WorldHandle }).world;
  const player = w.get('PLAYER') as never;
  const lamp = w.get('LAMP');
  lamp?.moveTo(player);
  lamp?.set(Flag.OnFire);
  lamp?.set(Flag.Light);
}

describe('CYCLOPS-ROOM-FCN: end-to-end look via game.turn', () => {
  // Reset cyclowrath module state between cases so tests are independent.
  beforeEach(() => setCyclowrath(0));

  it('default awake look (wrath=0): shows "eat horses" staircase text', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    const r = g.turn('look');
    expect(r.output).toContain('eat horses');
    expect(r.output).toContain('blocks the staircase');
  });

  it('CYCLOPS-FLAG=true → "sleeping blissfully" via game.turn', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    (g as unknown as { flags: Flags }).flags.set('CYCLOPS-FLAG', true);
    const r = g.turn('look');
    expect(r.output).toContain('sleeping blissfully');
  });

  it('MAGIC-FLAG=true → "cyclops-sized opening" via game.turn', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    (g as unknown as { flags: Flags }).flags.set('MAGIC-FLAG', true);
    const r = g.turn('look');
    expect(r.output).toContain('cyclops-sized opening');
  });
});

// ---------------------------------------------------------------------------
// V-TIE-UP end-to-end: cyclopsFcn falls through; default gverbs.zil:1471 fires.
//
// "tie up cyclops with rope": V-TIE-UP, PRSO=CYCLOPS, PRSI=ROPE.
// ZIL CYCLOPS-FCN only checks <VERB? TIE> (1actions.zil:1589), so V-TIE-UP
// falls through and V-TIE-UP () in gverbs.zil:1471 prints the default message.
// ---------------------------------------------------------------------------

describe('V-TIE-UP: end-to-end via game.turn', () => {
  it('"tie up cyclops with rope" → default V-TIE-UP message (gverbs.zil:1471)', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    // Move rope to player so the parser can resolve it as iobj.
    const w = (g as unknown as { world: WorldHandle }).world;
    const player = w.get('PLAYER') as never;
    w.get('ROPE')?.moveTo(player);
    const r = g.turn('tie up cyclops with rope');
    expect(r.output).toContain('You could certainly never tie it with that!');
  });
});
