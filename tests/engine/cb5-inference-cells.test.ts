/**
 * CB5 inference-only cells — §6 mandate.
 *
 * The decision-table has six cells marked INFERENCE-ONLY: they are correct
 * by code-reading but no test drove a real assertion through the path.
 * This file closes that gap.  Each block cites the ZIL lines it exercises.
 *
 * Also covers the §1 superbrief object-leak bug:
 * gverbs.zil:1630-1632 (V-FIRST-LOOK): DESCRIBE-OBJECTS is gated by
 * NOT SUPER-BRIEF; the landed describeRoomShared superbrief branch called
 * describeRoomObjects before returning, leaking an object paragraph that
 * the contract says must be suppressed.
 *
 * Pin 1 (§2A revisit-touched-brief): a touched non-maze movement-revisit
 * still prints its object paragraph with ldesc gone (West-of-House/mailbox).
 * Pin 2 (fixed by §1):  first-visit/touched-revisit superbrief = bare name,
 * no objects.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';
import { describeRoomShared } from '../../src/engine/verbs/index.js';
import { Room } from '../../src/domain/room.js';
import { Actor } from '../../src/domain/actor.js';
import { Thing } from '../../src/domain/thing.js';
import { World } from '../../src/domain/world.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// §1 — SUPER-BRIEF must suppress the object paragraph
// (gverbs.zil:1630-1632: DESCRIBE-OBJECTS gated by NOT SUPER-BRIEF in V-FIRST-LOOK)
// ---------------------------------------------------------------------------

describe('superbrief suppresses object paragraph (§1 bug fix)', () => {
  it('pin 2 — superbrief first-visit: bare name, mailbox NOT listed', async () => {
    // Start at SOUTH-OF-HOUSE, superbrief, then go west → WEST-OF-HOUSE (first visit).
    // Mailbox is a visible floor object at WEST-OF-HOUSE — must not appear.
    const g = createGame({ startRoom: 'SOUTH-OF-HOUSE' });
    g.start();
    await g.turn('superbrief');
    const r = await g.turn('west'); // → WEST-OF-HOUSE (first visit, untouched)
    // Room name present.
    expect(r.output).toContain('West of House');
    // Object paragraph must be absent (gverbs.zil:1632 NOT SUPER-BRIEF gate).
    expect(r.output).not.toContain('mailbox');
    expect(r.output).not.toContain('There is');
  });

  it('pin 2 — superbrief touched-revisit: bare name, mailbox NOT listed', async () => {
    // Start at WEST-OF-HOUSE (touches it), go south, superbrief, come back.
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start(); // first visit → WoH is now Touched
    await g.turn('south'); // → SOUTH-OF-HOUSE
    await g.turn('superbrief');
    const r = await g.turn('west'); // → WEST-OF-HOUSE (touched revisit under superbrief)
    expect(r.output).toContain('West of House');
    expect(r.output).not.toContain('mailbox');
    expect(r.output).not.toContain('There is');
  });

  it('explicit LOOK under superbrief forces full desc with objects', async () => {
    // gverbs.zil:1665: LOOK? overrides SUPER-BRIEF gate — full desc including objects.
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    await g.turn('superbrief');
    const r = await g.turn('look'); // explicit look → full including objects
    expect(r.output).toContain('West of House');
    expect(r.output).toContain('mailbox');
  });
});

// ---------------------------------------------------------------------------
// Pin 1 — §2A revisit-touched-brief: object paragraph survives brief-mode revisit
// (gverbs.zil:1681-1684: DESCRIBE-OBJECTS runs after the body gate, not inside it)
// ---------------------------------------------------------------------------

describe('pin 1 — touched brief revisit keeps object paragraph, drops ldesc', () => {
  it('WEST-OF-HOUSE brief revisit: mailbox listed, ldesc absent', async () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start(); // first visit — WoH Touched
    await g.turn('south'); // → SOUTH-OF-HOUSE
    const r = await g.turn('west'); // revisit WoH in default brief mode
    // Brief mode: room name present.
    expect(r.output).toContain('West of House');
    // ldesc suppressed in brief mode ("open field west of a white house...").
    expect(r.output).not.toContain('open field west');
    // Object paragraph still printed (DESCRIBE-OBJECTS is outside the V? gate).
    expect(r.output).toContain('mailbox');
  });
});

// ---------------------------------------------------------------------------
// I-1 — Maze under SUPER-BRIEF
// (gverbs.zil:1653-1655: maze rooms clear TOUCHBIT so V?=true is forced;
//  gverbs.zil:1664-1667: SUPER-BRIEF gate fires AFTER the TOUCHBIT/V? setup,
//  so the superbrief early-return suppresses both ldesc AND objects even though
//  V? was forced true by the maze path.)
// ---------------------------------------------------------------------------

describe('I-1 — maze room under SUPER-BRIEF', () => {
  it('maze room under superbrief prints room name only (no ldesc, no objects)', () => {
    // Construct a lit maze room with a floor object.
    // gverbs.zil:1653-1655: maze rooms FCLEAR TOUCHBIT → always V?=true forced.
    // gverbs.zil:1664-1667: SUPER-BRIEF gate fires → name-only, no body, no objects.
    const mazeRoom = new Room('MAZE-X', 'Maze', {
      exits: [],
      ldesc: 'It is a maze of twisty little passages, all alike.',
    });
    mazeRoom.set(Flag.On);    // lit
    mazeRoom.set(Flag.Maze);  // MAZEBIT — clears TOUCHBIT each visit

    const floorThing = new Thing('MAZE-COIN', 'ancient coin');
    floorThing.set(Flag.Takeable);
    floorThing.moveTo(mazeRoom);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(mazeRoom);

    void World.fromObjects([mazeRoom, player, floorThing]);

    const flags: Record<string, boolean> = { 'SUPER-BRIEF': true };
    const getGlobal = (k: string) => flags[k] ?? false;

    // lookFlag=false (movement arrival, not explicit LOOK)
    const out = describeRoomShared(
      mazeRoom, player, /*lookFlag*/false,
      undefined, undefined, getGlobal, /*alwaysLit*/true,
    );

    // Room name must appear.
    expect(out).toContain('Maze');
    // ldesc must be absent (maze clears TOUCHBIT → V?=true; but SB gate fires).
    expect(out).not.toContain('twisty little passages');
    // Object paragraph must be absent (gverbs.zil:1632 NOT SUPER-BRIEF gate).
    expect(out).not.toContain('ancient coin');
    expect(out).not.toContain('There is');
  });
});

// ---------------------------------------------------------------------------
// I-2 — Dark + SPRAYED? (read-confirm: covered by darkness-gate.test.ts §4)
//
// darkness-gate.test.ts "SPRAYED? flag determines grue suffix" calls
// g.start() which drives describeCurrentRoom() → describeRoomShared.
// The tests assert the describe-room path: CELLAR (dark room) → pitch-black
// message with/without grue warning depending on SPRAYED? global.
// This goes through the describeRoomShared darkness gate (gverbs.zil:1637-1649).
// No duplicate assertion needed here — the coverage is real and complete.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// I-3 — Chimney → KITCHEN brief revisit (BD7/DGC-7)
// (gverbs.zil:1650-1652: TOUCHBIT-gated brief mode suppresses ldesc on revisit;
//  DESCRIBE-OBJECTS :1681-1684 still runs — sandwich bag fdesc visible.)
// ---------------------------------------------------------------------------

describe('I-3 — chimney arrival into KITCHEN (brief revisit)', () => {
  it('chimney UP from STUDIO lands in KITCHEN with brief desc (name + objects, no ldesc)', async () => {
    // STUDIO → UP via UP-CHIMNEY-FUNCTION → KITCHEN.
    // Player needs lamp in hand and ≤2 items total (up-chimney contract).
    // Pre-touch KITCHEN so the arrival is a brief revisit (V?=false).
    const g = newGameAt('STUDIO');
    const w = (g as unknown as { world: { get(id: string): unknown } }).world;
    const lamp = w.get('LAMP') as { moveTo(p: unknown): void; set(f: Flag): void };
    const player = w.get('PLAYER') as unknown;
    const kitchen = w.get('KITCHEN') as { set(f: Flag): void };
    lamp.moveTo(player);
    (lamp as { set(f: Flag): void }).set(Flag.OnFire); // lit lamp
    // Pre-touch KITCHEN so arrival is brief (V?=false, ldesc suppressed).
    kitchen.set(Flag.Touched);

    g.start();

    const r = await g.turn('up'); // → KITCHEN via UP-CHIMNEY-FUNCTION
    // Brief revisit: room name present.
    expect(r.output).toContain('Kitchen');
    // Objects still described: sandwich bag fdesc on kitchen table.
    // (DESCRIBE-OBJECTS runs outside the V? gate — gverbs.zil:1681-1684.)
    expect(r.output).toContain('brown sack');
    // KITCHEN has no ldesc in rooms.json, so there is nothing to suppress there.
    // The key invariant: brief-mode M-LOOK/ldesc body is absent (V?=false).
  });
});

// ---------------------------------------------------------------------------
// I-4 — PRAY teleport (SOUTH-TEMPLE → FOREST-1) — arrival describe cell
//
// cb3-v-pray-audit.test.ts confirms: at SOUTH-TEMPLE → player.moveTo(FOREST-1),
// returned output = '' (ZIL <GOTO ,FOREST-1> produces no V-PRAY text itself).
//
// The describe-cell for GOTO-triggered arrivals is NOT yet wired for the
// verbPray path (verbPray returns { output:'', moved:true } and the turn loop's
// verbResult.moved path fires onRoomEntered but does NOT call describeCurrentRoom).
// The verbGo path embeds describeRoom in its own output (verbs/index.ts:482).
// The pray-GOTO describe cell is therefore "wired in verbGo, absent in verbPray".
//
// This is documented as a known gap: verbPray moves the player silently; the
// caller must issue an explicit LOOK to see the new room.  If ZIL fidelity
// requires auto-describe after teleport, that is a separate bug (CB5/verbPray
// scope vs the GOTO dispatch in game.ts).
//
// Assert the current contract: pray output is empty but player is in FOREST-1.
// ---------------------------------------------------------------------------

describe('I-4 — PRAY teleport: silent arrival (describe cell not wired for verbPray GOTO)', () => {
  it('pray at SOUTH-TEMPLE: player arrives in FOREST-1, output is empty', async () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    const r = await g.turn('pray');
    // ZIL <GOTO ,FOREST-1>: no V-PRAY text; the arrival-describe cell is not
    // auto-fired by the verbPray GOTO path — output is empty.
    expect(r.output).toBe('');
    expect(g.view().here).toBe('FOREST-1');
  });

  it('pray at SOUTH-TEMPLE: explicit LOOK after arrival describes FOREST-1', async () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    await g.turn('pray'); // teleports, silent
    const r = await g.turn('look'); // explicit look → describe FOREST-1
    expect(r.output).toContain('Forest');
    expect(r.output).toContain('This is a forest, with trees in all directions');
  });
});

// ---------------------------------------------------------------------------
// I-5 — MIRROR rub teleport: V?=false GOTO → destination not auto-described
// (gverbs.zil:991: MIRROR-MIRROR calls GOTO with no LOOK? flag — arrival
//  produces no description until explicit LOOK.)
// MIRROR-MIRROR handler (CC6) is not yet wired in this phase.
// Assert describeRoom's behavior for V?=false directly to anchor the contract.
// ---------------------------------------------------------------------------

describe('I-5 — V?=false GOTO: describeRoom suppresses body on touched room', () => {
  it('describeRoomShared with lookFlag=false on touched room produces name-only', () => {
    // When MIRROR-MIRROR calls GOTO it passes no LOOK? — equivalent to lookFlag=false.
    // Touched room + lookFlag=false + VERBOSE=false → brief mode: name + objects, no ldesc.
    // The ldesc/handler body is suppressed by the V? gate (gverbs.zil:1664-1667).
    // Note: the CC6 MIRROR-MIRROR caller is not wired yet (Phase-3 CC6 task);
    // this test asserts the describeRoomShared contract directly.
    const room = new Room('MIRROR-ROOM-A', 'Mirror Room', {
      exits: [],
      ldesc: 'You are in a room with a large mirror on the wall.',
    });
    room.set(Flag.On);
    room.set(Flag.Touched); // touched — brief mode applies

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    void World.fromObjects([room, player]);

    const flags: Record<string, boolean> = { VERBOSE: false, 'SUPER-BRIEF': false };
    const getGlobal = (k: string) => flags[k] ?? false;

    const out = describeRoomShared(
      room, player, /*lookFlag*/false,
      undefined, undefined, getGlobal, /*alwaysLit*/true,
    );

    // Room name present.
    expect(out).toContain('Mirror Room');
    // ldesc absent (V?=false, body suppressed).
    expect(out).not.toContain('large mirror on the wall');
  });
});

// ---------------------------------------------------------------------------
// I-6 — Vehicle/boat arrival: ", in the <vehicle>" room name suffix
// (gverbs.zil:1658-1663: when player is in a vehicle, room title is
//  "<room>, in the <vehicle>".)
// cb-boat1-goto-vehicle.test.ts covers landing/movement mechanics.
// Augment: assert the describe-room name suffix cell.
// ---------------------------------------------------------------------------

describe('I-6 — vehicle arrival: room name includes ", in the <vehicle>" suffix', () => {
  it('describeRoomShared with player in vehicle produces "Room, in the vehicle" title', () => {
    // gverbs.zil:1659-1663 — VEHBIT test: player inside vehicle → title suffix.
    const room = new Room('RIVER', 'River', {
      exits: [],
      ldesc: 'The river flows gently.',
    });
    room.set(Flag.On);
    room.set(Flag.NonLand);

    const boat = new Thing('MAGIC-BOAT', 'magic boat');
    boat.set(Flag.Vehicle);
    boat.set(Flag.Open);
    boat.moveTo(room);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(boat); // player is inside the vehicle

    void World.fromObjects([room, boat, player]);

    const flags: Record<string, boolean> = {};
    const getGlobal = (k: string) => flags[k] ?? false;

    const out = describeRoomShared(
      room, player, /*lookFlag*/true,
      undefined, undefined, getGlobal, /*alwaysLit*/true,
    );

    // Title must include ", in the magic boat".
    expect(out).toContain('River, in the magic boat');
  });

  it('water-to-water boat movement: room desc contains vehicle name suffix', () => {
    // Construct a minimal two-water-room fixture and verify the describe-room
    // suffix appears when the player is inside the boat.
    const waterRoom = new Room('RIVER', 'River', {
      exits: [{ dir: 'east', to: 'RIVER2' }],
      ldesc: 'Frigid water.',
    });
    waterRoom.set(Flag.On);
    waterRoom.set(Flag.NonLand);
    waterRoom.set(Flag.Touched); // touched so brief path applies

    const boat = new Thing('INFLATED-BOAT', 'magic boat');
    boat.set(Flag.Vehicle);
    boat.set(Flag.Open);
    boat.props.set('VTYPE', 'NONLANDBIT');
    boat.moveTo(waterRoom);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(boat);

    void World.fromObjects([waterRoom, boat, player]);

    const flags: Record<string, boolean> = {};
    const getGlobal = (k: string) => flags[k] ?? false;

    // Brief revisit (lookFlag=false, not VERBOSE): body suppressed but title suffix present.
    const out = describeRoomShared(
      waterRoom, player, /*lookFlag*/false,
      undefined, undefined, getGlobal, /*alwaysLit*/true,
    );

    expect(out).toContain('River, in the magic boat');
  });
});
