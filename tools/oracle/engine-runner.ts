/**
 * engine-runner.ts
 *
 * Executes our TypeScript engine (createGame) with a given command sequence
 * and captures a transcript in the same turn-by-turn format used by dfrotz,
 * so the normalizer can process both transcripts uniformly.
 */

import type { Game } from '../../src/engine/game.js';
import { createGame } from '../../src/engine/bootstrap.js';

export interface EngineRunOptions {
  /**
   * RNG seed for the game.  Defaults to 42 (same as bootstrap default) so
   * runs are deterministic.
   */
  seed?: number;
  /**
   * Override the starting room (default: WEST-OF-HOUSE).
   * Useful for targeted corpus fixtures that don't need the full navigation.
   */
  startRoom?: string;
  /**
   * Called after game.start() fires and before any commands run.
   * Use to inject initial state: WON-FLAG, inventory items, etc.
   */
  setup?: (game: Game) => void;
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
  const game = createGame({
    seed: opts.seed ?? 42,
    startRoom: opts.startRoom as string | undefined,
  });

  const lines: string[] = [];

  // The intro + initial room description
  lines.push(game.start());

  opts.setup?.(game);

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
