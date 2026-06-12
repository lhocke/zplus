/**
 * engine-runner.ts
 *
 * Executes our TypeScript engine (createGame) with a given command sequence
 * and captures a transcript in the same turn-by-turn format used by dfrotz,
 * so the normalizer can process both transcripts uniformly.
 */

import { createGame } from '../../src/engine/bootstrap.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';

export interface EngineRunOptions {
  /**
   * RNG seed for the game.  Defaults to 42 (same as bootstrap default) so
   * runs are deterministic.
   */
  seed?: number;
}

/**
 * Run our engine with the given commands and return a raw transcript string.
 *
 * The transcript format mirrors dfrotz plain output:
 *   - First block: the intro banner (game.start())
 *   - For each command: a "> <cmd>" prompt line, then the turn output
 *
 * @param commands - array of command strings
 * @returns multi-line transcript string
 */
export function runEngine(
  commands: readonly string[],
  opts: EngineRunOptions = {},
): string {
  // Reset module-level ZIL globals so each corpus run starts clean — mirrors
  // the reset list in src/shell/session.ts (§2 C1).
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();

  const game = createGame({ seed: opts.seed ?? 42 });

  const lines: string[] = [];

  // The intro + initial room description
  lines.push(game.start());

  for (const cmd of commands) {
    lines.push('');
    lines.push(`> ${cmd}`);
    const result = game.turn(cmd);
    if (result.output.length > 0) {
      lines.push(result.output);
    }
  }

  return lines.join('\n');
}
