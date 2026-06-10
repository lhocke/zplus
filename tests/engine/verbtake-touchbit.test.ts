/**
 * verbTake TOUCHBIT / NDESCBIT regression (gverbs.zil:1948–1950).
 *
 * ZIL ITAKE on successful take:
 *   <MOVE ,PRSO ,WINNER>         — move item to player
 *   <FCLEAR ,PRSO ,NDESCBIT>     — retire the FDESC
 *   <FSET ,PRSO ,TOUCHBIT>       — mark as touched
 *
 * The engine was missing the FCLEAR/FSET pair, so randomizeObjects() could
 * return a touched lamp to LIVING-ROOM and the room would still render
 * the FDESC instead of the LDESC.
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, describeRoomObjects, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Minimal fixture: a lit room, a player, and a takeable item with fdesc+ldesc.
// ---------------------------------------------------------------------------

interface Fix {
  world: World;
  room: Room;
  player: Actor;
  lamp: Thing;
}

function makeFixture(): Fix {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A bare test room.' });
  room.set(Flag.On);

  const lamp = new Thing('LAMP', 'brass lantern', {
    ldesc: 'There is a brass lantern (battery-powered) here.',
    fdesc: 'A battery-powered brass lantern is on the trophy case.',
  });
  lamp.set(Flag.Takeable);
  lamp.moveTo(room);

  const player = new Actor('PLAYER', 'adventurer', {});

  const world = World.fromObjects([room, player, lamp]);

  return { world, room, player, lamp };
}

function ctx(fix: Fix): VerbContext {
  return {
    verb:   'take',
    dobj:   fix.lamp,
    player: fix.player,
    here:   fix.room,
    world:  fix.world,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verbTake sets Flag.Touched (gverbs.zil:1950)', () => {
  it('Flag.Touched is false before take', () => {
    const fix = makeFixture();
    expect(fix.lamp.has(Flag.Touched)).toBe(false);
  });

  it('Flag.Touched is true after a successful take', () => {
    const fix = makeFixture();
    executeVerb(ctx(fix));
    expect(fix.lamp.has(Flag.Touched)).toBe(true);
  });
});

describe('verbTake clears Flag.NonDescript (gverbs.zil:1949)', () => {
  it('Flag.NonDescript is cleared after a successful take', () => {
    const fix = makeFixture();
    // Pre-set NonDescript to confirm it gets cleared.
    fix.lamp.set(Flag.NonDescript);
    executeVerb(ctx(fix));
    expect(fix.lamp.has(Flag.NonDescript)).toBe(false);
  });

  it('Flag.NonDescript stays false if it was already false', () => {
    const fix = makeFixture();
    executeVerb(ctx(fix));
    expect(fix.lamp.has(Flag.NonDescript)).toBe(false);
  });
});

describe('post-take room render uses ldesc not fdesc (FDESC retirement)', () => {
  it('after taking then returning the lamp, room renders ldesc', () => {
    const fix = makeFixture();

    // Take the lamp — sets Touched, clears NonDescript.
    executeVerb(ctx(fix));
    expect(fix.player.children.has(fix.lamp)).toBe(true);

    // Return it to the room (simulates randomizeObjects scatter).
    fix.lamp.moveTo(fix.room);

    // Room description should now show ldesc, not fdesc.
    const lines: string[] = [];
    const tell = (s: string) => lines.push(s);
    describeRoomObjects(fix.room, fix.player, tell);

    const text = lines.join('\n');
    expect(text).toContain('There is a brass lantern (battery-powered) here.');
    expect(text).not.toContain('A battery-powered brass lantern is on the trophy case.');
  });
});
