import type { ObjectId, Dir } from '../domain/game-object.js';

// --------------------------------------------------------------------------
// Public types — frozen contracts from the implementation plan.
// Game class and its dependencies (World, Rng, Clock, EventEmitter) will be
// filled in during Task 2.7.  The interfaces are declared here now so that
// downstream consumers (UI, assist, and tests) can import them without
// waiting for the full implementation.
// --------------------------------------------------------------------------

export interface TurnResult {
  readonly output: string;
  readonly moved: boolean;
}

/**
 * Read-only snapshot of game state for the UI and assist layers.
 * This shape is frozen — any additions require amending the contract section
 * of the implementation plan first.
 */
export interface GameView {
  readonly here: ObjectId;
  readonly hereName: string;
  readonly exits: ReadonlyArray<{ dir: Dir; known: boolean; to?: ObjectId }>;
  readonly visibleObjects: ReadonlyArray<{ id: ObjectId; name: string }>;
  readonly score: number;
  readonly maxScore: number;
  readonly moves: number;
  readonly inMaze: boolean;
}
