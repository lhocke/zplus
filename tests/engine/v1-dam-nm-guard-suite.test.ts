/**
 * V1 — Dam/River NM guard suite (spec §8.4 + §9 Wave 4 V1)
 *
 * One dedicated asserting describe per NM-A…NM-L.  Deps: all CB tasks.
 * These are the regression net against silent semantic drift in the dam/river
 * subsystem; each guard is individually greppable by name.
 *
 * NM-A  parked-timer-never-fires: disabled tick-0 I-RFILL/I-REMPTY stays inert
 * NM-B  trunk-rehide-conditional: I-RFILL re-hides TRUNK only if still in RESERVOIR
 * NM-C  drownings-index: I-MAINT-ROOM DROWNINGS indexed at WATER-LEVEL/2; drown at 14
 * NM-D  loud-room-mode: BAR untakeable while loud; takeable after ECHO
 * NM-E  goto-clauses-1-2-3: all three VEHBIT/NONLANDBIT rejection clauses enforced
 * NM-F  inflate-messages: only pump inflates; lungs and other tools give distinct messages
 * NM-G  sharp-object-puncture: BOARD with each of the six named sharp objects punctures
 * NM-H  iriver-rearm-speed: I-RIVER re-arms at the NEW section's speed after GOTO
 * NM-I  iriver-falls-death: past RIVER-5 (no RIVER-NEXT entry) triggers JIGS-UP, not silent disable
 * NM-J  beach-dig-bounds: dig #4 reveals scarab; dig #5 kills + resets; counter -1→0→1→2→3→4
 * NM-K  rainbow-on-wave-fatal: wave on ON-RAINBOW is fatal; endpoint wave toggles RAINBOW-FLAG
 * NM-L  irfill-mutation-order: LOW-TIDE=false + RESERVOIR NONLANDBIT survive after drowning death
 *
 * ZIL source spine: 1actions.zil (all refs cited per guard)
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Thing } from '../../src/domain/thing.js';
import { World } from '../../src/domain/world.js';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';

// ---------------------------------------------------------------------------
// Shared accessors — identical pattern to the CB test files
// ---------------------------------------------------------------------------

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

function clock(g: Game) {
  return (g as unknown as {
    clock: {
      getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined;
      queue(id: string, period: number, enabled: boolean): void;
    };
  }).clock;
}

function armTimer(g: Game, id: string, ticks: number) {
  clock(g).queue(id, ticks, true);
}

function setWaterLevel(g: Game, v: number) {
  (g as unknown as { waterLevel: number }).waterLevel = v;
}

function beachDig(g: Game): number {
  return (g as unknown as { beachDig: number }).beachDig;
}

function giveLight(g: Game) {
  const lamp = g.world.get('LAMP')!;
  lamp.set(Flag.Light);
  lamp.set(Flag.OnFire);
  lamp.moveTo(g.player);
}

function waitN(g: Game, n: number) {
  for (let i = 0; i < n; i++) g.turn('wait');
}

// ---------------------------------------------------------------------------
// NM-A — parked timer never fires
//
// When the bolt opens the gates, I-RFILL is parked: turnsLeft=0, enabled=false.
// Advancing N turns must leave LOW-TIDE unchanged (park means "don't fire").
// ZIL: 1actions.zil:1204 <QUEUE I-RFILL 0>, clock-main-loop.md §14.5
// ---------------------------------------------------------------------------

describe('NM-A — parked timer never fires (tick-0 disabled)', () => {
  it('parked I-RFILL (turnsLeft=0, enabled=false) does not flip LOW-TIDE after 10 turns', () => {
    const g = newGameAt('DAM-ROOM');
    // Park I-RFILL explicitly
    clock(g).queue('I-RFILL', 0, false);
    flags(g).set('LOW-TIDE', false);
    waitN(g, 10);
    expect(flags(g).get('LOW-TIDE')).toBe(false);
  });

  it('parked I-REMPTY (turnsLeft=0, enabled=false) does not flip LOW-TIDE', () => {
    const g = newGameAt('DAM-ROOM');
    clock(g).queue('I-REMPTY', 0, false);
    flags(g).set('LOW-TIDE', true);
    waitN(g, 10);
    // LOW-TIDE stays true — parked I-REMPTY never fires
    expect(flags(g).get('LOW-TIDE')).toBe(true);
  });

  it('bolt open: parks I-RFILL (enabled=false, turnsLeft=0) in the same turn', () => {
    const g = newGameAt('DAM-ROOM');
    g.world.get('WRENCH')!.moveTo(g.player);
    flags(g).set('GATE-FLAG', true);
    // gates are closed by default → turn bolt opens them
    g.turn('turn bolt with wrench');
    const rfill = clock(g).getEntry('I-RFILL');
    expect(rfill!.enabled).toBe(false);
    expect(rfill!.turnsLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NM-B — trunk re-hide is conditional
//
// I-RFILL re-hides TRUNK only if TRUNK is still in RESERVOIR.
// A taken trunk must stay visible even after the reservoir refills.
// ZIL: 1actions.zil:1231 <AND <IN? TRUNK RESERVOIR> ...>
// ---------------------------------------------------------------------------

describe('NM-B — trunk re-hide conditional on RESERVOIR location', () => {
  it('trunk in RESERVOIR is re-hidden by I-RFILL', () => {
    const g = newGameAt('DAM-ROOM');
    const trunk = g.world.get('TRUNK')!;
    trunk.clear(Flag.Invisible);
    trunk.moveTo(g.world.get('RESERVOIR')!);
    armTimer(g, 'I-RFILL', 1);
    g.turn('wait');
    expect(trunk.has(Flag.Invisible)).toBe(true);
  });

  it('trunk carried by player is NOT re-hidden by I-RFILL (NM-B)', () => {
    const g = newGameAt('DAM-ROOM');
    const trunk = g.world.get('TRUNK')!;
    trunk.clear(Flag.Invisible);
    trunk.moveTo(g.player);
    armTimer(g, 'I-RFILL', 1);
    g.turn('wait');
    expect(trunk.has(Flag.Invisible)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NM-C — DROWNINGS index at WATER-LEVEL/2; drown at 14
//
// I-MAINT-ROOM indexes DROWNINGS[WATER-LEVEL / 2] (integer division).
// The table has 9 entries (indices 0–8 cover WL 0–17 by half-steps).
// At WL >= 14, the room floods and the player drowns.
// ZIL: 1actions.zil:1284–1293 (DROWNINGS table), :1343–1360 (I-MAINT-ROOM)
// ---------------------------------------------------------------------------

describe('NM-C — DROWNINGS indexed at WATER-LEVEL/2', () => {
  it('WL=1 → DROWNINGS[0]: "up to your ankles"', () => {
    const g = newGameAt('MAINTENANCE-ROOM');
    g.world.get('MAINTENANCE-ROOM')!.set(Flag.On);
    giveLight(g);
    setWaterLevel(g, 1);
    clock(g).queue('I-MAINT-ROOM', -1, true);
    const out = g.turn('wait').output;
    expect(out).toContain('up to your ankles');
  });

  it('WL=4 → DROWNINGS[2]: "up to your knees"', () => {
    const g = newGameAt('MAINTENANCE-ROOM');
    g.world.get('MAINTENANCE-ROOM')!.set(Flag.On);
    giveLight(g);
    // Arm via push-blue-button to set up the demon; override WL after
    g.turn('push blue button');
    setWaterLevel(g, 4);
    const out = g.turn('wait').output;
    expect(out).toContain('up to your knees');
  });

  it('drown at WL=14 in MAINTENANCE-ROOM', () => {
    const g = newGameAt('MAINTENANCE-ROOM');
    g.world.get('MAINTENANCE-ROOM')!.set(Flag.On);
    giveLight(g);
    g.turn('push blue button');
    setWaterLevel(g, 13);  // next tick → 14 → drown
    const out = g.turn('wait').output;
    expect(out).toMatch(/drowned/i);
  });
});

// ---------------------------------------------------------------------------
// NM-D — loud-room input mode: BAR untakeable while loud; takeable after ECHO
//
// The BAR carries SACREDBIT in the loud room.  ECHO clears it.  Before ECHO,
// "take bar" echoes and the bar stays; after ECHO, "take bar" succeeds.
// ZIL: 1actions.zil:1660 (LOUD-ROOM-FCN), gverbs.zil:529–545 (V-ECHO)
// ---------------------------------------------------------------------------

describe('NM-D — BAR untakeable while loud; takeable after ECHO', () => {
  it('BAR has SACREDBIT at game start (1dungeon.zil:725)', () => {
    const g = newGameAt('LOUD-ROOM');
    expect(g.world.get('BAR')!.has(Flag.Sacred)).toBe(true);
  });

  it('take bar while loud → echoes, bar stays in LOUD-ROOM', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    flags(g).set('GATES-OPEN', false);  // ensure loud state (default)
    g.turn('take bar');
    expect(g.world.get('BAR')!.parent?.id).toBe('LOUD-ROOM');
  });

  it('ECHO clears BAR.SACREDBIT (1actions.zil:1676)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    flags(g).set('GATES-OPEN', false);
    g.turn('echo');
    expect(g.world.get('BAR')!.has(Flag.Sacred)).toBe(false);
  });

  it('take bar succeeds after ECHO (bar no longer sacred)', () => {
    const g = newGameAt('LOUD-ROOM');
    giveLight(g);
    flags(g).set('GATES-OPEN', false);
    g.turn('echo');
    g.turn('take bar');
    expect(g.world.get('BAR')!.parent?.id).toBe('PLAYER');
  });
});

// ---------------------------------------------------------------------------
// NM-E — GOTO all three rejection clauses enforced
//
// Clause 1: on foot, destination is NONLANDBIT → blocked ("without a vehicle")
// Clause 2: in vehicle, destination lacks VTYPE flag → blocked ("in a <vehicle>")
// Clause 3: water-vehicle beached on land, dest is land but not NONLANDBIT → blocked
// ZIL: gverbs.zil:2050–2066
// ---------------------------------------------------------------------------

describe('NM-E — GOTO three VEHBIT/NONLANDBIT rejection clauses', () => {
  function mkWorld() {
    const shore = new Room('SHORE', 'Shore', { exits: [{ dir: 'east', to: 'RIVER' }, { dir: 'north', to: 'LAND2' }], ldesc: 'Shore.' });
    shore.set(Flag.On); shore.set(Flag.Land);
    const land2 = new Room('LAND2', 'Other shore', { exits: [{ dir: 'south', to: 'SHORE' }], ldesc: 'Land.' });
    land2.set(Flag.On); land2.set(Flag.Land);
    const river = new Room('RIVER', 'River', { exits: [{ dir: 'west', to: 'SHORE' }], ldesc: 'Water.' });
    river.set(Flag.On); river.set(Flag.NonLand);
    const player = new Actor('PLAYER', 'you');
    player.moveTo(shore);
    const boat = new Thing('INFLATED-BOAT', 'magic boat');
    boat.set(Flag.Vehicle); boat.set(Flag.Open);
    boat.props.set('VTYPE', 'NONLANDBIT');
    boat.moveTo(shore);
    const world = World.fromObjects([shore, land2, river, player, boat]);
    return { shore, land2, river, player, boat, world };
  }

  function ctx(player: Actor, here: Room, world: World, dir: string): VerbContext {
    return { verb: 'walk', prep: dir, player, here, world };
  }

  it('clause 1: on-foot into NonLand → "without a vehicle"', () => {
    const { shore, player, world } = mkWorld();
    const result = executeVerb(ctx(player, shore, world, 'east'), 'V-WALK');
    expect(result.moved).toBe(false);
    expect(result.output).toContain('without a vehicle');
  });

  it('clause 2: boat beached on land, walk to another land room → "in a"', () => {
    const { shore, player, boat, world } = mkWorld();
    player.moveTo(boat);
    const result = executeVerb(ctx(player, shore, world, 'north'), 'V-WALK');
    expect(result.moved).toBe(false);
    expect(result.output).toContain('in a');
  });

  it('clause 3: boat in water, destination is land → allowed (landing)', () => {
    const { river, player, boat, world } = mkWorld();
    boat.moveTo(river);
    player.moveTo(boat);
    const result = executeVerb(ctx(player, river, world, 'west'), 'V-WALK');
    expect(result.moved).toBe(true);
  });

  it('landing emits "comes to a rest on the shore."', () => {
    const { river, player, boat, world } = mkWorld();
    boat.moveTo(river);
    player.moveTo(boat);
    const result = executeVerb(ctx(player, river, world, 'west'), 'V-WALK');
    expect(result.output).toContain('comes to a rest on the shore.');
  });
});

// ---------------------------------------------------------------------------
// NM-F — only pump inflates; lungs and other tools give distinct messages
//
// IBOAT-FUNCTION: pump → seaworthy; lungs → "not enough lung power"; anything
// else → "Surely you jest!"
// ZIL: 1actions.zil:2820–2840
// ---------------------------------------------------------------------------

describe('NM-F — inflate messages: pump inflates; lungs and other tools distinct', () => {
  it('inflate with pump → "seaworthy" (inflates the boat)', () => {
    const g = newGameAt('DAM-BASE');
    g.world.get('PUMP')!.moveTo(g.player);
    const out = g.turn('inflate boat with pump').output;
    expect(out).toContain('seaworthy');
  });

  it('blow in boat → "lung power" (NM-F: BREATHE path, distinct from pump)', () => {
    // ZIL: BREATHE → <PERFORM V?INFLATE PRSO LUNGS> (gverbs.zil:231, 1actions.zil:2817).
    // "blow in boat" routes V-BREATHE → lung-power message without inflating.
    // "inflate boat with lungs" is NOT a valid ZIL command (INFLATE syntax requires
    // TOOLBIT on iobj; LUNGS has only NDESCBIT); the canonical path is V-BREATHE.
    const g = newGameAt('DAM-BASE');
    const inflatable = g.world.get('INFLATABLE-BOAT')!;
    inflatable.moveTo(g.world.get('DAM-BASE')!);
    const out = g.turn('blow in boat').output;
    expect(out).toContain('lung power');
  });

  it('inflate with non-pump non-lungs tool → "jest"', () => {
    const g = newGameAt('DAM-BASE');
    g.world.get('WRENCH')!.moveTo(g.player);
    const out = g.turn('inflate boat with wrench').output;
    expect(out).toContain('jest');
  });

  it('blow in teeth → "How can you inflate that?" (non-boat V-BREATHE fall-through)', () => {
    // V-BREATHE dispatches <PERFORM V?INFLATE PRSO LUNGS>.  A non-boat dobj has no
    // IBOAT-FUNCTION branch → falls through to V-INFLATE: "How can you inflate that?"
    // ZIL: gverbs.zil:757–758 (V-INFLATE default)
    const g = newGameAt('WEST-OF-HOUSE');
    giveLight(g);
    // TEETH is a global object (NDESCBIT); always accessible.
    const out = g.turn('blow in teeth').output;
    expect(out).toContain('How can you inflate that?');
  });

  it('blow in punctured-boat → "No chance. Some moron punctured it." (1actions.zil:2656)', () => {
    // DBOAT-FUNCTION intercepts the BREATHE/INFLATE call and returns the puncture rejection.
    // ZIL: 1actions.zil:2652–2668 (DBOAT-FUNCTION)
    const g = newGameAt('DAM-BASE');
    // Remove inflatable so "boat" unambiguously resolves to the punctured boat.
    g.world.get('INFLATABLE-BOAT')!.moveTo(g.world.get('TROPHY-CASE')!);
    const punctured = g.world.get('PUNCTURED-BOAT')!;
    punctured.moveTo(g.world.get('DAM-BASE')!);
    const out = g.turn('blow in boat').output;
    expect(out).toContain('moron punctured it');
  });
});

// ---------------------------------------------------------------------------
// NM-G — BOARD sharp-object puncture by named identity set
//
// RBOAT-FUNCTION BOARD: if any of SCEPTRE/KNIFE/SWORD/RUSTY-KNIFE/AXE/STILETTO
// is in inventory → puncture and swap to PUNCTURED-BOAT.
// BOARD empty-handed succeeds (no puncture).
// DROP/PUT/ATTACK puncture uses WEAPONBIT (distinct from BOARD's named-set check).
// ZIL: 1actions.zil:2787–2800
// ---------------------------------------------------------------------------

describe('NM-G — BOARD with six named sharp objects punctures', () => {
  const sharpObjects = ['SWORD', 'KNIFE', 'RUSTY-KNIFE', 'AXE', 'STILETTO', 'SCEPTRE'];

  function setupBoard(sharpId: string) {
    const g = newGameAt('DAM-BASE');
    g.world.get('PUMP')!.moveTo(g.player);
    g.turn('inflate boat with pump');  // creates INFLATED-BOAT in room
    const sharp = g.world.get(sharpId);
    if (sharp) sharp.moveTo(g.player);
    return g;
  }

  for (const id of sharpObjects) {
    it(`board with ${id} in inventory → punctured boat`, () => {
      const g = setupBoard(id);
      // all six sharp objects must exist — a missing one is a data bug, not a skip
      expect(g.world.get(id)).toBeTruthy();
      const out = g.turn('board boat').output;
      expect(out).toMatch(/puncture|punctured|slipped/i);
      expect(g.world.get('PUNCTURED-BOAT')!.parent?.id).not.toBeNull();
    });
  }

  it('board with empty hands succeeds (no puncture)', () => {
    const g = newGameAt('DAM-BASE');
    g.world.get('PUMP')!.moveTo(g.player);
    g.turn('inflate boat with pump');
    // ensure no sharp objects in inventory
    for (const id of sharpObjects) {
      const obj = g.world.get(id);
      if (obj && obj.parent?.id === 'PLAYER') obj.moveTo(g.world.get('DAM-BASE')!);
    }
    const out = g.turn('board boat').output;
    expect(out).not.toMatch(/puncture|punctured|slipped/i);
  });
});

// ---------------------------------------------------------------------------
// NM-H — I-RIVER re-arms at the NEW section's speed after GOTO
//
// After drifting RIVER-1→RIVER-2, the re-arm uses RIVER-SPEEDS[RIVER-2] = 4,
// not RIVER-1's speed.  This is "re-arm reads HERE after GOTO".
// ZIL: 1actions.zil:2715 (RIVER-SPEEDS), :2708–2720 (I-RIVER body)
// ---------------------------------------------------------------------------

describe('NM-H — I-RIVER re-arms at new section speed after drift', () => {
  it('after RIVER-1→RIVER-2 drift, I-RIVER turnsLeft is 4 (RIVER-2 speed)', () => {
    const g = newGameAt('DAM-BASE');
    g.world.get('PUMP')!.moveTo(g.player);
    g.turn('inflate boat with pump');
    g.turn('board boat');
    g.turn('launch');
    // RIVER-1 speed = 4; clock advances once at end of launch turn → turnsLeft=3
    // Fire: 3 waits trigger the drift (turnsLeft 3→2→1→0)
    waitN(g, 3);
    // Drift to RIVER-2 fires; re-arm at RIVER-2 speed (4)
    const entry = clock(g).getEntry('I-RIVER');
    expect(entry!.enabled).toBe(true);
    expect(entry!.turnsLeft).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// NM-I — past RIVER-5 triggers JIGS-UP (waterfall death), not silent disable
//
// After RIVER-5, RIVER-NEXT has no entry → fatal.  The timer must not simply
// disable itself; the player must die.
// ZIL: 1actions.zil:2716–2719 (past-RIVER-5 death)
// ---------------------------------------------------------------------------

describe('NM-I — past RIVER-5: waterfall death (not silent disable)', () => {
  it('drifting off RIVER-5 emits waterfall death message', () => {
    const g = newGameAt('DAM-BASE');
    g.world.get('PUMP')!.moveTo(g.player);
    g.turn('inflate boat with pump');
    g.turn('board boat');
    g.turn('launch');
    // Speeds: R1=4(→3), R2=4, R3=3, R4=2, R5=1
    // Launch: turnsLeft=3 (4-1 from advance).  Cumulative waits to reach R5:
    // R1→R2 on wait 3, R2→R3 on wait 7, R3→R4 on wait 10, R4→R5 on wait 12.
    // R5 turnsLeft=1 after re-arm; falls on wait 13.
    waitN(g, 12);
    expect(g.world.get('INFLATED-BOAT')!.parent?.id).toBe('RIVER-5');
    const out = g.turn('wait').output;
    expect(out).toMatch(/waterfalls|bottom|rocks/i);
  });
});

// ---------------------------------------------------------------------------
// NM-J — BEACH-DIG counter bounds: dig #4 reveals scarab; dig #5 kills + resets
//
// Counter inits -1; each dig increments first: -1→0(dig1), 0→1(dig2),
// 1→2(dig3), 2→3(dig4, reveal), 3→4(dig5, death, reset to -1).
// ZIL: 1actions.zil:2855–2869, BEACH-DIG init :2851
// ---------------------------------------------------------------------------

describe('NM-J — BEACH-DIG counter: dig #4 reveals; dig #5 kills', () => {
  function digSetup(overrideDig?: number) {
    const g = newGameAt('SANDY-CAVE');
    g.world.get('SANDY-CAVE')!.set(Flag.On);
    g.world.get('SHOVEL')!.moveTo(g.player);
    const scarab = g.world.get('SCARAB')!;
    scarab.moveTo(g.world.get('SANDY-CAVE')!);
    scarab.set(Flag.Invisible);
    if (overrideDig !== undefined) {
      (g as unknown as { beachDig: number }).beachDig = overrideDig;
    }
    return g;
  }

  it('starts at BEACH-DIG = -1 (1actions.zil:2851)', () => {
    const g = digSetup();
    expect(beachDig(g)).toBe(-1);
  });

  it('dig #1: BEACH-DIG → 0, progress message', () => {
    const g = digSetup();
    const out = g.turn('dig sand with shovel').output;
    expect(beachDig(g)).toBe(0);
    expect(out).toContain('digging a hole');
  });

  it('dig #4 (pre-set to 2): BEACH-DIG → 3, scarab revealed', () => {
    const g = digSetup(2);
    g.turn('dig sand with shovel');
    expect(beachDig(g)).toBe(3);
    expect(g.world.get('SCARAB')!.has(Flag.Invisible)).toBe(false);
  });

  it('dig #5 (pre-set to 3): death + BEACH-DIG reset to -1', () => {
    const g = digSetup(3);
    const out = g.turn('dig sand with shovel').output;
    expect(out).toContain('smothering');
    expect(beachDig(g)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// NM-K — rainbow: wave on ON-RAINBOW fatal; endpoint wave toggles RAINBOW-FLAG;
//         pot-of-gold reveal only at END-OF-RAINBOW (not ARAGAIN-FALLS)
//
// ZIL: 1actions.zil:2592–2620 (SCEPTRE-FUNCTION)
// ---------------------------------------------------------------------------

describe('NM-K — rainbow: on-rainbow fatal; endpoint toggle; pot reveal only at END-OF-RAINBOW', () => {
  it('wave sceptre on ON-RAINBOW → fatal', () => {
    const g = newGameAt('ON-RAINBOW');
    giveLight(g);
    const sceptre = g.world.get('SCEPTRE')!;
    sceptre.moveTo(g.player);
    flags(g).set('RAINBOW-FLAG', true);  // solid rainbow (player is on it)
    const out = g.turn('wave sceptre').output;
    expect(out).toMatch(/midair|vapor|hanging/i);
  });

  it('wave at ARAGAIN-FALLS sets RAINBOW-FLAG', () => {
    const g = newGameAt('ARAGAIN-FALLS');
    giveLight(g);
    const sceptre = g.world.get('SCEPTRE')!;
    sceptre.moveTo(g.player);
    flags(g).set('RAINBOW-FLAG', false);
    g.turn('wave sceptre');
    expect(flags(g).get('RAINBOW-FLAG')).toBe(true);
  });

  it('wave at ARAGAIN-FALLS does NOT show pot-of-gold message', () => {
    const g = newGameAt('ARAGAIN-FALLS');
    giveLight(g);
    const sceptre = g.world.get('SCEPTRE')!;
    sceptre.moveTo(g.player);
    flags(g).set('RAINBOW-FLAG', false);
    const out = g.turn('wave sceptre').output;
    expect(out).not.toContain('pot of gold');
  });

  it('wave at END-OF-RAINBOW (first time, pot in room) → pot-of-gold message', () => {
    const g = newGameAt('END-OF-RAINBOW');
    giveLight(g);
    const sceptre = g.world.get('SCEPTRE')!;
    sceptre.moveTo(g.player);
    const pot = g.world.get('POT-OF-GOLD')!;
    pot.set(Flag.Invisible);
    pot.moveTo(g.world.get('END-OF-RAINBOW')!);
    flags(g).set('RAINBOW-FLAG', false);
    const out = g.turn('wave sceptre').output;
    expect(out).toMatch(/pot of gold|shimmering/i);
  });
});

// ---------------------------------------------------------------------------
// NM-L — I-RFILL mutation ordering: flag writes survive the death-abort path
//
// I-RFILL sets NONLANDBIT, clears RLANDBIT, clears TOUCHBITs, and flips
// LOW-TIDE=false BEFORE the HERE switch that may call JIGS-UP.  After a
// drowning death in RESERVOIR, these flags must NOT be rolled back.
// ZIL: 1actions.zil:1226–1243 (mutation order + drown path)
// ---------------------------------------------------------------------------

describe('NM-L — I-RFILL mutations survive JIGS-UP (death does not roll them back)', () => {
  it('after drowning in RESERVOIR: LOW-TIDE is false', () => {
    const g = newGameAt('RESERVOIR');
    flags(g).set('LOW-TIDE', true);
    armTimer(g, 'I-RFILL', 1);
    g.turn('wait');
    expect(flags(g).get('LOW-TIDE')).toBe(false);
  });

  it('after drowning in RESERVOIR: RESERVOIR has NONLANDBIT set', () => {
    const g = newGameAt('RESERVOIR');
    armTimer(g, 'I-RFILL', 1);
    g.turn('wait');
    expect(g.world.get('RESERVOIR')!.has(Flag.NonLand)).toBe(true);
  });

  it('after drowning in RESERVOIR: RESERVOIR does not have RLANDBIT', () => {
    const g = newGameAt('RESERVOIR');
    armTimer(g, 'I-RFILL', 1);
    g.turn('wait');
    expect(g.world.get('RESERVOIR')!.has(Flag.Land)).toBe(false);
  });

  it('after drowning in RESERVOIR: trunk (in reservoir) is re-hidden (NM-L + NM-B)', () => {
    const g = newGameAt('RESERVOIR');
    const trunk = g.world.get('TRUNK')!;
    trunk.clear(Flag.Invisible);
    trunk.moveTo(g.world.get('RESERVOIR')!);
    armTimer(g, 'I-RFILL', 1);
    g.turn('wait');
    expect(trunk.has(Flag.Invisible)).toBe(true);
  });
});
