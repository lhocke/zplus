import { describe, expect, it } from 'vitest';
import { parse, type ParseResult } from '../../src/engine/parser/parser';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Container } from '../../src/domain/container';
import { Flag } from '../../src/domain/flags';

// ---------------------------------------------------------------------------
// Minimal world fixture — just enough for scope tests.
// No dependency on the full extracted data.
// ---------------------------------------------------------------------------

function makeFixtureWorld(): { world: World; westOfHouse: Room } {
  const westOfHouse = new Room('WEST-OF-HOUSE', 'West of House', {
    exits: [{ dir: 'north', to: 'NORTH-OF-HOUSE' }],
  });

  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox', 'box'],
    adjectives: ['small'],
  });
  mailbox.set(Flag.Container);
  mailbox.moveTo(westOfHouse);

  const leaflet = new Thing('LEAFLET', 'leaflet', {
    synonyms: ['leaflet'],
    adjectives: [],
  });
  leaflet.set(Flag.Readable);
  leaflet.moveTo(mailbox);

  const lantern = new Thing('LANTERN', 'brass lantern', {
    synonyms: ['lantern', 'lamp'],
    adjectives: ['brass'],
  });
  lantern.set(Flag.Light);
  lantern.set(Flag.Takeable);
  lantern.moveTo(westOfHouse);

  // A second lantern in a different room — NOT in scope.
  const northRoom = new Room('NORTH-OF-HOUSE', 'North of House', {});
  const spareLantern = new Thing('SPARE-LANTERN', 'brass lantern', {
    synonyms: ['lantern', 'lamp'],
    adjectives: ['brass'],
  });
  spareLantern.moveTo(northRoom);

  // Build world from raw data records rather than calling fromData so we can
  // pass already-constructed objects.  We wire objects directly instead.
  // Use a small private helper that accepts pre-built objects.
  const world = World.fromObjects([
    westOfHouse,
    mailbox,
    leaflet,
    lantern,
    northRoom,
    spareLantern,
  ]);

  return { world, westOfHouse };
}

// ---------------------------------------------------------------------------

describe('parse — basic verb+noun resolution', () => {
  it('resolves "open mailbox" to the MAILBOX object in scope', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('open mailbox', westOfHouse, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.verb).toBe('open');
    expect(cmd.dobjIds?.[0]).toBe('MAILBOX');
  });

  it('resolves "take lamp" via synonym to the LANTERN', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('take lamp', westOfHouse, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.verb).toBe('take');
    expect(cmd.dobjIds?.[0]).toBe('LANTERN');
  });

  it('accepts adjective + noun: "take brass lantern"', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('take brass lantern', westOfHouse, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.dobjIds?.[0]).toBe('LANTERN');
  });

  it('resolves a verb-only command (no noun)', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('look', westOfHouse, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.verb).toBe('look');
    expect(cmd.dobjIds).toBeUndefined();
  });
});

describe('parse — unknown word errors', () => {
  it('returns fail for a completely made-up verb', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('frobulate mailbox', westOfHouse, null, world);
    expect(result.kind).toBe('fail');
    const err = result as Extract<ParseResult, { kind: 'fail' }>;
    expect(err.message).toMatch(/frobulate/i);
  });

  it('returns fail for an unrecognized noun', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('take widget', westOfHouse, null, world);
    expect(result.kind).toBe('fail');
    const err = result as Extract<ParseResult, { kind: 'fail' }>;
    expect(err.message).toMatch(/widget/i);
  });

  it('returns fail with pardon message for blank input', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('', westOfHouse, null, world);
    expect(result.kind).toBe('fail');
    const err = result as Extract<ParseResult, { kind: 'fail' }>;
    expect(err.message).toMatch(/pardon/i);
  });
});

describe('parse — scope restriction', () => {
  it('does not resolve objects in a different room', () => {
    const { world } = makeFixtureWorld();
    // Verify that parse from NORTH-OF-HOUSE finds SPARE-LANTERN, not the one
    // in WEST-OF-HOUSE.
    const north = world.get('NORTH-OF-HOUSE');
    if (!north) throw new Error('North room not found');
    const result = parse('take lantern', north as Room, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.dobjIds?.[0]).toBe('SPARE-LANTERN');
  });
});

describe('parse — verb synonyms', () => {
  it('normalizes "get lamp" to verb "take"', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    const result = parse('get lamp', westOfHouse, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.verb).toBe('take');
  });
});

describe('parse — preposition / iobj', () => {
  it('parses "put leaflet in mailbox" with iobj', () => {
    const { world, westOfHouse } = makeFixtureWorld();
    // Move leaflet to the player's hand (null parent means in inventory for this test).
    const leaflet = world.get('LEAFLET')!;
    leaflet.moveTo(null);
    const result = parse('put leaflet in mailbox', westOfHouse, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.verb).toBe('put');
    expect(cmd.dobjIds?.[0]).toBe('LEAFLET');
    expect(cmd.iobjIds?.[0]).toBe('MAILBOX');
    expect(cmd.prep).toBe('in');
  });
});

// ---------------------------------------------------------------------------
// GameView shape — defined in engine/game.ts per the frozen contract.
// We import it here to ensure it type-checks correctly.
// ---------------------------------------------------------------------------
import type { GameView } from '../../src/engine/game';
import type { Dir } from '../../src/domain/game-object';

describe('GameView shape', () => {
  it('satisfies the frozen contract interface', () => {
    const view: GameView = {
      here: 'WEST-OF-HOUSE',
      hereName: 'West of House',
      exits: [{ dir: 'north' as Dir, known: true, to: 'NORTH-OF-HOUSE' }],
      visibleObjects: [{ id: 'MAILBOX', name: 'small mailbox' }],
      score: 0,
      maxScore: 350,
      moves: 0,
      inMaze: false,
    };
    expect(view.here).toBe('WEST-OF-HOUSE');
    expect(view.maxScore).toBe(350);
    expect(view.inMaze).toBe(false);
    expect(view.exits[0]?.dir).toBe('north');
  });
});
