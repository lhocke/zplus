/**
 * C4 repair oracle verification tests.
 *
 * Exercises the specific bugs from the REPAIR CONTEXT to ensure they are fixed:
 *   1. LOCAL-GLOBALS/GLOBAL-OBJECTS conflation (false-positive scope)
 *   2. Multi-element GLOBAL lists now resolved via ROOM_GLOBAL_IDS table
 *   3. lit() ONBIT vs LIGHTBIT fix
 *   4. IT-pronoun unbound message verbatim
 *   5. Disambiguation message format with "the" prefix
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import { Parser } from '../../src/engine/parser/parser.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { World } from '../../src/domain/world.js';

// ---------------------------------------------------------------------------
// 1. LOCAL-GLOBALS / GLOBAL-OBJECTS tier separation
// ---------------------------------------------------------------------------

describe('LOCAL-GLOBALS/GLOBAL-OBJECTS tier separation', () => {
  it('CELLAR: "examine white house" → dark (CELLAR is dark, WHITE-HOUSE not in scope)', () => {
    const g = newGameAt('CELLAR');
    const r = g.turn('examine white house');
    // WHITE-HOUSE is NOT in CELLAR's GLOBAL list (TRAP-DOOR SLIDE STAIRS).
    // CELLAR is dark (no light) → "It's too dark to see!" (not "not-here")
    // In a lit room the message would be "You can't see any white house here!"
    // In a dark room it's "It's too dark to see!" (gparser.zil:1134-1135)
    expect(r.output).toMatch(/It's too dark to see!/i);
  });

  it('CELLAR: "examine forest" → dark (CELLAR is dark, FOREST not in scope)', () => {
    const g = newGameAt('CELLAR');
    const r = g.turn('examine forest');
    // FOREST is not in CELLAR's GLOBAL list, and CELLAR is dark
    expect(r.output).toMatch(/It's too dark to see!/i);
  });

  it('WEST-OF-HOUSE: "examine forest" → resolves (FOREST in WOH GLOBAL list)', () => {
    const g = newGameAt('WEST-OF-HOUSE');
    const r = g.turn('examine forest');
    // FOREST is in WEST-OF-HOUSE GLOBAL list [WHITE-HOUSE, BOARD, FOREST]
    // It should resolve (not emit "not-here" or "I don't know the word")
    expect(r.output).not.toMatch(/can't see any forest here/i);
    expect(r.output).not.toMatch(/I don't know the word/i);
  });

  it('EAST-OF-HOUSE: "open window" → resolves (KITCHEN-WINDOW in EAST-OF-HOUSE GLOBAL list)', () => {
    const g = newGameAt('EAST-OF-HOUSE');
    const r = g.turn('open window');
    // KITCHEN-WINDOW is in EAST-OF-HOUSE GLOBAL list [WHITE-HOUSE, KITCHEN-WINDOW, FOREST]
    expect(r.output).not.toMatch(/can't see any window here/i);
  });

  it('FOREST-1: "examine songbird" → resolves (SONGBIRD in FOREST-1 GLOBAL list)', () => {
    const g = newGameAt('FOREST-1');
    const r = g.turn('examine songbird');
    // SONGBIRD is in FOREST-1 GLOBAL list [TREE, SONGBIRD, WHITE-HOUSE, FOREST]
    expect(r.output).not.toMatch(/can't see any songbird here/i);
    expect(r.output).not.toMatch(/I don't know the word/i);
  });
});

// ---------------------------------------------------------------------------
// 2. lit() ONBIT vs LIGHTBIT fix
// ---------------------------------------------------------------------------

describe('lit() ONBIT vs LIGHTBIT', () => {
  it('unlit lamp (Flag.Light only) does NOT light a dark room', async () => {
    const { lit } = await import('../../src/engine/parser/scope.js');

    const room = new Room('DARK', 'A dark room');
    // Room has no Flag.Light (ONBIT)
    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);
    const lamp = new Thing('LAMP', 'brass lantern', { synonyms: ['LAMP'] });
    lamp.set(Flag.Light);    // LIGHTBIT only — not turned on
    // NOT setting Flag.OnFire (ONBIT)
    lamp.moveTo(player);

    const world = World.fromObjects([room, player, lamp]);
    expect(lit(room, player, world)).toBe(false);
  });

  it('lit lamp (Flag.OnFire) DOES light a dark room', async () => {
    const { lit } = await import('../../src/engine/parser/scope.js');

    const room = new Room('DARK', 'A dark room');
    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);
    const lamp = new Thing('LAMP', 'brass lantern', { synonyms: ['LAMP'] });
    lamp.set(Flag.Light);    // LIGHTBIT
    lamp.set(Flag.OnFire);   // ONBIT — currently emitting light
    lamp.moveTo(player);

    const world = World.fromObjects([room, player, lamp]);
    expect(lit(room, player, world)).toBe(true);
  });

  it('candles (Flag.OnFire) light the room from inventory', async () => {
    // CANDLES in ZIL have FLAGS TAKEBIT FLAMEBIT ONBIT LIGHTBIT — they start lit
    const { lit } = await import('../../src/engine/parser/scope.js');

    const room = new Room('DARK', 'A dark room');
    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);
    const candles = new Thing('CANDLES', 'pair of candles', { synonyms: ['CANDLES'] });
    candles.set(Flag.OnFire);   // ONBIT — burning
    candles.set(Flag.Flammable); // BURNBIT
    candles.moveTo(player);

    const world = World.fromObjects([room, player, candles]);
    expect(lit(room, player, world)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. IT-pronoun unbound message
// ---------------------------------------------------------------------------

describe('IT-pronoun messages (verbatim ZIL)', () => {
  it('IT with no referent → "I don\'t see what you\'re referring to."', () => {
    const g = newGameAt('LIVING-ROOM');
    const r = g.turn('examine it');
    // ZIL: "I don't see what you're referring to." (gparser.zil:1261)
    // NOT "You haven't mentioned any thing recently."
    expect(r.output).toContain("I don't see what you're referring to.");
  });
});

// ---------------------------------------------------------------------------
// 4. Disambiguation message format
// ---------------------------------------------------------------------------

describe('disambiguation message format (WHICH-PRINT verbatim)', () => {
  it('two candidates → "Which X do you mean, the A or the B?"', async () => {
    // Create two objects with the same noun "sword"
    const room = new Room('ROOM', 'A room');
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);

    const sword1 = new Thing('SWORD1', 'rusty sword', { synonyms: ['SWORD'], adjectives: ['RUSTY'] });
    sword1.moveTo(room);
    const sword2 = new Thing('SWORD2', 'elvish sword', { synonyms: ['SWORD'], adjectives: ['ELVISH'] });
    sword2.moveTo(room);

    const world = World.fromObjects([room, player, sword1, sword2]);
    const parser = new Parser();
    const result = parser.parse('take sword', room, player, world);

    expect(result.kind).toBe('disambig');
    if (result.kind === 'disambig') {
      // Must use "the" prefix and "or" join (not comma)
      expect(result.message).toMatch(/Which sword do you mean, the .+ or the .+\?/);
      // Must NOT use the old format without "the"
      expect(result.message).not.toMatch(/Which sword do you mean, rusty sword or/);
    }
  });

  it('three candidates → "Which X do you mean, the A, the B, or the C?"', async () => {
    const room = new Room('ROOM', 'A room');
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'player');
    player.moveTo(room);

    const door1 = new Thing('DOOR1', 'wooden door', { synonyms: ['DOOR'], adjectives: ['WOODEN'] });
    door1.moveTo(room);
    const door2 = new Thing('DOOR2', 'trap door', { synonyms: ['DOOR'], adjectives: ['TRAP'] });
    door2.moveTo(room);
    const door3 = new Thing('DOOR3', 'iron door', { synonyms: ['DOOR'], adjectives: ['IRON'] });
    door3.moveTo(room);

    const world = World.fromObjects([room, player, door1, door2, door3]);
    const parser = new Parser();
    const result = parser.parse('open door', room, player, world);

    expect(result.kind).toBe('disambig');
    if (result.kind === 'disambig') {
      // Oxford comma for 3+: "the A, the B, or the C"
      expect(result.message).toMatch(/Which door do you mean, the .+, the .+, or the .+\?/);
    }
  });
});
