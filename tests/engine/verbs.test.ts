import { describe, it, expect } from 'vitest';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Container } from '../../src/domain/container';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import type { Exit } from '../../src/domain/game-object';

// ---------------------------------------------------------------------------
// Fixture world — a small hand-wired map covering all verb test cases.
//
// Layout:
//   CLEARING (has lantern, mailbox-with-leaflet; exits: north→FOREST, east→BLOCKED-ROOM)
//   FOREST   (dark room, no items)
//   BLOCKED-ROOM (east exit uses elseMessage, north uses per routine)
// ---------------------------------------------------------------------------

interface Fixture {
  world: World;
  clearing: Room;
  forest: Room;
  blockedRoom: Room;
  player: Actor;
  lantern: Thing;
  mailbox: Container;
  leaflet: Thing;
  pamphlet: Thing;
  chest: Container;
  sword: Thing;
}

function makeFixture(): Fixture {
  const clearing = new Room('CLEARING', 'Clearing', {
    exits: [
      { dir: 'north', to: 'FOREST' },
      { dir: 'east',  to: 'BLOCKED-ROOM' },
    ],
    ldesc: 'You are in a sun-drenched clearing.',
  });
  // Outdoor rooms are always lit (ZIL ONBIT = Flag.On on rooms).
  clearing.set(Flag.On);

  const forest = new Room('FOREST', 'Forest', {
    exits: [{ dir: 'south', to: 'CLEARING' }],
    ldesc: 'Tall trees surround you.',
  });
  // Outdoor rooms are always lit (ZIL ONBIT = Flag.On on rooms).
  forest.set(Flag.On);

  // Exits with conditional blocking for the go-verb tests.
  const blockedExits: Exit[] = [
    { dir: 'west', to: 'CLEARING' },
    // This exit is blocked: no 'to', has elseMessage.
    { dir: 'south', elseMessage: 'The way is barred by a rusty gate.' },
    // This exit uses a per-routine hook.
    { dir: 'north', per: 'SOME-ROUTINE' },
  ];
  const blockedRoom = new Room('BLOCKED-ROOM', 'Blocked Room', {
    exits: blockedExits,
  });

  const player = new Actor('PLAYER', 'yourself');

  const lantern = new Thing('LANTERN', 'brass lantern', {
    synonyms: ['lantern', 'lamp'],
    adjectives: ['brass'],
    ldesc: 'A tarnished brass lantern.',
  });
  lantern.set(Flag.Takeable);
  lantern.set(Flag.Light);
  lantern.moveTo(clearing);

  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox', 'box'],
    adjectives: ['small'],
    ldesc: 'A standard issue mailbox.',
  });
  mailbox.set(Flag.Open);  // starts open so leaflet is visible
  mailbox.moveTo(clearing);

  const leaflet = new Thing('LEAFLET', 'leaflet', {
    synonyms: ['leaflet'],
    adjectives: [],
    ldesc: 'A leaflet that reads: "ZORK is a trademark of Infocom."',
  });
  leaflet.set(Flag.Readable);
  leaflet.set(Flag.Takeable);
  leaflet.props.set('text', 'ZORK is a trademark of Infocom.');
  leaflet.moveTo(mailbox);

  // A pamphlet in the clearing — also readable but no text prop.
  const pamphlet = new Thing('PAMPHLET', 'pamphlet', {
    synonyms: ['pamphlet'],
    adjectives: [],
    ldesc: 'A pamphlet.',
  });
  pamphlet.set(Flag.Readable);
  pamphlet.set(Flag.Takeable);
  pamphlet.moveTo(clearing);

  // A chest for "put X in Y" tests (starts closed).
  const chest = new Container('CHEST', 'wooden chest', {
    synonyms: ['chest'],
    adjectives: ['wooden'],
    ldesc: 'A heavy wooden chest.',
  });
  chest.props.set('CAPACITY', 100);
  chest.props.set('SIZE', 10);
  // Chest is closed initially (no Flag.Open).
  chest.moveTo(clearing);

  const sword = new Thing('SWORD', 'elvish sword', {
    synonyms: ['sword'],
    adjectives: ['elvish'],
    ldesc: 'A short sword of elvish make.',
  });
  sword.set(Flag.Takeable);
  sword.set(Flag.Weapon);
  sword.moveTo(clearing);

  player.moveTo(clearing);

  const world = World.fromObjects([
    clearing, forest, blockedRoom,
    player, lantern, mailbox, leaflet, pamphlet, chest, sword,
  ]);

  return { world, clearing, forest, blockedRoom, player, lantern, mailbox, leaflet, pamphlet, chest, sword };
}

// ---------------------------------------------------------------------------
// Helper: build a VerbContext for a command.
// ---------------------------------------------------------------------------

function ctx(fix: Fixture, opts: {
  verb: string;
  dobjId?: string;
  iobjId?: string;
  prep?: string;
  here?: Room;
  perResolver?: (name: string, here: Room) => string | undefined;
}): VerbContext {
  const here = opts.here ?? fix.clearing;
  return {
    verb: opts.verb,
    dobj: opts.dobjId !== undefined ? fix.world.get(opts.dobjId) : undefined,
    iobj: opts.iobjId !== undefined ? fix.world.get(opts.iobjId) : undefined,
    prep: opts.prep,
    player: fix.player,
    here,
    world: fix.world,
    perResolver: opts.perResolver,
  };
}

// ---------------------------------------------------------------------------
// Tests — one per verb
// ---------------------------------------------------------------------------

describe('verb: look', () => {
  it('prints the room name and ldesc', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'look' }));
    expect(result.output).toContain('Clearing');
    expect(result.output).toContain('sun-drenched');
  });

  it('lists visible items in the room', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'look' }));
    // lantern and sword are loose in the clearing; mailbox is a container.
    expect(result.output).toContain('lantern');
    expect(result.output).toContain('mailbox');
  });

  it('does not list the player actor ("yourself") in room contents', () => {
    const fix = makeFixture();
    // Player is in the clearing; look should NOT list "yourself" as a room item.
    const result = executeVerb(ctx(fix, { verb: 'look' }));
    expect(result.output).not.toContain('yourself');
  });

  it('does not list items carried by the player as room contents when moving', () => {
    const fix = makeFixture();
    // Move lantern to player inventory, then go to FOREST and look.
    fix.lantern.moveTo(fix.player);
    const goResult = executeVerb(ctx(fix, { verb: 'walk', prep: 'north' }));
    // The description of FOREST should not mention "lantern" as a loose item.
    expect(goResult.output).not.toContain('lantern');
    expect(goResult.output).not.toContain('yourself');
  });
});

describe('verb: go', () => {
  it('moves the player to the destination room', () => {
    const fix = makeFixture();
    // "go north" from clearing → forest
    const result = executeVerb(ctx(fix, { verb: 'walk', prep: 'north' }));
    expect(result.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('FOREST');
  });

  it('prints the destination room description after moving', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'walk', prep: 'north' }));
    expect(result.output).toContain('Forest');
  });

  it('shows blocked-exit message when no destination and elseMessage is set', () => {
    const fix = makeFixture();
    // In BLOCKED-ROOM, south exit has only elseMessage — no destination.
    const result = executeVerb(ctx(fix, { verb: 'walk', prep: 'south', here: fix.blockedRoom }));
    expect(result.moved).toBe(false);
    expect(result.output).toContain('rusty gate');
  });

  it('shows generic blocked message when exit has no to and no elseMessage', () => {
    // north exit in BLOCKED-ROOM has per='SOME-ROUTINE' but no to/elseMessage.
    // Without a perResolver the engine should fall back to a generic message.
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'walk', prep: 'north', here: fix.blockedRoom }));
    expect(result.moved).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('calls per routine when a perResolver is provided and resolves destination', () => {
    const fix = makeFixture();
    const perResolver = (_name: string, _here: Room) => 'FOREST';
    const result = executeVerb(ctx(fix, { verb: 'walk', prep: 'north', here: fix.blockedRoom, perResolver }));
    expect(result.moved).toBe(true);
    expect(fix.player.parent?.id).toBe('FOREST');
  });

  it('returns error when direction has no exit', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'walk', prep: 'up' }));
    expect(result.moved).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
  });
});

describe('verb: take', () => {
  it('moves a takeable item from the room to the player inventory', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'take', dobjId: 'LANTERN' }));
    expect(result.output).toMatch(/taken|ok/i);
    expect(fix.lantern.parent?.id).toBe('PLAYER');
  });

  it('refuses to take an item without the Takeable flag', () => {
    const fix = makeFixture();
    // chest is not Takeable.
    const result = executeVerb(ctx(fix, { verb: 'take', dobjId: 'CHEST' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.chest.parent?.id).toBe('CLEARING');
  });

  it('refuses to take something the player already carries', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'take', dobjId: 'LANTERN' }));
    expect(result.output.length).toBeGreaterThan(0);
    // Still with player (no double-take).
    expect(fix.lantern.parent?.id).toBe('PLAYER');
  });
});

describe('verb: drop', () => {
  it('moves a carried item from inventory to the current room', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'drop', dobjId: 'LANTERN' }));
    expect(result.output).toMatch(/dropped|ok/i);
    expect(fix.lantern.parent?.id).toBe('CLEARING');
  });

  it('refuses to drop an item not in inventory', () => {
    const fix = makeFixture();
    // Lantern is on the floor, not held.
    const result = executeVerb(ctx(fix, { verb: 'drop', dobjId: 'LANTERN' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.lantern.parent?.id).toBe('CLEARING');
  });
});

describe('verb: open', () => {
  it('sets the Open flag on a container', () => {
    const fix = makeFixture();
    // Close the mailbox first so we can open it.
    fix.mailbox.clear(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }));
    expect(result.output).toMatch(/open/i);
    expect(fix.mailbox.has(Flag.Open)).toBe(true);
  });

  it('says already open if it is already open', () => {
    const fix = makeFixture();
    // Mailbox starts open in fixture.
    const result = executeVerb(ctx(fix, { verb: 'open', dobjId: 'MAILBOX' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.mailbox.has(Flag.Open)).toBe(true);
  });
});

describe('verb: close', () => {
  it('clears the Open flag on a container', () => {
    const fix = makeFixture();
    // mailbox starts open.
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'MAILBOX' }));
    expect(result.output).toMatch(/close/i);
    expect(fix.mailbox.has(Flag.Open)).toBe(false);
  });

  it('says already closed if not open', () => {
    const fix = makeFixture();
    fix.mailbox.clear(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'close', dobjId: 'MAILBOX' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.mailbox.has(Flag.Open)).toBe(false);
  });
});

describe('verb: read', () => {
  it('prints the text prop of a readable item', () => {
    const fix = makeFixture();
    // Leaflet is inside an open mailbox — bring to inventory for simplicity.
    fix.leaflet.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'read', dobjId: 'LEAFLET' }));
    expect(result.output).toContain('Infocom');
  });

  it('falls back to ldesc for a readable item without a text prop', () => {
    const fix = makeFixture();
    fix.pamphlet.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'read', dobjId: 'PAMPHLET' }));
    expect(result.output).toContain('pamphlet');
  });

  it('refuses when the item lacks the Readable flag', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'read', dobjId: 'LANTERN' }));
    expect(result.output.length).toBeGreaterThan(0);
    // Sanity: lantern has no text anyway.
    expect(result.output).not.toContain('undefined');
  });
});

describe('verb: inventory', () => {
  it('lists items the player is carrying', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    fix.sword.moveTo(fix.player);
    const result = executeVerb(ctx(fix, { verb: 'inventory' }));
    expect(result.output).toContain('lantern');
    expect(result.output).toContain('sword');
  });

  it('prints an empty-hands message when carrying nothing', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'inventory' }));
    expect(result.output.length).toBeGreaterThan(0);
    // Should mention "empty" or "nothing" or "not carrying".
    expect(result.output).toMatch(/empty|nothing|not carrying/i);
  });
});

describe('verb: examine', () => {
  it('prints the ldesc of an object', () => {
    const fix = makeFixture();
    const result = executeVerb(ctx(fix, { verb: 'examine', dobjId: 'LANTERN' }));
    expect(result.output).toContain('tarnished');
  });

  it('falls back to desc when ldesc is absent', () => {
    const fix = makeFixture();
    // Remove ldesc from pamphlet and confirm we still get a response.
    fix.pamphlet.ldesc = undefined;
    const result = executeVerb(ctx(fix, { verb: 'examine', dobjId: 'PAMPHLET' }));
    expect(result.output).toContain('pamphlet');
  });
});

describe('verb: put X in Y', () => {
  it('moves the dobj into an open container iobj', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    fix.chest.set(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.lantern.parent?.id).toBe('CHEST');
  });

  it('refuses to put into a closed container', () => {
    const fix = makeFixture();
    fix.lantern.moveTo(fix.player);
    // chest is closed by default.
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.lantern.parent?.id).not.toBe('CHEST');
  });

  it('refuses to put something not held by the player', () => {
    const fix = makeFixture();
    // lantern is on the floor, not held.
    fix.chest.set(Flag.Open);
    const result = executeVerb(ctx(fix, { verb: 'put', dobjId: 'LANTERN', iobjId: 'CHEST', prep: 'in' }));
    expect(result.output.length).toBeGreaterThan(0);
    expect(fix.lantern.parent?.id).not.toBe('CHEST');
  });
});

// ---------------------------------------------------------------------------
// V-LOOK-UNDER / V-LOOK-BEHIND / V-LOOK-ON — gverbs.zil:862-900
// These actions come from the syntax table:
//   LOOK UNDER X → action=V-LOOK-UNDER  (gsyntax.zil:304)
//   LOOK BEHIND X → action=V-LOOK-BEHIND (gsyntax.zil:305)
//   LOOK ON X    → action=V-LOOK-ON     (gsyntax.zil:302)
// Without dedicated ACTION_HANDLERS entries they fall through to verbLook,
// which re-describes the room — wrong in all three cases.
// ---------------------------------------------------------------------------

describe('V-LOOK-UNDER (action)', () => {
  it('always emits "There is nothing but dust there." (gverbs.zil:900)', () => {
    const fix = makeFixture();
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'UNDER' }),
      'V-LOOK-UNDER',
    );
    expect(result.output).toBe('There is nothing but dust there.');
    expect(result.moved).toBe(false);
  });

  it('does NOT re-describe the room', () => {
    const fix = makeFixture();
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'UNDER' }),
      'V-LOOK-UNDER',
    );
    expect(result.output).not.toContain('Clearing');
  });
});

describe('V-LOOK-BEHIND (action)', () => {
  it('emits "There is nothing behind the <desc>." (gverbs.zil:863)', () => {
    const fix = makeFixture();
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'BEHIND' }),
      'V-LOOK-BEHIND',
    );
    expect(result.output).toBe('There is nothing behind the brass lantern.');
    expect(result.moved).toBe(false);
  });

  it('does NOT re-describe the room', () => {
    const fix = makeFixture();
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'BEHIND' }),
      'V-LOOK-BEHIND',
    );
    expect(result.output).not.toContain('Clearing');
  });
});

describe('V-LOOK-ON (action)', () => {
  it('emits "Look on a <desc>???" when PRSO lacks SURFACEBIT (gverbs.zil:897)', () => {
    const fix = makeFixture();
    // Lantern has no SURFACEBIT — the non-surface branch.
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'ON' }),
      'V-LOOK-ON',
    );
    expect(result.output).toBe('Look on a brass lantern???');
    expect(result.moved).toBe(false);
  });

  it('delegates to LOOK-INSIDE when PRSO has SURFACEBIT (gverbs.zil:893-894)', () => {
    const fix = makeFixture();
    // Give the lantern SURFACEBIT and add something on it.
    fix.lantern.set(Flag.Surface);
    fix.lantern.set(Flag.Container);
    fix.lantern.set(Flag.Open);
    fix.sword.moveTo(fix.lantern);
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'ON' }),
      'V-LOOK-ON',
    );
    // Should list contents (sword on the surface), not the "???" message.
    expect(result.output).not.toContain('Look on a');
    expect(result.output).toContain('sword');
  });

  it('does NOT re-describe the room', () => {
    const fix = makeFixture();
    const result = executeVerb(
      ctx(fix, { verb: 'look', dobjId: 'LANTERN', prep: 'ON' }),
      'V-LOOK-ON',
    );
    expect(result.output).not.toContain('Clearing');
  });
});
