/**
 * D3 — Verbatim verb-default string wiring.
 *
 * Verifies that verb handlers use the exact ZIL strings from the D1 messages
 * module (MSG), replacing all paraphrased/invented strings per string-divergences.md.
 *
 * Tested divergences (from string-divergences.md):
 *   A1  verbTake already-have  → "You already have that!" (PRE-TAKE)
 *   A2  verbTake can't-take    → YUKS random pick (not "You can't take the X.")
 *   A4  verbOpen already-open  → "It is already open."
 *   A5  verbOpen can't-open    → "You must tell me how to do that to a %s."
 *   A6  verbOpen reveals       → "Opening the %s reveals %s."
 *   A7  verbOpen opened        → "Opened." (empty container) / "The %s opens." (door)
 *   A8  verbClose already-closed → "It is already closed."
 *   A9  verbClose success      → "Closed." (container) / "The %s is now closed." (door)
 *   A10 verbRead not-readable  → "How does one read a %s?"
 *   A11 verbRead no-text       → removed (READBIT always has text in ZIL)
 *   A13 verbExamine no-ldesc   → "There's nothing special about the %s."
 *   A14 verbPut not-held       → "That's easy for you to say since you don't even have the %s."
 *   A15 verbPut can't-put      → "You can't do that."
 *   A16 verbPut container-closed → "The %s isn't open."
 *
 * Lamp display name:
 *   light-sources.ts LANTERN handler → "The brass lantern is now on." (not "The lamp is now on.")
 */

import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Container } from '../../src/domain/container.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { Rng } from '../../src/engine/rng.js';
import { createGame } from '../../src/engine/bootstrap.js';
import {
  yuks,
  dummy,
  vOpen,
  vClose,
  vRead,
  vExamine,
  vPut,
  preGive,
  fmt,
} from '../../src/engine/game-messages.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface Fix {
  world: World;
  room: Room;
  player: Actor;
  lantern: Thing;       // takeable, light-source, no READBIT
  mailbox: Container;   // container, starts open
  leaflet: Thing;       // readable, has text prop
  chest: Container;     // container, starts closed, not takeable
  door: Thing;          // door object (Flag.Door)
  rng: Rng;
}

function makeFixture(): Fix {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A bare test room.' });
  room.set(Flag.On);

  const lantern = new Thing('LANTERN', 'brass lantern', {
    synonyms: ['lantern', 'lamp'],
    adjectives: ['brass'],
    ldesc: 'A brass lantern.',
  });
  lantern.set(Flag.Takeable);
  lantern.set(Flag.Light);
  lantern.moveTo(room);

  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox'],
    adjectives: ['small'],
    ldesc: 'A standard mailbox.',
  });
  mailbox.set(Flag.Container);
  mailbox.set(Flag.Open);
  mailbox.moveTo(room);

  const leaflet = new Thing('LEAFLET', 'leaflet', {
    synonyms: ['leaflet'],
    adjectives: [],
    ldesc: 'A leaflet.',
  });
  leaflet.set(Flag.Readable);
  leaflet.set(Flag.Takeable);
  leaflet.props.set('TEXT', 'WELCOME TO ZORK!');
  leaflet.moveTo(mailbox);

  const chest = new Container('CHEST', 'wooden chest', {
    synonyms: ['chest'],
    adjectives: ['wooden'],
    ldesc: 'A heavy chest.',
  });
  chest.set(Flag.Container);
  // Chest starts closed (no Flag.Open), not takeable
  chest.moveTo(room);

  const door = new Thing('DOOR', 'front door', {
    synonyms: ['door'],
    adjectives: ['front'],
    ldesc: 'A heavy wooden door.',
  });
  door.set(Flag.Door);
  door.moveTo(room);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  const world = World.fromObjects([room, lantern, mailbox, leaflet, chest, door, player]);
  const rng = new Rng(42);

  return { world, room, player, lantern, mailbox, leaflet, chest, door, rng };
}

function ctx(fix: Fix, opts: {
  verb: string;
  dobjId?: string;
  iobjId?: string;
  prep?: string;
  here?: Room;
}): VerbContext {
  const here = opts.here ?? fix.room;
  return {
    verb: opts.verb,
    dobj: opts.dobjId !== undefined ? fix.world.get(opts.dobjId) : undefined,
    iobj: opts.iobjId !== undefined ? fix.world.get(opts.iobjId) : undefined,
    prep: opts.prep,
    player: fix.player,
    here,
    world: fix.world,
    rng: fix.rng,
  };
}

// ---------------------------------------------------------------------------
// A1 — verbTake already-have → "You already have that!"
// ---------------------------------------------------------------------------

describe('D3 A1 — verbTake already-have', () => {
  it('returns "You already have that!" when player already carries item', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'take', dobjId: 'LANTERN' }), 'V-TAKE');
    expect(result.output).toBe('You already have that!');
  });
});

// ---------------------------------------------------------------------------
// A2 — verbTake can't-take → YUKS pick (never "You can't take the X.")
// ---------------------------------------------------------------------------

describe('D3 A2 — verbTake non-takeable uses YUKS', () => {
  it('returns a YUKS table entry for non-takeable objects', () => {
    const fix = makeFixture();
    // chest has no Takeable flag
    const result = executeVerb(ctx(fix, { verb: 'take', dobjId: 'CHEST' }), 'V-TAKE');
    expect(yuks.entries).toContain(result.output);
  });

  it('never says "You can\'t take the X."', () => {
    const fix = makeFixture();
    // Run many times to ensure we never see the forbidden string
    for (let i = 0; i < 20; i++) {
      fix.rng = new Rng(i);
      const result = executeVerb(ctx(fix, { verb: 'take', dobjId: 'CHEST' }), 'V-TAKE');
      expect(result.output).not.toMatch(/You can't take/);
    }
  });
});

// ---------------------------------------------------------------------------
// A4 — verbOpen already-open → "It is already open."
// ---------------------------------------------------------------------------

describe('D3 A4 — verbOpen already-open', () => {
  it('returns "It is already open." when container is open', () => {
    const fix = makeFixture();
    // mailbox starts open
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }), 'V-OPEN');
    expect(result.output).toBe(vOpen.alreadyOpen);
    expect(result.output).toBe('It is already open.');
  });

  it('does NOT say "The X is already open."', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }), 'V-OPEN');
    expect(result.output).not.toMatch(/The .* is already open/);
  });
});

// ---------------------------------------------------------------------------
// A5 — verbOpen non-openable → "You must tell me how to do that to a %s."
// ---------------------------------------------------------------------------

describe('D3 A5 — verbOpen non-openable', () => {
  it('returns "You must tell me how to do that to a brass lantern." for non-openable', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'LANTERN' }), 'V-OPEN');
    expect(result.output).toBe(fmt(vOpen.notOpenable, 'brass lantern'));
    expect(result.output).toBe('You must tell me how to do that to a brass lantern.');
  });

  it('does NOT say "You can\'t open the X."', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'LANTERN' }), 'V-OPEN');
    expect(result.output).not.toMatch(/You can't open/);
  });
});

// ---------------------------------------------------------------------------
// A6/A7 — verbOpen success with contents → "Opening the X reveals Y."
// ---------------------------------------------------------------------------

describe('D3 A6 — verbOpen reveals contents', () => {
  it('returns "Opening the small mailbox reveals a leaflet." after opening closed mailbox with leaflet', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open); // close it first
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }), 'V-OPEN');
    expect(result.output).toBe('Opening the small mailbox reveals a leaflet.');
  });

  it('does NOT say "Opened. Inside you see: leaflet."', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }), 'V-OPEN');
    expect(result.output).not.toMatch(/Inside you see/);
  });
});

// ---------------------------------------------------------------------------
// A7 — verbOpen empty container → "Opened."
// ---------------------------------------------------------------------------

describe('D3 A7 — verbOpen empty container → "Opened."', () => {
  it('returns "Opened." when container has no contents', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open);
    // Move leaflet out
    fix.leaflet.moveTo(fix.room);
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }), 'V-OPEN');
    expect(result.output).toBe('Opened.');
  });

  it('does NOT say "The X is now open."', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open);
    fix.leaflet.moveTo(fix.room);
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }), 'V-OPEN');
    expect(result.output).not.toMatch(/is now open/);
  });
});

// ---------------------------------------------------------------------------
// A7b — verbOpen door → "The X opens."
// ---------------------------------------------------------------------------

describe('D3 A7b — verbOpen door → "The X opens."', () => {
  it('returns "The front door opens." for a door object', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'DOOR' }), 'V-OPEN');
    expect(result.output).toBe(fmt(vOpen.opens, 'front door'));
    expect(result.output).toBe('The front door opens.');
  });
});

// ---------------------------------------------------------------------------
// A8 — verbClose already-closed → "It is already closed."
// ---------------------------------------------------------------------------

describe('D3 A8 — verbClose already-closed', () => {
  it('returns "It is already closed." when container is closed', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open); // close it
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'MAILBOX' }), 'V-CLOSE');
    expect(result.output).toBe(vClose.alreadyClosed);
    expect(result.output).toBe('It is already closed.');
  });

  it('does NOT say "The X is already closed."', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'MAILBOX' }), 'V-CLOSE');
    expect(result.output).not.toMatch(/The .* is already closed/);
  });
});

// ---------------------------------------------------------------------------
// A9 — verbClose container success → "Closed." (NOT "The X is now closed.")
// ---------------------------------------------------------------------------

describe('D3 A9 — verbClose container success', () => {
  it('returns "Closed." when closing an open container', () => {
    const fix = makeFixture();
    // mailbox starts open
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'MAILBOX' }), 'V-CLOSE');
    expect(result.output).toBe('Closed.');
  });

  it('does NOT say "The X is now closed." for a container', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'MAILBOX' }), 'V-CLOSE');
    expect(result.output).not.toMatch(/is now closed/);
  });
});

// ---------------------------------------------------------------------------
// A9b — verbClose door success → "The X is now closed."
// ---------------------------------------------------------------------------

describe('D3 A9b — verbClose door → "The X is now closed."', () => {
  it('returns "The front door is now closed." when closing a door', () => {
    const fix = makeFixture();
    fix.door.set(Flag.Open); // open it first
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'DOOR' }), 'V-CLOSE');
    expect(result.output).toBe(fmt(vClose.doorClosed, 'front door'));
    expect(result.output).toBe('The front door is now closed.');
  });
});

// ---------------------------------------------------------------------------
// A10 — verbRead not-readable → "How does one read a X?"
// ---------------------------------------------------------------------------

describe('D3 A10 — verbRead not-readable', () => {
  it('returns "How does one read a brass lantern?" for non-readable', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'read', dobjId: 'LANTERN' }), 'V-READ');
    expect(result.output).toBe(fmt(vRead.notReadable, 'brass lantern'));
    expect(result.output).toBe('How does one read a brass lantern?');
  });

  it('does NOT say "There\'s nothing to read on the X."', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'read', dobjId: 'LANTERN' }), 'V-READ');
    expect(result.output).not.toMatch(/nothing to read/);
  });

  it('still reads text prop for readable items', () => {
    const fix = makeFixture();
    fix.leaflet.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'read', dobjId: 'LEAFLET' }), 'V-READ');
    expect(result.output).toContain('WELCOME TO ZORK');
  });
});

// ---------------------------------------------------------------------------
// A13 — verbExamine no-ldesc → "There's nothing special about the X."
// ---------------------------------------------------------------------------

describe('D3 A13 — verbExamine no-text/no-ldesc fallback', () => {
  it('returns "There\'s nothing special about the X." when no ldesc/text', () => {
    const fix = makeFixture();
    // Create a plain item with no ldesc
    const pebble = new Thing('PEBBLE', 'small pebble', {
      synonyms: ['pebble'],
      adjectives: ['small'],
    });
    pebble.set(Flag.Takeable);
    pebble.moveTo(fix.room);
    fix.world.register(pebble);

    const result = executeVerb(ctx(fix, { verb: 'examine', dobjId: 'PEBBLE' }), 'V-EXAMINE');
    expect(result.output).toBe(fmt(vExamine.nothingSpecial, 'small pebble'));
    expect(result.output).toBe("There's nothing special about the small pebble.");
  });

  it('still returns ldesc when present', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'examine', dobjId: 'LANTERN' }), 'V-EXAMINE');
    expect(result.output).toBe('A brass lantern.');
  });
});

// ---------------------------------------------------------------------------
// A14 — verbPut not-held → "That's easy for you to say since you don't even have the X."
// ---------------------------------------------------------------------------

describe('D3 A14 — verbPut not-held', () => {
  it('returns "That\'s easy for you to say since you don\'t even have the X." when not held', () => {
    const fix = makeFixture();
    // lantern is on the floor, not held
    fix.chest.set(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }), 'V-PUT');
    expect(result.output).toBe(fmt(preGive.notHoldingIt, 'brass lantern'));
    expect(result.output).toBe("That's easy for you to say since you don't even have the brass lantern.");
  });

  it('does NOT say "You\'re not carrying the X."', () => {
    const fix = makeFixture();
    fix.chest.set(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }), 'V-PUT');
    expect(result.output).not.toMatch(/You're not carrying/);
  });
});

// ---------------------------------------------------------------------------
// A15 — verbPut non-container → "You can't do that."
// ---------------------------------------------------------------------------

describe('D3 A15 — verbPut non-container', () => {
  it('returns "You can\'t do that." when iobj is not a container', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    // leaflet is not a container
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'LEAFLET', prep: 'in' }), 'V-PUT');
    expect(result.output).toBe(vPut.cantDoThat);
    expect(result.output).toBe("You can't do that.");
  });

  it('does NOT say "You can\'t put things in the X."', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'LEAFLET', prep: 'in' }), 'V-PUT');
    expect(result.output).not.toMatch(/can't put things/);
  });
});

// ---------------------------------------------------------------------------
// A16 — verbPut container-closed → "The X isn't open."
// ---------------------------------------------------------------------------

describe('D3 A16 — verbPut container-closed', () => {
  it('returns "The wooden chest isn\'t open." when container is closed', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    // chest is closed by default
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }), 'V-PUT');
    expect(result.output).toBe(fmt(vPut.notOpen, 'wooden chest'));
    expect(result.output).toBe("The wooden chest isn't open.");
  });

  it('does NOT say "The X is closed."', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }), 'V-PUT');
    expect(result.output).not.toBe('The wooden chest is closed.');
  });
});

// ---------------------------------------------------------------------------
// Lamp display name — "The brass lantern is now on." (not "The lamp is now on.")
// ---------------------------------------------------------------------------

describe('D3 Lamp display name', () => {
  it('lamp description uses desc ("brass lantern") not hardcoded "lamp"', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM' });
    // Take the lamp from its starting location (trophy case area), then turn on.
    // In LIVING-ROOM the lamp is there with fdesc; we just need to test the turn-on output.
    const result = game.turn('turn on lamp');
    // The output should say "The brass lantern is now on." not "The lamp is now on."
    expect(result.output).toContain('brass lantern');
    expect(result.output).not.toContain('The lamp is now on.');
  });
});

// ---------------------------------------------------------------------------
// DUMMY table — above-ground "already open/closed" uses PICK-ONE DUMMY
// (B10, B24, B40)
// ---------------------------------------------------------------------------

describe('D3 B10/B24/B40 — already-done uses DUMMY pick', () => {
  it('kitchen window already-open returns a DUMMY table entry', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    // First open the kitchen window (go to it)
    game.turn('go north'); // north of house
    game.turn('go east'); // behind house
    // Now open the kitchen window (it's "slightly ajar" on examine, meaning it starts closed)
    // Try opening it twice to get the "already open" path
    game.turn('open window');  // opens it
    const result = game.turn('open window');  // should give DUMMY
    expect(dummy.entries).toContain(result.output);
    expect(result.output).not.toBe("It's already open.");
  });
});
