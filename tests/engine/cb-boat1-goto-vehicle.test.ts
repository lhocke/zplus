/**
 * CB-BOAT1 — GOTO vehicle interlock (phase-3-dam-river §9 Wave 2)
 *
 * Done-criteria (spec §9 CB-BOAT1 + §4.2):
 *   - Clause 1 (NM-E): on foot, destination is NonLand → "can't go there without a vehicle"
 *   - Clause 2 (NM-E): in vehicle, destination lacks the vehicle's VTYPE flag → "can't go there in a <vehicle>"
 *   - Clause 3 (NM-E): in water-vehicle on land, destination is land but lacks NONLANDBIT → blocked
 *   - Landing message: boat moves from NonLand room to Land room → "comes to a rest on the shore."
 *   - Normal land→land movement (on foot) unaffected — no regression
 *   - Vehicle moves to destination (not the player directly) when in boat
 *
 * ZIL ref: gverbs.zil:2045–2088 (GOTO vehicle interlock), :2038–2043 (NO-GO-TELL)
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Thing } from '../../src/domain/thing.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal fixture:
 *   landRoom    — has Flag.Land (RLANDBIT); lit
 *   waterRoom   — has Flag.NonLand (NONLANDBIT); lit
 *   anotherLand — a second land room (for clause 3 tests); lit
 * The inflatedBoat is a vehicle with VTYPE=NONLANDBIT.
 */
function makeFixture() {
  const landRoom = new Room('LAND', 'Shore', {
    exits: [
      { dir: 'east', to: 'WATER' },
      { dir: 'north', to: 'LAND2' },
    ],
    ldesc: 'A sandy shore.',
  });
  landRoom.set(Flag.On);
  landRoom.set(Flag.Land);

  const land2Room = new Room('LAND2', 'Another shore', {
    exits: [{ dir: 'south', to: 'LAND' }],
    ldesc: 'Another shore.',
  });
  land2Room.set(Flag.On);
  land2Room.set(Flag.Land);

  const waterRoom = new Room('WATER', 'River', {
    exits: [
      { dir: 'west', to: 'LAND' },
      { dir: 'east', to: 'WATER2' },
    ],
    ldesc: 'Frigid water.',
  });
  waterRoom.set(Flag.On);
  waterRoom.set(Flag.NonLand);

  const water2Room = new Room('WATER2', 'More river', {
    exits: [{ dir: 'west', to: 'WATER' }],
    ldesc: 'Still water.',
  });
  water2Room.set(Flag.On);
  water2Room.set(Flag.NonLand);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(landRoom);

  const boat = new Thing('INFLATED-BOAT', 'magic boat');
  boat.set(Flag.Vehicle);
  boat.set(Flag.Open);
  boat.props.set('VTYPE', 'NONLANDBIT');
  // Boat starts in the land room (for some tests)
  boat.moveTo(landRoom);

  const world = World.fromObjects([landRoom, land2Room, waterRoom, water2Room, player, boat]);
  return { landRoom, land2Room, waterRoom, water2Room, player, boat, world };
}

function makeCtx(
  player: Actor,
  here: Room,
  world: World,
  dir: string,
): VerbContext {
  return { verb: 'walk', prep: dir, player, here, world };
}

// ---------------------------------------------------------------------------
// Baseline: normal land→land movement unaffected (no regression)
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — GOTO: land→land on foot (baseline, no regression)', () => {
  it('can walk from one land room to another land room', () => {
    const { landRoom, player, world } = makeFixture();
    const ctx = makeCtx(player, landRoom, world, 'north');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
    expect(player.parent?.id).toBe('LAND2');
  });
});

// ---------------------------------------------------------------------------
// Clause 1 (NM-E): on foot, destination is NonLand → no-vehicle message
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — GOTO clause 1: on foot into NonLand blocked', () => {
  it('blocks on-foot walk east into water: "without a vehicle"', () => {
    const { landRoom, player, world } = makeFixture();
    const ctx = makeCtx(player, landRoom, world, 'east');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(false);
    expect(result.output).toContain('without a vehicle');
  });

  it('does NOT block on-foot walk into a land room', () => {
    const { landRoom, player, world } = makeFixture();
    const ctx = makeCtx(player, landRoom, world, 'north');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clause 2 (NM-E): in vehicle, destination lacks NONLANDBIT → "in a <vehicle>"
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — GOTO clause 2: boat into non-water blocked', () => {
  it('boat in water, destination is a second water room → allowed', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    // Put player in the boat, boat in water
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'east');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
  });

  it('boat in water, destination is land → allowed (landing)', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'west');
    const result = executeVerb(ctx, 'V-WALK');
    // Landing on land is allowed — moves vehicle to land room
    expect(result.moved).toBe(true);
  });

  it('boat in water, no exit in that direction → normal no-exit message', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'north');
    const result = executeVerb(ctx, 'V-WALK');
    // No exit north — standard no-exit fatal
    expect(result.moved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Clause 3 (NM-E): water-vehicle on land, dest is land, dest lacks NONLANDBIT → blocked
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — GOTO clause 3: water-vehicle on land can\'t walk to another land room', () => {
  it('boat beached on land, walk to another land room → blocked ("in a <vehicle>")', () => {
    const { landRoom, player, boat, world } = makeFixture();
    // Boat is on the shore (land room); player in the boat
    boat.moveTo(landRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, landRoom, world, 'north');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(false);
    expect(result.output).toContain("in a");
  });

  it('boat beached on land, walk into water → allowed (launch direction)', () => {
    const { landRoom, player, boat, world } = makeFixture();
    boat.moveTo(landRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, landRoom, world, 'east');
    const result = executeVerb(ctx, 'V-WALK');
    // Water destination has NONLANDBIT = VTYPE, so it is allowed
    expect(result.moved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Landing message: boat moving from NonLand to Land emits "comes to a rest on the shore."
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — GOTO: landing message when boat reaches shore', () => {
  it('emits "comes to a rest on the shore." when boat lands from water', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'west');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
    expect(result.output).toContain('comes to a rest on the shore.');
  });

  it('no landing message for water→water boat movement', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'east');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
    expect(result.output).not.toContain('comes to a rest');
  });

  it('no landing message when on foot moving to land', () => {
    const { landRoom, player, world } = makeFixture();
    const ctx = makeCtx(player, landRoom, world, 'north');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
    expect(result.output).not.toContain('comes to a rest');
  });
});

// ---------------------------------------------------------------------------
// Vehicle movement: vehicle (not player) moves to destination
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — GOTO: vehicle-in-vehicle movement moves vehicle to dest', () => {
  it('boat (not player) is moved to the destination water room', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'east');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
    // Boat moved to WATER2; player stays in boat
    expect(boat.parent?.id).toBe('WATER2');
    expect(player.parent?.id).toBe('INFLATED-BOAT');
  });

  it('landing: boat is moved to land room, player stays in boat', () => {
    const { waterRoom, player, boat, world } = makeFixture();
    boat.moveTo(waterRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, waterRoom, world, 'west');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.moved).toBe(true);
    expect(boat.parent?.id).toBe('LAND');
    expect(player.parent?.id).toBe('INFLATED-BOAT');
  });
});

// ---------------------------------------------------------------------------
// NO-GO-TELL messages (ZIL gverbs.zil:2038–2043)
// ---------------------------------------------------------------------------

describe('CB-BOAT1 — NO-GO-TELL messages', () => {
  it('on foot into water: "You can\'t go there without a vehicle."', () => {
    const { landRoom, player, world } = makeFixture();
    const ctx = makeCtx(player, landRoom, world, 'east');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.output).toBe("You can't go there without a vehicle.");
  });

  it('in boat, dest lacks NONLANDBIT: "You can\'t go there in a magic boat."', () => {
    const { landRoom, player, boat, world } = makeFixture();
    // Boat on land, player in boat, destination is another land room (no NONLANDBIT)
    boat.moveTo(landRoom);
    player.moveTo(boat);
    const ctx = makeCtx(player, landRoom, world, 'north');
    const result = executeVerb(ctx, 'V-WALK');
    expect(result.output).toBe("You can't go there in a magic boat.");
  });
});
