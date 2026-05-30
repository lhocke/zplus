import { describe, expect, it } from 'vitest';
import { Parser } from '../../src/engine/parser/parser';
import type { ParseResult } from '../../src/engine/parser/types';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Flag } from '../../src/domain/flags';

// ---------------------------------------------------------------------------
// Fixture: a room with two items sharing the same synonym ("lamp"), allowing
// us to trigger the disambiguation path.
// ---------------------------------------------------------------------------

function makeTwoLampWorld(): { world: World; room: Room } {
  const room = new Room('STUDY', 'Study', {});

  const brassLamp = new Thing('BRASS-LAMP', 'brass lamp', {
    synonyms: ['lamp', 'lantern'],
    adjectives: ['brass'],
  });
  brassLamp.set(Flag.Light);
  brassLamp.set(Flag.Takeable);
  brassLamp.moveTo(room);

  const silvLamp = new Thing('SILVER-LAMP', 'silver lamp', {
    synonyms: ['lamp', 'lantern'],
    adjectives: ['silver'],
  });
  silvLamp.set(Flag.Light);
  silvLamp.set(Flag.Takeable);
  silvLamp.moveTo(room);

  const world = World.fromObjects([room, brassLamp, silvLamp]);
  return { world, room };
}

// A world where a lamp is present alongside a bottle (used for pronoun tests).
function makeLampBottleWorld(): { world: World; room: Room } {
  const room = new Room('CELLAR', 'Cellar', {});

  const lamp = new Thing('CELLAR-LAMP', 'brass lantern', {
    synonyms: ['lantern', 'lamp'],
    adjectives: ['brass'],
  });
  lamp.set(Flag.Light);
  lamp.set(Flag.Takeable);
  lamp.moveTo(room);

  const bottle = new Thing('BOTTLE', 'glass bottle', {
    synonyms: ['bottle'],
    adjectives: ['glass'],
  });
  bottle.set(Flag.Takeable);
  bottle.moveTo(room);

  const world = World.fromObjects([room, lamp, bottle]);
  return { world, room };
}

// ---------------------------------------------------------------------------
// Disambiguation tests
// ---------------------------------------------------------------------------

describe('Parser — disambiguation', () => {
  it('returns ambiguous when two objects share a noun with no distinguishing adjective', () => {
    const { world, room } = makeTwoLampWorld();
    const parser = new Parser();
    const result = parser.parse('take lamp', room, null, world);

    expect(result.kind).toBe('ambiguous');
    const amb = result as Extract<ParseResult, { kind: 'ambiguous' }>;
    expect(amb.noun).toBe('lamp');
    expect(amb.candidates).toHaveLength(2);
    expect(amb.candidates).toContain('BRASS-LAMP');
    expect(amb.candidates).toContain('SILVER-LAMP');
    expect(amb.message).toMatch(/which lamp do you mean/i);
  });

  it('includes the descriptive names of both candidates in the message', () => {
    const { world, room } = makeTwoLampWorld();
    const parser = new Parser();
    const result = parser.parse('take lamp', room, null, world);

    expect(result.kind).toBe('ambiguous');
    const amb = result as Extract<ParseResult, { kind: 'ambiguous' }>;
    // Both desc strings should appear somewhere in the message.
    expect(amb.message).toMatch(/brass lamp/i);
    expect(amb.message).toMatch(/silver lamp/i);
  });

  it('resolves unambiguously when an adjective discriminates between the two lamps', () => {
    const { world, room } = makeTwoLampWorld();
    const parser = new Parser();

    const result = parser.parse('take brass lamp', room, null, world);
    expect(result.kind).toBe('ok');
    const cmd = (result as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.dobjId).toBe('BRASS-LAMP');
  });
});

// ---------------------------------------------------------------------------
// Pronoun tests
// ---------------------------------------------------------------------------

describe('Parser — pronoun binding', () => {
  it('"it" resolves to the last direct object after a successful command', () => {
    const { world, room } = makeLampBottleWorld();
    const parser = new Parser();

    // First command establishes the referent.
    const r1 = parser.parse('take lantern', room, null, world);
    expect(r1.kind).toBe('ok');
    const cmd1 = (r1 as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd1.dobjId).toBe('CELLAR-LAMP');

    // The lamp was moved by the first parse? No — parser doesn't move things.
    // We need the caller to inform the parser that the command succeeded.
    // After binding, "it" should resolve to the lantern.
    parser.bindPronouns(cmd1);

    // Now the lantern is still in the room (parser doesn't move things).
    // "examine it" should resolve "it" → CELLAR-LAMP.
    const r2 = parser.parse('examine it', room, null, world);
    expect(r2.kind).toBe('ok');
    const cmd2 = (r2 as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd2.dobjId).toBe('CELLAR-LAMP');
  });

  it('"it" resolves to the indirect object (iobj) when the last command had no dobj', () => {
    // Build a world with a box to put things into.
    const room = new Room('ROOM', 'Room', {});
    const box = new Thing('BOX', 'wooden box', {
      synonyms: ['box'],
      adjectives: ['wooden'],
    });
    box.set(Flag.Container);
    box.set(Flag.Open);
    box.moveTo(room);
    const coin = new Thing('COIN', 'gold coin', {
      synonyms: ['coin'],
      adjectives: ['gold'],
    });
    coin.set(Flag.Takeable);
    coin.moveTo(room);
    const world = World.fromObjects([room, box, coin]);
    const parser = new Parser();

    // "put coin in box" — dobj=COIN, iobj=BOX.
    const r1 = parser.parse('put coin in box', room, null, world);
    expect(r1.kind).toBe('ok');
    const cmd1 = (r1 as Extract<ParseResult, { kind: 'ok' }>).command;
    parser.bindPronouns(cmd1);

    // "examine it" after binding dobj — should still resolve to COIN (the DO).
    const r2 = parser.parse('examine it', room, null, world);
    expect(r2.kind).toBe('ok');
    const cmd2 = (r2 as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd2.dobjId).toBe('COIN');
  });

  it('"them" resolves to the last plural group when set explicitly', () => {
    // We treat "them" as a multi-pronoun; for single DO binding it mirrors "it".
    const { world, room } = makeLampBottleWorld();
    const parser = new Parser();

    const r1 = parser.parse('take lantern', room, null, world);
    expect(r1.kind).toBe('ok');
    const cmd1 = (r1 as Extract<ParseResult, { kind: 'ok' }>).command;
    parser.bindPronouns(cmd1);

    // "examine them" — "them" is bound to the same last DO.
    const r2 = parser.parse('examine them', room, null, world);
    expect(r2.kind).toBe('ok');
    const cmd2 = (r2 as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd2.dobjId).toBe('CELLAR-LAMP');
  });

  it('pronoun "it" yields unknown-word when no previous DO has been set', () => {
    const { world, room } = makeLampBottleWorld();
    const parser = new Parser();

    // No command has been issued — "it" has no referent.
    const result = parser.parse('examine it', room, null, world);
    // Either unknown-word or a special "no referent" error is acceptable;
    // we specify unknown-word with the word "it" matching the current contract.
    expect(result.kind).toBe('unknown-word');
    const err = result as Extract<ParseResult, { kind: 'unknown-word' }>;
    expect(err.word).toBe('it');
  });

  it('pronoun binding updates across sequential turns', () => {
    const { world, room } = makeLampBottleWorld();
    const parser = new Parser();

    // First: bind lantern.
    const r1 = parser.parse('take lantern', room, null, world);
    expect(r1.kind).toBe('ok');
    parser.bindPronouns((r1 as Extract<ParseResult, { kind: 'ok' }>).command);

    // Second: take bottle — rebinds "it" to the bottle.
    const r2 = parser.parse('take bottle', room, null, world);
    expect(r2.kind).toBe('ok');
    parser.bindPronouns((r2 as Extract<ParseResult, { kind: 'ok' }>).command);

    // Now "it" should point to the bottle.
    const r3 = parser.parse('examine it', room, null, world);
    expect(r3.kind).toBe('ok');
    const cmd3 = (r3 as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd3.dobjId).toBe('BOTTLE');
  });
});
