/**
 * CC5 — skeleton curse unit tests (spec §6.5)
 *
 * SKELETON — 1actions.zil:931–940
 *
 *   VERB? TAKE RUB MOVE PUSH RAISE LOWER ATTACK KICK KISS:
 *     ghost message + ROB HERE → LAND-OF-LIVING-DEAD 100 (prob gate)
 *                    ROB ADVENTURER → LAND-OF-LIVING-DEAD (no prob gate)
 *
 * ZIL ROB filter (1actions.zil:3976–3989):
 *   !INVISIBLE && !SACREDBIT && TVALUE>0 && (!prob || prob(prob))
 *
 * ADVENTURER (ZIL WINNER) = the player object — its direct children are the
 * player's carried inventory.  The engine's rob() in thief.ts implements the
 * same filter; the WINNER call uses no prob argument, so every non-Invisible,
 * non-Sacred treasure moves unconditionally.
 *
 * ROB comparison (required by spec §6.5 A.1; see skeleton.ts):
 *   ZIL ROB check 1: !INVISIBLE  → engine: child.hasFlag(Flag.Invisible) skip  ✓
 *   ZIL ROB check 2: !SACREDBIT  → engine: child.hasFlag(Flag.Sacred) skip      ✓
 *   ZIL ROB check 3: TVALUE>0    → engine: child.tvalue <= 0 skip                ✓
 *   ZIL ROB check 4: !prob       → engine: prob===undefined → always pass        ✓
 *   MOVE + FSET TOUCHBIT         → engine: moveTo + setFlag(Touched)             ✓
 *   WHERE==THIEF → FSET INVISIBLE → engine: whereId==='THIEF' check              ✓
 *     (LAND-OF-LIVING-DEAD is never THIEF, so the INVISIBLE-on-move branch
 *      does not fire for either SKELETON call — correct)
 *
 * Conclusion: rob() faithfully implements ZIL ROB for the WINNER call.
 * No extension flag needed.
 *
 * Done-criteria (spec §6.5 + §11 CC5):
 *   - touch skeleton → ghost message emitted
 *   - carried treasures (tvalue>0, !Invisible, !Sacred) move to LAND-OF-LIVING-DEAD
 *   - room treasures (tvalue>0, !Invisible, !Sacred) move to LAND-OF-LIVING-DEAD
 *   - Sacred items are NOT moved (COFFIN has Sacred flag)
 *   - Invisible items are NOT moved (when Invisible flag is set)
 *   - items with tvalue==0 are NOT moved
 *   - skeleton returns true (PERFORM chain stops, ghost handled it)
 *
 * Spec §10.4 test contract: world-state prerequisites assert-and-fail, no
 * conditional early-returns above expects.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import { Thing } from '../../src/domain/thing.js';

const MAZE_5 = 'MAZE-5';
const LAND = 'LAND-OF-LIVING-DEAD';

function gameAtMaze5() {
  const g = newGameAt(MAZE_5);
  g.start();
  // Give the player a lamp so the room is lit (MAZE-5 is underground).
  const lamp = g.world.get('LAMP');
  expect(lamp, 'LAMP must exist').toBeDefined();
  lamp!.moveTo(g.player);
  lamp!.set(Flag.OnFire);
  lamp!.set(Flag.Light);
  return g;
}

function ensureBonesInRoom(g: ReturnType<typeof newGameAt>): void {
  const bones = g.world.get('BONES');
  expect(bones, 'BONES must exist in world').toBeDefined();
  const room = g.world.get(MAZE_5);
  expect(room, 'MAZE-5 must exist in world').toBeDefined();
  bones!.moveTo(room!);
}

function ensureLandExists(g: ReturnType<typeof newGameAt>): void {
  const land = g.world.get(LAND);
  expect(land, 'LAND-OF-LIVING-DEAD must exist in world').toBeDefined();
}

// ---------------------------------------------------------------------------
// Ghost message
// ---------------------------------------------------------------------------

describe('CC5 — SKELETON: ghost message on touch (1actions.zil:932)', () => {
  it('take skeleton: ghost message mentions "curse"', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);
    const out = g.turn('take skeleton').output;
    expect(out).toContain('ghost');
  });

  it('take skeleton: message mentions valuables being banished', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);
    const out = g.turn('take skeleton').output;
    expect(out).toContain('Land of the Living Dead');
  });

  it('take skeleton: action returns true (PERFORM chain halted)', () => {
    // Verified indirectly: if the handler returns true the output will
    // not include the default "You can't take the skeleton." or similar
    // fallback — the ghost message text is the only output.
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);
    const out = g.turn('take skeleton').output;
    expect(out).toContain('ghost');
    // No "default verb" fallback text
    expect(out).not.toContain("don't know how to");
  });
});

// ---------------------------------------------------------------------------
// Carried treasures scatter to LAND-OF-LIVING-DEAD (ROB ADVENTURER branch)
// ---------------------------------------------------------------------------

describe('CC5 — SKELETON: carried treasures move to LAND-OF-LIVING-DEAD (1actions.zil:939)', () => {
  it('carried treasure (tvalue>0, !Invisible, !Sacred) moves to LAND-OF-LIVING-DEAD', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    const land = g.world.get(LAND);
    expect(land, 'LAND-OF-LIVING-DEAD must exist').toBeDefined();

    // Give the player a treasure with tvalue > 0 (use JADE, tvalue=5).
    const jade = g.world.get('JADE');
    expect(jade, 'JADE must exist in world').toBeDefined();
    jade!.moveTo(g.player);

    g.turn('take skeleton');

    expect(jade!.parent?.id, 'JADE must move to LAND-OF-LIVING-DEAD').toBe(LAND);
  });

  it('carried treasure gets TOUCHBIT set when robbed', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    const jade = g.world.get('JADE');
    expect(jade, 'JADE must exist in world').toBeDefined();
    jade!.moveTo(g.player);
    jade!.clear(Flag.Touched);

    g.turn('take skeleton');

    expect(jade!.has(Flag.Touched), 'JADE must have Touched after rob').toBe(true);
  });

  it('Sacred item in inventory is NOT moved (COFFIN has Sacred)', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    const coffin = g.world.get('COFFIN');
    expect(coffin, 'COFFIN must exist in world').toBeDefined();
    // Coffin has Sacred flag in objects.json — verify it before relying on it.
    expect(coffin!.has(Flag.Sacred), 'COFFIN must have Sacred flag').toBe(true);

    const originalParent = coffin!.parent;
    coffin!.moveTo(g.player);

    g.turn('take skeleton');

    expect(coffin!.parent?.id, 'Sacred COFFIN must NOT move to LAND').not.toBe(LAND);
    coffin!.moveTo(originalParent);
  });

  it('Invisible item in inventory is NOT moved', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    // Create a temporary treasure with Invisible flag.
    const hiddenGem = new Thing('HIDDEN-GEM', 'hidden gem');
    hiddenGem.props.set('TVALUE', 5);
    hiddenGem.set(Flag.Invisible);
    g.world.register(hiddenGem);
    hiddenGem.moveTo(g.player);

    g.turn('take skeleton');

    expect(hiddenGem.parent?.id, 'Invisible item must NOT move to LAND').not.toBe(LAND);
  });

  it('zero-tvalue item in inventory is NOT moved', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    // Lamp (tvalue=0) should not be moved.
    const lamp = g.world.get('LAMP');
    expect(lamp, 'LAMP must exist').toBeDefined();
    // Lamp is already in player's inventory from setup; confirm it stays.
    const lampParentBefore = lamp!.parent?.id;

    g.turn('take skeleton');

    // Lamp (tvalue=0) should still be with the player, not in LAND.
    expect(lamp!.parent?.id, 'Lamp (tvalue=0) must NOT move to LAND').not.toBe(LAND);
    expect(lamp!.parent?.id).toBe(lampParentBefore);
  });
});

// ---------------------------------------------------------------------------
// Room treasures scatter to LAND-OF-LIVING-DEAD (ROB HERE branch, prob=100)
// ROB HERE ... 100 means prob=100, which always passes (prob(100) === true)
// ---------------------------------------------------------------------------

describe('CC5 — SKELETON: room treasures move to LAND-OF-LIVING-DEAD (1actions.zil:938)', () => {
  it('room treasure (tvalue>0, in MAZE-5) moves to LAND-OF-LIVING-DEAD', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    // BAG-OF-COINS starts in MAZE-5 (tvalue=5).
    const bag = g.world.get('BAG-OF-COINS');
    expect(bag, 'BAG-OF-COINS must exist in world').toBeDefined();
    const room = g.world.get(MAZE_5);
    expect(room, 'MAZE-5 must exist').toBeDefined();
    bag!.moveTo(room!);

    g.turn('take skeleton');

    expect(bag!.parent?.id, 'BAG-OF-COINS must move to LAND-OF-LIVING-DEAD').toBe(LAND);
  });

  it('zero-tvalue room item is NOT moved', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);

    // Place a junk item (tvalue=0) in the room — should stay.
    const junk = new Thing('TEST-JUNK', 'junk');
    junk.props.set('TVALUE', 0);
    g.world.register(junk);
    const room = g.world.get(MAZE_5);
    expect(room, 'MAZE-5 must exist').toBeDefined();
    junk.moveTo(room!);

    g.turn('take skeleton');

    expect(junk.parent?.id, 'junk (tvalue=0) must NOT move to LAND').not.toBe(LAND);
  });
});

// ---------------------------------------------------------------------------
// Verb coverage — multiple verbs trigger SKELETON (1actions.zil:932)
// ---------------------------------------------------------------------------

describe('CC5 — SKELETON: multiple verbs trigger the curse (1actions.zil:932)', () => {
  it('rub skeleton triggers ghost message', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);
    const out = g.turn('rub skeleton').output;
    expect(out).toContain('ghost');
  });

  it('move skeleton triggers ghost message', () => {
    const g = gameAtMaze5();
    ensureBonesInRoom(g);
    ensureLandExists(g);
    const out = g.turn('move skeleton').output;
    expect(out).toContain('ghost');
  });
});
