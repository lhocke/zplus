import { describe, expect, it } from 'vitest';
import { Parser } from '../../src/engine/parser/parser';
import type { ParseResult } from '../../src/engine/parser/types';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Container } from '../../src/domain/container';
import { Flag } from '../../src/domain/flags';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePickupWorld(): { world: World; room: Room } {
  const room = new Room('CLEARING', 'Forest Clearing', {});

  const lantern = new Thing('LANTERN', 'brass lantern', {
    synonyms: ['lantern', 'lamp'],
    adjectives: ['brass'],
  });
  lantern.set(Flag.Takeable);
  lantern.moveTo(room);

  const sword = new Thing('SWORD', 'elvish sword', {
    synonyms: ['sword'],
    adjectives: ['elvish'],
  });
  sword.set(Flag.Takeable);
  sword.set(Flag.Weapon);
  sword.moveTo(room);

  // A non-takeable fixture — should never appear in "take all" results.
  const tree = new Thing('TREE', 'large tree', {
    synonyms: ['tree'],
    adjectives: ['large'],
  });
  // No Flag.Takeable — deliberately.
  tree.moveTo(room);

  // An open container that holds a coin — coin is also takeable.
  const chest = new Container('CHEST', 'wooden chest', {
    synonyms: ['chest'],
    adjectives: ['wooden'],
  });
  chest.set(Flag.Container);
  chest.set(Flag.Open);
  chest.moveTo(room);

  const coin = new Thing('COIN', 'gold coin', {
    synonyms: ['coin'],
    adjectives: ['gold'],
  });
  coin.set(Flag.Takeable);
  coin.moveTo(chest);

  const world = World.fromObjects([room, lantern, sword, tree, chest, coin]);
  return { world, room };
}

// ---------------------------------------------------------------------------
// Command chaining: parseChained
// ---------------------------------------------------------------------------

describe('Parser.parseChained — sequential segment execution', () => {
  it('returns a single parsed command for a plain (non-chained) input', () => {
    const { world, room } = makePickupWorld();
    const parser = new Parser();
    const results = parser.parseChained('take lantern', room, null, world);

    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe('ok');
    const cmd = (results[0] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd.verb).toBe('take');
    expect(cmd.dobjIds?.[0]).toBe('LANTERN');
  });

  it('parses both segments of "open mailbox then read leaflet"', () => {
    // Build a world with an open mailbox containing a leaflet.
    const room = new Room('WEST', 'West of House', {});
    const mailbox = new Container('MAILBOX', 'small mailbox', {
      synonyms: ['mailbox'],
      adjectives: ['small'],
    });
    mailbox.set(Flag.Container);
    mailbox.set(Flag.Open);
    mailbox.moveTo(room);

    const leaflet = new Thing('LEAFLET', 'leaflet', {
      synonyms: ['leaflet'],
      adjectives: [],
    });
    leaflet.set(Flag.Readable);
    leaflet.moveTo(mailbox);

    const world = World.fromObjects([room, mailbox, leaflet]);
    const parser = new Parser();
    const results = parser.parseChained('open mailbox then read leaflet', room, null, world);

    expect(results).toHaveLength(2);
    expect(results[0]!.kind).toBe('ok');
    expect(results[1]!.kind).toBe('ok');

    const cmd0 = (results[0] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd0.verb).toBe('open');
    expect(cmd0.dobjIds?.[0]).toBe('MAILBOX');

    const cmd1 = (results[1] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd1.verb).toBe('read');
    expect(cmd1.dobjIds?.[0]).toBe('LEAFLET');
  });

  it('handles compass chaining: "n. e. take lamp"', () => {
    const { world, room } = makePickupWorld();
    const parser = new Parser();
    const results = parser.parseChained('n. e. take lamp', room, null, world);

    expect(results).toHaveLength(3);
    // First two are walk commands with direction prep.
    expect(results[0]!.kind).toBe('ok');
    expect(results[1]!.kind).toBe('ok');
    expect(results[2]!.kind).toBe('ok');

    const walk1 = (results[0] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(walk1.verb).toBe('walk');
    expect(walk1.prep).toBe('north');

    const walk2 = (results[1] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(walk2.verb).toBe('walk');
    expect(walk2.prep).toBe('east');

    const take = (results[2] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(take.verb).toBe('take');
    expect(take.dobjIds?.[0]).toBe('LANTERN');
  });

  it('propagates pronoun binding across segments in the same chain', () => {
    const { world, room } = makePickupWorld();
    const parser = new Parser();
    // "take lantern then examine it" — "it" should resolve to LANTERN via
    // pronoun binding carried across segments.
    const results = parser.parseChained('take lantern then examine it', room, null, world);

    expect(results).toHaveLength(2);
    expect(results[0]!.kind).toBe('ok');
    expect(results[1]!.kind).toBe('ok');

    const cmd1 = (results[1] as Extract<ParseResult, { kind: 'ok' }>).command;
    expect(cmd1.dobjIds?.[0]).toBe('LANTERN');
  });

  it('stops processing at the first error in a chain and includes the error', () => {
    const { world, room } = makePickupWorld();
    const parser = new Parser();
    // "take widget" is an unknown noun — processing should stop there.
    const results = parser.parseChained('take widget then take sword', room, null, world);

    // At minimum the first element must be the error (fail kind).
    expect(results[0]!.kind).toBe('fail');
    // The sword command after the error is not returned.
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// "take all" expansion
// ---------------------------------------------------------------------------

describe('Parser — "take all" expansion', () => {
  it('"take all" expands to one ParsedCommand per in-scope takeable', () => {
    const { world, room } = makePickupWorld();
    const parser = new Parser();
    const results = parser.parseChained('take all', room, null, world);

    // Should expand to commands for LANTERN, SWORD, and COIN (inside open chest).
    // Not the TREE (no Takeable flag) and not the CHEST itself (Container, not
    // Takeable unless the flag were set — it isn't in this fixture).
    expect(results.length).toBeGreaterThanOrEqual(3);
    const takeableIds = results
      .filter(r => r.kind === 'ok')
      .map(r => (r as Extract<ParseResult, { kind: 'ok' }>).command.dobjIds?.[0]);

    expect(takeableIds).toContain('LANTERN');
    expect(takeableIds).toContain('SWORD');
    expect(takeableIds).toContain('COIN');
    expect(takeableIds).not.toContain('TREE');
    expect(takeableIds).not.toContain('CHEST');
  });

  it('"take all" returns empty (or an informative error) when nothing is takeable', () => {
    const room = new Room('EMPTY', 'Empty Room', {});
    const rock = new Thing('ROCK', 'large rock', {
      synonyms: ['rock'],
      adjectives: ['large'],
    });
    // No Takeable flag on the rock.
    rock.moveTo(room);
    const world = World.fromObjects([room, rock]);
    const parser = new Parser();
    const results = parser.parseChained('take all', room, null, world);

    // Either zero results or a single not-found/error result — nothing to take.
    // The engine can decide what message to show; the parser just reports
    // that there is nothing takeable.
    if (results.length > 0) {
      // Any returned result must NOT be an 'ok' take command.
      for (const r of results) {
        if (r.kind === 'ok') {
          // If an ok result is returned, it should have an undefined dobjIds
          // (i.e. not a concrete object reference), or the test should fail.
          const cmd = (r as Extract<ParseResult, { kind: 'ok' }>).command;
          expect(cmd.dobjIds).toBeUndefined();
        }
      }
    }
  });

  it('"take all except sword" expands to takeables excluding the named item', () => {
    const { world, room } = makePickupWorld();
    const parser = new Parser();
    const results = parser.parseChained('take all except sword', room, null, world);

    const takeableIds = results
      .filter(r => r.kind === 'ok')
      .map(r => (r as Extract<ParseResult, { kind: 'ok' }>).command.dobjIds?.[0]);

    expect(takeableIds).toContain('LANTERN');
    expect(takeableIds).not.toContain('SWORD');
  });

  it('"drop all" also expands across inventory items', () => {
    // Build a world where the player carries items (null-parent means inventory
    // in the test-shortcut path used when player === null).
    const room = new Room('VAULT', 'Vault', {});
    const gem = new Thing('GEM', 'ruby gem', {
      synonyms: ['gem', 'ruby'],
      adjectives: ['ruby'],
    });
    gem.set(Flag.Takeable);
    gem.moveTo(null); // in inventory

    const key = new Thing('KEY', 'iron key', {
      synonyms: ['key'],
      adjectives: ['iron'],
    });
    key.set(Flag.Takeable);
    key.moveTo(null); // in inventory

    const world = World.fromObjects([room, gem, key]);
    const parser = new Parser();
    const results = parser.parseChained('drop all', room, null, world);

    const dropIds = results
      .filter(r => r.kind === 'ok')
      .map(r => (r as Extract<ParseResult, { kind: 'ok' }>).command.dobjIds?.[0]);

    expect(dropIds).toContain('GEM');
    expect(dropIds).toContain('KEY');
  });
});
