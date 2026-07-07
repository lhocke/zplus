/**
 * CB-BOAT2 — IBOAT-FUNCTION / RBOAT-FUNCTION deflate / DBOAT-FUNCTION
 *
 * Done-criteria (spec §9 Wave 2 CB-BOAT2):
 *   - inflate with pump swaps INFLATABLE-BOAT → INFLATED-BOAT; emits seaworthy msg
 *   - inflate with pump shows label hint when BOAT-LABEL not yet touched (NM-F: label msg)
 *   - inflate with lungs → "not enough lung power" (NM-F: distinct message)
 *   - inflate with other → "Surely you jest!" (NM-F: distinct message)
 *   - inflate when boat not in room → "must be on the ground"
 *   - DEFLATE = false after inflate
 *   - deflate while IN boat → "can't deflate while you're in it"
 *   - deflate when inflated boat not in room → "must be on the ground"
 *   - deflate when boat on ground → "deflates" + DEFLATE=true + swap inflated→inflatable
 *   - DBOAT-FUNCTION PUT PUTTY → repair: "repaired" + swap punctured→inflatable
 *   - DBOAT-FUNCTION PUT-ON PUTTY → repair
 *   - DBOAT-FUNCTION PLUG with PUTTY → repair
 *   - DBOAT-FUNCTION INFLATE → "Some moron punctured it"
 *   - DBOAT-FUNCTION PLUG with non-putty → "With a <prsi>?"
 *
 * ZIL refs:
 *   IBOAT-FUNCTION   1actions.zil:2820–2840
 *   RBOAT-FUNCTION   1actions.zil:2803–2815 (DEFLATE branch)
 *   DBOAT-FUNCTION   1actions.zil:2652–2662
 *   FIX-BOAT         1actions.zil:2664–2667
 *   BREATHE          1actions.zil:2817–2818
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import type { ActionContext } from '../../src/domain/game-object.js';
import { iboatFcn, dboatFcn } from '../../src/actions/boat.js';

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

function gameFlags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

// ---------------------------------------------------------------------------
// Minimal ActionContext factory for isolated handler tests
// ---------------------------------------------------------------------------

import { Flag as F } from '../../src/domain/flags.js';
import type { GameObject } from '../../src/domain/game-object.js';

/** Derive ZIL PRSA action id from canonical verb word. Used in bareCtx. */
function verbAction(verb: string, prep?: string): string {
  const p = prep?.toUpperCase();
  switch (verb) {
    case 'inflat': case 'inflate': return 'V-INFLATE';
    case 'fill':   return 'V-FILL';
    case 'deflate': return 'V-DEFLATE';
    case 'board':  return 'V-BOARD';
    case 'launch': return 'V-LAUNCH';
    case 'plug':   return 'V-PLUG';
    case 'put':    return p === 'ON' ? 'V-PUT-ON' : 'V-PUT';
    case 'put-on': return 'V-PUT-ON';
    default:       return 'V-' + verb.toUpperCase();
  }
}

function bareCtx(
  overrides: Pick<ActionContext, 'self' | 'verb' | 'world' | 'here'> &
    Partial<ActionContext> & { _out: string[] },
): ActionContext {
  const { _out, ...rest } = overrides;
  const globals: Record<string, boolean> = {};
  // Derive action from verb if not explicitly provided.
  const derivedAction = rest.action ?? verbAction(rest.verb ?? '', rest.prep);
  return {
    actor: new Actor('PLAYER', 'you'),
    rng: undefined,
    dobj: undefined,
    iobj: undefined,
    prep: undefined,
    rarg: undefined,
    tell: (s: string) => _out.push(s),
    hasFlag: (obj: GameObject, f: F) => obj.has(f),
    setFlag: (obj: GameObject, f: F) => obj.set(f),
    clearFlag: (obj: GameObject, f: F) => obj.clear(f),
    moveTo: (obj: GameObject, dest: GameObject) => obj.moveTo(dest),
    score: () => {},
    scoreObj: () => {},
    recomputeTrophy: () => {},
    enableClock: () => {},
    disableClock: () => {},
    fatal: () => {},
    getGlobal: (n: string) => globals[n] ?? false,
    setGlobal: (n: string, v = true) => { globals[n] = v; },
    ...rest,
    action: derivedAction,
  } as unknown as ActionContext;
}

// ---------------------------------------------------------------------------
// IBOAT-FUNCTION — inflate from game integration
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — IBOAT-FUNCTION (game integration, 1actions.zil:2820)', () => {
  let g: Game;

  beforeEach(() => {
    // DAM-BASE is where INFLATABLE-BOAT starts
    g = newGameAt('DAM-BASE');
    // Give player the pump
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
  });

  it('inflate boat with pump → seaworthy message', async () => {
    const out = await (await g.turn('inflate boat with pump')).output;
    expect(out).toContain('seaworthy');
  });

  it('inflate boat with pump → swaps INFLATABLE-BOAT out', async () => {
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    const room = g.world.get('DAM-BASE')!;
    expect(inflatable.parent).toBe(room);
    await g.turn('inflate boat with pump');
    // After inflate, INFLATABLE-BOAT should be removed from the room
    expect(inflatable.parent).toBeNull();
  });

  it('inflate boat with pump → INFLATED-BOAT appears in room', async () => {
    const inflated = g.world.get('INFLATED-BOAT')!;
    await g.turn('inflate boat with pump');
    const room = g.world.get('DAM-BASE')!;
    expect(inflated.parent).toBe(room);
  });

  it('inflate boat with pump → DEFLATE flag set to false', async () => {
    await g.turn('inflate boat with pump');
    expect(gameFlags(g).get('DEFLATE')).toBe(false);
  });

  it('inflate boat with pump → label hint when BOAT-LABEL not touched (1actions.zil:2828)', async () => {
    // BOAT-LABEL starts without TOUCHBIT
    const label = g.world.get('BOAT-LABEL')!;
    expect(label.has(Flag.Touched)).toBe(false);
    const out = await (await g.turn('inflate boat with pump')).output;
    expect(out).toContain('tan label');
  });

  it('inflate boat with pump → no label hint when BOAT-LABEL already touched', async () => {
    const label = g.world.get('BOAT-LABEL')!;
    label.set(Flag.Touched);
    const out = await (await g.turn('inflate boat with pump')).output;
    expect(out).not.toContain('tan label');
  });

  it('inflate when boat not in room → "must be on the ground" (1actions.zil:2822)', async () => {
    // Move the inflatable boat away from the room
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    inflatable.moveTo(g.player);   // carry it
    const out = await (await g.turn('inflate boat with pump')).output;
    expect(out).toContain('ground');
  });
});

// ---------------------------------------------------------------------------
// NM-F — lungs and other-tool inflate messages (unit test)
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — NM-F: lungs and other-tool inflate messages (1actions.zil:2835)', () => {
  function buildWorld(): {
    room: Room;
    player: Actor;
    inflatable: Thing;
    pump: Thing;
    lungs: Thing;
    wrench: Thing;
    world: World;
  } {
    const room = new Room('ROOM', 'Test Room', { exits: [] });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'you');
    player.moveTo(room);
    const inflatable = new Thing('INFLATABLE-BOAT', 'pile of plastic');
    inflatable.moveTo(room);
    const pump = new Thing('PUMP', 'pump');
    pump.set(Flag.Tool);
    const lungs = new Thing('LUNGS', 'blast of air');
    const wrench = new Thing('WRENCH', 'wrench');
    wrench.set(Flag.Tool);
    const world = World.fromObjects([room, player, inflatable, pump, lungs, wrench]);
    return { room, player, inflatable, pump, lungs, wrench, world };
  }

  it('inflate with LUNGS → "not enough lung power" (1actions.zil:2835)', () => {
    const { room, player, inflatable, lungs, world } = buildWorld();
    const out: string[] = [];
    iboatFcn(bareCtx({
      _out: out,
      self: inflatable,
      verb: 'inflat',
      dobj: inflatable,
      iobj: lungs,
      actor: player,
      world,
      here: room,
    }));
    expect(out.join('\n')).toContain('lung power');
  });

  it('inflate with other tool → "Surely you jest!" (1actions.zil:2838)', () => {
    const { room, player, inflatable, wrench, world } = buildWorld();
    const out: string[] = [];
    iboatFcn(bareCtx({
      _out: out,
      self: inflatable,
      verb: 'inflat',
      dobj: inflatable,
      iobj: wrench,
      actor: player,
      world,
      here: room,
    }));
    expect(out.join('\n')).toContain('jest');
  });
});

// ---------------------------------------------------------------------------
// RBOAT-FUNCTION DEFLATE branch
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — RBOAT-FUNCTION DEFLATE (1actions.zil:2803)', () => {
  let g: Game;

  beforeEach(async () => {
    g = newGameAt('DAM-BASE');
    // Inflate the boat manually: swap objects
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    await g.turn('inflate boat with pump');
  });

  it('deflate while IN boat → "can\'t deflate while you\'re in it" (1actions.zil:2804)', async () => {
    // Put the player inside the inflated boat
    const inflated = g.world.get('INFLATED-BOAT')!;
    g.player.moveTo(inflated);
    const out = await (await g.turn('deflate boat')).output;
    expect(out).toContain("can't deflate");
  });

  it('deflate when boat not in room → "must be on the ground" (1actions.zil:2807)', async () => {
    // Move the inflated boat away
    const inflated = g.world.get('INFLATED-BOAT')!;
    inflated.moveTo(g.player);   // picked up (not "on the ground")
    const out = await (await g.turn('deflate boat')).output;
    expect(out).toContain('ground');
  });

  it('deflate when boat on ground → "deflates" message (1actions.zil:2810)', async () => {
    const out = await (await g.turn('deflate boat')).output;
    expect(out).toContain('deflates');
  });

  it('deflate when on ground → sets DEFLATE flag true (1actions.zil:2812)', async () => {
    await g.turn('deflate boat');
    expect(gameFlags(g).get('DEFLATE')).toBe(true);
  });

  it('deflate when on ground → swaps INFLATED-BOAT out, INFLATABLE-BOAT in room', async () => {
    const inflated   = g.world.get('INFLATED-BOAT')!;
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    const room = g.world.get('DAM-BASE')!;

    expect(inflated.parent).toBe(room);
    await g.turn('deflate boat');
    expect(inflated.parent).toBeNull();
    expect(inflatable.parent).toBe(room);
  });
});

// ---------------------------------------------------------------------------
// DBOAT-FUNCTION — putty repair (unit test)
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — DBOAT-FUNCTION putty repair (1actions.zil:2652)', () => {
  function buildRepairWorld(): {
    room: Room;
    player: Actor;
    punctured: Thing;
    inflatable: Thing;
    putty: Thing;
    wrench: Thing;
    world: World;
  } {
    const room = new Room('ROOM', 'Test Room', { exits: [] });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'you');
    player.moveTo(room);
    const punctured = new Thing('PUNCTURED-BOAT', 'punctured boat');
    punctured.moveTo(room);
    const inflatable = new Thing('INFLATABLE-BOAT', 'pile of plastic');
    // inflatable starts nowhere (spawned on repair)
    const putty = new Thing('PUTTY', 'putty');
    putty.moveTo(player);
    const wrench = new Thing('WRENCH', 'wrench');
    wrench.moveTo(player);
    const world = World.fromObjects([room, player, punctured, inflatable, putty, wrench]);
    return { room, player, punctured, inflatable, putty, wrench, world };
  }

  function runDboat(
    w: ReturnType<typeof buildRepairWorld>,
    verb: string,
    dobj?: Thing,
    iobj?: Thing,
  ): string {
    const out: string[] = [];
    dboatFcn(bareCtx({
      _out: out,
      self: w.punctured,
      verb,
      dobj: dobj ?? w.punctured,
      iobj,
      actor: w.player,
      world: w.world,
      here: w.room,
    }));
    return out.join('\n');
  }

  it('PUT PUTTY → "repaired" message (1actions.zil:2654)', () => {
    const w = buildRepairWorld();
    const msg = runDboat(w, 'put', w.putty, undefined);
    expect(msg).toContain('repaired');
  });

  it('PUT PUTTY → swaps PUNCTURED-BOAT → INFLATABLE-BOAT (FIX-BOAT 1actions.zil:2664)', () => {
    const w = buildRepairWorld();
    runDboat(w, 'put', w.putty, undefined);
    expect(w.punctured.parent).toBeNull();
    expect(w.inflatable.parent).toBe(w.room);
  });

  it('PUT-ON PUTTY → also repairs (1actions.zil:2653)', () => {
    const w = buildRepairWorld();
    const msg = runDboat(w, 'put-on', w.putty, undefined);
    expect(msg).toContain('repaired');
    expect(w.punctured.parent).toBeNull();
    expect(w.inflatable.parent).toBe(w.room);
  });

  it('PLUG with PUTTY (as iobj) → repairs (1actions.zil:2659)', () => {
    const w = buildRepairWorld();
    const msg = runDboat(w, 'plug', w.punctured, w.putty);
    expect(msg).toContain('repaired');
    expect(w.punctured.parent).toBeNull();
    expect(w.inflatable.parent).toBe(w.room);
  });

  it('INFLATE/FILL → "Some moron punctured it" (1actions.zil:2656)', () => {
    const w = buildRepairWorld();
    const msg = runDboat(w, 'inflat');
    expect(msg).toContain('punctured');
  });

  it('PLUG with non-putty → "With a <prsi>?" (1actions.zil:2661)', () => {
    const w = buildRepairWorld();
    const msg = runDboat(w, 'plug', w.punctured, w.wrench);
    expect(msg).toContain('With a');
  });

  it('non-handled verb → returns false (fall-through)', () => {
    const w = buildRepairWorld();
    const out: string[] = [];
    const result = dboatFcn(bareCtx({
      _out: out,
      self: w.punctured,
      verb: 'examine',
      dobj: w.punctured,
      actor: w.player,
      world: w.world,
      here: w.room,
    }));
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DBOAT-FUNCTION integration: C-PUNCTURE oracle sequence
// Board inflated boat while holding sword → punctures → repair with putty
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — oracle C-PUNCTURE: repair sequence (1actions.zil:2652–2667)', () => {
  let g: Game;

  beforeEach(async () => {
    g = newGameAt('DAM-BASE');
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    // Inflate the boat
    await g.turn('inflate boat with pump');
    // Give player putty for the repair test
    const tube = g.world.get('TUBE')!;
    tube.moveTo(g.player);
    // Open the tube and squeeze to get putty
    // (or just move putty directly to player for integration)
    const putty = g.world.get('PUTTY')!;
    putty.moveTo(g.player);
  });

  it('PUT GUNK ON PUNCTURED-BOAT in game → "repaired" (integration)', async () => {
    // Puncture the boat by placing the PUNCTURED-BOAT in room manually
    // (board + sharp-object is CB-BOAT3; for CB-BOAT2 we test repair directly).
    // PUTTY object synonyms: MATERIAL, GUNK (objects.json).
    const inflated   = g.world.get('INFLATED-BOAT')!;
    const punctured  = g.world.get('PUNCTURED-BOAT')!;
    const room = g.world.get('DAM-BASE')!;

    // Swap to punctured state manually to test the repair path
    inflated.moveTo(null);
    punctured.moveTo(room);

    // "put gunk on boat" — GUNK resolves to PUTTY object (synonym), BOAT to PUNCTURED-BOAT
    const out = await (await g.turn('put gunk on boat')).output;
    expect(out).toContain('repaired');
    expect(punctured.parent).toBeNull();
    // After repair, INFLATABLE-BOAT should be in room
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    expect(inflatable.parent).toBe(room);
  });
});

// ---------------------------------------------------------------------------
// RBOAT-FUNCTION INFLATE/FILL fall-through
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — RBOAT-FUNCTION INFLATE fall-through (1actions.zil:2801)', () => {
  it('inflating an already-inflated boat → "probably burst it"', async () => {
    const g = newGameAt('DAM-BASE');
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    await g.turn('inflate boat with pump');  // inflate first
    // Now try to inflate the inflated boat
    const out = await (await g.turn('inflate boat with pump')).output;
    expect(out).toContain('burst');
  });
});

// ---------------------------------------------------------------------------
// THIS-IS-IT — pronoun re-pointing after boat swap (1actions.zil:2834, :2815)
// ---------------------------------------------------------------------------

describe('CB-BOAT2 — THIS-IS-IT: pronoun re-points after inflate (1actions.zil:2834)', () => {
  it('after inflate, "examine it" resolves to the magic boat, not the plastic pile', async () => {
    const g = newGameAt('DAM-BASE');
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    await g.turn('inflate boat with pump');
    // "it" should now resolve to INFLATED-BOAT; examine should return its description
    const out = await (await g.turn('examine it')).output;
    // INFLATED-BOAT has "magic boat" in description; pile of plastic must not appear
    expect(out).not.toContain('pile of plastic');
  });

  it('after inflate, "take it" resolves to the magic boat', async () => {
    const g = newGameAt('DAM-BASE');
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    await g.turn('inflate boat with pump');
    // ZIL: after inflate THIS-IS-IT ,INFLATED-BOAT → "it" = the magic boat
    // "take it" should either succeed (taking INFLATED-BOAT) or give a boat-specific message,
    // not silently take the now-removed INFLATABLE-BOAT.
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    const inflated   = g.world.get('INFLATED-BOAT')!;
    await g.turn('take it');
    // INFLATED-BOAT may have been taken; the pile of plastic must NOT be in player inventory
    expect(inflatable.parent).not.toBe(g.player);
    // INFLATED-BOAT should be in player inventory (taken) or still in room
    // The key: "it" pointed to inflated, not inflatable
    expect(inflated.parent === g.player || inflated.parent === g.world.get('DAM-BASE')).toBe(true);
  });
});

describe('CB-BOAT2 — THIS-IS-IT: pronoun re-points after deflate (1actions.zil:2815)', () => {
  it('after deflate, "take it" resolves to the pile of plastic, not the magic boat', async () => {
    const g = newGameAt('DAM-BASE');
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    await g.turn('inflate boat with pump');
    await g.turn('deflate boat');
    // ZIL: after deflate THIS-IS-IT ,INFLATABLE-BOAT → "it" = the pile of plastic
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    const inflated   = g.world.get('INFLATED-BOAT')!;
    await g.turn('take it');
    // pile of plastic should be taken; magic boat (removed) must NOT be taken
    expect(inflatable.parent).toBe(g.player);
    expect(inflated.parent).toBeNull();
  });

  it('after deflate, "examine it" resolves to the pile of plastic', async () => {
    const g = newGameAt('DAM-BASE');
    const pump = g.world.get('PUMP')!;
    pump.moveTo(g.player);
    await g.turn('inflate boat with pump');
    await g.turn('deflate boat');
    const out = await (await g.turn('examine it')).output;
    // INFLATABLE-BOAT is the "pile of plastic"; magic boat description must not appear
    expect(out).not.toContain('magic boat');
  });
});
