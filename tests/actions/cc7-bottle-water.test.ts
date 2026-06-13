/**
 * CC7 — bottle/water handler unit tests (spec §6.7)
 *
 * BOTTLE-FUNCTION — 1actions.zil:1491–1507
 *   THROW bottle → "hits the far wall and shatters" + bottle removed + water removed
 *   MUNG  bottle → "A brilliant maneuver destroys the bottle." + bottle removed
 *   SHAKE open bottle (with water) → "The water spills to the floor and evaporates."
 *
 * WATER-F — 1actions.zil:157–237 (object-side drink handling)
 *   DRINK water from open bottle  → HIT-SPOT thirst message + water consumed
 *   DRINK water from closed bottle → "You'll have to open the glass bottle first."
 *   DRINK water when bottle inaccessible → "There isn't any water here."
 *
 * V-POUR-ON — gverbs.zil:1024–1044 (action handler)
 *   POUR water ON lit candle → "The pair of candles is extinguished." + flags cleared
 *   POUR water ON non-lit object → "evaporates" + water removed
 *
 * Bottle-open gate (spec §6.7 closed-bottle gate):
 *   Drinking from closed bottle is blocked.
 *
 * Spec §10.4 test contract: world-state prerequisites assert-and-fail.
 * No conditional early-returns above expects.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// BOTTLE-FUNCTION world prerequisites
// ---------------------------------------------------------------------------

describe('CC7 — BOTTLE-FUNCTION: world prerequisites', () => {
  it('BOTTLE exists in world', () => {
    const g = newGameAt('KITCHEN');
    g.start();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
  });

  it('WATER exists inside BOTTLE at start', () => {
    const g = newGameAt('KITCHEN');
    g.start();
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    expect(water!.parent?.id, 'WATER must start inside BOTTLE').toBe('BOTTLE');
  });

  it('BOTTLE starts on KITCHEN-TABLE', () => {
    const g = newGameAt('KITCHEN');
    g.start();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    expect(bottle!.parent?.id, 'BOTTLE must start on KITCHEN-TABLE').toBe('KITCHEN-TABLE');
  });
});

// ---------------------------------------------------------------------------
// Helper: get a game where the player is in the kitchen holding the bottle
// ---------------------------------------------------------------------------

function kitchenWithBottle() {
  const g = newGameAt('KITCHEN');
  g.start();
  const bottle = g.world.get('BOTTLE');
  expect(bottle, 'BOTTLE must exist').toBeDefined();
  bottle!.moveTo(g.player);
  return g;
}

// Helper: game in TROLL-ROOM with bottle and lamp (lit) in player inventory.
// Troll has ACTORBIT — needed for "throw bottle AT troll" (V-THROW syntax requires ACTORBIT iobj).
function trollRoomWithBottle() {
  const g = newGameAt('TROLL-ROOM');
  g.start();
  const lamp = g.world.get('LAMP');
  expect(lamp, 'LAMP must exist').toBeDefined();
  lamp!.moveTo(g.player);
  lamp!.set(Flag.OnFire);
  lamp!.set(Flag.Light);
  const bottle = g.world.get('BOTTLE');
  expect(bottle, 'BOTTLE must exist').toBeDefined();
  bottle!.moveTo(g.player);
  const troll = g.world.get('TROLL');
  expect(troll, 'TROLL must exist for V-THROW iobj').toBeDefined();
  return g;
}

// ---------------------------------------------------------------------------
// BOTTLE-FUNCTION: THROW bottle (1actions.zil:1492–1496)
// ---------------------------------------------------------------------------

// THROW needs "throw bottle AT <ACTORBIT>" — gsyntax.zil:486–487. Troll has ACTORBIT.
describe('CC7 — BOTTLE-FUNCTION: throw bottle → shatters (1actions.zil:1492–1496)', () => {
  it('throw bottle at troll: shatters message emitted', () => {
    const g = trollRoomWithBottle();
    const out = g.turn('throw bottle at troll').output;
    expect(out).toContain('shatters');
  });

  it('throw bottle at troll: bottle removed from world', () => {
    const g = trollRoomWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();

    g.turn('throw bottle at troll');

    expect(bottle!.parent, 'BOTTLE must be removed after throw').toBeNull();
  });

  it('throw bottle at troll: water also removed (spills as bottle shatters)', () => {
    const g = trollRoomWithBottle();
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    expect(water!.parent?.id, 'WATER must be in BOTTLE before throw').toBe('BOTTLE');

    g.turn('throw bottle at troll');

    expect(water!.parent, 'WATER must be removed after bottle shatters').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BOTTLE-FUNCTION: MUNG bottle (1actions.zil:1496–1499)
// ---------------------------------------------------------------------------

describe('CC7 — BOTTLE-FUNCTION: mung/destroy bottle (1actions.zil:1496–1499)', () => {
  it('mung bottle: "brilliant maneuver destroys the bottle" message', () => {
    const g = kitchenWithBottle();
    // Give player a weapon so PRE-MUNG passes.
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist').toBeDefined();
    sword!.moveTo(g.player);

    const out = g.turn('break bottle with sword').output;
    expect(out).toContain('brilliant maneuver destroys the bottle');
  });

  it('mung bottle: bottle removed from world', () => {
    const g = kitchenWithBottle();
    const sword = g.world.get('SWORD');
    expect(sword, 'SWORD must exist').toBeDefined();
    sword!.moveTo(g.player);

    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();

    g.turn('break bottle with sword');

    expect(bottle!.parent, 'BOTTLE must be removed after mung').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BOTTLE-FUNCTION: SHAKE open bottle with water (1actions.zil:1500–1506)
// ---------------------------------------------------------------------------

describe('CC7 — BOTTLE-FUNCTION: shake open bottle → spill (1actions.zil:1500–1506)', () => {
  it('shake open bottle: "water spills to the floor and evaporates"', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.set(Flag.Open);

    const out = g.turn('shake bottle').output;
    expect(out).toContain('evaporates');
  });

  it('shake open bottle: water removed from world', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.set(Flag.Open);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    expect(water!.parent?.id, 'WATER must be in BOTTLE before shake').toBe('BOTTLE');

    g.turn('shake bottle');

    expect(water!.parent, 'WATER must be removed after shake-spill').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V-SHAKE closed bottle — gverbs.zil:1233–1237 (repair: V-SHAKE was unregistered)
// ---------------------------------------------------------------------------

describe('CC7 — V-SHAKE: closed bottle sounds (gverbs.zil:1233–1237)', () => {
  it('shake closed bottle with water inside: "something inside" message', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    // Bottle starts closed — BOTTLE-FUNCTION returns false, V-SHAKE default runs.
    expect(bottle!.has(Flag.Open), 'BOTTLE must start closed for this test').toBe(false);

    const out = g.turn('shake bottle').output;
    expect(out).toContain('something inside');
  });

  it('shake closed bottle: water NOT spilled', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    expect(bottle!.has(Flag.Open), 'BOTTLE must start closed').toBe(false);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();

    g.turn('shake bottle');

    expect(water!.parent?.id, 'WATER must remain in BOTTLE after closed-shake').toBe('BOTTLE');
  });
});

// ---------------------------------------------------------------------------
// WATER-F DROP — 1actions.zil:219–233 (repair: V-DROP path was unhandled)
// "pour water" routes to V-DROP via gsyntax.zil:360; WATER-F intercepts.
// ---------------------------------------------------------------------------

describe('CC7 — WATER-F: pour/drop water → evaporates (1actions.zil:219–233)', () => {
  it('pour water (no target): evaporates message', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.set(Flag.Open);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    water!.moveTo(g.player);   // water in player inventory (poured out of bottle)

    const out = g.turn('pour water').output;
    expect(out).toContain('evaporates');
  });

  it('pour water (no target): water removed', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.set(Flag.Open);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    water!.moveTo(g.player);

    g.turn('pour water');

    expect(water!.parent, 'WATER must be removed after pour').toBeNull();
  });

  it('pour water from closed bottle: "The bottle is closed."', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    // Bottle is closed; water is inside the bottle.
    expect(bottle!.has(Flag.Open), 'BOTTLE must start closed').toBe(false);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    expect(water!.parent?.id, 'WATER must be in BOTTLE').toBe('BOTTLE');

    const out = g.turn('pour water').output;
    expect(out).toContain('bottle is closed');
  });
});

// ---------------------------------------------------------------------------
// THROW bottle (no target) — BOTTLE-FUNCTION intercepts before V-THROW default
// (repair: bare THROW needed a 1-object syntax entry so parser routes it)
// ---------------------------------------------------------------------------

describe('CC7 — BOTTLE-FUNCTION: throw bottle (no target) → shatters (1actions.zil:1492–1496)', () => {
  it('throw bottle (no target): shatters message emitted', () => {
    const g = kitchenWithBottle();
    const out = g.turn('throw bottle').output;
    expect(out).toContain('shatters');
  });

  it('throw bottle (no target): bottle removed from world', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();

    g.turn('throw bottle');

    expect(bottle!.parent, 'BOTTLE must be removed after throw').toBeNull();
  });

  it('throw bottle (no target): water also removed (spills)', () => {
    const g = kitchenWithBottle();
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    expect(water!.parent?.id, 'WATER must be in BOTTLE before throw').toBe('BOTTLE');

    g.turn('throw bottle');

    expect(water!.parent, 'WATER must be removed after bottle shatters').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drink water — open bottle gate (spec §6.7, gverbs.zil:483–524)
// ---------------------------------------------------------------------------

describe('CC7 — WATER-F / V-DRINK: open-bottle drink (gverbs.zil:483–524)', () => {
  it('drink water from open bottle: HIT-SPOT thirst message', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.set(Flag.Open);
    bottle!.moveTo(g.player);

    const out = g.turn('drink water').output;
    expect(out).toContain('rather thirsty');
  });

  it('drink water from open bottle: water consumed (removed from world)', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.set(Flag.Open);
    bottle!.moveTo(g.player);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    expect(water!.parent?.id, 'WATER must be in BOTTLE before drink').toBe('BOTTLE');

    g.turn('drink water');

    expect(water!.parent, 'WATER must be removed after drinking').toBeNull();
  });

  it('drink water from closed bottle: bottle-closed gate message', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    // Bottle starts closed (no Open flag).
    expect(bottle!.has(Flag.Open), 'BOTTLE must start closed').toBe(false);
    bottle!.moveTo(g.player);

    const out = g.turn('drink water').output;
    expect(out).toContain('open the glass bottle first');
  });

  it('drink water from closed bottle: water NOT consumed', () => {
    const g = kitchenWithBottle();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    expect(bottle!.has(Flag.Open), 'BOTTLE must start closed').toBe(false);
    bottle!.moveTo(g.player);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();

    g.turn('drink water');

    expect(water!.parent?.id, 'WATER must remain in BOTTLE after failed drink').toBe('BOTTLE');
  });
});

// ---------------------------------------------------------------------------
// V-POUR-ON: pour water on lit candle → extinguish (gverbs.zil:1024–1038)
// ---------------------------------------------------------------------------

describe('CC7 — V-POUR-ON: pour water on lit candle (gverbs.zil:1024–1038)', () => {
  function templeWithWater() {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    // Move bottle+water to player; open bottle so water is accessible.
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.moveTo(g.player);
    bottle!.set(Flag.Open);
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();
    // Move water directly to player inventory for pouring.
    water!.moveTo(g.player);
    return g;
  }

  it('pour water on lit candles: extinguished message', () => {
    const g = templeWithWater();
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    // Candles start lit (have OnFire and Light flags).
    expect(candles!.has(Flag.OnFire), 'CANDLES must be lit (OnFire) for test').toBe(true);

    const out = g.turn('pour water on candles').output;
    expect(out).toContain('extinguished');
  });

  it('pour water on lit candles: candles lose OnFire flag', () => {
    const g = templeWithWater();
    const candles = g.world.get('CANDLES');
    expect(candles, 'CANDLES must exist').toBeDefined();
    expect(candles!.has(Flag.OnFire), 'CANDLES must be lit for test').toBe(true);

    g.turn('pour water on candles');

    expect(candles!.has(Flag.OnFire), 'CANDLES must not have OnFire after pour').toBe(false);
  });

  it('pour water on lit candles: water removed', () => {
    const g = templeWithWater();
    const water = g.world.get('WATER');
    expect(water, 'WATER must exist').toBeDefined();

    g.turn('pour water on candles');

    expect(water!.parent, 'WATER must be removed after pour').toBeNull();
  });

  it('pour water on unlit object: evaporates message', () => {
    const g = templeWithWater();
    // Place the bottle in SOUTH-TEMPLE so it's a targetable unlit object.
    const temple = g.world.get('SOUTH-TEMPLE');
    expect(temple, 'SOUTH-TEMPLE must exist').toBeDefined();
    const bottle = g.world.get('BOTTLE');
    expect(bottle, 'BOTTLE must exist').toBeDefined();
    bottle!.moveTo(temple!);
    // Bottle has no OnFire flag → not FLAMING? → evaporates path.

    const out = g.turn('pour water on bottle').output;
    expect(out).toContain('evaporates');
  });
});
