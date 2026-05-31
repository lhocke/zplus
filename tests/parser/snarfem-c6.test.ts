/**
 * C6 — SNARFEM (ALL/AND/BUT/ONE) + MANY-CHECK + TAKE-CHECK tests.
 *
 * Red→Green TDD for:
 *  - SMANY: verb-agnostic ALL collection via SMANY bit in dobjLocBits
 *  - BUT/EXCEPT subtraction from ALL set
 *  - MANY-CHECK: reject multi-object when SMANY not set (verbatim message)
 *  - STAKE (auto-take): "(Taken)" printed when object auto-taken
 *  - SHAVE (must-have): "You don't have the <obj>." hard-error
 *  - STAKE without SHAVE: silent failure path (no hard error)
 *
 * Per spec:
 *   gparser.zil:1036-1038 — STAKE=8, SMANY=4, SHAVE=2
 *   gparser.zil:1248-1292 — ITAKE-CHECK
 *   gparser.zil:1294-1313 — MANY-CHECK
 *   td1-parser-SPEC.md §7.4/§7.5
 *   td1-scope-model.md §2
 *
 * Verified bitmask facts from syntax.json:
 *   TAKE V-TAKE:    dobjLocBits=52   = SIR|SOG|SMANY        (SMANY ✓, STAKE ✗, SHAVE ✗)
 *   DROP V-DROP:    dobjLocBits=134  = SH|SMANY|SHAVE        (SMANY ✓, STAKE ✗, SHAVE ✓)
 *   READ V-READ:    dobjLocBits=248  = SH|SC|SIR|SOG|STAKE   (SMANY ✗, STAKE ✓, SHAVE ✗)
 *   THROW V-THROW:  dobjLocBits=194  = SH|SC|SHAVE           (SMANY ✗, STAKE ✗, SHAVE ✓)
 *   EAT V-EAT:     dobjLocBits=248  = SH|SC|SIR|SOG|STAKE   (SMANY ✗, STAKE ✓, SHAVE ✗)
 */

import { describe, it, expect } from 'vitest';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { World } from '../../src/domain/world.js';
import { Parser } from '../../src/engine/parser/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoom(id: string, desc: string, light = true): Room {
  const r = new Room(id, desc);
  if (light) r.set(Flag.On);
  return r;
}

function makeThing(
  id: string,
  desc: string,
  synonyms: string[],
  adjectives: string[] = [],
): Thing {
  return new Thing(id, desc, { synonyms, adjectives });
}

function makeActor(id: string, synonyms: string[] = []): Actor {
  return new Actor(id, 'actor', { synonyms });
}

// ---------------------------------------------------------------------------
// MANY-CHECK tests
// (READ has no SMANY in syntax.json — dobjLocBits=248 = SH|SC|SIR|SOG|STAKE)
// ---------------------------------------------------------------------------

describe('MANY-CHECK — rejects multiple direct objects when SMANY not set', () => {
  it('"read all" → verbatim MANY-CHECK fail (READ lacks SMANY)', () => {
    // READ dobjLocBits=248 has STAKE but NOT SMANY.
    // When "read all" resolves multiple objects, MANY-CHECK fires.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const book = makeThing('BOOK', 'small book', ['BOOK', 'MANUAL'], ['SMALL']);
    book.set(Flag.Readable);
    book.set(Flag.Takeable);
    book.moveTo(room);

    const scroll = makeThing('SCROLL', 'old scroll', ['SCROLL', 'PARCHMENT'], ['OLD']);
    scroll.set(Flag.Readable);
    scroll.set(Flag.Takeable);
    scroll.moveTo(room);

    const world = World.fromObjects([room, player, book, scroll]);
    const parser = new Parser();

    // "read all" — READ lacks SMANY, so resolving multiple objects should fail
    const results = parser.parseChained('read all', room, player, world);
    const hasManyFail = results.some(r =>
      r.kind === 'fail' &&
      r.message.includes("You can't use multiple direct objects with") &&
      r.message.includes('read'),
    );
    expect(hasManyFail).toBe(true);
  });

  it('MANY-CHECK message is verbatim ZIL string', () => {
    // "You can't use multiple direct objects with \"read\"."
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const book = makeThing('BOOK', 'small book', ['BOOK'], ['SMALL']);
    book.set(Flag.Readable);
    book.set(Flag.Takeable);
    book.moveTo(room);

    const scroll = makeThing('SCROLL', 'old scroll', ['SCROLL'], ['OLD']);
    scroll.set(Flag.Readable);
    scroll.set(Flag.Takeable);
    scroll.moveTo(room);

    const world = World.fromObjects([room, player, book, scroll]);
    const parser = new Parser();

    const results = parser.parseChained('read all', room, player, world);
    const fail = results.find(r =>
      r.kind === 'fail' &&
      r.message.includes("You can't use multiple direct objects with"),
    );
    expect(fail).toBeDefined();
    if (fail && fail.kind === 'fail') {
      // Verbatim ZIL string (gparser.zil:1302-1303):
      // "You can't use multiple direct objects with \"<verb>\"."
      expect(fail.message).toBe('You can\'t use multiple direct objects with "read".');
    }
  });

  it('"take all" with multiple items succeeds — TAKE has SMANY set (dobjLocBits=52)', () => {
    // TAKE dobjLocBits=52 = SIR|SOG|SMANY. MANY-CHECK passes.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Light);
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);

    const scroll = makeThing('SCROLL', 'scroll', ['SCROLL']);
    scroll.set(Flag.Takeable);
    scroll.moveTo(room);

    const world = World.fromObjects([room, player, lamp, scroll]);
    const parser = new Parser();

    // "take all" → should return multiple ok results (one per object)
    const results = parser.parseChained('take all', room, player, world);
    const okResults = results.filter(r => r.kind === 'ok');
    expect(okResults.length).toBeGreaterThanOrEqual(2);
    for (const r of okResults) {
      if (r.kind === 'ok') {
        expect(r.command.action).toBe('V-TAKE');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ALL / BUT/EXCEPT collection tests
// ---------------------------------------------------------------------------

describe('ALL collection — SMANY verb collects all matching objects', () => {
  it('"take all" collects both objects from the room', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Light);
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);

    const mailbox = makeThing('MAILBOX', 'small mailbox', ['MAILBOX', 'BOX'], ['SMALL']);
    mailbox.set(Flag.Takeable);
    mailbox.moveTo(room);

    const world = World.fromObjects([room, player, lamp, mailbox]);
    const parser = new Parser();

    const results = parser.parseChained('take all', room, player, world);
    const objIds = results
      .filter(r => r.kind === 'ok')
      .map(r => r.kind === 'ok' ? r.command.dobjIds?.[0] : undefined)
      .filter(Boolean);

    expect(objIds).toContain('LAMP');
    expect(objIds).toContain('MAILBOX');
  });

  it('"take all except lamp" collects mailbox but not lamp', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Light);
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);

    const mailbox = makeThing('MAILBOX', 'small mailbox', ['MAILBOX', 'BOX'], ['SMALL']);
    mailbox.set(Flag.Takeable);
    mailbox.moveTo(room);

    const world = World.fromObjects([room, player, lamp, mailbox]);
    const parser = new Parser();

    const results = parser.parseChained('take all except lamp', room, player, world);
    const objIds = results
      .filter(r => r.kind === 'ok')
      .map(r => r.kind === 'ok' ? r.command.dobjIds?.[0] : undefined)
      .filter(Boolean);

    expect(objIds).toContain('MAILBOX');
    expect(objIds).not.toContain('LAMP');
  });

  it('"drop all" collects all inventory items', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Takeable);
    lamp.moveTo(player);

    const sword = makeThing('SWORD', 'elvish sword', ['SWORD'], ['ELVISH']);
    sword.set(Flag.Takeable);
    sword.moveTo(player);

    const world = World.fromObjects([room, player, lamp, sword]);
    const parser = new Parser();

    const results = parser.parseChained('drop all', room, player, world);
    const objIds = results
      .filter(r => r.kind === 'ok')
      .map(r => r.kind === 'ok' ? r.command.dobjIds?.[0] : undefined)
      .filter(Boolean);

    expect(objIds).toContain('LAMP');
    expect(objIds).toContain('SWORD');
  });

  it('"take all" returns nothing (empty) when no takeable objects in room', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    // No takeable objects
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    const results = parser.parseChained('take all', room, player, world);
    // Should return empty or a not-found message, NOT multiple ok results
    const okResults = results.filter(r => r.kind === 'ok');
    expect(okResults.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// STAKE (auto-take) — "(Taken)" parenthetical
// ---------------------------------------------------------------------------

describe('STAKE — auto-take when STAKE bit set and object not held', () => {
  it('READ with unheld object produces autoTaken (STAKE fires)', () => {
    // READ dobjLocBits=248 = SH|SC|SIR|SOG|STAKE (no SHAVE).
    // When an object is in the room (not held), STAKE fires → mark autoTaken.
    // STAKE without SHAVE: if auto-take "succeeds" mark autoTaken, proceed.
    // The parser marks autoTaken; the action handler or Game.turn prints "(Taken)".
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    // A readable object in room (not held)
    const leaflet = makeThing('LEAFLET', 'leaflet', ['LEAFLET'], ['SMALL']);
    leaflet.set(Flag.Readable);
    leaflet.set(Flag.Takeable);  // can be taken
    leaflet.moveTo(room);  // in room, NOT in player inventory

    const world = World.fromObjects([room, player, leaflet]);
    const parser = new Parser();

    // "read leaflet" — STAKE fires (leaflet not held, but takeable)
    const result = parser.parse('read leaflet', room, player, world);
    // Should succeed (STAKE without SHAVE = no hard failure)
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.dobjIds?.[0]).toBe('LEAFLET');
      // C6: autoTaken populated when STAKE succeeds
      expect(result.command.autoTaken).toBeDefined();
      expect(result.command.autoTaken).toContain('LEAFLET');
    }
  });

  it('READ with held object produces no autoTaken (already held)', () => {
    // When object is already in player inventory, STAKE does NOT fire.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const leaflet = makeThing('LEAFLET', 'leaflet', ['LEAFLET'], ['SMALL']);
    leaflet.set(Flag.Readable);
    leaflet.set(Flag.Takeable);
    leaflet.moveTo(player);  // HELD — already in inventory

    const world = World.fromObjects([room, player, leaflet]);
    const parser = new Parser();

    const result = parser.parse('read leaflet', room, player, world);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      // Already held → no auto-take → autoTaken should be undefined or empty
      expect(result.command.autoTaken).toBeUndefined();
    }
  });

  it('STAKE without SHAVE: non-takeable object → ok (silent failure, no hard error)', () => {
    // STAKE fires but ITAKE conceptually fails (not takeable).
    // STAKE without SHAVE: silent → the command still proceeds (ok).
    // This tests the "STAKE without SHAVE is silent on failure" ZIL behavior.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    // A readable object that is NOT takeable — STAKE fires, ITAKE fails silently
    const stone = makeThing('STONE', 'inscribed stone', ['STONE'], ['INSCRIBED']);
    stone.set(Flag.Readable);
    // NOT Flag.Takeable — can't be taken
    stone.moveTo(room);

    const world = World.fromObjects([room, player, stone]);
    const parser = new Parser();

    // "read stone" — STAKE fires, stone not takeable → ITAKE would fail → silent
    // STAKE without SHAVE: no error even if take fails
    const result = parser.parse('read stone', room, player, world);
    // Should NOT fail with SHAVE error (STAKE-only = silent on failure)
    // The result may be ok (proceed without autoTaken) or ok with empty autoTaken
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      // Stone not takeable → no autoTaken
      expect(result.command.autoTaken).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// SHAVE (must-have) — "You don't have the X."
// ---------------------------------------------------------------------------

describe('SHAVE — must-have hard error when object not held', () => {
  it('"drop lamp" when lamp is in room (not held) → SHAVE fail', () => {
    // DROP dobjLocBits=134 = SH|SMANY|SHAVE (no STAKE).
    // DROP is a 1-object verb so no GWIM iobj is needed — SHAVE fires directly.
    // If the lamp is in the room (not held), DROP should fail with SHAVE message.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);  // NOT in player inventory

    const world = World.fromObjects([room, player, lamp]);
    const parser = new Parser();

    // "drop lamp" — lamp not held → SHAVE → "You don't have the brass lantern."
    const result = parser.parse('drop lamp', room, player, world);
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      expect(result.message).toMatch(/You don't have the/);
      expect(result.message).toMatch(/brass lantern/);
    }
  });

  it('"drop lamp" when lamp IS held → succeeds (no SHAVE error)', () => {
    // When the object is in player inventory, SHAVE check passes.
    // DROP is a 1-object verb (no GWIM needed).
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Takeable);
    lamp.moveTo(player);  // IN player inventory

    const world = World.fromObjects([room, player, lamp]);
    const parser = new Parser();

    // "drop lamp" — lamp held → SHAVE passes → ok
    const result = parser.parse('drop lamp', room, player, world);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.dobjIds?.[0]).toBe('LAMP');
    }
  });

  it('SHAVE fail message format: "You don\'t have the <desc>." (ends with period)', () => {
    // Verbatim: "You don't have the <desc>." (gparser.zil:1285-1286)
    // The desc is the object's desc field (lowercase name), not the id.
    // Use DROP (1-object verb with SHAVE) to test the message format.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const rope = makeThing('ROPE', 'coarse rope', ['ROPE'], ['COARSE']);
    rope.set(Flag.Takeable);
    rope.moveTo(room);  // NOT held

    const world = World.fromObjects([room, player, rope]);
    const parser = new Parser();

    // "drop rope" — DROP has SHAVE, rope not held → SHAVE → "You don't have the coarse rope."
    const result = parser.parse('drop rope', room, player, world);
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      expect(result.message).toBe("You don't have the coarse rope.");
    }
  });

  it('"drop lamp" when lamp is in room (not held) → SHAVE fail', () => {
    // DROP dobjLocBits=134 = SH|SMANY|SHAVE (no STAKE).
    // If the lamp is in the room (not held), DROP should fail with SHAVE message.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Takeable);
    lamp.moveTo(room);  // NOT in player inventory

    const world = World.fromObjects([room, player, lamp]);
    const parser = new Parser();

    const result = parser.parse('drop lamp', room, player, world);
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      expect(result.message).toBe("You don't have the brass lantern.");
    }
  });

  it('"drop lamp" when lamp IS held → succeeds (no SHAVE error)', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);

    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN'], ['BRASS']);
    lamp.set(Flag.Takeable);
    lamp.moveTo(player);  // IN player inventory

    const world = World.fromObjects([room, player, lamp]);
    const parser = new Parser();

    const result = parser.parse('drop lamp', room, player, world);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.dobjIds?.[0]).toBe('LAMP');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — Game.turn level
// ---------------------------------------------------------------------------

describe('C6 integration via Game.turn', () => {
  it('"take all" in WEST-OF-HOUSE succeeds without MANY-CHECK error', async () => {
    // TAKE has SMANY. "take all" should succeed (no MANY-CHECK error).
    const { createGame } = await import('../../src/engine/bootstrap.js');

    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();

    const result = game.turn('take all');
    // Should NOT produce MANY-CHECK error for TAKE
    expect(result.output).not.toContain('You can\'t use multiple direct objects with "take"');
  });

  it('"read all" in multi-object room → no "I don\'t know the word" error', async () => {
    // "read all" should now be recognized (not "I don't know the word 'all'")
    // either succeeding (1 readable) or failing MANY-CHECK (2+ readables).
    const { createGame } = await import('../../src/engine/bootstrap.js');

    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();
    // Open mailbox first to expose leaflet
    game.turn('open mailbox');

    const result = game.turn('read all');
    // Should either succeed (if only 1 readable visible) or fail with MANY-CHECK
    // (if 2+ readables visible). Either way should not crash or produce "I don't know..."
    expect(result.output).not.toContain('I don\'t know the word "all"');
  });

  it('STAKE auto-take: "(Taken)" appears in output when STAKE fires', async () => {
    // When a STAKE-enabled syntax resolves an unheld object, Game.turn should
    // print "(Taken)" as part of the turn output (gparser.zil:1291).
    //
    // READ has STAKE bit. In WEST-OF-HOUSE, the leaflet is inside the mailbox.
    // After opening the mailbox, "read leaflet" should auto-take it and print "(Taken)".
    const { createGame } = await import('../../src/engine/bootstrap.js');

    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();
    game.turn('open mailbox');  // expose leaflet

    // "read leaflet" — leaflet in mailbox (open container, reachable but not held)
    // READ has STAKE: if not held → auto-take → "(Taken)" echoed
    const result = game.turn('read leaflet');
    // The "(Taken)" should appear in the output
    expect(result.output).toContain('(Taken)');
  });

  it('"take all" in LIVING-ROOM: player (cretin) not included in ALL candidates', async () => {
    // C6 regression guard: the old collectScope included the player as a room child.
    // The new buildScope-based candidate collection must exclude the player.
    const { createGame } = await import('../../src/engine/bootstrap.js');

    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();

    const result = game.turn('take all');
    // Player should NEVER appear as a take-all candidate
    expect(result.output).not.toContain('cretin');
    // Result should not be an error about MANY-CHECK
    expect(result.output).not.toContain("You can't use multiple direct objects with");
  });

  it('"take all" in LIVING-ROOM: output has per-object "<name>: " prefix (ALL-iteration)', async () => {
    // gmain.zil:121-144: ALL-iteration prints "<objname>: " before each action result.
    // Game.turn must add this prefix for allIter-flagged commands (C6 SNARFEM).
    const { createGame } = await import('../../src/engine/bootstrap.js');

    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();

    const result = game.turn('take all');
    // The output must contain at least one "desc: " prefix — takeable objects
    // in Living Room are sword and brass lantern.
    const hasSwordPrefix = result.output.includes('sword:') || result.output.includes('sword: ');
    const hasLanternPrefix = result.output.includes('brass lantern:') || result.output.includes('brass lantern: ');
    expect(hasSwordPrefix || hasLanternPrefix).toBe(true);
  });

  it('"examine all" in LIVING-ROOM: player (cretin) not included (scope bug fix)', async () => {
    // C6 bug: the generic SMANY else-branch in tryExpandAll used the old collectScope
    // which included the player as a room child.  Fixed to use buildScope tiers.
    // EXAMINE dobjLocBits=4 (SMANY only, no SOG/SIR/SH/SC) → local/inv search finds
    // nothing → GLOBAL-CHECK fires.
    const { createGame } = await import('../../src/engine/bootstrap.js');

    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();

    const result = game.turn('examine all');
    // Player should NEVER appear as an examine-all candidate
    expect(result.output).not.toContain('cretin');
    // Room objects should NOT appear (EXAMINE scope bits don't cover room tier)
    expect(result.output).not.toContain('trophy case');
  });
});

// ---------------------------------------------------------------------------
// C6-FIX oracle-backed tests — verified against dfrotz R119
// Fixes: A1 (TryTake gate), A2 (SRCTOP descent), A3 (STAIRS object), A4 (order)
// ---------------------------------------------------------------------------

describe('C6-FIX oracle: "take all" in LIVING-ROOM', () => {
  // dfrotz oracle (LIVING-ROOM, no prior commands):
  //   sword: Taken.
  //   brass lantern: Taken.
  //   carpet: The rug is extremely heavy and cannot be carried.
  //   trophy case: The trophy case is securely fastened to the wall.

  it('A1+A4: TryTake objects (rug, trophy case) are reported with refusal lines', async () => {
    // A1 fix: gate is Takeable||TryTake, not just Takeable.
    // RUG and TROPHY-CASE have TryTake only → they must appear with refusal lines.
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();
    const result = game.turn('take all');
    // Verbatim refusal lines from ZIL action handlers
    expect(result.output).toContain('carpet: The rug is extremely heavy and cannot be carried.');
    expect(result.output).toContain('trophy case: The trophy case is securely fastened to the wall.');
  });

  it('A1+A4: Takeable objects (sword, lantern) are taken', async () => {
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();
    const result = game.turn('take all');
    expect(result.output).toContain('sword: Taken.');
    expect(result.output).toContain('brass lantern: Taken.');
  });

  it('A4: objects appear in canonical ZIL FIRST?/NEXT? order', async () => {
    // dfrotz order: sword, brass lantern, carpet, trophy case.
    // (sword added last in ZIL → appears first via FIRST?; lantern before sword in JSON → appears second)
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();
    const result = game.turn('take all');
    // Full verbatim output matches oracle order
    const expected =
      'sword: Taken.\n' +
      'brass lantern: Taken.\n' +
      'carpet: The rug is extremely heavy and cannot be carried.\n' +
      'trophy case: The trophy case is securely fastened to the wall.';
    expect(result.output).toBe(expected);
  });
});

describe('C6-FIX oracle: "take all" in KITCHEN', () => {
  // dfrotz oracle (KITCHEN, no prior commands):
  //   glass bottle: Taken.
  //   brown sack: Taken.
  //
  // Water (inside the bottle) is NOT in the set — SRCTOP descent does not
  // recurse into a plain Container/Transparent container (no Searchable/Surface).

  it('A2: water is excluded (SRCTOP does not descend into plain open/transparent container)', async () => {
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'KITCHEN' });
    game.start();
    const result = game.turn('take all');
    // Water must NOT appear in take all output
    expect(result.output).not.toContain('quantity of water');
    expect(result.output).not.toContain("You can't reach");
  });

  it('A4: bottle and sack taken in canonical order (bottle before sack)', async () => {
    // dfrotz order: glass bottle, then brown sack.
    // (BOTTLE was inserted after SANDWICH-BAG in JSON → appears first via FIRST?)
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'KITCHEN' });
    game.start();
    const result = game.turn('take all');
    const expected = 'glass bottle: Taken.\nbrown sack: Taken.';
    expect(result.output).toBe(expected);
  });
});

describe('C6-FIX oracle: "examine all" in LIVING-ROOM (A3 STAIRS)', () => {
  // dfrotz oracle (LIVING-ROOM):
  //   stairs: There's nothing special about the stairs.
  //
  // Before fix: STAIRS was missing from objects.json, so localGlobals for
  // LIVING-ROOM was empty and GLOBAL-OBJECTS (teeth/walls) fell through.
  // After fix: STAIRS exists → localGlobals non-empty → GLOBAL-OBJECTS suppressed.

  it('A3: STAIRS object is found by examine all (not global-objects)', async () => {
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();
    const result = game.turn('examine all');
    // STAIRS must appear, global-objects must not
    expect(result.output).toContain('stairs:');
    expect(result.output).not.toContain('set of teeth');
    expect(result.output).not.toContain('granite wall');
    expect(result.output).not.toContain('surrounding wall');
  });

  it('A3: examine all LIVING-ROOM verbatim output matches oracle', async () => {
    const { createGame } = await import('../../src/engine/bootstrap.js');
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    game.start();
    const result = game.turn('examine all');
    expect(result.output).toBe("stairs: There's nothing special about the stairs.");
  });
});
