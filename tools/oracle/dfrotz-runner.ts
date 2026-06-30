/**
 * dfrotz-runner.ts
 *
 * Executes dfrotz on the Zork I story file with a given command sequence and
 * captures the raw transcript.
 *
 * dfrotz invocation pattern:
 *   printf '<cmds>\nquit\ny\n' | dfrotz -p -w <wide> <story>
 *
 * dfrotz is run at a deliberately wide column width so it never word-wraps:
 * every newline it emits is then a genuine game newline, giving the normalizer
 * real paragraph structure to compare against the (never-wrapping) engine
 * rather than guessing wraps from line length.
 *
 * The story file path is resolved from env ZORK_STORY, defaulting to the
 * Zork I story file bundled in-repo at tools/oracle/zork1.z3 (the MIT-licensed
 * Microsoft 2025 release — see CREDITS.md). No absolute path is baked in.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STORY_PATH =
  process.env['ZORK_STORY'] ??
  fileURLToPath(new URL('./zork1.z3', import.meta.url));

// Run dfrotz far wider than any real game line so it never width-wraps — every
// newline is then a genuine game newline, and the normalizer compares real
// structure instead of un-guessing column-80 wraps.
const WIDE_OUTPUT_WIDTH = 1000;

export interface DfrotzRunOptions {
  /**
   * Path to the story file.  Defaults to DEFAULT_STORY_PATH.
   */
  storyPath?: string;
  /**
   * Column width passed to dfrotz (-w).  Defaults to WIDE_OUTPUT_WIDTH so dfrotz
   * never width-wraps and its line breaks are real game structure.
   */
  width?: number;
  /**
   * Timeout for the dfrotz process in milliseconds.  Defaults to 15000.
   */
  timeoutMs?: number;
  /**
   * RNG seed to pass via dfrotz -s.  When provided, dfrotz uses a seeded LCG
   * so runs are reproducible.  Omit (or pass undefined) for the default
   * entropy-seeded behaviour.
   */
  seed?: number;
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
  const width = opts.width ?? WIDE_OUTPUT_WIDTH;
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
  const args = ['-p', '-w', String(width)];
  if (opts.seed !== undefined) args.push('-s', String(opts.seed));
  args.push(storyPath);

  const result = spawnSync(
    'dfrotz',
    args,
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
