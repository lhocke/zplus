/**
 * CB1 — V-CLIMB family, V-ENTER, V-EXIT, V-LOCK, V-UNLOCK
 *
 * ZIL refs:
 *   gverbs.zil:279–335  V-CLIMB-DOWN / V-CLIMB-FOO / V-CLIMB-ON / V-CLIMB-UP
 *   gverbs.zil:620–621  V-ENTER  — DO-WALK P?IN
 *   gverbs.zil:632–641  V-EXIT   — vehicle → V-DISEMBARK; else DO-WALK P?OUT
 *   gverbs.zil:855–856  V-LOCK   — "It doesn't seem to work."
 *   gverbs.zil:1508–1509 V-UNLOCK — calls V-LOCK
 *
 * Done-criteria (spec §4.1 + §4.8):
 *   - climb tree from PATH reaches UP-A-TREE
 *   - climb tree from FOREST → "There are no climbable trees here."
 *   - bare climb (no obj) with no up exit → "You can't go that way."
 *   - climb mailbox (not VEHBIT) → "You can't climb onto the mailbox."
 *   - enter delegates to DO-WALK 'in' (resolves 'in' exit)
 *   - exit delegates to DO-WALK 'out' (resolves 'out' exit)
 *   - exit in vehicle → V-DISEMBARK
 *   - lock → "It doesn't seem to work."
 *   - unlock → "It doesn't seem to work."
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Container } from '../../src/domain/container.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { newGameAt } from '../helpers/new-game.js';

// ---------------------------------------------------------------------------
// Fixture: PATH with up→TREE-TOP, FOREST with no up exit, BOAT room
// ---------------------------------------------------------------------------

interface Fix {
  world: World;
  path: Room;
  treeTop: Room;
  forest: Room;
  boatRoom: Room;
  player: Actor;
  tree: Thing;
  mailbox: Container;
  boat: Thing;        // VEHBIT object (vehicle)
}

function makeFixture(): Fix {
  const treeTop = new Room('TREE-TOP', 'Up a Tree', { ldesc: 'You are up a tree.', exits: [{ dir: 'down', to: 'PATH' }] });
  treeTop.set(Flag.On);
  treeTop.set(Flag.Sacred);
  // TREE is a global in UP-A-TREE (zil/1dungeon.zil GLOBAL TREE FOREST ...);
  // mirrored here so the GLOBAL-IN? check in verbClimbUp passes.
  treeTop.props.set('GLOBAL', 'TREE');

  const path = new Room('PATH', 'Forest Path', {
    ldesc: 'A narrow path. A large tree stands nearby.',
    exits: [
      { dir: 'up', to: 'TREE-TOP' },
      { dir: 'in', to: 'TREE-TOP' },  // entry point
      { dir: 'out', to: 'TREE-TOP' }, // exit point (for exit verb test)
    ],
  });
  path.set(Flag.On);
  path.set(Flag.Sacred);
  // GLOBAL: TREE — needed for the Zork-1 no-climbable-tree branch check.
  path.props.set('GLOBAL', 'TREE');

  // Forest has TREE global but no passable 'up' exit.
  const forest = new Room('FOREST', 'Forest', {
    ldesc: 'Dense trees all around.',
    exits: [
      { dir: 'east', to: 'PATH' },
      { dir: 'up', elseMessage: 'There is no tree here suitable for climbing.' },
    ],
  });
  forest.set(Flag.On);
  forest.set(Flag.Sacred);
  forest.props.set('GLOBAL', 'TREE');

  // Boat room: a LAND room containing a vehicle the player can sit in.
  const boatRoom = new Room('BOAT-ROOM', 'Boat Room', {
    ldesc: 'A room with a boat.',
    exits: [],
  });
  boatRoom.set(Flag.On);
  boatRoom.set(Flag.Land);

  const player = new Actor('PLAYER', 'yourself');

  const tree = new Thing('TREE', 'tree', {
    synonyms: ['tree'],
    adjectives: [],
    ldesc: 'A large tree.',
  });
  // Tree is a global scenery object in PATH.
  tree.moveTo(path);

  const mailbox = new Container('MAILBOX', 'mailbox', {
    synonyms: ['mailbox'],
    adjectives: [],
    ldesc: 'A mailbox.',
  });
  // Not VEHBIT: cannot board it.
  mailbox.set(Flag.Takeable);
  mailbox.moveTo(path);

  const boat = new Thing('BOAT', 'small boat', {
    synonyms: ['boat'],
    adjectives: ['small'],
    ldesc: 'A small boat.',
  });
  boat.set(Flag.Vehicle);
  boat.moveTo(boatRoom);

  player.moveTo(path);

  const world = World.fromObjects([path, treeTop, forest, boatRoom, player, tree, mailbox, boat]);
  return { world, path, treeTop, forest, boatRoom, player, tree, mailbox, boat };
}

function makeCtx(fix: Fix, overrides: Partial<VerbContext> & { verb: string }): VerbContext {
  return {
    player: fix.player,
    here: fix.path,
    world: fix.world,
    prep: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// V-LOCK / V-UNLOCK — gverbs.zil:855–856, 1508–1509
// ---------------------------------------------------------------------------

describe('V-LOCK', () => {
  it('returns "It doesn\'t seem to work." — gverbs.zil:856', () => {
    const fix = makeFixture();
    const r = executeVerb(makeCtx(fix, { verb: 'lock', action: 'V-LOCK', dobj: fix.mailbox }), 'V-LOCK');
    expect(r.output).toBe("It doesn't seem to work.");
  });
});

describe('V-UNLOCK', () => {
  it('returns "It doesn\'t seem to work." — same as V-LOCK (gverbs.zil:1509)', () => {
    const fix = makeFixture();
    const r = executeVerb(makeCtx(fix, { verb: 'unlock', action: 'V-UNLOCK', dobj: fix.mailbox }), 'V-UNLOCK');
    expect(r.output).toBe("It doesn't seem to work.");
  });
});

// ---------------------------------------------------------------------------
// V-ENTER — gverbs.zil:620–621  DO-WALK P?IN
// ---------------------------------------------------------------------------

describe('V-ENTER', () => {
  it('resolves the "in" exit and moves the player there', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.path);
    const r = executeVerb(makeCtx(fix, { verb: 'enter', action: 'V-ENTER', here: fix.path }), 'V-ENTER');
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('TREE-TOP');
  });

  it('returns a blocked message when there is no "in" exit', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.forest);
    const r = executeVerb(makeCtx(fix, { verb: 'enter', action: 'V-ENTER', here: fix.forest }), 'V-ENTER');
    expect(r.moved).toBe(false);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// V-EXIT — gverbs.zil:632–641
// ---------------------------------------------------------------------------

describe('V-EXIT', () => {
  it('no vehicle: resolves the "out" exit and moves the player', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.path);
    const r = executeVerb(makeCtx(fix, { verb: 'exit', action: 'V-EXIT', here: fix.path }), 'V-EXIT');
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('TREE-TOP');
  });

  it('no vehicle, no "out" exit: returns a blocked message', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.treeTop);
    const r = executeVerb(makeCtx(fix, { verb: 'exit', action: 'V-EXIT', here: fix.treeTop }), 'V-EXIT');
    expect(r.moved).toBe(false);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('in vehicle on land: disembarks — "You are on your own feet again."', () => {
    const fix = makeFixture();
    // Player inside boat in a LAND room.
    fix.player.moveTo(fix.boat);
    fix.boat.moveTo(fix.boatRoom);
    const r = executeVerb(makeCtx(fix, {
      verb: 'exit',
      action: 'V-EXIT',
      here: fix.boatRoom,
    }), 'V-EXIT');
    expect(r.output).toBe('You are on your own feet again.');
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('BOAT-ROOM');
  });
});

// ---------------------------------------------------------------------------
// V-CLIMB-UP / V-CLIMB-DOWN / V-CLIMB-FOO / V-CLIMB-ON — gverbs.zil:279–335
// ---------------------------------------------------------------------------

describe('V-CLIMB-UP', () => {
  it('climb tree from PATH: reaches UP-A-TREE (traverses "up" exit)', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.path);
    const r = executeVerb(makeCtx(fix, {
      verb: 'climb',
      action: 'V-CLIMB-UP',
      dobj: fix.tree,
      here: fix.path,
    }), 'V-CLIMB-UP');
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('TREE-TOP');
  });

  it('climb tree from FOREST: elseMessage-only exit is NEXIT → verb-layer refusal — gverbs.zil:305–306', () => {
    // Structural fix: {elseMessage}-only exits (no to/per) are NEXIT at the verb layer.
    // ZIL V-CLIMB-UP always has OBJ=nil (gverbs.zil:300-302); the dobj passed here
    // simulates V-CLIMB-FOO ("climb tree") which DOES pass PRSO as OBJ.
    // V-CLIMB-FOO: OBJ set (TREE) + NEXIT → "The tree doesn't lead upward." — gverbs.zil:305–306.
    // In the full game, FOREST-ROOM M-BEG intercepts climb-tree FIRST and prints the
    // elseMessage ("There is no tree here suitable for climbing.") via DO-WALK.
    // This unit test exercises verbClimbFoo without the M-BEG layer.
    const fix = makeFixture();
    fix.player.moveTo(fix.forest);
    const r = executeVerb(makeCtx(fix, {
      verb: 'climb',
      action: 'V-CLIMB-FOO',
      dobj: fix.tree,
      here: fix.forest,
    }), 'V-CLIMB-FOO');
    expect(r.moved).toBe(false);
    expect(r.output).toBe("The tree doesn't lead upward.");
  });

  it('climb wall from FOREST (elseMessage exit, WALL not global of HERE): refusal — gverbs.zil:306–316', () => {
    // DIV-1 repair: FOREST up exit has elseMessage but WALL is not a local-global
    // of FOREST (GLOBAL:TREE only). ZIL CEXIT check: NOT GLOBAL-IN? PRSO HERE →
    // "The surrounding wall doesn't lead upward."
    // dfrotz @ FOREST-1 "climb wall": "The surrounding wall doesn't lead upward."
    // Uses V-CLIMB-FOO because V-CLIMB-UP always has OBJ=nil (gverbs.zil:300-302);
    // the verb that actually passes PRSO as OBJ is V-CLIMB-FOO (bare "climb <obj>").
    const fix = makeFixture();
    const wallObj = new Thing('WALL', 'surrounding wall', { synonyms: ['WALL', 'WALLS'], adjectives: ['SURROUNDING'] });
    wallObj.moveTo(fix.forest);
    fix.player.moveTo(fix.forest);
    const w = World.fromObjects([fix.path, fix.treeTop, fix.forest, fix.boatRoom, fix.player, fix.tree, fix.mailbox, fix.boat, wallObj]);
    const r = executeVerb({
      verb: 'climb',
      action: 'V-CLIMB-FOO',
      dobj: wallObj,
      player: fix.player,
      here: fix.forest,
      world: w,
    }, 'V-CLIMB-FOO');
    expect(r.moved).toBe(false);
    expect(r.output).toBe("The surrounding wall doesn't lead upward.");
  });

  it('climb tree from room with bare NEXIT up: still "The X doesn\'t lead upward." — gverbs.zil:306', () => {
    // DIV-1 control: a genuinely bare NEXIT (no elseMessage/ifFlag/per) still
    // gets the "doesn't lead upward" refusal, not the room message.
    // Uses V-CLIMB-FOO because V-CLIMB-UP always has OBJ=nil (gverbs.zil:300-302).
    const player2 = new Actor('PLAYER2', 'yourself');
    const bareNexitRoom = new Room('BARE-NEXIT', 'Cave', {
      ldesc: 'A cave.',
      exits: [{ dir: 'up' }],  // bare NEXIT: to/elseMessage/ifFlag/per all absent
    });
    bareNexitRoom.set(Flag.On);
    const wallObj = new Thing('WALL2', 'wall', { synonyms: ['WALL'], adjectives: [] });
    wallObj.moveTo(bareNexitRoom);
    player2.moveTo(bareNexitRoom);
    const tree2 = new Thing('TREE2', 'tree', { synonyms: ['TREE'], adjectives: [] });
    tree2.moveTo(bareNexitRoom);
    const w2 = World.fromObjects([bareNexitRoom, player2, wallObj, tree2]);
    const ctx2: VerbContext = { verb: 'climb', player: player2, here: bareNexitRoom, world: w2 };
    const r = executeVerb({ ...ctx2, dobj: tree2 }, 'V-CLIMB-FOO');
    expect(r.moved).toBe(false);
    expect(r.output).toBe("The tree doesn't lead upward.");
  });

  it('climb wall in room with no up exit: WALL synonym → "Climbing the walls is to no avail." — gverbs.zil:320–323 (DIV-2)', () => {
    // DIV-2: no exit in DIR and dobj has WALL in its synonyms → walls branch fires.
    // ZIL gverbs.zil:320–323 is the ELSE branch of GETPT (no exit found).
    // Uses V-CLIMB-FOO because V-CLIMB-UP always has OBJ=nil (gverbs.zil:300-302);
    // the WALL branch only fires when OBJ is set with WALL synonym.
    const player2 = new Actor('PLAYER2WV', 'yourself');
    const caveRoom = new Room('CAVE-WV', 'Cave', {
      ldesc: 'A cave with stone walls.',
      exits: [],  // no up exit — WALL branch can fire
    });
    caveRoom.set(Flag.On);
    const wallObj = new Thing('WALL-WV', 'surrounding wall', { synonyms: ['WALL', 'WALLS'], adjectives: ['SURROUNDING'] });
    wallObj.moveTo(caveRoom);
    player2.moveTo(caveRoom);
    const w2 = World.fromObjects([caveRoom, player2, wallObj]);
    const r = executeVerb({
      verb: 'climb',
      action: 'V-CLIMB-FOO',
      dobj: wallObj,
      player: player2,
      here: caveRoom,
      world: w2,
    }, 'V-CLIMB-FOO');
    expect(r.moved).toBe(false);
    expect(r.output).toBe('Climbing the walls is to no avail.');
  });

  it('bare climb (no obj) no up exit: Zork-1 tree branch — "There are no climbable trees here." — gverbs.zil:329', () => {
    // Build a room with TREE global and no up exit at all (not even elseMessage).
    // Then V-CLIMB-FOO (no obj) → Zork-1 branch fires.
    const player2 = new Actor('PLAYER2', 'yourself');
    const noExitRoom = new Room('NO-EXIT-TREE', 'Tree Clearing', {
      ldesc: 'Surrounded by trees.',
      exits: [],  // no 'up' exit
    });
    noExitRoom.set(Flag.On);
    noExitRoom.props.set('GLOBAL', 'TREE');
    player2.moveTo(noExitRoom);
    const miniWorld = World.fromObjects([noExitRoom, player2]);
    const ctx2: VerbContext = {
      verb: 'climb',
      player: player2,
      here: noExitRoom,
      world: miniWorld,
    };
    const r = executeVerb(ctx2, 'V-CLIMB-FOO');
    expect(r.moved).toBe(false);
    expect(r.output).toBe('There are no climbable trees here.');
  });
});

describe('V-CLIMB-DOWN', () => {
  it('climb down from UP-A-TREE: moves to PATH via "down" exit', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.treeTop);
    const r = executeVerb(makeCtx(fix, {
      verb: 'climb',
      action: 'V-CLIMB-DOWN',
      dobj: fix.tree,
      here: fix.treeTop,
    }), 'V-CLIMB-DOWN');
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('PATH');
  });
});

describe('V-CLIMB-ON', () => {
  it('climb onto non-vehicle object: "You can\'t climb onto the mailbox." — gverbs.zil:298', () => {
    const fix = makeFixture();
    const r = executeVerb(makeCtx(fix, {
      verb: 'climb',
      action: 'V-CLIMB-ON',
      dobj: fix.mailbox,
    }), 'V-CLIMB-ON');
    expect(r.output).toBe("You can't climb onto the mailbox.");
    expect(r.moved).toBe(false);
  });

  it('climb onto vehicle: delegates to V-BOARD (outputs board message)', () => {
    const fix = makeFixture();
    fix.player.moveTo(fix.boatRoom);
    const r = executeVerb(makeCtx(fix, {
      verb: 'climb',
      action: 'V-CLIMB-ON',
      dobj: fix.boat,
      here: fix.boatRoom,
    }), 'V-CLIMB-ON');
    // V-BOARD moves player inside the vehicle.
    expect(r.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('BOAT');
  });
});

// ---------------------------------------------------------------------------
// Integration: game-level climb tree reaches UP-A-TREE from PATH
// ---------------------------------------------------------------------------

describe('CB1 integration: climb tree from real PATH room', () => {
  it('game.turn("climb tree") from PATH moves player to UP-A-TREE', () => {
    const g = newGameAt('PATH');
    g.start();
    expect(g.view().here).toBe('PATH');
    const r = g.turn('climb tree');
    expect(r.moved).toBe(true);
    expect(g.view().here).toBe('UP-A-TREE');
  });

  it('V-LOCK action always returns "It doesn\'t seem to work."', () => {
    // Verify via unit-level dispatch: lock on any object uses V-LOCK default.
    const fix = makeFixture();
    const r = executeVerb(makeCtx(fix, { verb: 'lock', action: 'V-LOCK', dobj: fix.mailbox }), 'V-LOCK');
    expect(r.output).toBe("It doesn't seem to work.");
  });

  it('V-UNLOCK action always returns "It doesn\'t seem to work."', () => {
    const fix = makeFixture();
    const r = executeVerb(makeCtx(fix, { verb: 'unlock', action: 'V-UNLOCK', dobj: fix.mailbox }), 'V-UNLOCK');
    expect(r.output).toBe("It doesn't seem to work.");
  });
});

// ---------------------------------------------------------------------------
// REPAIR: V-ENTER resolves the 'in' exit (rooms.json data fix)
// ZIL 1dungeon.zil:1304 — EAST-OF-HOUSE has (IN TO KITCHEN IF KITCHEN-WINDOW IS OPEN)
// ---------------------------------------------------------------------------

describe('CB1 repair: V-ENTER resolves "in" exit at EAST-OF-HOUSE', () => {
  it('enter at EAST-OF-HOUSE with window open moves player to KITCHEN', () => {
    const g = newGameAt('EAST-OF-HOUSE');
    g.start();
    // Open the kitchen window first.
    g.turn('open window');
    expect(g.view().here).toBe('EAST-OF-HOUSE');
    const r = g.turn('enter');
    expect(r.moved).toBe(true);
    expect(g.view().here).toBe('KITCHEN');
  });

  it('enter at EAST-OF-HOUSE with window closed: blocked (no open in exit)', () => {
    const g = newGameAt('EAST-OF-HOUSE');
    g.start();
    // Window is closed by default — in exit is gated by KITCHEN-WINDOW.
    const r = g.turn('enter');
    expect(r.moved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REPAIR: V-CLIMB-UP GLOBAL-IN? check (gverbs.zil:305–316)
// Chimney/window at Kitchen are not globals in ATTIC → "doesn't lead upward."
// Stairs ARE a global in ATTIC → DO-WALK succeeds.
// ---------------------------------------------------------------------------

describe('CB1 repair: V-CLIMB-UP GLOBAL-IN? for destination room', () => {
  it('climb chimney at Kitchen: chimney not global in ATTIC → "The chimney doesn\'t lead upward."', () => {
    // gverbs.zil:309–316: exit exists (up→ATTIC) but CHIMNEY not in ATTIC globals.
    const g = newGameAt('KITCHEN');
    g.start();
    const r = g.turn('climb chimney');
    expect(r.moved).toBe(false);
    expect(r.output).toBe("The chimney doesn't lead upward.");
  });

  it('climb window at Kitchen: window not global in ATTIC → "The kitchen window doesn\'t lead upward."', () => {
    const g = newGameAt('KITCHEN');
    g.start();
    const r = g.turn('climb window');
    expect(r.moved).toBe(false);
    expect(r.output).toBe("The kitchen window doesn't lead upward.");
  });

  it('climb stairs at Kitchen: STAIRS is global in ATTIC → moves to ATTIC (control)', () => {
    const g = newGameAt('KITCHEN');
    g.start();
    const r = g.turn('climb stairs');
    expect(r.moved).toBe(true);
    expect(g.view().here).toBe('ATTIC');
  });
});
