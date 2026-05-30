/**
 * newGameAt — test helper for Phase 3 per-room action tests.
 *
 * Returns a bootstrapped Game with the player placed in the given room.
 * Used in the Phase 3 worked exemplar (maze-cyclops.test.ts) and any other
 * handler test that needs a specific starting location.
 */

import type { ObjectId } from '../../src/domain/game-object.js';
import type { Game } from '../../src/engine/game.js';
import { createGame } from '../../src/engine/bootstrap.js';

export function newGameAt(roomId: ObjectId): Game {
  return createGame({ startRoom: roomId });
}
