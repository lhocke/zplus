/**
 * SD2 — RANDOMIZE-OBJECTS
 *
 * 1actions.zil:4101–4123: on death, scatter inventory items, relocate LAMP/COFFIN,
 * zero SWORD.TVALUE.
 *
 * Spec §9.3 + §12 SD2 done-criteria:
 *   - LAMP in player inventory → moved to LIVING-ROOM
 *   - COFFIN in player inventory → moved to EGYPT-ROOM
 *   - SWORD.TVALUE set to 0 regardless of current value
 *   - Each carried item with TVALUE > 0 lands in a Land && !On room (underground scatter)
 *   - Each carried item with TVALUE <= 0 lands in one of the 11 ABOVE_GROUND rooms
 *   - Player inventory is empty after scatter
 *   - Structural/seeded tests — never exact-room assertions
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Thing } from '../../src/domain/thing.js';
import { Flag } from '../../src/domain/flags.js';
import { randomizeObjects } from '../../src/engine/death.js';
import { Rng } from '../../src/engine/rng.js';

// The 11 ABOVE_GROUND rooms from 1dungeon.zil:2630–2633.
const ABOVE_GROUND_IDS = new Set([
  'WEST-OF-HOUSE', 'NORTH-OF-HOUSE', 'EAST-OF-HOUSE', 'SOUTH-OF-HOUSE',
  'FOREST-1', 'FOREST-2', 'FOREST-3', 'PATH', 'CLEARING',
  'GRATING-CLEARING', 'CANYON-VIEW',
]);

describe('SD2-A: LAMP relocation', () => {
  it('LAMP in player inventory moves to LIVING-ROOM', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 1 });
    const lamp = game.world.get('LAMP')!;
    lamp.moveTo(game.player);

    expect(lamp.parent?.id).toBe('PLAYER');
    randomizeObjects(game.world, game.player, new Rng(1));
    expect(lamp.parent?.id).toBe('LIVING-ROOM');
  });

  it('LAMP not in player inventory is not relocated', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 2 });
    const lamp = game.world.get('LAMP')!;
    const originalParent = lamp.parent?.id;

    randomizeObjects(game.world, game.player, new Rng(2));
    // LAMP wasn't carried; should not have moved to LIVING-ROOM forcibly
    expect(lamp.parent?.id).toBe(originalParent);
  });
});

describe('SD2-B: COFFIN relocation', () => {
  it('COFFIN in player inventory moves to EGYPT-ROOM', () => {
    const game = createGame({ startRoom: 'EGYPT-ROOM', seed: 3 });
    const coffin = game.world.get('COFFIN')!;
    coffin.moveTo(game.player);

    randomizeObjects(game.world, game.player, new Rng(3));
    expect(coffin.parent?.id).toBe('EGYPT-ROOM');
  });
});

describe('SD2-C: SWORD.TVALUE zeroed', () => {
  it('SWORD TVALUE set to 0', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 4 });
    const sword = game.world.get('SWORD')!;
    sword.props.set('TVALUE', 50);  // pretend player deposited sword for points

    randomizeObjects(game.world, game.player, new Rng(4));
    expect(sword.props.get('TVALUE')).toBe(0);
  });

  it('SWORD TVALUE stays 0 when already 0', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 5 });
    const sword = game.world.get('SWORD')!;
    sword.props.set('TVALUE', 0);

    randomizeObjects(game.world, game.player, new Rng(5));
    expect(sword.props.get('TVALUE')).toBe(0);
  });
});

describe('SD2-D: treasure scatter (TVALUE > 0) → Land && !On room', () => {
  it('item with TVALUE > 0 lands in a Land && !On room (underground)', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 7 });
    // Add a treasure to player inventory
    const treasure = new Thing('TEST-TREASURE', 'test treasure', {});
    treasure.props.set('TVALUE', 10);
    game.world.register(treasure);
    treasure.moveTo(game.player);

    randomizeObjects(game.world, game.player, new Rng(7));

    expect(treasure.parent).not.toBeNull();
    expect(treasure.parent?.id).not.toBe('PLAYER');
    // Must be a Land && !On room (underground scatter)
    const dest = treasure.parent!;
    expect(dest.has(Flag.Land)).toBe(true);
    expect(dest.has(Flag.On)).toBe(false);
  });

  it('treasure not in ABOVE_GROUND set after scatter', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 8 });
    const treasure = new Thing('TEST-TREASURE-2', 'test treasure 2', {});
    treasure.props.set('TVALUE', 10);
    game.world.register(treasure);
    treasure.moveTo(game.player);

    randomizeObjects(game.world, game.player, new Rng(8));

    expect(ABOVE_GROUND_IDS.has(treasure.parent!.id)).toBe(false);
  });
});

describe('SD2-E: non-treasure scatter (TVALUE <= 0) → ABOVE_GROUND room', () => {
  it('item with TVALUE 0 lands in an ABOVE_GROUND room', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 9 });
    const junk = new Thing('TEST-JUNK', 'test junk', {});
    junk.props.set('TVALUE', 0);
    game.world.register(junk);
    junk.moveTo(game.player);

    randomizeObjects(game.world, game.player, new Rng(9));

    expect(junk.parent).not.toBeNull();
    expect(junk.parent?.id).not.toBe('PLAYER');
    expect(ABOVE_GROUND_IDS.has(junk.parent!.id)).toBe(true);
  });

  it('item with no TVALUE prop lands in an ABOVE_GROUND room', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 10 });
    const junk = new Thing('TEST-JUNK-2', 'test junk 2', {});
    // no TVALUE prop set
    game.world.register(junk);
    junk.moveTo(game.player);

    randomizeObjects(game.world, game.player, new Rng(10));

    expect(ABOVE_GROUND_IDS.has(junk.parent!.id)).toBe(true);
  });
});

describe('SD2-F: player inventory empty after scatter', () => {
  it('player has no children after randomizeObjects', () => {
    const game = createGame({ startRoom: 'LIVING-ROOM', seed: 11 });
    const lamp = game.world.get('LAMP')!;
    lamp.moveTo(game.player);
    const junk = new Thing('TEST-JUNK-3', 'test junk 3', {});
    game.world.register(junk);
    junk.moveTo(game.player);

    randomizeObjects(game.world, game.player, new Rng(11));
    expect(game.player.children.size).toBe(0);
  });
});

describe('SD2-G: seeded determinism', () => {
  it('same seed produces same outcome across two calls', () => {
    // Run twice with same seed; items go to the same rooms.
    const makeGame = (seed: number) => {
      const game = createGame({ startRoom: 'LIVING-ROOM', seed });
      const item1 = new Thing(`ITEM-G-1-${seed}`, 'item', {});
      item1.props.set('TVALUE', 10);
      game.world.register(item1);
      item1.moveTo(game.player);
      const item2 = new Thing(`ITEM-G-2-${seed}`, 'item2', {});
      item2.props.set('TVALUE', 0);
      game.world.register(item2);
      item2.moveTo(game.player);
      randomizeObjects(game.world, game.player, new Rng(seed));
      return { item1: item1.parent?.id, item2: item2.parent?.id };
    };

    const a = makeGame(42);
    const b = makeGame(42);
    expect(a.item1).toBe(b.item1);
    expect(a.item2).toBe(b.item2);
  });
});
