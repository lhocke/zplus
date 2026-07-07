/**
 * CB0 — PRSA ratify + unify (spec §5.1)
 *
 * Verifies:
 *  1. VerbContext carries `action` (ZIL PRSA) at dispatch time so handlers
 *     route on action id, not the surface verb word.
 *  2. Non-primary synonyms reach the same ACTION_HANDLERS entry as the
 *     canonical verb — e.g. "hurl" and "chuck" both dispatch V-THROW.
 *  3. ActionContext.action is always set at dispatch (no ac.action ?? ac.verb
 *     fallback needed in handlers).
 *  4. After the sweep, light-source handlers respond to synonym inputs that
 *     previously fell through because they checked ctx.verb (surface word)
 *     rather than ctx.action (V-* id).
 *
 * ZIL ref: gmain.zil:283–284 (PERFORM dispatches on PRSA, not verb word).
 * Spec §5.1 A.1 decision rule: ctx.verb === 'X' where X has a V-* id →
 * migrate to ctx.action === 'V-X'.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { ActionContext } from '../../src/domain/game-object.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';

// ---------------------------------------------------------------------------
// 1. VerbContext.action — interface contract
// ---------------------------------------------------------------------------

describe('CB0 — VerbContext has action populated', () => {
  it('VerbContext type accepts action field (compile-time + runtime)', () => {
    // VerbContext must expose `action` so handlers can read ctx.action.
    const stub: VerbContext = {
      verb: 'take',
      action: 'V-TAKE',
      player: {} as never,
      here: {} as never,
      world: {} as never,
    };
    expect(stub.action).toBe('V-TAKE');
  });
});

// ---------------------------------------------------------------------------
// 2. ActionContext.action — always populated at dispatch (no fallback needed)
// ---------------------------------------------------------------------------

describe('CB0 — ActionContext.action populated at every dispatch site', () => {
  it('lantern handler sees ctx.action=V-THROW when lamp is thrown (not undefined)', async () => {
    const g = newGameAt('TROLL-ROOM');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);

    let capturedAction: string | undefined = undefined;
    const original = lamp.handler!;
    lamp.handler = (ctx: ActionContext) => {
      capturedAction = ctx.action;
      return original(ctx);
    };

    // "throw lamp at troll" → V-THROW; lamp is dobj; lantern handler fires.
    await g.turn('throw lamp at troll');
    expect(capturedAction).toBeDefined();
    expect(capturedAction).toBe('V-THROW');
  });

  it('lantern handler sees ctx.action=V-LAMP-ON on "turn on lamp"', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);

    let capturedAction: string | undefined = undefined;
    const original = lamp.handler!;
    lamp.handler = (ctx: ActionContext) => {
      capturedAction = ctx.action;
      return original(ctx);
    };

    await g.turn('turn on lamp');
    expect(capturedAction).toBe('V-LAMP-ON');
  });

  it('lantern handler sees ctx.action=V-LAMP-OFF on "turn off lamp"', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);

    let capturedAction: string | undefined = undefined;
    const original = lamp.handler!;
    lamp.handler = (ctx: ActionContext) => {
      capturedAction = ctx.action;
      return original(ctx);
    };

    await g.turn('turn off lamp');
    expect(capturedAction).toBe('V-LAMP-OFF');
  });

  it('lantern handler sees ctx.action=V-EXAMINE on "examine lamp"', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);

    let capturedAction: string | undefined = undefined;
    const original = lamp.handler!;
    lamp.handler = (ctx: ActionContext) => {
      capturedAction = ctx.action;
      return original(ctx);
    };

    await g.turn('examine lamp');
    expect(capturedAction).toBe('V-EXAMINE');
  });
});

// ---------------------------------------------------------------------------
// 3. Non-primary synonyms reach the same handler (synonym coverage tests)
//    At least one per priority verb group — spec §5.1 done-criteria.
// ---------------------------------------------------------------------------

describe('CB0 — synonym coverage: TAKE family (get, grab, carry)', () => {
  it('"get lamp" reaches V-TAKE (not unknown verb)', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.world.get('WEST-OF-HOUSE')!);
    const out = await (await g.turn('get lamp')).output;
    expect(out).not.toMatch(/don't know how to/i);
    expect(out).toMatch(/taken/i);
  });

  it('"grab lamp" reaches V-TAKE', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.world.get('WEST-OF-HOUSE')!);
    const out = await (await g.turn('grab lamp')).output;
    expect(out).not.toMatch(/don't know how to/i);
    expect(out).toMatch(/taken/i);
  });
});

describe('CB0 — synonym coverage: EXAMINE family (describe)', () => {
  it('"describe mailbox" reaches V-EXAMINE (not unknown verb)', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('describe mailbox')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

describe('CB0 — synonym coverage: THROW family — synonym reaches lantern handler', () => {
  it('"hurl lamp at troll" fires the lantern smash handler via V-THROW action', async () => {
    const g = newGameAt('TROLL-ROOM');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    // hurl → canonical throw → V-THROW; lantern handler must fire via ctx.action.
    const out = await (await g.turn('hurl lamp at troll')).output;
    // The lantern handler V-THROW branch: "smashed into the floor"
    expect(out).toContain('smashed into the floor');
  });
});

describe('CB0 — synonym coverage: ATTACK family (kill, fight, hit, hurt)', () => {
  it('"kill troll" routes V-ATTACK (not unknown)', async () => {
    const g = newGameAt('TROLL-ROOM');
    const sword = g.world.get('SWORD')!;
    sword.moveTo(g.player);
    const out = await (await g.turn('kill troll')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });

  it('"fight troll" routes V-ATTACK', async () => {
    const g = newGameAt('TROLL-ROOM');
    const sword = g.world.get('SWORD')!;
    sword.moveTo(g.player);
    const out = await (await g.turn('fight troll')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });

  it('"murder troll" routes V-ATTACK (MURDER synonym)', async () => {
    const g = newGameAt('TROLL-ROOM');
    const sword = g.world.get('SWORD')!;
    sword.moveTo(g.player);
    const out = await (await g.turn('murder troll')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

describe('CB0 — synonym coverage: OPEN family (destroy)', () => {
  it('"break front door" reaches V-MUNG or V-OPEN (not unknown)', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('break door')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

describe('CB0 — synonym coverage: LOOK family (stare, gaze, l)', () => {
  it('"stare" reaches V-LOOK', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('stare')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });

  it('"l" reaches V-LOOK', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('l')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

describe('CB0 — synonym coverage: WAIT (z)', () => {
  it('"z" reaches V-WAIT (Time passes...)', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('z')).output;
    expect(out).toContain('Time passes');
  });
});

describe('CB0 — synonym coverage: INVENTORY (i)', () => {
  it('"i" reaches V-INVENTORY', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('i')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

describe('CB0 — synonym coverage: MOVE family (push)', () => {
  it('"push rug" reaches V-PUSH or V-MOVE (not unknown)', async () => {
    const g = newGameAt('LIVING-ROOM');
    const out = await (await g.turn('push rug')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

describe('CB0 — synonym coverage: BURN family (incinerate)', () => {
  it('"incinerate door" (no iobj) is a parse, not unknown verb', async () => {
    // "incinerate" → canonical "burn" → BURN with no iobj → PRE-BURN fires.
    // PRE-BURN says "You didn't say with what!" — still reaches V-BURN path,
    // not "I don't know how to".
    const g = newGameAt('WEST-OF-HOUSE');
    const out = await (await g.turn('incinerate door')).output;
    expect(out).not.toMatch(/don't know how to/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Synonym→action-dispatch proof: lantern handler must respond to synonyms
//    These tests FAIL before the CB0 sweep (handler checks ctx.verb==='throw')
//    and PASS after (handler checks ctx.action==='V-THROW').
// ---------------------------------------------------------------------------

describe('CB0 — action-dispatch proof: light-sources.ts responds to SYNONYM inputs', () => {
  it('"douse lamp" extinguishes (V-LAMP-OFF via EXTINGUISH synonym)', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    // "douse" → canonical extinguish → V-LAMP-OFF
    // After CB0: ctx.action === 'V-LAMP-OFF' catches it.
    // Before CB0: ctx.verb === 'extinguish' misses 'douse', returns false.
    const out = await (await g.turn('douse lamp')).output;
    expect(out).not.toMatch(/don't know how to/i);
    expect(out).toMatch(/now off/i);
  });

  it('"douse candles" extinguishes candles (V-LAMP-OFF)', async () => {
    const g = newGameAt('EAST-OF-HOUSE');
    const candles = g.world.get('CANDLES')!;
    candles.moveTo(g.player);
    candles.set(Flag.OnFire);
    // "douse" → V-LAMP-OFF; candles handler must fire via ctx.action
    const out = await (await g.turn('douse candles')).output;
    expect(out).not.toMatch(/don't know how to/i);
    expect(out).toMatch(/extinguish|flame|not lighted/i);
  });

  it('"light lamp" turns on lamp (V-LAMP-ON via LIGHT verb)', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const lamp = g.world.get('LAMP')!;
    lamp.moveTo(g.player);
    // "light" → V-LAMP-ON (separate syntax entry, not the burn path)
    const out = await (await g.turn('light lamp')).output;
    expect(out).not.toMatch(/don't know how to/i);
    expect(out).toMatch(/now on|turned on/i);
  });
});
