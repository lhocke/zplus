/**
 * BD-B — V-PUT closed-openable destination → "The X isn't open."
 *
 * ZIL gverbs.zil:1085–1094 COND order:
 *   1. Gate: NOT (OPENBIT set OR OPENABLE? OR VEHBIT) → "You can't do that."
 *      OPENABLE? = has CONTBIT or DOORBIT.
 *   2. Openable/vehicle but NOT open → "The <dest> isn't open."
 *
 * dfrotz R119: open mailbox / take leaflet / put leaflet in door
 *              → "The door isn't open."
 *
 * Prior to this fix, objects with Flag.Door (but not Flag.Container) hit the
 * gate and returned "You can't do that." instead.
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Container } from '../../src/domain/container.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { vPut, fmt } from '../../src/engine/game-messages.js';
import { newGameAt } from '../helpers/new-game.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, desc: string): Thing {
  const t = new Thing(id, desc, { synonyms: [id.toLowerCase()] });
  t.set(Flag.Takeable);
  return t;
}

function makeDoor(id: string, desc: string): Thing {
  const d = new Thing(id, desc, { synonyms: [id.toLowerCase()] });
  d.set(Flag.Door);
  // Door starts closed (no Flag.Open)
  return d;
}


interface Fix {
  world: World;
  room: Room;
  player: Actor;
  leaflet: Thing;
  door: Thing;
  closedBox: Container;
}

function makeFixture(): Fix {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A bare room.' });
  room.set(Flag.On);

  const leaflet = makeItem('LEAFLET', 'leaflet');
  leaflet.moveTo(room);

  const door = makeDoor('DOOR', 'door');
  door.moveTo(room);

  const closedBox = new Container('BOX', 'wooden box', { synonyms: ['box'] });
  closedBox.set(Flag.Container);
  closedBox.props.set('CAPACITY', 10);
  closedBox.props.set('SIZE', 5);
  // starts closed (no Flag.Open)
  closedBox.moveTo(room);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, leaflet, door, closedBox, player]);
  return { world, room, player, leaflet, door, closedBox };
}

function ctx(fix: Fix, dobjId: string, iobjId: string): VerbContext {
  return {
    verb: 'put',
    action: 'V-PUT',
    dobj: fix.world.get(dobjId),
    iobj: fix.world.get(iobjId),
    prep: 'in',
    player: fix.player,
    here: fix.room,
    world: fix.world,
  };
}

// ---------------------------------------------------------------------------
// Guard: closed Door → "The X isn't open."
// ---------------------------------------------------------------------------

describe('BD-B — V-PUT door (closed, Flag.Door only) → "isn\'t open"', () => {
  it('returns "The door isn\'t open." — not "You can\'t do that."', async () => {
    const fix = makeFixture();
    fix.leaflet.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'LEAFLET', 'DOOR'), 'V-PUT');
    expect(result.output).toBe(fmt(vPut.notOpen, 'door'));
    expect(result.output).toBe("The door isn't open.");
  });

  it('does NOT return "You can\'t do that." for a closed door', async () => {
    const fix = makeFixture();
    fix.leaflet.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'LEAFLET', 'DOOR'), 'V-PUT');
    expect(result.output).not.toBe(vPut.cantDoThat);
    expect(result.output).not.toBe('You can\'t do that.');
  });

  it('does not set TOUCHBIT on item when door is closed', async () => {
    const fix = makeFixture();
    fix.leaflet.moveTo(fix.player);
    expect(fix.leaflet.has(Flag.Touched)).toBe(false);
    await executeVerb(ctx(fix, 'LEAFLET', 'DOOR'), 'V-PUT');
    expect(fix.leaflet.has(Flag.Touched)).toBe(false);
  });

  it('does not move item when door is closed', async () => {
    const fix = makeFixture();
    fix.leaflet.moveTo(fix.player);
    await executeVerb(ctx(fix, 'LEAFLET', 'DOOR'), 'V-PUT');
    expect(fix.leaflet.parent).toBe(fix.player);
  });
});

// ---------------------------------------------------------------------------
// Guard: closed Container → "The X isn't open." (regression guard)
// ---------------------------------------------------------------------------

describe('BD-B — V-PUT closed Container still → "isn\'t open"', () => {
  it('returns "The wooden box isn\'t open." for closed container', async () => {
    const fix = makeFixture();
    fix.leaflet.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'LEAFLET', 'BOX'), 'V-PUT');
    expect(result.output).toBe(fmt(vPut.notOpen, 'wooden box'));
    expect(result.output).toBe("The wooden box isn't open.");
  });
});

// ---------------------------------------------------------------------------
// Integration: dfrotz R119 anchor — "put leaflet in door" at West of House
// ---------------------------------------------------------------------------

describe('BD-B — integration: put leaflet in door (West of House)', () => {
  it('dfrotz R119: put leaflet in door → "The door isn\'t open."', async () => {
    const game = newGameAt('WEST-OF-HOUSE');
    await game.turn('open mailbox');
    await game.turn('take leaflet');
    const result = await game.turn('put leaflet in door');
    expect(result.output).toBe("The door isn't open.");
  });
});

// ---------------------------------------------------------------------------
// Integration: closed-trap-door at Living Room
// ---------------------------------------------------------------------------

describe('BD-B — integration: put leaflet in trap door (Living Room)', () => {
  it('trap door closed → "The trap door isn\'t open."', async () => {
    // Navigate: West of House → mailbox → Living Room → trap door
    // The trap door starts invisible/closed; the rug must be moved to reveal it,
    // then we attempt to put leaflet in it while it's still closed.
    const game = newGameAt('WEST-OF-HOUSE');
    await game.turn('open mailbox');
    await game.turn('take leaflet');
    // Enter the house: north → east → open window → west → west puts us in Living Room
    await game.turn('north');
    await game.turn('east');
    await game.turn('open window');
    await game.turn('west');
    await game.turn('west');
    // Living Room: move rug to reveal trap door (it starts invisible)
    await game.turn('move rug');
    // Trap door is now visible but still closed
    const result = await game.turn('put leaflet in trap door');
    expect(result.output).toBe("The trap door isn't open.");
  });
});

// ---------------------------------------------------------------------------
// Regression: capacity SIZE-default guard still works (BD4 repair must not regress)
// ---------------------------------------------------------------------------

describe('BD-B — regression: capacity check with SIZE default=5 still works', () => {
  it('dfrotz R119: put bottle in sack (kitchen) → "There\'s no room."', async () => {
    const game = newGameAt('KITCHEN');
    await game.turn('open sack');
    await game.turn('take bottle');
    const result = await game.turn('put bottle in sack');
    expect(result.output).toBe("There's no room.");
  });
});
