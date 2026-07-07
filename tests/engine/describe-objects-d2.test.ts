/**
 * D2 — DESCRIBE-ROOM / DESCRIBE-OBJECTS tests.
 *
 * Verifies that the authentic PRINT-CONT / DESCRIBE-OBJECT / FIRSTER model
 * replaces the non-authentic "You can see: X, Y." listing.
 *
 * Key oracle facts (from dfrotz R119):
 *   Turn [0] WEST-OF-HOUSE: "There is a small mailbox here."
 *   Turn [6] LIVING-ROOM:   sword fdesc + lantern fdesc, no trophy case/rug lines
 *   KITCHEN (after entering):
 *     "A bottle is sitting on the table." (BOTTLE fdesc via table recursion)
 *     "The glass bottle contains:\n  A quantity of water"
 *     "On the table is an elongated brown sack, smelling of hot peppers." (SANDWICH-BAG fdesc)
 */

import { describe, it, expect } from 'vitest';
import { Room } from '../../src/domain/room.js';
import { Container } from '../../src/domain/container.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { World } from '../../src/domain/world.js';
import { Flag } from '../../src/domain/flags.js';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { createGame } from '../../src/engine/bootstrap.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal VerbContext for the given room.
// ---------------------------------------------------------------------------

function makeCtx(
  room: Room,
  player: Actor,
  world: World,
  opts: Partial<VerbContext> = {},
): VerbContext {
  return {
    verb: 'look',
    player,
    here: room,
    world,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// 1. WEST-OF-HOUSE — mailbox with no fdesc shows "There is a small mailbox here."
// ---------------------------------------------------------------------------

describe('D2: WEST-OF-HOUSE object listing', () => {
  function makeWestOfHouse() {
    const room = new Room('WEST-OF-HOUSE', 'West of House', {
      ldesc: 'You are standing in an open field west of a white house, with a boarded front door.',
    });
    room.set(Flag.On);

    const mailbox = new Container('MAILBOX', 'small mailbox', {
      synonyms: ['mailbox', 'box'],
      adjectives: ['small'],
    });
    mailbox.set(Flag.Container);
    // No fdesc, no ldesc, no TOUCHBIT, no NDESCBIT
    mailbox.moveTo(room);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, mailbox, player]);
    return { room, mailbox, player, world };
  }

  it('shows "There is a small mailbox here." instead of "You can see: small mailbox."', async () => {
    const { room, player, world } = makeWestOfHouse();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('There is a small mailbox here.');
    expect(result.output).not.toContain('You can see:');
  });

  it('does not list the player actor in room contents', async () => {
    const { room, player, world } = makeWestOfHouse();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('yourself');
  });

  it('still shows the room name and ldesc', async () => {
    const { room, player, world } = makeWestOfHouse();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('West of House');
    expect(result.output).toContain('open field west of a white house');
  });
});

// ---------------------------------------------------------------------------
// 2. NDESCBIT objects are NOT listed (trophy case, rug)
// ---------------------------------------------------------------------------

describe('D2: NDESCBIT objects skipped', () => {
  function makeLivingRoom() {
    const room = new Room('LIVING-ROOM', 'Living Room', {
      ldesc: 'You are in the living room.',
    });
    room.set(Flag.On);

    // Trophy case — NonDescript (NDESCBIT), Transparent container
    const trophyCase = new Container('TROPHY-CASE', 'trophy case', {
      synonyms: ['case'],
      adjectives: ['trophy'],
    });
    trophyCase.set(Flag.Container);
    trophyCase.set(Flag.Transparent);
    trophyCase.set(Flag.NonDescript);
    trophyCase.moveTo(room);

    // Rug — NonDescript
    const rug = new Thing('RUG', 'carpet', {
      synonyms: ['rug', 'carpet'],
      adjectives: ['large', 'oriental'],
    });
    rug.set(Flag.NonDescript);
    rug.moveTo(room);

    // Sword — has fdesc, no NDESCBIT
    const sword = new Thing('SWORD', 'sword', {
      synonyms: ['sword'],
      adjectives: ['elvish'],
      fdesc: 'Above the trophy case hangs an elvish sword of great antiquity.',
    });
    sword.set(Flag.Takeable);
    sword.moveTo(room);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, trophyCase, rug, sword, player]);
    return { room, trophyCase, rug, sword, player, world };
  }

  it('lists the sword via its fdesc', async () => {
    const { room, player, world } = makeLivingRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('Above the trophy case hangs an elvish sword of great antiquity.');
  });

  it('does NOT list the trophy case (NDESCBIT)', async () => {
    const { room, player, world } = makeLivingRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toMatch(/trophy case[^.]*here/);
    expect(result.output).not.toContain('There is a trophy case here.');
  });

  it('does NOT list the rug (NDESCBIT)', async () => {
    const { room, player, world } = makeLivingRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('carpet here');
    expect(result.output).not.toContain('There is a carpet here.');
  });

  it('does not emit "You can see:" for any objects', async () => {
    const { room, player, world } = makeLivingRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('You can see:');
  });
});

// ---------------------------------------------------------------------------
// 3. FDESC (pass 1) vs fallback (pass 2) — touched vs untouched
// ---------------------------------------------------------------------------

describe('D2: fdesc pass 1 vs fallback pass 2', () => {
  function makeRoom() {
    const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A test room.' });
    room.set(Flag.On);

    // Item with fdesc and no TOUCHBIT → should show fdesc
    const lampWithFdesc = new Thing('LAMP', 'brass lantern', {
      fdesc: 'A battery-powered brass lantern is on the trophy case.',
      ldesc: 'There is a brass lantern (battery-powered) here.',
    });
    lampWithFdesc.set(Flag.Takeable);
    lampWithFdesc.set(Flag.Light);
    lampWithFdesc.moveTo(room);

    // Item with fdesc but TOUCHBIT set → should NOT use fdesc, falls to ldesc/fallback
    const touchedItem = new Thing('TOUCHED-ITEM', 'touched thing', {
      fdesc: 'This is the fdesc for the touched thing.',
      ldesc: 'There is a touched thing here.',
    });
    touchedItem.set(Flag.Takeable);
    touchedItem.set(Flag.Touched);
    touchedItem.moveTo(room);

    // Item with no fdesc and no ldesc → "There is a <desc> here."
    const plainItem = new Thing('PLAIN-ITEM', 'plain widget', {});
    plainItem.set(Flag.Takeable);
    plainItem.moveTo(room);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, lampWithFdesc, touchedItem, plainItem, player]);
    return { room, lampWithFdesc, touchedItem, plainItem, player, world };
  }

  it('untouched item with fdesc shows its fdesc (pass 1)', async () => {
    const { room, player, world } = makeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('A battery-powered brass lantern is on the trophy case.');
  });

  it('touched item with fdesc shows ldesc instead (pass 2)', async () => {
    const { room, player, world } = makeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('This is the fdesc for the touched thing.');
    expect(result.output).toContain('There is a touched thing here.');
  });

  it('item with no fdesc and no ldesc shows "There is a <desc> here."', async () => {
    const { room, player, world } = makeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('There is a plain widget here.');
  });
});

// ---------------------------------------------------------------------------
// 4. Open/transparent containers recursed into (SEE-INSIDE)
// ---------------------------------------------------------------------------

describe('D2: open/transparent container contents listed', () => {
  function makeRoomWithContainer() {
    const room = new Room('TEST-ROOM', 'Test Room', { ldesc: 'A room with containers.' });
    room.set(Flag.On);

    // Open container — shows FIRSTER header + contents
    const box = new Container('OPEN-BOX', 'wooden box', {
      synonyms: ['box'],
      adjectives: ['wooden'],
    });
    box.set(Flag.Container);
    box.set(Flag.Open);
    box.set(Flag.Touched); // touched → shows in pass 2, gets FIRSTER
    box.moveTo(room);

    // Item inside the open box
    const coin = new Thing('COIN', 'gold coin', {
      synonyms: ['coin'],
      adjectives: ['gold'],
      ldesc: 'A shiny gold coin.',
    });
    coin.set(Flag.Takeable);
    coin.set(Flag.Touched);
    coin.moveTo(box);

    // Closed (opaque) container — contents NOT shown
    const closedBox = new Container('CLOSED-BOX', 'iron safe', {
      synonyms: ['safe'],
      adjectives: ['iron'],
    });
    closedBox.set(Flag.Container);
    // Not Open, not Transparent
    closedBox.set(Flag.Touched);
    closedBox.moveTo(room);

    const secret = new Thing('SECRET', 'secret item', {});
    secret.set(Flag.Takeable);
    secret.moveTo(closedBox);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, box, coin, closedBox, secret, player]);
    return { room, box, coin, closedBox, secret, player, world };
  }

  it('shows FIRSTER header for open container with contents', async () => {
    const { room, player, world } = makeRoomWithContainer();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('The wooden box contains:');
  });

  it('shows contents of open container with indent', async () => {
    const { room, player, world } = makeRoomWithContainer();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    // At level 1: "  A gold coin" (INDENTS[1] = "  ", then "A " + desc)
    expect(result.output).toContain('A gold coin');
  });

  it('does NOT show contents of closed opaque container', async () => {
    const { room, player, world } = makeRoomWithContainer();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('secret item');
  });
});

// ---------------------------------------------------------------------------
// 5. NDESCBIT container with SEE-INSIDE — recurse into contents
// ---------------------------------------------------------------------------

describe('D2: NDESCBIT container with open/transparent contents recurse', () => {
  function makeKitchenLikeRoom() {
    const room = new Room('KITCHEN', 'Kitchen', { ldesc: 'You are in the kitchen.' });
    room.set(Flag.On);

    // KITCHEN-TABLE: NonDescript, Container, Open, Surface
    const table = new Container('KITCHEN-TABLE', 'kitchen table', {
      synonyms: ['table'],
      adjectives: ['kitchen'],
    });
    table.set(Flag.NonDescript);
    table.set(Flag.Container);
    table.set(Flag.Open);
    table.set(Flag.Surface);
    table.moveTo(room);

    // BOTTLE: Transparent container on table, has fdesc
    const bottle = new Container('BOTTLE', 'glass bottle', {
      synonyms: ['bottle'],
      adjectives: ['glass'],
      fdesc: 'A bottle is sitting on the table.',
    });
    bottle.set(Flag.Takeable);
    bottle.set(Flag.Container);
    bottle.set(Flag.Transparent);
    bottle.moveTo(table);

    // WATER: inside BOTTLE, no fdesc, has ldesc → appears as "A quantity of water"
    const water = new Thing('WATER', 'quantity of water', {
      synonyms: ['water'],
      ldesc: 'Some water.',
    });
    water.set(Flag.Drink);
    water.set(Flag.Takeable);
    water.set(Flag.Touched);
    water.moveTo(bottle);

    // SANDWICH-BAG: on table, has fdesc, closed/opaque (Burned flag but no Open/Transparent)
    const sack = new Container('SANDWICH-BAG', 'brown sack', {
      synonyms: ['sack', 'bag'],
      adjectives: ['brown', 'elongated'],
      fdesc: 'On the table is an elongated brown sack, smelling of hot peppers.',
    });
    sack.set(Flag.Takeable);
    sack.set(Flag.Container);
    // No Open, no Transparent — SEE-INSIDE? = false
    sack.moveTo(table);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, table, bottle, water, sack, player]);
    return { room, table, bottle, water, sack, player, world };
  }

  it('shows bottle fdesc (recursed into from NDESCBIT table)', async () => {
    const { room, player, world } = makeKitchenLikeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('A bottle is sitting on the table.');
  });

  it('shows bottle contents with FIRSTER header', async () => {
    const { room, player, world } = makeKitchenLikeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('The glass bottle contains:');
  });

  it('shows water inside bottle with indent', async () => {
    const { room, player, world } = makeKitchenLikeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('A quantity of water');
  });

  it('shows sack fdesc (recursed into from NDESCBIT table)', async () => {
    const { room, player, world } = makeKitchenLikeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('On the table is an elongated brown sack, smelling of hot peppers.');
  });

  it('does NOT show "You can see:" anywhere', async () => {
    const { room, player, world } = makeKitchenLikeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('You can see:');
  });

  it('does NOT list the table itself (NDESCBIT)', async () => {
    const { room, player, world } = makeKitchenLikeRoom();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).not.toContain('There is a kitchen table here.');
  });
});

// ---------------------------------------------------------------------------
// 6. Empty room — no extra output
// ---------------------------------------------------------------------------

describe('D2: empty room produces no object listing', () => {
  it('shows only room name and ldesc with no object lines', async () => {
    const room = new Room('EMPTY', 'Empty Room', { ldesc: 'Nothing here.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);

    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toBe('Empty Room\nNothing here.');
    expect(result.output).not.toContain('You can see:');
    expect(result.output).not.toContain('There is');
  });
});

// ---------------------------------------------------------------------------
// 7. describeCurrentRoom in game.ts (integration via game.start())
// ---------------------------------------------------------------------------

describe('D2: game.start() uses authentic object listing', () => {
  it('west-of-house start does not say "You can see:"', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    const output = game.start();
    expect(output).not.toContain('You can see:');
  });

  it('west-of-house start shows mailbox as "There is a small mailbox here."', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    const output = game.start();
    expect(output).toContain('There is a small mailbox here.');
  });
});

// ---------------------------------------------------------------------------
// 8. LIVING-ROOM integration — sword fdesc + lantern fdesc
// ---------------------------------------------------------------------------

describe('D2: living-room shows fdesc objects', () => {
  it('entering living room shows sword fdesc', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const output = game.start();
    expect(output).toContain('Above the trophy case hangs an elvish sword of great antiquity.');
  });

  it('entering living room shows lantern fdesc', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const output = game.start();
    expect(output).toContain('A battery-powered brass lantern is on the trophy case.');
  });

  it('entering living room does NOT show trophy case as room item', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const output = game.start();
    expect(output).not.toContain('There is a trophy case here.');
  });

  it('entering living room does NOT show rug as room item', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    const output = game.start();
    expect(output).not.toContain('There is a carpet here.');
    expect(output).not.toContain('There is a rug here.');
  });
});

// ---------------------------------------------------------------------------
// 9. TROPHY-CASE "consists of:" header — regression for printCont ndescContainer
//    over-broad guard (bug: NonDescript on the CONTAINER fired for trophy case too,
//    suppressing the firster header).
//
//    ZIL reference: gverbs.zil:1802 keys NDESCBIT on the CHILD, not the container.
//    The trophy case is NonDescript+Transparent (not a Surface), so its contents
//    must show the "Your collection of treasures consists of:" FIRSTER header.
// ---------------------------------------------------------------------------

describe('D2: trophy-case "consists of" header with filled case', () => {
  function makeLivingRoomWithTreasure() {
    const room = new Room('LIVING-ROOM', 'Living Room', {
      ldesc: 'You are in the living room.',
    });
    room.set(Flag.On);

    // Trophy case: NonDescript + Transparent + Container (matches real game flags).
    // NOT a Surface — this is the key distinction from kitchen-table etc.
    const trophyCase = new Container('TROPHY-CASE', 'trophy case', {
      synonyms: ['case'],
      adjectives: ['trophy'],
    });
    trophyCase.set(Flag.Container);
    trophyCase.set(Flag.Transparent);
    trophyCase.set(Flag.NonDescript);
    trophyCase.set(Flag.TryTake);
    trophyCase.set(Flag.Searchable);
    trophyCase.moveTo(room);

    // A treasure inside the trophy case, already touched so it shows in pass 2.
    const egg = new Thing('EGG', 'jewel-encrusted egg', {
      synonyms: ['egg'],
      adjectives: ['jewel-encrusted', 'jeweled'],
      ldesc: 'The egg is covered in jewels.',
    });
    egg.set(Flag.Takeable);
    egg.set(Flag.Touched);
    egg.moveTo(trophyCase);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, trophyCase, egg, player]);
    return { room, trophyCase, egg, player, world };
  }

  it('LOOK in living room with filled trophy case shows "consists of" header', async () => {
    const { room, player, world } = makeLivingRoomWithTreasure();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('Your collection of treasures consists of:');
  });

  it('LOOK in living room with filled trophy case lists the treasure (ldesc) under the header', async () => {
    // At room-look depth (level 0), describeObject uses ldesc rather than "A <desc>".
    // ZIL: the treasury contents are printed at room depth via printCont(TROPHY-CASE, -1).
    const { room, player, world } = makeLivingRoomWithTreasure();
    const result = await executeVerb(makeCtx(room, player, world), 'V-LOOK');
    expect(result.output).toContain('The egg is covered in jewels.');
  });

  it('EXAMINE trophy-case with treasure shows "consists of" header', async () => {
    const { room, trophyCase, player, world } = makeLivingRoomWithTreasure();
    const result = await executeVerb(
      { ...makeCtx(room, player, world), dobj: trophyCase },
      'V-EXAMINE',
    );
    expect(result.output).toContain('Your collection of treasures consists of:');
  });

  it('EXAMINE trophy-case with treasure lists the treasure under the header', async () => {
    const { room, trophyCase, player, world } = makeLivingRoomWithTreasure();
    const result = await executeVerb(
      { ...makeCtx(room, player, world), dobj: trophyCase },
      'V-EXAMINE',
    );
    expect(result.output).toContain('A jewel-encrusted egg');
  });
});
