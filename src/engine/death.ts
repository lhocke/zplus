// death.ts — JIGS-UP machinery and its dependents.
//
// RANDOMIZE-OBJECTS (SD2) and KILL-INTERRUPTS (SD3) live here.
// The full JIGS-UP lift (DT1) will fold game.ts:608–640 in when that task lands.
//
// RANDOMIZE-OBJECTS — 1actions.zil:4101–4123
// KILL-INTERRUPTS   — 1actions.zil:4125–4135

import type { World } from '../domain/world.js';
import type { Actor } from '../domain/actor.js';
import type { GameObject } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import type { Rng } from './rng.js';
import type { Clock } from './clock.js';

// 1dungeon.zil:2630–2633 — the 11 above-ground rooms the ZIL ABOVE-GROUND LTABLE holds.
const ABOVE_GROUND: readonly string[] = [
  'WEST-OF-HOUSE', 'NORTH-OF-HOUSE', 'EAST-OF-HOUSE', 'SOUTH-OF-HOUSE',
  'FOREST-1', 'FOREST-2', 'FOREST-3', 'PATH', 'CLEARING',
  'GRATING-CLEARING', 'CANYON-VIEW',
];

/**
 * Scatter the player's inventory on death — 1actions.zil:4101–4123.
 *
 * LAMP→LIVING-ROOM, COFFIN→EGYPT-ROOM, SWORD.TVALUE=0, then for each
 * carried item: if TVALUE>0 walk the ROOMS chain for a RLANDBIT&&!ONBIT
 * room at 50% prob; else drop in a random ABOVE_GROUND room.
 *
 * The underground walk replicates the ZIL REPEAT loop that cycles through
 * <FIRST? ROOMS> ... <NEXT? .R>, accepting each candidate at PROB 50.
 * Because the compiled room-chain order is unrecoverable from ZIL source,
 * tests assert structure (valid room type, left inventory) not exact rooms.
 */
export function randomizeObjects(world: World, player: Actor, rng: Rng): void {
  // Snapshot inventory before moving anything — mirrors ZIL <SET N <FIRST? WINNER>>.
  const items = Array.from(player.children);

  // Special relocations first (before the general loop, matching ZIL order).
  const lamp = world.get('LAMP');
  if (lamp !== undefined && lamp.parent === player) {
    const lr = world.get('LIVING-ROOM');
    if (lr !== undefined) lamp.moveTo(lr);
  }

  const coffin = world.get('COFFIN');
  if (coffin !== undefined && coffin.parent === player) {
    const egypt = world.get('EGYPT-ROOM');
    if (egypt !== undefined) coffin.moveTo(egypt);
  }

  // SWORD.TVALUE = 0 unconditionally — 1actions.zil:4106.
  const sword = world.get('SWORD');
  if (sword !== undefined) sword.props.set('TVALUE', 0);

  // Build the underground room list once — rooms with RLANDBIT && !ONBIT.
  // This mirrors the ZIL ROOMS chain walked by NEXT?.
  const underground: GameObject[] = world.all().filter(
    (o) => o.has(Flag.Land) && !o.has(Flag.On),
  );

  // Above-ground room objects resolved once.
  const aboveGround: Array<GameObject | undefined> = ABOVE_GROUND.map((id) => world.get(id));
  const aboveGroundResolved = aboveGround.filter((r): r is NonNullable<typeof r> => r !== undefined);

  for (const item of items) {
    // Skip LAMP and COFFIN — already handled above.
    if (item === lamp || item === coffin) continue;

    const tvalue = item.props.get('TVALUE');
    const isTreasure = typeof tvalue === 'number' && tvalue > 0;

    if (isTreasure && underground.length > 0) {
      // Walk the underground list cycling until a 50% PROB hit.
      // ZIL: <COND (<NOT .R> <SET R <FIRST? ROOMS>>)> — start from beginning each cycle.
      let placed = false;
      // Safety limit: cycle the list a bounded number of times to avoid an infinite
      // loop if every room happens to be rejected. 10 passes is generous.
      for (let pass = 0; pass < 10 && !placed; pass++) {
        for (const room of underground) {
          if (rng.prob(50)) {
            item.moveTo(room);
            placed = true;
            break;
          }
        }
      }
      // Fallback: drop in first underground room if prob never hit (degenerate case).
      if (!placed) item.moveTo(underground[0]!);
    } else {
      // Non-treasure: move to a random ABOVE_GROUND room.
      // ZIL: <RANDOM .L> where L = <GET ABOVE-GROUND 0> = 11 (the LTABLE length word).
      const dest = aboveGroundResolved[rng.nextInt(aboveGroundResolved.length)];
      if (dest !== undefined) item.moveTo(dest);
    }
  }
}

// The full ZIL slot list from 1actions.zil:4126–4133.
// Registered today: I-LANTERN, I-CANDLES, I-MATCH.
// Unregistered (no-ops this phase): I-XB, I-XC, I-CYCLOPS, I-SWORD, I-FOREST-ROOM.
const INTERRUPT_IDS = [
  'I-XB', 'I-XC', 'I-CYCLOPS',
  'I-LANTERN', 'I-CANDLES', 'I-SWORD',
  'I-FOREST-ROOM', 'I-MATCH',
] as const;

/**
 * KILL-INTERRUPTS — 1actions.zil:4125–4135.
 *
 * Disables every registered slot in the 8-slot list and clears MATCH ONBIT.
 * Safe no-op for any id that is not registered in the clock.
 */
export function killInterrupts(clock: Clock, world: World): void {
  clock.killAll([...INTERRUPT_IDS]);
  const match = world.get('MATCH');
  if (match !== undefined) match.clear(Flag.OnFire);
}
