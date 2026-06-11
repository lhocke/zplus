/**
 * CB-DAM3 — BUTTON-F + leak (I-MAINT-ROOM, LEAK-FUNCTION, PUTTY/TUBE)
 *
 * Done-criteria (spec §9 Wave 1 CB-DAM3):
 *   - Each button effect (§3.3): blue starts leak, red toggles lights, brown/yellow
 *     set GATE-FLAG and clear DAM-ROOM TOUCHBIT.
 *   - Blue button jammed when WATER-LEVEL != 0 (NM-C: -1 sentinel counts as fixed).
 *   - READ any button → "They're greek to you."
 *   - I-MAINT-ROOM: DROWNINGS indexed at WATER-LEVEL/2; drown at level >= 14 (NM-C).
 *   - LEAK-FUNCTION: PUT/PUT-ON putty or PLUG with putty calls FIX-MAINT-LEAK.
 *   - PLUG with non-putty → "With a <prsi>?"
 *   - WATER-LEVEL = -1 after repair (one-shot gate); blue button "jammed" thereafter.
 *   - Timer stops after repair (I-MAINT-ROOM parked).
 *   - Boat-in-dam-area drowns too (I-MAINT-ROOM drown-in-boat path).
 *
 * ZIL refs:
 *   BUTTON-F      1actions.zil:1298–1330
 *   I-MAINT-ROOM  1actions.zil:1343–1360
 *   LEAK-FUNCTION 1actions.zil:1362–1370
 *   FIX-MAINT-LEAK 1actions.zil:1372–1377
 *   PUTTY-FCN     1actions.zil:1379–1384
 *   TUBE-FUNCTION 1actions.zil:1386–1398
 *   TOOL-CHEST-FCN 1actions.zil:1332–1341
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import type { ActionContext } from '../../src/domain/game-object.js';
import { lookupAction } from '../../src/actions/registry.js';

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

function getWaterLevel(g: Game): number {
  return (g as unknown as { waterLevel: number }).waterLevel;
}

function setWaterLevel(g: Game, v: number): void {
  (g as unknown as { waterLevel: number }).waterLevel = v;
}

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

function clockEntry(g: Game, id: string) {
  return (g as unknown as { clock: { getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined } })
    .clock.getEntry(id);
}

function armClock(g: Game, id: string, period: number, enabled: boolean) {
  (g as unknown as { clock: { queue(id: string, period: number, enabled: boolean): void } })
    .clock.queue(id, period, enabled);
}

// Give the player a lit lamp so unlit rooms work in tests.
function lightUp(g: Game) {
  const lamp = g.world.get('LAMP')!;
  lamp.set(Flag.Light);
  lamp.set(Flag.OnFire);
  lamp.moveTo(g.player);
}

// newGameAt + lit lamp + ONBIT on the start room.
// preReadHandler (and any other simplified lit-check) requires Flag.On on HERE,
// not just a lamp in inventory, so we set both.
function newLitGameAt(roomId: string): Game {
  const g = newGameAt(roomId);
  lightUp(g);
  const room = g.world.get(roomId);
  if (room !== undefined) room.set(Flag.On);
  return g;
}

// ---------------------------------------------------------------------------
// BUTTON-F — READ any button
// ---------------------------------------------------------------------------

describe('CB-DAM3 — BUTTON-F: READ any button', () => {
  it('READ button → "They\'re greek to you."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const out = g.turn('read yellow button').output;
    expect(out).toContain("greek to you");
  });
});

// ---------------------------------------------------------------------------
// BUTTON-F — blue button
// ---------------------------------------------------------------------------

describe('CB-DAM3 — BUTTON-F: blue button starts leak', () => {
  it('PUSH BLUE-BUTTON when WATER-LEVEL==0: clears LEAK INVISIBLE, sets WL=1, arms I-MAINT-ROOM', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    expect(getWaterLevel(g)).toBe(0);

    const out = g.turn('push blue button').output;
    expect(out).toMatch(/stream of water/i);

    // LEAK is now visible
    const leak = g.world.get('LEAK')!;
    expect(leak.has(Flag.Invisible)).toBe(false);

    // WATER-LEVEL: button sets it to 1, then I-MAINT-ROOM demon fires once this
    // same turn (clock.advance after the action), so post-turn WL is 2.
    expect(getWaterLevel(g)).toBe(2);

    // I-MAINT-ROOM armed as demon (turnsLeft=-1, enabled=true)
    const entry = clockEntry(g, 'I-MAINT-ROOM');
    expect(entry).toBeDefined();
    expect(entry!.enabled).toBe(true);
    expect(entry!.turnsLeft).toBe(-1);
  });

  it('PUSH BLUE-BUTTON when WATER-LEVEL != 0 → "jammed"', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    setWaterLevel(g, 3);
    const out = g.turn('push blue button').output;
    expect(out).toMatch(/jammed/i);
    expect(getWaterLevel(g)).toBe(3);  // unchanged
  });

  it('PUSH BLUE-BUTTON when WATER-LEVEL == -1 (repaired) → "jammed"', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    setWaterLevel(g, -1);
    const out = g.turn('push blue button').output;
    expect(out).toMatch(/jammed/i);
  });
});

// ---------------------------------------------------------------------------
// BUTTON-F — red button toggles ONBIT on MAINTENANCE-ROOM
// ---------------------------------------------------------------------------

describe('CB-DAM3 — BUTTON-F: red button toggles lights', () => {
  it('PUSH RED-BUTTON (room lit) → "shut off"; room loses ONBIT', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const mroom = g.world.get('MAINTENANCE-ROOM')!;
    mroom.set(Flag.On);

    const out = g.turn('push red button').output;
    expect(out).toMatch(/shut off/i);
    expect(mroom.has(Flag.On)).toBe(false);
  });

  it('PUSH RED-BUTTON (room dark) → "come on"; room gains ONBIT', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const mroom = g.world.get('MAINTENANCE-ROOM')!;
    mroom.clear(Flag.On);

    const out = g.turn('push red button').output;
    expect(out).toMatch(/come on/i);
    expect(mroom.has(Flag.On)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUTTON-F — brown/yellow buttons: panel lock
// ---------------------------------------------------------------------------

describe('CB-DAM3 — BUTTON-F: brown/yellow panel lock buttons', () => {
  it('PUSH BROWN-BUTTON: GATE-FLAG=false + clears DAM-ROOM TOUCHBIT + prints "Click."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    flags(g).set('GATE-FLAG', true);
    const damRoom = g.world.get('DAM-ROOM')!;
    damRoom.set(Flag.Touched);

    const out = g.turn('push brown button').output;
    expect(out).toContain('Click.');
    expect(flags(g).get('GATE-FLAG')).toBe(false);
    expect(damRoom.has(Flag.Touched)).toBe(false);
  });

  it('PUSH YELLOW-BUTTON: GATE-FLAG=true + clears DAM-ROOM TOUCHBIT + prints "Click."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    flags(g).set('GATE-FLAG', false);
    const damRoom = g.world.get('DAM-ROOM')!;
    damRoom.set(Flag.Touched);

    const out = g.turn('push yellow button').output;
    expect(out).toContain('Click.');
    expect(flags(g).get('GATE-FLAG')).toBe(true);
    expect(damRoom.has(Flag.Touched)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I-MAINT-ROOM — DROWNINGS progression (NM-C: index = WATER-LEVEL / 2)
// ---------------------------------------------------------------------------

describe('CB-DAM3 — I-MAINT-ROOM: DROWNINGS message at WATER-LEVEL/2 (NM-C)', () => {
  it('DROWNINGS[0] = "up to your ankles." when WL=1, player in MAINTENANCE-ROOM', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    // Arm the demon directly so we control WL precisely (push-blue-button would
    // fire the demon once in the same turn, advancing WL from 1 to 2 before wait).
    setWaterLevel(g, 1);
    armClock(g, 'I-MAINT-ROOM', -1, true);
    const out = g.turn('wait').output;
    expect(out).toContain('up to your ankles');
    // After the tick, WL incremented to 2
    expect(getWaterLevel(g)).toBe(2);
  });

  it('DROWNINGS[2] = "up to your knees." when WL=4 (index=4/2=2)', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    setWaterLevel(g, 4);
    const out = g.turn('wait').output;
    expect(out).toContain('up to your knees');
  });

  it('DROWNINGS not printed when player is NOT in MAINTENANCE-ROOM', () => {
    const g = newGameAt('DAM-LOBBY');
    // Arm the demon by manipulating the clock directly
    setWaterLevel(g, 1);
    armClock(g, 'I-MAINT-ROOM', -1, true);
    const out = g.turn('wait').output;
    // No level message when player is not in MAINTENANCE-ROOM
    expect(out).not.toContain('up to your');
    // But WL still increments
    expect(getWaterLevel(g)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// I-MAINT-ROOM — drown at WATER-LEVEL >= 14 (NM-C)
// ---------------------------------------------------------------------------

describe('CB-DAM3 — I-MAINT-ROOM: drown at WL >= 14 (NM-C)', () => {
  it('player drowns when WATER-LEVEL reaches 14 in MAINTENANCE-ROOM', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    setWaterLevel(g, 13);  // next tick increments to 14 → drown
    const out = g.turn('wait').output;
    expect(out).toMatch(/drowned/i);
  });

  it('MAINT-ROOM ldesc replaced with flooded message on drown', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    setWaterLevel(g, 13);
    g.turn('wait');
    const mroom = g.world.get('MAINTENANCE-ROOM')!;
    expect(mroom.ldesc).toMatch(/full of water/i);
  });

  it('I-MAINT-ROOM demon is stopped after room floods', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    setWaterLevel(g, 13);
    g.turn('wait');
    const entry = clockEntry(g, 'I-MAINT-ROOM');
    expect(entry).toBeDefined();
    // Must not still be an active demon after the flood
    const active = entry!.enabled && entry!.turnsLeft < 0;
    expect(active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I-MAINT-ROOM — drown in boat near dam
// ---------------------------------------------------------------------------

describe('CB-DAM3 — I-MAINT-ROOM: player in boat near dam drowns', () => {
  it('player in inflated boat in DAM-ROOM drowns when water rises (WL < 14)', () => {
    const g = newGameAt('DAM-ROOM');
    const inflatedBoat = g.world.get('INFLATED-BOAT')!;
    inflatedBoat.moveTo(g.world.get('DAM-ROOM')!);
    g.player.moveTo(inflatedBoat);

    setWaterLevel(g, 1);
    armClock(g, 'I-MAINT-ROOM', -1, true);

    const out = g.turn('wait').output;
    expect(out).toMatch(/over the dam|over the falls|tsk/i);
  });
});

// ---------------------------------------------------------------------------
// LEAK-FUNCTION — putty repair
// ---------------------------------------------------------------------------

describe('CB-DAM3 — LEAK-FUNCTION: putty repairs the leak', () => {
  // ZIL: PUTTY object has SYNONYM MATERIAL GUNK — the word "putty" is NOT in the
  // dictionary. Tests use "material" (the canonical noun) to match reference behavior.
  it('PUT MATERIAL ON LEAK → "miracle" + WATER-LEVEL = -1', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');  // WL=1, arms demon, makes LEAK visible
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);

    const out = g.turn('put material on leak').output;
    expect(out).toMatch(/miracle|stop the leak/i);
    expect(getWaterLevel(g)).toBe(-1);
  });

  it('PLUG LEAK WITH MATERIAL also repairs', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    // Make LEAK visible/accessible for the parser
    const leak = g.world.get('LEAK')!;
    leak.clear(Flag.Invisible);

    const out = g.turn('plug leak with material').output;
    expect(out).toMatch(/miracle|stop the leak/i);
    expect(getWaterLevel(g)).toBe(-1);
  });

  it('I-MAINT-ROOM stops after repair', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    g.turn('put material on leak');

    const entry = clockEntry(g, 'I-MAINT-ROOM');
    expect(entry).toBeDefined();
    const active = entry!.enabled && entry!.turnsLeft < 0;
    expect(active).toBe(false);
  });

  it('blue button is "jammed" after repair (WATER-LEVEL = -1, one-shot)', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    g.turn('put material on leak');

    const out = g.turn('push blue button').output;
    expect(out).toMatch(/jammed/i);
  });

  it('PLUG LEAK WITH non-putty → "With a <prsi>?"', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    // Set up an active leak without letting the demon advance WL.
    setWaterLevel(g, 1);
    armClock(g, 'I-MAINT-ROOM', 0, false);  // parked — won't fire during turns
    const leak = g.world.get('LEAK')!;
    leak.clear(Flag.Invisible);
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);

    const out = g.turn('plug leak with wrench').output;
    expect(out).toMatch(/With a /i);
    expect(getWaterLevel(g)).toBe(1);  // plug action did not fix the leak
  });

  it('LEAK-FUNCTION is no-op when WATER-LEVEL == 0', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    // WL=0 means no active leak — handler returns false without acting
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    const leak = g.world.get('LEAK')!;
    leak.clear(Flag.Invisible);

    const out = g.turn('put material on leak').output;
    expect(out).not.toMatch(/miracle|stop the leak/i);
    // WL stays 0
    expect(getWaterLevel(g)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PUTTY-FCN — rejects lubrication use and bare PUT
// ---------------------------------------------------------------------------

describe('CB-DAM3 — PUTTY-FCN: rejects OIL use', () => {
  it('OIL <object> WITH PUTTY → "all-purpose gunk isn\'t a lubricant"', () => {
    // Test via direct handler invocation to avoid parser wiring complexity.
    const puttyFcn = lookupAction('PUTTY-FCN')!;
    expect(puttyFcn).toBeDefined();

    const room = new Room('TEST', 'Test Room', {});
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself', {});
    player.moveTo(room);
    const putty = new Thing('PUTTY', 'viscous material', { synonyms: ['material', 'gunk'] });
    putty.moveTo(player);
    const bolt = new Thing('BOLT', 'bolt', { synonyms: ['bolt'] });
    bolt.moveTo(room);
    const world = World.fromObjects([room, player, putty, bolt]);

    const msgs: string[] = [];
    const ctx: ActionContext = {
      self: putty,
      actor: player,
      verb: 'lubricate',  // ZIL OIL maps to lubricate in the port's verb table
      dobj: bolt,
      iobj: putty,
      world,
      here: room,
      tell: (s) => msgs.push(s),
      hasFlag: (obj, flag) => obj.has(flag),
      setFlag: (obj, flag) => obj.set(flag),
      clearFlag: (obj, flag) => obj.clear(flag),
      moveTo: (obj, dest) => obj.moveTo(dest),
      score: () => {},
      scoreObj: () => {},
      recomputeTrophy: () => {},
      enableClock: () => {},
      disableClock: () => {},
      fatal: () => {},
    };

    const handled = puttyFcn(ctx);
    expect(handled).toBe(true);
    expect(msgs.join(' ')).toMatch(/lubricant/i);
  });

  it('PUT PUTTY (bare, no target) → gunk message', () => {
    // ZIL: (VERB? PUT) (EQUAL? PRSO PUTTY) → "not a lubricant" message
    // In port: PUTTY-FCN intercepts PUT where PRSO=putty
    const puttyFcn = lookupAction('PUTTY-FCN')!;

    const room = new Room('TEST', 'Test Room', {});
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself', {});
    player.moveTo(room);
    const putty = new Thing('PUTTY', 'viscous material', { synonyms: ['material'] });
    putty.moveTo(player);
    const world = World.fromObjects([room, player, putty]);

    const msgs: string[] = [];
    const ctx: ActionContext = {
      self: putty,
      actor: player,
      verb: 'put',
      dobj: putty,
      iobj: undefined,
      world,
      here: room,
      tell: (s) => msgs.push(s),
      hasFlag: (obj, flag) => obj.has(flag),
      setFlag: (obj, flag) => obj.set(flag),
      clearFlag: (obj, flag) => obj.clear(flag),
      moveTo: (obj, dest) => obj.moveTo(dest),
      score: () => {},
      scoreObj: () => {},
      recomputeTrophy: () => {},
      enableClock: () => {},
      disableClock: () => {},
      fatal: () => {},
    };

    // PUTTY-FCN: (VERB? PUT)(EQUAL? PRSO PUTTY) → "gunk isn't a lubricant"
    const handled = puttyFcn(ctx);
    expect(handled).toBe(true);
    expect(msgs.join(' ')).toMatch(/lubricant/i);
  });
});

// ---------------------------------------------------------------------------
// TUBE-FUNCTION — squeeze and reject put
// ---------------------------------------------------------------------------

describe('CB-DAM3 — TUBE-FUNCTION', () => {
  it('PUT <object> IN TUBE → "The tube refuses to accept anything."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    tube.set(Flag.Open);
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);

    const out = g.turn('put wrench in tube').output;
    expect(out).toMatch(/refuses to accept/i);
  });

  it('SQUEEZE TUBE (open + putty inside) → putty moves to player hand', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    tube.set(Flag.Open);
    const putty = g.world.get('PUTTY')!;
    expect(putty.parent?.id).toBe('TUBE');

    const out = g.turn('squeeze tube').output;
    expect(out).toMatch(/oozes into your hand/i);
    expect(putty.parent?.id).toBe('PLAYER');
  });

  it('SQUEEZE TUBE (open, empty) → "The tube is apparently empty."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    tube.set(Flag.Open);
    g.world.get('PUTTY')!.moveTo(null);

    const out = g.turn('squeeze tube').output;
    expect(out).toMatch(/apparently empty/i);
  });

  it('SQUEEZE TUBE (closed) → "The tube is closed."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    tube.clear(Flag.Open);

    const out = g.turn('squeeze tube').output;
    expect(out).toMatch(/tube is closed/i);
  });
});

// ---------------------------------------------------------------------------
// BUTTON-F — red button: single-line output (no spurious newline)
// ZIL 1actions.zil:1316-1322: two no-CR TELLs concatenate into one line.
// ---------------------------------------------------------------------------

describe('CB-DAM3 — BUTTON-F: red button output is a single line (no spurious newline)', () => {
  it('PUSH RED-BUTTON (room lit) → single-line "The lights within the room shut off."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const mroom = g.world.get('MAINTENANCE-ROOM')!;
    mroom.set(Flag.On);

    const out = g.turn('push red button').output;
    // Must be ONE line — no embedded newline between "room" and "shut off."
    expect(out).not.toMatch(/room\s*\nshut/);
    expect(out).toContain('The lights within the room shut off.');
  });

  it('PUSH RED-BUTTON (room dark) → single-line "The lights within the room come on."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const mroom = g.world.get('MAINTENANCE-ROOM')!;
    mroom.clear(Flag.On);

    const out = g.turn('push red button').output;
    expect(out).not.toMatch(/room\s*\ncome/);
    expect(out).toContain('The lights within the room come on.');
  });
});

// ---------------------------------------------------------------------------
// TUBE-FUNCTION — V-PUT-ON (put X ON tube) must NOT intercept; falls through
// to default surface check → "There's no good surface on the tube."
// ZIL 1actions.zil:1387: <VERB? PUT> matches V-PUT only; PUT-ON is distinct.
// ---------------------------------------------------------------------------

describe('CB-DAM3 — TUBE-FUNCTION: PUT ON tube gives surface error (not tube refusal)', () => {
  it('PUT screwdriver ON tube → "no good surface on the tube" (not "refuses")', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    const screwdriver = g.world.get('SCREWDRIVER');
    if (screwdriver === undefined) {
      // No SCREWDRIVER object — use wrench as stand-in
      const wrench = g.world.get('WRENCH')!;
      wrench.moveTo(g.player);
      const out = g.turn('put wrench on tube').output;
      expect(out).not.toMatch(/refuses to accept/i);
      expect(out).toMatch(/no good surface/i);
    } else {
      screwdriver.moveTo(g.player);
      const out = g.turn('put screwdriver on tube').output;
      expect(out).not.toMatch(/refuses to accept/i);
      expect(out).toMatch(/no good surface/i);
    }
  });

  it('PUT screwdriver IN tube still gives "refuses to accept" (V-PUT unchanged)', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    tube.set(Flag.Open);
    const wrench = g.world.get('WRENCH')!;
    wrench.moveTo(g.player);

    const out = g.turn('put wrench in tube').output;
    expect(out).toMatch(/refuses to accept/i);
  });
});

// ---------------------------------------------------------------------------
// PUTTY synonym — "putty" must NOT be a recognized word (ZIL: SYNONYM MATERIAL GUNK).
// Input "plug leak with putty" must be rejected as unknown word, NOT repair the leak.
// ---------------------------------------------------------------------------

describe('CB-DAM3 — PUTTY: word "putty" is not in dictionary (only MATERIAL/GUNK)', () => {
  it('"plug leak with putty" → unknown word, leak not repaired', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    // Set up an active leak
    g.turn('push blue button');
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    const leak = g.world.get('LEAK')!;
    leak.clear(Flag.Invisible);

    const out = g.turn('plug leak with putty').output;
    // Must NOT repair the leak
    expect(out).not.toMatch(/miracle|stop the leak/i);
    // Must reject "putty" as unknown word
    expect(out).toMatch(/don't know the word|unknown word/i);
    // Leak still active
    expect(getWaterLevel(g)).toBeGreaterThan(0);
  });

  it('"plug leak with gunk" → repairs the leak (GUNK is a valid synonym)', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    const leak = g.world.get('LEAK')!;
    leak.clear(Flag.Invisible);

    const out = g.turn('plug leak with gunk').output;
    expect(out).toMatch(/miracle|stop the leak/i);
    expect(getWaterLevel(g)).toBe(-1);
  });

  it('"plug leak with material" → repairs the leak (MATERIAL is a valid synonym)', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    g.turn('push blue button');
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
    const leak = g.world.get('LEAK')!;
    leak.clear(Flag.Invisible);

    const out = g.turn('plug leak with material').output;
    expect(out).toMatch(/miracle|stop the leak/i);
    expect(getWaterLevel(g)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// TOOL-CHEST-FCN
// ---------------------------------------------------------------------------

describe('CB-DAM3 — TOOL-CHEST-FCN', () => {
  it('EXAMINE TOOL-CHEST → "The chests are all empty."', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const chest = g.world.get('TOOL-CHEST');
    expect(chest).toBeDefined();
    const out = g.turn('examine tool chest').output;
    expect(out).toMatch(/all empty/i);
  });

  it('TAKE/OPEN TOOL-CHEST → crumble message + chest removed', () => {
    const g = newLitGameAt('MAINTENANCE-ROOM');
    const chest = g.world.get('TOOL-CHEST')!;
    // TAKE path — ensure it's takeable so parser dispatches
    chest.set(Flag.Takeable);

    const out = g.turn('take tool chest').output;
    expect(out).toMatch(/crumble/i);
    expect(chest.parent).toBeNull();
  });
});
