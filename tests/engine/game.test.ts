import { describe, it, expect } from 'vitest';
import { Game } from '../../src/engine/game';
import { World } from '../../src/domain/world';
import { SimpleEventEmitter } from '../../src/engine/events';
import type { EngineEvent } from '../../src/engine/events';
import { Clock } from '../../src/engine/clock';
import { Room } from '../../src/domain/room';
import { Container } from '../../src/domain/container';
import { Thing } from '../../src/domain/thing';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import type { Rng } from '../../src/engine/game';

// ---------------------------------------------------------------------------
// Minimal fake RNG — sequential values, deterministic.
// ---------------------------------------------------------------------------

function makeRng(): Rng {
  let n = 0;
  return { next: () => (n++ % 100) / 100 };
}

// ---------------------------------------------------------------------------
// Fixture: a small world rooted at WEST-OF-HOUSE with a closed mailbox
// containing an ADVERTISEMENT (leaflet).
// ---------------------------------------------------------------------------

interface Fixture {
  game: Game;
  emitter: SimpleEventEmitter;
}

function makeFixture(): Fixture {
  const westOfHouse = new Room('WEST-OF-HOUSE', 'West of House', {
    ldesc: 'You are standing in an open field west of a white house, with a boarded front door.',
    exits: [{ dir: 'north', to: 'NORTH-OF-HOUSE' }],
  });
  westOfHouse.set(Flag.Light);

  const northOfHouse = new Room('NORTH-OF-HOUSE', 'North of House', {
    ldesc: 'You are facing the north side of a white house.',
    exits: [{ dir: 'south', to: 'WEST-OF-HOUSE' }],
  });
  northOfHouse.set(Flag.Light);

  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox', 'box'],
    adjectives: ['small'],
  });
  mailbox.set(Flag.Container);
  mailbox.moveTo(westOfHouse);

  const leaflet = new Thing('ADVERTISEMENT', 'leaflet', {
    synonyms: ['leaflet', 'advertisement', 'booklet', 'mail'],
    adjectives: ['small'],
  });
  leaflet.set(Flag.Readable);
  leaflet.set(Flag.Takeable);
  leaflet.props.set('text', 'WELCOME TO ZORK!\n\nZORK is a game of adventure, danger, and low cunning.');
  leaflet.moveTo(mailbox);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(westOfHouse);

  const world = World.fromObjects([westOfHouse, northOfHouse, mailbox, leaflet, player]);

  const emitter = new SimpleEventEmitter();
  const clock = new Clock();
  const rng = makeRng();

  const game = new Game(world, { rng, clock, events: emitter });
  return { game, emitter };
}

// ---------------------------------------------------------------------------
// Tests: Game.start()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests: player exclusion from room descriptions
// ---------------------------------------------------------------------------

describe('player not listed in room contents', () => {
  it('start() does not list the player (yourself) in room contents', () => {
    const { game } = makeFixture();
    const output = game.start();
    expect(output).not.toContain('yourself');
  });

  it('turn(north) output does not list the player in room contents', () => {
    const { game } = makeFixture();
    game.start();
    const result = game.turn('north');
    expect(result.output).not.toContain('yourself');
  });

  it('a held item (in player inventory) is not listed as a room item', () => {
    const { game } = makeFixture();
    game.start();
    // Take leaflet from mailbox, then open mailbox; leaflet should appear in
    // "open" result but NOT in a subsequent look.
    game.turn('open mailbox');
    game.turn('take leaflet');
    // Now look — leaflet is in inventory (player), not in the room.
    const result = game.turn('look');
    // The room listing should not show the leaflet as a loose room object.
    // (It may appear in some contexts but not as "You can see: leaflet.")
    expect(result.output).not.toMatch(/You can see:.*leaflet/);
  });
});

describe('Game.start()', () => {
  it('returns text containing the game title', () => {
    const { game } = makeFixture();
    const output = game.start();
    expect(output).toContain('ZORK');
  });

  it('returns text containing the starting room name', () => {
    const { game } = makeFixture();
    const output = game.start();
    expect(output).toContain('West of House');
  });

  it('emits a room-entered event for the initial room', () => {
    const { game, emitter } = makeFixture();
    const events: EngineEvent[] = [];
    emitter.on('room-entered', e => events.push(e));
    game.start();
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<EngineEvent, { type: 'room-entered' }>;
    expect(ev.room).toBe('WEST-OF-HOUSE');
    expect(ev.firstVisit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Game.turn()
// ---------------------------------------------------------------------------

describe('Game.turn()', () => {
  it('open mailbox reveals leaflet and returns output', () => {
    const { game } = makeFixture();
    game.start();
    const result = game.turn('open mailbox');
    expect(result.output.toLowerCase()).toContain('leaflet');
  });

  it('increments the move counter each turn', () => {
    const { game } = makeFixture();
    game.start();
    game.turn('look');
    expect(game.view().moves).toBe(1);
    game.turn('look');
    expect(game.view().moves).toBe(2);
  });

  it('emits turn-complete with the updated move count', () => {
    const { game, emitter } = makeFixture();
    game.start();

    const completions: number[] = [];
    emitter.on('turn-complete', e => completions.push(e.moves));

    game.turn('look');
    game.turn('look');
    expect(completions).toEqual([1, 2]);
  });

  it('emits room-entered when moving to a new room', () => {
    const { game, emitter } = makeFixture();
    game.start();

    const entered: string[] = [];
    emitter.on('room-entered', e => entered.push(e.room));

    // Start emits one for WEST-OF-HOUSE; move north emits another.
    game.turn('north');
    expect(entered).toContain('NORTH-OF-HOUSE');
  });

  it('marks firstVisit true the first time a room is entered', () => {
    const { game, emitter } = makeFixture();
    game.start();

    const visits: Array<{ room: string; firstVisit: boolean }> = [];
    emitter.on('room-entered', e => visits.push({ room: e.room, firstVisit: e.firstVisit }));

    game.turn('north');  // first visit to NORTH-OF-HOUSE
    game.turn('south'); // back to WEST-OF-HOUSE — not first visit
    game.turn('north');  // second visit to NORTH-OF-HOUSE

    const northVisits = visits.filter(v => v.room === 'NORTH-OF-HOUSE');
    expect(northVisits[0]?.firstVisit).toBe(true);
    expect(northVisits[1]?.firstVisit).toBe(false);
  });

  it('moved is true when location changed, false otherwise', () => {
    const { game } = makeFixture();
    game.start();

    const lookResult = game.turn('look');
    expect(lookResult.moved).toBe(false);

    const goResult = game.turn('north');
    expect(goResult.moved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Game.view()
// ---------------------------------------------------------------------------

describe('Game.view()', () => {
  it('returns the current room id and name', () => {
    const { game } = makeFixture();
    game.start();
    const v = game.view();
    expect(v.here).toBe('WEST-OF-HOUSE');
    expect(v.hereName).toBe('West of House');
  });

  it('lists exits for the current room', () => {
    const { game } = makeFixture();
    game.start();
    const v = game.view();
    const dirs = v.exits.map(e => e.dir);
    expect(dirs).toContain('north');
  });

  it('reports inMaze false for a non-maze room', () => {
    const { game } = makeFixture();
    game.start();
    expect(game.view().inMaze).toBe(false);
  });

  it('starts with score 0 and moves 0', () => {
    const { game } = makeFixture();
    game.start();
    const v = game.view();
    expect(v.score).toBe(0);
    expect(v.moves).toBe(0);
    expect(v.maxScore).toBe(350);
  });
});
