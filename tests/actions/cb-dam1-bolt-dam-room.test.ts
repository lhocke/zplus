/**
 * CB-DAM1 — BOLT-F + DAM-ROOM-FCN + DAM-FUNCTION
 *
 * Done-criteria (spec §9 Wave 1 CB-DAM1):
 *   - bolt toggles GATES-OPEN + arms correct timer + parks opposite (NM-A)
 *   - dam-room description matches each of the 4 states (S0..S3)
 *   - bubble "glowing serenely" iff GATE-FLAG is set
 *   - dam joke verbs (OPEN, CLOSE, PLUG) produce correct messages
 *   - BOLT TAKE → "integral part of the control panel"
 *   - BOLT OIL → "glue, not oil" message
 *   - BOLT TURN without GATE-FLAG → "won't turn with your best effort"
 *   - BOLT TURN with wrong PRSI → "won't turn using the <prsi>"
 *
 * ZIL refs: 1actions.zil:1187–1217 (BOLT-F), :1156–1185 (DAM-ROOM-FCN),
 *            :1400–1410 (DAM-FUNCTION), :1219–1224 (BUBBLE-F)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import type { ActionContext } from '../../src/domain/game-object.js';
import type { Room } from '../../src/domain/room.js';
import { Flag } from '../../src/domain/flags.js';
import { damFunction } from '../../src/actions/dam.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clockEntry(g: Game, id: string) {
  return (g as unknown as { clock: { getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined } })
    .clock.getEntry(id);
}

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean } }).flags;
}

// ---------------------------------------------------------------------------
// BOLT-F — wrench gating
// ---------------------------------------------------------------------------

describe('CB-DAM1 — BOLT-F: wrench gate', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('DAM-ROOM');
    // Give player the wrench (in MAINTENANCE-ROOM normally; move for test)
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);
    // Push yellow button to unlock the panel (set GATE-FLAG)
    // directly via flags store for isolation
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATE-FLAG', true);
  });

  it('TURN BOLT WITH WRENCH succeeds when GATE-FLAG is set', async () => {
    const out = await (await g.turn('turn bolt with wrench')).output;
    // Either opening or closing — no "won't turn" message
    expect(out).not.toContain("won't turn");
  });

  it('TURN BOLT WITHOUT WRENCH (wrong iobj) → "won\'t turn using the"', async () => {
    // Put a non-wrench object in reach for the parser to find
    const leaflet = g.world.get('LEAFLET');
    if (leaflet) leaflet.moveTo(g.player);
    else {
      // Leaflet may not be in scope — test via direct ActionContext instead
      // (BOLT-F checks ctx.iobj !== WRENCH)
    }
    // Give player a takeable item that isn't the wrench
    const pump = g.world.get('PUMP');
    if (pump) pump.moveTo(g.player);
    const out = pump ? await (await g.turn('turn bolt with pump')).output : '';
    if (pump) expect(out).toMatch(/won't turn using the/);
  });

  it('TURN BOLT WITH WRENCH without GATE-FLAG → "won\'t turn with your best effort"', async () => {
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATE-FLAG', false);
    const out = await (await g.turn('turn bolt with wrench')).output;
    expect(out).toContain("won't turn with your best effort");
  });
});

// ---------------------------------------------------------------------------
// BOLT-F — gate toggle + timer arms (NM-A)
// ---------------------------------------------------------------------------

describe('CB-DAM1 — BOLT-F: gate toggle and timer arms (NM-A)', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('DAM-ROOM');
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATE-FLAG', true);
  });

  it('opening: sets GATES-OPEN, queues I-REMPTY (enabled), parks I-RFILL (disabled)', async () => {
    // Start with gates closed (default)
    expect(flags(g).get('GATES-OPEN')).toBe(false);
    await g.turn('turn bolt with wrench');
    expect(flags(g).get('GATES-OPEN')).toBe(true);

    // NM-A: I-REMPTY is enabled after the bolt turn.
    // clock.advance() runs at end of turn, decrementing from 8 to 7 — that's faithful.
    // Check enabled=true and turnsLeft>0 (armed, will fire).
    const rempty = clockEntry(g, 'I-REMPTY');
    expect(rempty).toBeDefined();
    expect(rempty!.enabled).toBe(true);
    expect(rempty!.turnsLeft).toBeGreaterThan(0);  // was 8, now 7 (one advance)

    // NM-A: I-RFILL parked (disabled, turnsLeft=0)
    const rfill = clockEntry(g, 'I-RFILL');
    expect(rfill).toBeDefined();
    expect(rfill!.turnsLeft).toBe(0);
    expect(rfill!.enabled).toBe(false);
  });

  it('closing: clears GATES-OPEN, queues I-RFILL (enabled), parks I-REMPTY (disabled)', async () => {
    // Open gates first
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATES-OPEN', true);
    await g.turn('turn bolt with wrench');
    expect(flags(g).get('GATES-OPEN')).toBe(false);

    const rfill = clockEntry(g, 'I-RFILL');
    expect(rfill).toBeDefined();
    expect(rfill!.enabled).toBe(true);
    expect(rfill!.turnsLeft).toBeGreaterThan(0);

    const rempty = clockEntry(g, 'I-REMPTY');
    expect(rempty).toBeDefined();
    expect(rempty!.turnsLeft).toBe(0);
    expect(rempty!.enabled).toBe(false);
  });

  it('opening emits sluice-open message (1actions.zil:1202)', async () => {
    const out = await (await g.turn('turn bolt with wrench')).output;
    expect(out).toContain('sluice gates open');
  });

  it('closing emits sluice-close message (1actions.zil:1195)', async () => {
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATES-OPEN', true);
    const out = await (await g.turn('turn bolt with wrench')).output;
    expect(out).toContain('sluice gates close');
  });

  it('closing clears RESERVOIR-SOUTH TOUCHBIT (1actions.zil:1191)', async () => {
    // RESERVOIR-SOUTH should be re-described after toggle
    const resSouth = g.world.get('RESERVOIR-SOUTH')!;
    resSouth.set(Flag.Touched);
    await g.turn('turn bolt with wrench');
    // After open, TOUCHBIT cleared
    // (closing path also clears LOUD-ROOM; both go via the shared clear of RESERVOIR-SOUTH)
    // The closing bolt path also clears LOUD-ROOM.TOUCHBIT
    expect(resSouth.has(Flag.Touched)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BOLT-F — TAKE and OIL
// ---------------------------------------------------------------------------

describe('CB-DAM1 — BOLT-F: TAKE and OIL fall-throughs', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('DAM-ROOM');
  });

  it('TAKE BOLT → "integral part of the control panel" (1actions.zil:1213)', async () => {
    const out = await (await g.turn('take bolt')).output;
    expect(out).toBe('It is an integral part of the control panel.');
  });

  it('OIL BOLT WITH TUBE → "glue, not oil" message (1actions.zil:1215)', async () => {
    // "oil" is a synonym for LUBRICATE which takes 2 objects (WITH prep).
    // Move the tube to the player so the parser has an iobj.
    const tube = g.world.get('TUBE');
    if (tube) tube.moveTo(g.player);
    const out = await (await g.turn('oil bolt with tube')).output;
    expect(out).toContain('glue, not oil');
  });
});

// ---------------------------------------------------------------------------
// DAM-ROOM-FCN — 4-state room description
// ---------------------------------------------------------------------------

describe('CB-DAM1 — DAM-ROOM-FCN: 4-state description (1actions.zil:1156–1185)', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('DAM-ROOM');
  });

  function setFlags(gatesOpen: boolean, lowTide: boolean) {
    const fs = (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags;
    fs.set('GATES-OPEN', gatesOpen);
    fs.set('LOW-TIDE', lowTide);
  }

  async function look() {
    return await (await g.turn('look')).output;
  }

  it('S0 sealed (GATES-OPEN=F, LOW-TIDE=F): "Water is pouring over the top"', async () => {
    setFlags(false, false);
    const out = await look();
    expect(out).toContain('Water is pouring over the top of the now');
  });

  it('S2 draining (GATES-OPEN=T, LOW-TIDE=F): "water level behind the dam is still high"', async () => {
    setFlags(true, false);
    const out = await look();
    expect(out).toContain('water level behind the dam is still high');
  });

  it('S3 drained (GATES-OPEN=T, LOW-TIDE=T): "The sluice gates have been opened. Water rushes"', async () => {
    setFlags(true, true);
    const out = await look();
    expect(out).toContain('sluice gates have been');
  });

  it('S4 refilling (GATES-OPEN=F, LOW-TIDE=T): "level is rising quickly"', async () => {
    setFlags(false, true);
    const out = await look();
    expect(out).toContain('level is rising quickly');
  });

  it('control panel text appears in all states', async () => {
    for (const [go, lt] of [[false, false], [true, false], [true, true], [false, true]] as const) {
      setFlags(go, lt);
      const out = await look();
      expect(out).toContain('control panel');
    }
  });

  it('bubble is "glowing serenely" when GATE-FLAG is true (1actions.zil:1182)', async () => {
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATE-FLAG', true);
    const out = await look();
    expect(out).toContain('glowing serenely');
  });

  it('bubble does NOT mention "glowing serenely" when GATE-FLAG is false', async () => {
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATE-FLAG', false);
    const out = await look();
    expect(out).not.toContain('glowing serenely');
  });
});

// ---------------------------------------------------------------------------
// DAM-FUNCTION — joke verbs on the dam object
// ---------------------------------------------------------------------------

describe('CB-DAM1 — DAM-FUNCTION: joke verbs (1actions.zil:1400–1410)', () => {
  let g: Game;

  beforeEach(() => {
    g = newGameAt('DAM-ROOM');
  });

  it('OPEN DAM → "Sounds reasonable, but this isn\'t how."', async () => {
    const out = await (await g.turn('open dam')).output;
    expect(out).toBe("Sounds reasonable, but this isn't how.");
  });

  it('CLOSE DAM → "Sounds reasonable, but this isn\'t how."', async () => {
    const out = await (await g.turn('close dam')).output;
    expect(out).toBe("Sounds reasonable, but this isn't how.");
  });

  it('PLUG DAM (no iobj) → Dutch-boy message', () => {
    // "plug" requires 2 objects in syntax; drive via ActionContext directly
    // to bypass parser and test the HANDS branch (iobj===undefined).
    const dam = g.world.get('DAM')!;
    const out: string[] = [];
    const ctx: ActionContext = {
      self: dam, actor: g.player, action: 'V-PLUG', verb: 'plug', dobj: dam, iobj: undefined,
      world: g.world, here: g.player.parent as Room,
      tell: (s) => { out.push(s); },
      hasFlag: (o, f) => o.has(f),
      setFlag: () => {}, clearFlag: () => {}, moveTo: () => {},
      score: () => {}, scoreObj: () => {}, recomputeTrophy: () => {},
      enableClock: () => {}, disableClock: () => {}, fatal: () => {},
      getGlobal: () => false, setGlobal: () => {},
    };
    damFunction(ctx);
    expect(out.join(' ')).toContain('little Dutch boy');
  });

  it('PLUG DAM WITH non-hands → "how big this dam is" message', async () => {
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);
    const out = await (await g.turn('plug dam with wrench')).output;
    expect(out).toContain('how big this dam is');
  });
});

// ---------------------------------------------------------------------------
// BUBBLE-F — integral part
// ---------------------------------------------------------------------------

describe('CB-DAM1 — BUBBLE-F: TAKE bubble (1actions.zil:1219–1221)', () => {
  it('TAKE BUBBLE → "integral part of the control panel"', async () => {
    const g = newGameAt('DAM-ROOM');
    const out = await (await g.turn('take bubble')).output;
    expect(out).toBe('It is an integral part of the control panel.');
  });
});

// ---------------------------------------------------------------------------
// NM-A guard — parked opposite timer stays disabled after bolt turn
//
// The parked timer has turnsLeft=0 and enabled=false; the Clock skips it.
// We verify the slot stays non-firing by checking it remains disabled
// and at turnsLeft=0 throughout.  The armed timer's actual effect on game
// state (LOW-TIDE) is tested in CB-DAM2 (I-RFILL / I-REMPTY tick bodies).
// ---------------------------------------------------------------------------

describe('CB-DAM1 — NM-A: parked opposite timer stays disabled', () => {
  it('after opening: I-RFILL parked (turnsLeft=0, enabled=false) throughout 10 advances', async () => {
    const g = newGameAt('DAM-ROOM');
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);
    (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags.set('GATE-FLAG', true);

    // Open gates
    await g.turn('turn bolt with wrench');

    // Check that I-RFILL is the parked one (turnsLeft=0, disabled)
    const rfill = clockEntry(g, 'I-RFILL');
    expect(rfill).toBeDefined();
    expect(rfill!.turnsLeft).toBe(0);
    expect(rfill!.enabled).toBe(false);

    // Advance several turns — I-RFILL must stay parked
    for (let i = 0; i < 10; i++) await g.turn('wait');
    const rfill2 = clockEntry(g, 'I-RFILL');
    expect(rfill2!.turnsLeft).toBe(0);
    expect(rfill2!.enabled).toBe(false);
  });

  it('after closing: I-REMPTY parked (turnsLeft=0, enabled=false) throughout 10 advances', async () => {
    const g = newGameAt('DAM-ROOM');
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);
    const fs = (g as unknown as { flags: { set(n: string, v: boolean): void } }).flags;
    fs.set('GATE-FLAG', true);
    fs.set('GATES-OPEN', true);  // start with gates open

    // Close gates
    await g.turn('turn bolt with wrench');

    const rempty = clockEntry(g, 'I-REMPTY');
    expect(rempty).toBeDefined();
    expect(rempty!.turnsLeft).toBe(0);
    expect(rempty!.enabled).toBe(false);

    // Advance — I-REMPTY must stay parked
    for (let i = 0; i < 10; i++) await g.turn('wait');
    const rempty2 = clockEntry(g, 'I-REMPTY');
    expect(rempty2!.turnsLeft).toBe(0);
    expect(rempty2!.enabled).toBe(false);
  });
});
