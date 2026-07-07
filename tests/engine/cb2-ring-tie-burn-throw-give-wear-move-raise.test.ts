/**
 * CB2 — V-RING, V-TIE, V-UNTIE, V-TIE-UP (verify-only), V-BURN+PRE-BURN,
 *        V-THROW, V-GIVE, V-WEAR, V-MOVE, V-RAISE, V-LOWER.
 *
 * ZIL refs:
 *   gverbs.zil:1162       V-RING   — "How, exactly, can you ring that?"
 *   gverbs.zil:1465–1469  V-TIE    — PRSI=WINNER → "to yourself" / else "to that"
 *   gverbs.zil:1511–1512  V-UNTIE  — "This cannot be tied, so it cannot be untied!"
 *   gverbs.zil:1471–1472  V-TIE-UP — verify-only: "You could certainly never tie it with that!"
 *   gverbs.zil:243–274    PRE-BURN + V-BURN — flame check + BURNBIT death/consume/refuse
 *   gverbs.zil:1445–1460  V-THROW  — IDROP then self/actor/else
 *   gverbs.zil:708–717    PRE-GIVE + V-GIVE — held check + actor/else
 *   gverbs.zil:1597–1602  V-WEAR   — WEARBIT check + PERFORM V-TAKE
 *   gverbs.zil:910–918    PRE-MOVE + V-MOVE — held guard + TAKEBIT reveal/refuse
 *   gverbs.zil:902        V-LOWER  — HACK-HACK "Playing in this way with the "
 *   gverbs.zil:1131–1132  V-RAISE  — V-LOWER (same HACK-HACK route)
 *
 * Done-criteria (spec §4.3–§4.5 + A.1):
 *   - V-RING:  "How, exactly, can you ring that?"
 *   - V-TIE (PRSI=player): "You can't tie anything to yourself."
 *   - V-TIE (PRSI=other):  "You can't tie the rope to that."
 *   - V-UNTIE: "This cannot be tied, so it cannot be untied!"
 *   - V-TIE-UP (verify-only): "You could certainly never tie it with that!" — unchanged
 *   - PRE-BURN (no PRSI):        "You didn't say with what!"
 *   - PRE-BURN (PRSI not flame): "With a <obj>??!?"
 *   - V-BURN (BURNBIT, held):    fire + JIGS-UP ("holding it at the time")
 *   - V-BURN (BURNBIT, not held):fire + "catches fire and is consumed."
 *   - V-BURN (no BURNBIT):       "You can't burn a <obj>."
 *   - PRE-GIVE (not held):       "That's easy for you to say since you don't even have the <obj>."
 *   - V-GIVE (PRSI not actor):   "You can't give a <obj> to a <prsi>!"
 *   - V-GIVE (PRSI actor):       "The <prsi> refuses it politely."
 *   - V-WEAR (no WEARBIT):       "You can't wear the <obj>."
 *   - V-WEAR (WEARBIT):          moves item to player inventory
 *   - PRE-MOVE (held):           "You aren't an accomplished enough juggler."
 *   - V-MOVE (TAKEBIT):          "Moving the <obj> reveals nothing."
 *   - V-MOVE (no TAKEBIT):       "You can't move the <obj>."
 *   - V-LOWER / V-RAISE (normal): "Playing in this way with the <obj>" + HO-HUM suffix
 *   - V-LOWER / V-RAISE (global): "The <obj> isn't here!"
 *   - "You can't raise that." is GONE from the implementation
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Container } from '../../src/domain/container.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

interface Fix {
  world: World;
  room: Room;
  player: Actor;
  bell: Thing;         // no special flags — RING target
  rope: Thing;         // Takeable — TIE target
  book: Thing;         // Flammable — BURN target (not held)
  torch: Thing;        // OnFire + Light — flame source for PRE-BURN
  heldBook: Thing;     // Flammable + held — BURN death target
  sword: Thing;        // Takeable, in player inv — THROW target
  npc: Actor;          // Actor flag — GIVE target
  bucket: Thing;       // no ACTORBIT — V-GIVE non-actor iobj
  cloak: Thing;        // Wearable — V-WEAR target
  stone: Thing;        // no Wearable — V-WEAR refuse
  rug: Thing;          // Takeable, in room — V-MOVE reveal
  statue: Thing;       // no Takeable — V-MOVE refuse
  wall: Thing;         // parentless (GLOBAL-OBJECTS) — HACK-HACK notHere branch
}

function makeFixture(): Fix {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A plain room.', exits: [] });
  room.set(Flag.On);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const bell = new Thing('BELL', 'small bell', { synonyms: ['bell'], adjectives: ['small'], ldesc: 'A small bell.' });
  bell.moveTo(room);

  const rope = new Thing('ROPE', 'rope', { synonyms: ['rope'], adjectives: [], ldesc: 'A coil of rope.' });
  rope.set(Flag.Takeable);
  rope.moveTo(player);  // held

  const book = new Thing('BOOK', 'black book', { synonyms: ['book'], adjectives: ['black'], ldesc: 'A black book.' });
  book.set(Flag.Flammable);
  book.moveTo(room);  // not held

  const torch = new Thing('TORCH', 'torch', { synonyms: ['torch'], adjectives: [], ldesc: 'A torch.' });
  torch.set(Flag.OnFire);
  torch.set(Flag.Light);
  torch.moveTo(player);

  const heldBook = new Thing('HELD-BOOK', 'held book', { synonyms: ['book'], adjectives: ['held'], ldesc: 'A held book.' });
  heldBook.set(Flag.Flammable);
  heldBook.moveTo(player);  // held — BURN with player holding it

  const sword = new Thing('SWORD', 'sword', { synonyms: ['sword'], adjectives: [], ldesc: 'A sword.' });
  sword.set(Flag.Takeable);
  sword.moveTo(player);

  const npc = new Actor('NPC', 'troll', { synonyms: ['troll'], adjectives: [] });
  npc.set(Flag.Actor);
  npc.moveTo(room);

  const bucket = new Thing('BUCKET', 'bucket', { synonyms: ['bucket'], adjectives: [], ldesc: 'A bucket.' });
  bucket.moveTo(room);

  const cloak = new Thing('CLOAK', 'cloak', { synonyms: ['cloak'], adjectives: [], ldesc: 'A cloak.' });
  cloak.set(Flag.Wearable);
  cloak.set(Flag.Takeable);
  cloak.moveTo(room);

  const stone = new Thing('STONE', 'stone', { synonyms: ['stone'], adjectives: [], ldesc: 'A stone.' });
  stone.moveTo(room);

  const rug = new Thing('RUG', 'rug', { synonyms: ['rug'], adjectives: [], ldesc: 'A rug.' });
  rug.set(Flag.Takeable);
  rug.moveTo(room);

  const statue = new Thing('STATUE', 'statue', { synonyms: ['statue'], adjectives: [], ldesc: 'A heavy statue.' });
  statue.moveTo(room);

  // Parentless object → GLOBAL-OBJECTS member (accessible globally, "not here")
  const wall = new Thing('WALL', 'surrounding wall', { synonyms: ['wall'], adjectives: ['surrounding'], ldesc: 'Solid walls.' });
  // Do NOT moveTo anything — parent stays null → isGlobalObject check fires.

  const world = World.fromObjects([room, player, bell, rope, book, torch, heldBook, sword, npc, bucket, cloak, stone, rug, statue, wall]);
  return { world, room, player, bell, rope, book, torch, heldBook, sword, npc, bucket, cloak, stone, rug, statue, wall };
}

function ctx(fix: Fix, overrides: Partial<VerbContext> & { verb: string }): VerbContext {
  return {
    player: fix.player,
    here:   fix.room,
    world:  fix.world,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// V-RING — gverbs.zil:1162
// ---------------------------------------------------------------------------

describe('V-RING', () => {
  it('returns "How, exactly, can you ring that?" — gverbs.zil:1163', async () => {
    const fix = makeFixture();
    const r = await executeVerb(ctx(fix, { verb: 'ring', action: 'V-RING', dobj: fix.bell }), 'V-RING');
    expect(r.output).toBe('How, exactly, can you ring that?');
  });
});

// ---------------------------------------------------------------------------
// V-TIE — gverbs.zil:1465–1469
// ---------------------------------------------------------------------------

describe('V-TIE', () => {
  it('PRSI=player → "You can\'t tie anything to yourself."', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'tie', action: 'V-TIE', dobj: fix.rope, iobj: fix.player }),
      'V-TIE',
    );
    expect(r.output).toBe("You can't tie anything to yourself.");
  });

  it('PRSI=other → "You can\'t tie the rope to that."', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'tie', action: 'V-TIE', dobj: fix.rope, iobj: fix.bell }),
      'V-TIE',
    );
    expect(r.output).toBe("You can't tie the rope to that.");
  });
});

// ---------------------------------------------------------------------------
// V-UNTIE — gverbs.zil:1511–1512
// ---------------------------------------------------------------------------

describe('V-UNTIE', () => {
  it('returns "This cannot be tied, so it cannot be untied!" — gverbs.zil:1512', async () => {
    const fix = makeFixture();
    const r = await executeVerb(ctx(fix, { verb: 'untie', action: 'V-UNTIE', dobj: fix.rope }), 'V-UNTIE');
    expect(r.output).toBe('This cannot be tied, so it cannot be untied!');
  });
});

// ---------------------------------------------------------------------------
// V-TIE-UP — verify-only (gverbs.zil:1471–1472, A.1: already byte-faithful)
// ---------------------------------------------------------------------------

describe('V-TIE-UP (verify-only)', () => {
  it('still returns "You could certainly never tie it with that!" — gverbs.zil:1472', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'tie', action: 'V-TIE-UP', dobj: fix.rope, iobj: fix.stone }),
      'V-TIE-UP',
    );
    expect(r.output).toBe('You could certainly never tie it with that!');
  });
});

// ---------------------------------------------------------------------------
// PRE-BURN — gverbs.zil:243–249
// ---------------------------------------------------------------------------

describe('PRE-BURN', () => {
  it('no PRSI → "You didn\'t say with what!" (TELL-NO-PRSI)', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'burn', action: 'PRE-BURN', dobj: fix.book }),
      'PRE-BURN',
    );
    expect(r.output).toBe("You didn't say with what!");
  });

  it('PRSI not FLAMING → "With a <obj>??!?" — gverbs.zil:249', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'burn', action: 'PRE-BURN', dobj: fix.book, iobj: fix.stone }),
      'PRE-BURN',
    );
    expect(r.output).toBe('With a stone??!?');
  });

  it('PRSI FLAMING → passes (empty output, no block)', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'burn', action: 'PRE-BURN', dobj: fix.book, iobj: fix.torch }),
      'PRE-BURN',
    );
    // PRE-BURN returns empty string when FLAMING — allows V-BURN to proceed.
    expect(r.output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// V-BURN — gverbs.zil:251–274
// ---------------------------------------------------------------------------

describe('V-BURN', () => {
  it('no BURNBIT → "You can\'t burn a <obj>." — gverbs.zil:274', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'burn', action: 'V-BURN', dobj: fix.stone, iobj: fix.torch }),
      'V-BURN',
    );
    expect(r.output).toBe("You can't burn a stone.");
  });

  it('BURNBIT not held → "catches fire and is consumed." — gverbs.zil:271–272', async () => {
    const fix = makeFixture();
    // book is in room, not held
    expect(fix.book.parent).toBe(fix.room);
    const r = await executeVerb(
      ctx(fix, { verb: 'burn', action: 'V-BURN', dobj: fix.book, iobj: fix.torch }),
      'V-BURN',
    );
    expect(r.output).toContain('catches fire and is consumed.');
    expect(r.output).toContain('black book');
    // Object removed from world
    expect(fix.book.parent).toBeNull();
  });

  it('BURNBIT held → jigsUp called with "holding it at the time" — gverbs.zil:265–268', async () => {
    const fix = makeFixture();
    // heldBook is in player's inventory
    expect(fix.heldBook.parent).toBe(fix.player);
    let deathMsg = '';
    const r = await executeVerb(
      ctx(fix, {
        verb: 'burn',
        action: 'V-BURN',
        dobj: fix.heldBook,
        iobj: fix.torch,
        jigsUp: (msg: string) => { deathMsg = msg; },
      }),
      'V-BURN',
    );
    // jigsUp carries the full death description; verb output may be empty (like grue)
    expect(deathMsg).toContain('catches fire');
    expect(deathMsg).toContain('holding it at the time');
    expect(r.fatal).toBe(true);
    // Object removed from world
    expect(fix.heldBook.parent).toBeNull();
  });

  it('BURNBIT, player inside (container case) → "in it at the time" — gverbs.zil:265–267', async () => {
    // Build a burnbit container with player inside
    const room = new Room('R2', 'Room 2', { ldesc: 'A room.', exits: [] });
    room.set(Flag.On);
    const container = new Container('BOX', 'box', { synonyms: ['box'], adjectives: [], ldesc: 'A box.' });
    container.set(Flag.Flammable);
    container.set(Flag.Open);
    container.moveTo(room);
    const player = new Actor('P2', 'yourself');
    player.moveTo(container);  // player inside the container
    const flame = new Thing('TORCH2', 'torch', { synonyms: ['torch'], adjectives: [], ldesc: 'torch' });
    flame.set(Flag.OnFire);
    flame.set(Flag.Light);
    flame.moveTo(player);
    const world = World.fromObjects([room, container, player, flame]);
    let death = '';
    const r = await executeVerb({
      verb: 'burn', action: 'V-BURN',
      dobj: container, iobj: flame,
      player, here: room, world,
      jigsUp: (m: string) => { death = m; },
    }, 'V-BURN');
    expect(death).toContain('in it at the time');
    expect(r.fatal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V-THROW — gverbs.zil:1445–1460
// ---------------------------------------------------------------------------

describe('V-THROW', () => {
  it('IDROP fails (not carried) → "Huh?" — gverbs.zil:1460', async () => {
    const fix = makeFixture();
    // bell is in room, not held — IDROP fails
    const r = await executeVerb(
      ctx(fix, { verb: 'throw', action: 'V-THROW', dobj: fix.bell }),
      'V-THROW',
    );
    expect(r.output).toBe('Huh?');
  });

  it('IDROP succeeds, PRSI=player → jigsUp called with death msg — gverbs.zil:1447–1454', async () => {
    const fix = makeFixture();
    // sword is held; throw at self (iobj = player = ME)
    let deathMsg = '';
    const r = await executeVerb(
      ctx(fix, {
        verb: 'throw',
        action: 'V-THROW',
        dobj: fix.sword,
        iobj: fix.player,
        jigsUp: (msg: string) => { deathMsg = msg; },
      }),
      'V-THROW',
    );
    // jigsUp carries the full death message; "A terrific throw!" prefix + death suffix
    expect(deathMsg).toContain('A terrific throw!');
    expect(deathMsg).toContain('sword');
    expect(deathMsg).toContain('break your neck');
    expect(r.fatal).toBe(true);
  });

  it('IDROP succeeds, PRSI=actor → "<actor> ducks..." — gverbs.zil:1455–1458', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, {
        verb: 'throw',
        action: 'V-THROW',
        dobj: fix.sword,
        iobj: fix.npc,
      }),
      'V-THROW',
    );
    expect(r.output).toContain('ducks');
    expect(r.output).toContain('sword');
    expect(r.output).toContain('troll');
    // Sword dropped to room
    expect(fix.sword.parent).toBe(fix.room);
  });

  it('IDROP succeeds, PRSI none/non-actor → "Thrown." — gverbs.zil:1459', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'throw', action: 'V-THROW', dobj: fix.sword }),
      'V-THROW',
    );
    expect(r.output).toBe('Thrown.');
    expect(fix.sword.parent).toBe(fix.room);
  });
});

// ---------------------------------------------------------------------------
// PRE-GIVE — gverbs.zil:708–711
// ---------------------------------------------------------------------------

describe('PRE-GIVE', () => {
  it('not holding PRSO → "That\'s easy for you to say..." — gverbs.zil:710–711', async () => {
    const fix = makeFixture();
    // bell is in room, not in player inventory
    const r = await executeVerb(
      ctx(fix, { verb: 'give', action: 'PRE-GIVE', dobj: fix.bell, iobj: fix.npc }),
      'PRE-GIVE',
    );
    expect(r.output).toContain("That's easy for you to say");
    expect(r.output).toContain('small bell');
  });

  it('holding PRSO → empty (passes, no block)', async () => {
    const fix = makeFixture();
    // sword is in player
    const r = await executeVerb(
      ctx(fix, { verb: 'give', action: 'PRE-GIVE', dobj: fix.sword, iobj: fix.npc }),
      'PRE-GIVE',
    );
    expect(r.output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// V-GIVE — gverbs.zil:713–717
// ---------------------------------------------------------------------------

describe('V-GIVE', () => {
  it('PRSI not ACTORBIT → "You can\'t give a <obj> to a <prsi>!" — gverbs.zil:715', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'give', action: 'V-GIVE', dobj: fix.sword, iobj: fix.bucket }),
      'V-GIVE',
    );
    expect(r.output).toBe("You can't give a sword to a bucket!");
  });

  it('PRSI ACTORBIT → "The <prsi> refuses it politely." — gverbs.zil:717', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'give', action: 'V-GIVE', dobj: fix.sword, iobj: fix.npc }),
      'V-GIVE',
    );
    expect(r.output).toBe('The troll refuses it politely.');
  });
});

// ---------------------------------------------------------------------------
// V-WEAR — gverbs.zil:1597–1602
// ---------------------------------------------------------------------------

describe('V-WEAR', () => {
  it('no WEARBIT → "You can\'t wear the <obj>." — gverbs.zil:1599', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'wear', action: 'V-WEAR', dobj: fix.stone }),
      'V-WEAR',
    );
    expect(r.output).toBe("You can't wear the stone.");
  });

  it('WEARBIT → performs TAKE: "You are now wearing the cloak." — gverbs.zil:1601, V-TAKE:1384', async () => {
    const fix = makeFixture();
    // cloak is in room (not in player)
    expect(fix.cloak.parent).toBe(fix.room);
    const r = await executeVerb(
      ctx(fix, { verb: 'wear', action: 'V-WEAR', dobj: fix.cloak }),
      'V-WEAR',
    );
    expect(r.output).toContain('You are now wearing the cloak.');
    expect(fix.cloak.parent).toBe(fix.player);
  });
});

// ---------------------------------------------------------------------------
// PRE-MOVE — gverbs.zil:910–912
// ---------------------------------------------------------------------------

describe('PRE-MOVE', () => {
  it('PRSO held → "You aren\'t an accomplished enough juggler." — gverbs.zil:912', async () => {
    const fix = makeFixture();
    // rope is in player
    const r = await executeVerb(
      ctx(fix, { verb: 'move', action: 'PRE-MOVE', dobj: fix.rope }),
      'PRE-MOVE',
    );
    expect(r.output).toBe("You aren't an accomplished enough juggler.");
  });

  it('PRSO not held → passes (empty)', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'move', action: 'PRE-MOVE', dobj: fix.rug }),
      'PRE-MOVE',
    );
    expect(r.output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// V-MOVE — gverbs.zil:914–918
// ---------------------------------------------------------------------------

describe('V-MOVE', () => {
  it('TAKEBIT → "Moving the <obj> reveals nothing." — gverbs.zil:916', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'move', action: 'V-MOVE', dobj: fix.rug }),
      'V-MOVE',
    );
    expect(r.output).toBe('Moving the rug reveals nothing.');
  });

  it('no TAKEBIT → "You can\'t move the <obj>." — gverbs.zil:918', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'move', action: 'V-MOVE', dobj: fix.statue }),
      'V-MOVE',
    );
    expect(r.output).toBe("You can't move the statue.");
  });
});

// ---------------------------------------------------------------------------
// V-LOWER — gverbs.zil:902 (HACK-HACK "Playing in this way with the ")
// ---------------------------------------------------------------------------

describe('V-LOWER', () => {
  it('normal object → "Playing in this way with the <obj>" + HO-HUM suffix', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      // rng returning 0 → first hoHum entry " doesn't seem to work."
      ctx(fix, {
        verb: 'lower', action: 'V-LOWER', dobj: fix.rug,
        rng: { next: () => 0 },
      }),
      'V-LOWER',
    );
    expect(r.output).toMatch(/^Playing in this way with the rug/);
    expect(r.output).toMatch(/ doesn't seem to work\.$| isn't notably helpful\.$| has no effect\.$/);
  });

  it('global-objects item (null parent) → "The <obj> isn\'t here!" — gverbs.zil:2027', async () => {
    const fix = makeFixture();
    expect(fix.wall.parent).toBeNull();
    const r = await executeVerb(
      ctx(fix, { verb: 'lower', action: 'V-LOWER', dobj: fix.wall }),
      'V-LOWER',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });

  // LOCAL-GLOBALS (WHITE-HOUSE, FOREST) are (IN LOCAL-GLOBALS) in ZIL, NOT (IN GLOBAL-OBJECTS).
  // HACK-HACK: <IN? PRSO GLOBAL-OBJECTS> is false for them → HO-HUM, not "isn't here!".
  // Verified: dfrotz R119 at WEST-OF-HOUSE → "Playing in this way with the white house has no effect."
  it('local-global WHITE-HOUSE (null parent, in ROOM_GLOBAL_IDS) → HO-HUM, not "isn\'t here!"', async () => {
    const fix = makeFixture();
    const whiteHouse = new Thing('WHITE-HOUSE', 'white house', { synonyms: ['house'], adjectives: ['white'], ldesc: '' });
    // parent stays null — mimics LOCAL-GLOBALS: never placed in a room directly
    expect(whiteHouse.parent).toBeNull();
    const world2 = World.fromObjects([fix.room, fix.player, whiteHouse]);
    const r = await executeVerb(
      { verb: 'lower', action: 'V-LOWER', dobj: whiteHouse, player: fix.player, here: fix.room, world: world2, rng: { next: () => 2 } },
      'V-LOWER',
    );
    expect(r.output).toMatch(/^Playing in this way with the white house/);
    expect(r.output).not.toContain("isn't here!");
  });

  it('local-global FOREST (null parent, in ROOM_GLOBAL_IDS) → HO-HUM, not "isn\'t here!"', async () => {
    const fix = makeFixture();
    const forest = new Thing('FOREST', 'forest', { synonyms: ['forest'], adjectives: [], ldesc: '' });
    expect(forest.parent).toBeNull();
    const world2 = World.fromObjects([fix.room, fix.player, forest]);
    const r = await executeVerb(
      { verb: 'lower', action: 'V-LOWER', dobj: forest, player: fix.player, here: fix.room, world: world2, rng: { next: () => 2 } },
      'V-LOWER',
    );
    expect(r.output).toMatch(/^Playing in this way with the forest/);
    expect(r.output).not.toContain("isn't here!");
  });
});

// ---------------------------------------------------------------------------
// V-RAISE — gverbs.zil:1131–1132 (calls V-LOWER = HACK-HACK)
// A.1: must NOT return "You can't raise that." (the fabricated string)
// ---------------------------------------------------------------------------

describe('V-RAISE', () => {
  it('normal object → HACK-HACK route — NOT "You can\'t raise that." (A.1 fix)', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, {
        verb: 'raise', action: 'V-RAISE', dobj: fix.rug,
        rng: { next: () => 0 },
      }),
      'V-RAISE',
    );
    expect(r.output).not.toBe("You can't raise that.");
    expect(r.output).toMatch(/^Playing in this way with the rug/);
  });

  it('global-objects item → "The <obj> isn\'t here!" — same as V-LOWER', async () => {
    const fix = makeFixture();
    const r = await executeVerb(
      ctx(fix, { verb: 'raise', action: 'V-RAISE', dobj: fix.wall }),
      'V-RAISE',
    );
    expect(r.output).toBe("The surrounding wall isn't here!");
  });

  // Same LOCAL-GLOBALS fix: raise white house / raise forest → HO-HUM, not "isn't here!"
  it('local-global WHITE-HOUSE → HO-HUM via HACK-HACK (dfrotz: "has no effect.")', async () => {
    const fix = makeFixture();
    const whiteHouse = new Thing('WHITE-HOUSE', 'white house', { synonyms: ['house'], adjectives: ['white'], ldesc: '' });
    expect(whiteHouse.parent).toBeNull();
    const world2 = World.fromObjects([fix.room, fix.player, whiteHouse]);
    const r = await executeVerb(
      { verb: 'raise', action: 'V-RAISE', dobj: whiteHouse, player: fix.player, here: fix.room, world: world2, rng: { next: () => 2 } },
      'V-RAISE',
    );
    expect(r.output).toMatch(/^Playing in this way with the white house/);
    expect(r.output).not.toContain("isn't here!");
  });
});

// ---------------------------------------------------------------------------
// "You can't raise that." gone from src/ — structural guard
// (done-criteria: grep proves the fabricated string is gone)
// ---------------------------------------------------------------------------

describe('CB2 structural guard', () => {
  it('"You can\'t raise that." string is gone from the implementation', async () => {
    // Read the verb index source and assert the fabricated non-ZIL string is absent.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = fileURLToPath(import.meta.url);
    const src = await readFile(resolve(dirname(here), '../../src/engine/verbs/index.ts'), 'utf8');
    expect(src).not.toContain("You can't raise that.");
  });
});
