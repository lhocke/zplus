/**
 * BD4 — V-PUT container checks (spec §7 BD4; DGC-5)
 *
 * ZIL V-PUT gverbs.zil:1085–1116 performs four guards before moving PRSO
 * into PRSI, in this order:
 *   1. not-open         → "The X isn't open."          (already tested in D3 A16)
 *   2. self-containment → "How can you do that?"
 *   3. already-in       → "The X is already in the Y."
 *   4. capacity         → "There's no room."
 * On success: MOVE + FSET TOUCHBIT + SCORE-OBJ + "Done."
 *
 * Tests here cover guards 2-4 and the success path TOUCHBIT/SCORE-OBJ.
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
// Fixture
// ---------------------------------------------------------------------------

interface Fix {
  world: World;
  room: Room;
  player: Actor;
  box: Container;      // open container with capacity=10
  coin: Thing;         // size=3 — fits in box
  boulder: Thing;      // size=99 — does not fit
  scoreLog: { obj: string }[];
}

function makeFixture(): Fix {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A bare room.' });
  room.set(Flag.On);

  const box = new Container('BOX', 'wooden box', { synonyms: ['box'] });
  box.set(Flag.Container);
  box.set(Flag.Open);
  box.props.set('CAPACITY', 10);
  box.props.set('SIZE', 5);
  box.moveTo(room);

  const coin = new Thing('COIN', 'gold coin', { synonyms: ['coin'] });
  coin.props.set('SIZE', 3);
  coin.moveTo(room);

  const boulder = new Thing('BOULDER', 'heavy boulder', { synonyms: ['boulder'] });
  boulder.props.set('SIZE', 99);
  boulder.moveTo(room);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, box, coin, boulder, player]);

  const scoreLog: { obj: string }[] = [];

  return { world, room, player, box, coin, boulder, scoreLog };
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
    scoreObj: (obj) => { fix.scoreLog.push({ obj: obj.id }); },
  };
}

// ---------------------------------------------------------------------------
// Guard 2 — self-containment
// ---------------------------------------------------------------------------

describe('BD4 — V-PUT self-containment', () => {
  it('returns "How can you do that?" when putting a container into itself', async () => {
    const fix = makeFixture();
    fix.box.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'BOX', 'BOX'), 'V-PUT');
    expect(result.output).toBe(vPut.how);
    expect(result.output).toBe('How can you do that?');
  });

  it('does not move the container', async () => {
    const fix = makeFixture();
    fix.box.moveTo(fix.player);
    await executeVerb(ctx(fix, 'BOX', 'BOX'), 'V-PUT');
    expect(fix.box.parent).toBe(fix.player);
  });
});

// ---------------------------------------------------------------------------
// Guard 3 — already in container
// ---------------------------------------------------------------------------

describe('BD4 — V-PUT already-in', () => {
  it('reports already-in message with correct names', async () => {
    const fix = makeFixture();
    // place coin inside box, player holds nothing relevant
    fix.coin.moveTo(fix.box);
    // player tries to put coin in box (coin is already in box — not held by player,
    // but we want to test guard 3 triggers before the not-held guard)
    // Guard order in ZIL: not-open → self → already-in → capacity → not-held → try-take
    const result = await executeVerb(ctx(fix, 'COIN', 'BOX'), 'V-PUT');
    expect(result.output).toBe(fmt(vPut.alreadyIn, 'gold coin', 'wooden box'));
    expect(result.output).toBe('The gold coin is already in the wooden box.');
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — capacity
// ---------------------------------------------------------------------------

describe('BD4 — V-PUT capacity check', () => {
  it('returns "There\'s no room." when item is too heavy for container', async () => {
    const fix = makeFixture();
    fix.boulder.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'BOULDER', 'BOX'), 'V-PUT');
    expect(result.output).toBe(vPut.noRoom);
    expect(result.output).toBe("There's no room.");
  });

  it('allows put when item fits exactly', async () => {
    const fix = makeFixture();
    // box capacity=10, box SIZE=5, box currently empty so content-weight=0
    // coin SIZE=3 → 0+3 <= 10 → fits
    fix.coin.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'COIN', 'BOX'), 'V-PUT');
    expect(result.output).toBe(vPut.done);
    expect(result.output).toBe('Done.');
  });

  it('rejects when contents plus new item exceed capacity', async () => {
    const fix = makeFixture();
    // fill box with a size-9 thing
    const stone = new Thing('STONE', 'stone', { synonyms: ['stone'] });
    stone.props.set('SIZE', 9);
    stone.moveTo(fix.box);
    fix.world.register(stone);
    // coin size=3; content weight already 9; 9+3 > 10 → no room
    fix.coin.moveTo(fix.player);
    const result = await executeVerb(ctx(fix, 'COIN', 'BOX'), 'V-PUT');
    expect(result.output).toBe(vPut.noRoom);
  });
});

// ---------------------------------------------------------------------------
// Success path — TOUCHBIT + SCORE-OBJ
// ---------------------------------------------------------------------------

describe('BD4 — V-PUT success sets TOUCHBIT and calls SCORE-OBJ', () => {
  it('sets Flag.Touched on the moved item', async () => {
    const fix = makeFixture();
    fix.coin.moveTo(fix.player);
    expect(fix.coin.has(Flag.Touched)).toBe(false);
    await executeVerb(ctx(fix, 'COIN', 'BOX'), 'V-PUT');
    expect(fix.coin.has(Flag.Touched)).toBe(true);
  });

  it('calls scoreObj with the moved item', async () => {
    const fix = makeFixture();
    fix.coin.moveTo(fix.player);
    await executeVerb(ctx(fix, 'COIN', 'BOX'), 'V-PUT');
    expect(fix.scoreLog).toHaveLength(1);
    expect(fix.scoreLog[0]!.obj).toBe('COIN');
  });

  it('moves item into container', async () => {
    const fix = makeFixture();
    fix.coin.moveTo(fix.player);
    await executeVerb(ctx(fix, 'COIN', 'BOX'), 'V-PUT');
    expect(fix.coin.parent).toBe(fix.box);
  });

  it('does not call scoreObj on a failed put', async () => {
    const fix = makeFixture();
    fix.boulder.moveTo(fix.player);
    await executeVerb(ctx(fix, 'BOULDER', 'BOX'), 'V-PUT');
    expect(fix.scoreLog).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ZIL default SIZE — objects with no explicit SIZE property
// ---------------------------------------------------------------------------
// ZIL declares <PROPDEF SIZE 5> (zork1.zil:24), so GETP P?SIZE returns 5
// for any object that lacks an explicit (SIZE ...) stanza. The capacity guard
// must use 5 as the absent-SIZE default, not 0.
//
// Real-game anchor: dfrotz R119 path
//   north / east / open window / west / open sack / take bottle /
//   put bottle in sack  →  "There's no room."
// Kitchen sack starts with garlic (SIZE 4) + lunch (no SIZE → 5).
// WEIGHT(sack) = SIZE(sack=9) + 4 + 5 = 18; WEIGHT(bottle) = 5 + 4 = 9.
// (18 + 9) - 9 = 18 > 9 (capacity) → no room.

describe('BD4 — capacity uses ZIL default SIZE=5 for items without explicit SIZE', () => {
  it('rejects put bottle in sack (dfrotz R119: "There\'s no room.")', async () => {
    const game = newGameAt('KITCHEN');
    await game.turn('open sack');
    await game.turn('take bottle');
    const result = await game.turn('put bottle in sack');
    expect(result.output).toBe("There's no room.");
  });

  it('weight() counts absent-SIZE items as 5 per ZIL PROPDEF', async () => {
    // Minimal fixture: a container with capacity 4, and two SIZE-less items.
    // With default-0: 0+0 <= 4 → fits. With default-5: 5+5=10 > 4 → no room.
    const room = new Room('R', 'Room', { ldesc: 'A room.' });
    room.set(Flag.On);
    const box = new Container('BOX2', 'box', { synonyms: ['box'] });
    box.set(Flag.Container);
    box.set(Flag.Open);
    box.props.set('CAPACITY', 4);
    box.props.set('SIZE', 5);
    box.moveTo(room);

    // filler — no explicit SIZE
    const apple = new Thing('APPLE', 'apple', { synonyms: ['apple'] });
    apple.set(Flag.Takeable);
    apple.moveTo(box);   // already inside, contributes to WEIGHT(box)

    const pear = new Thing('PEAR', 'pear', { synonyms: ['pear'] });
    pear.set(Flag.Takeable);

    const player = new Actor('PLAYER2', 'yourself');
    player.moveTo(room);
    pear.moveTo(player);

    const world = World.fromObjects([room, box, apple, pear, player]);
    const vctx: VerbContext = {
      verb: 'put', action: 'V-PUT',
      dobj: pear, iobj: box, prep: 'in',
      player, here: room, world,
    };
    // WEIGHT(box) = SIZE(box=5) + WEIGHT(apple=5) = 10
    // WEIGHT(pear) = 5
    // (10 + 5) - 5 = 10 > 4 → no room
    const result = await executeVerb(vctx, 'V-PUT');
    expect(result.output).toBe("There's no room.");
  });
});
