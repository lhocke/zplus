/**
 * dfrotz-runner.ts
 *
 * Executes dfrotz on the Zork I story file with a given command sequence and
 * captures the raw transcript.
 *
 * dfrotz invocation pattern:
 *   printf '<cmds>\nquit\ny\n' | dfrotz -p -w 80 <story>
 *
 * The story file path is resolved from env ZORK_STORY, defaulting to
 * /Users/lhocke/Code/zork-oracle-prep/zork1.z3.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const DEFAULT_STORY_PATH =
  process.env['ZORK_STORY'] ??
  '/Users/lhocke/Code/zork-oracle-prep/zork1.z3';

export interface DfrotzRunOptions {
  /**
   * Path to the story file.  Defaults to DEFAULT_STORY_PATH.
   */
  storyPath?: string;
  /**
   * Max line width for dfrotz output.  Defaults to 80.
   */
  width?: number;
  /**
   * Timeout for the dfrotz process in milliseconds.  Defaults to 15000.
   */
  timeoutMs?: number;
}

/**
 * Run dfrotz with the given newline-separated commands and return the raw
 * transcript (including the status bar lines, loading text, etc.).
 *
 * Uses spawnSync with an argument array (no shell) to avoid command-injection
 * risks.  stdin is passed directly as a Buffer.
 *
 * @param commands - array of command strings (e.g. ["open mailbox", "north"])
 * @returns raw stdout from dfrotz
 */
export function runDfrotz(
  commands: readonly string[],
  opts: DfrotzRunOptions = {},
): string {
  const storyPath = opts.storyPath ?? DEFAULT_STORY_PATH;
  const width = opts.width ?? 80;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  if (!existsSync(storyPath)) {
    throw new Error(
      `dfrotz-runner: story file not found: "${storyPath}"\n` +
        'Set the ZORK_STORY environment variable to the correct path.',
    );
  }

  // Build the stdin payload: each command on its own line, then quit + confirm.
  const stdinPayload = [...commands, 'quit', 'y'].join('\n') + '\n';

  // spawnSync with an explicit argument array — no shell involved, so no
  // command-injection surface even if command strings contain shell chars.
  const result = spawnSync(
    'dfrotz',
    ['-p', '-w', String(width), storyPath],
    {
      input: stdinPayload,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024, // 4 MB should be ample
    },
  );

  if (result.error !== undefined) {
    throw new Error(`dfrotz-runner: failed to spawn dfrotz: ${result.error.message}`);
  }

  // dfrotz may exit non-zero on a clean quit; treat stdout as valid either way.
  return result.stdout ?? '';
}
