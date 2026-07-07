#!/usr/bin/env tsx
/**
 * run-corpus.ts
 *
 * CLI entry point for running one or more corpus files through the oracle
 * harness (dfrotz vs engine) and reporting divergences.
 *
 * Usage:
 *   npx tsx tools/oracle/run-corpus.ts [file ...]
 *   # or via npm script:
 *   npm run oracle -- tools/oracle/corpus/opening-walkthrough.txt
 *
 * If no file arguments are given, all *.txt files in the corpus directory
 * are processed in alphabetical order.
 *
 * Corpus file format: one command per line; blank lines and lines starting
 * with '#' are ignored.  A header comment of the form:
 *
 *   # Run with: dfrotz -s <N> /path/to/zork1.z3
 *
 * causes dfrotz to be invoked with seed N (-s N) for a deterministic run
 * (e.g. deterministic troll fight with -s 1).  When absent, dfrotz is run
 * without a seed (default entropy).
 *
 * The engine is always run with seed 42 (its deterministic default).
 *
 * Corpus annotation syntax
 * ------------------------
 * Lines NOT starting with '#' are commands (sent to both dfrotz and engine).
 *
 * Two optional annotations may appear in the corpus:
 *
 *   ~<CMD>         — The tilde prefix marks a command as RNG-variable.  For
 *                    that turn the harness compares only structural landmarks
 *                    (room line, Score/Moves, "killed"/"died"/"scored") rather
 *                    than exact text.  Use on combat turns where dfrotz and the
 *                    engine use different RNGs and may produce different
 *                    fight-text.
 *
 *   @resync <PAT>  — After a block of RNG-variable turns, insert this directive
 *                    to re-anchor the two transcripts.  The harness advances
 *                    both dfrotz and engine turn arrays until it finds a turn
 *                    whose text contains <PAT> (case-insensitive), then resumes
 *                    strict comparison from that point.  Turns skipped during
 *                    re-sync are reported as "skipped (resync)" in the output
 *                    but do NOT count as divergences.
 *
 * Exit codes:
 *   0 — all corpus files: all turns matched exactly (or via structural match)
 *   1 — one or more divergences (or error)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runDfrotz } from './dfrotz-runner.js';
import { runEngine } from './engine-runner.js';
import { normalizeDfrotz, normalizeEngine } from './normalizer.js';
import { compareTurns, formatReport } from './comparator.js';

const CORPUS_DIR = new URL('corpus/', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single corpus entry: a command to run plus optional metadata. */
export interface CorpusEntry {
  /** The raw command text sent to dfrotz and engine. */
  command: string;
  /**
   * If true, this turn's comparison uses structural-landmark matching only
   * (room line, score/moves, kill/death keywords) rather than exact text.
   * Set by the `~` prefix in the corpus file.
   */
  rngVariable: boolean;
}

/** A special re-sync directive: advance both transcripts until <pattern> matches. */
export interface ResyncDirective {
  kind: 'resync';
  pattern: string;
}

/** A parsed corpus item is either a command entry or a resync directive. */
export type CorpusItem = CorpusEntry | ResyncDirective;

// ---------------------------------------------------------------------------
// Seed extraction
// ---------------------------------------------------------------------------

/**
 * Scan the raw comment header of a corpus file for a seed directive:
 *   # Run with: dfrotz -s <N> ...
 * Returns the seed as a number, or undefined if none is found.
 *
 * Exported for testing.
 */
export function extractSeedFromHeader(raw: string): number | undefined {
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) break; // stop at first non-comment line
    // Match either inline: "# Run with: dfrotz -s 1 ..."
    // or indented next line: "#   dfrotz -s 1 ..."
    const m = trimmed.match(/dfrotz\s+(?:.*?\s)?-s\s+(\d+)/);
    if (m !== null) return Number(m[1]);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

/**
 * Load a corpus file and return a sequence of CorpusItems (commands +
 * optional resync directives).
 *
 * Parsing rules:
 *   - Blank lines and lines starting with '#' are ignored.
 *   - Lines starting with '@resync ' produce a ResyncDirective.
 *   - Lines starting with '~' produce a CorpusEntry with rngVariable=true;
 *     the '~' prefix is stripped from the command text.
 *   - All other lines produce a CorpusEntry with rngVariable=false.
 */
export function loadCorpusItems(filePath: string): CorpusItem[] {
  if (!existsSync(filePath)) {
    throw new Error(`Corpus file not found: ${filePath}`);
  }
  const items: CorpusItem[] = [];
  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    if (line.startsWith('@resync ')) {
      const pattern = line.slice('@resync '.length).trim();
      items.push({ kind: 'resync', pattern });
    } else if (line.startsWith('~')) {
      items.push({ command: line.slice(1).trim(), rngVariable: true });
    } else {
      items.push({ command: line, rngVariable: false });
    }
  }
  return items;
}

/**
 * Extract the plain command list from a CorpusItems array (for passing to
 * dfrotz/engine runners which only accept string[]).
 */
export function extractCommands(items: CorpusItem[]): string[] {
  return items
    .filter((i): i is CorpusEntry => !('kind' in i))
    .map((i) => i.command);
}

function corpusFiles(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => join(CORPUS_DIR, f));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runFile(corpusPath: string): Promise<boolean> {
  console.log(`\n=== Corpus: ${corpusPath} ===\n`);

  const raw = existsSync(corpusPath) ? readFileSync(corpusPath, 'utf8') : '';
  const seed = extractSeedFromHeader(raw);
  if (seed !== undefined) {
    console.log(`  seed: dfrotz -s ${seed} (from corpus header)`);
  }

  const items = loadCorpusItems(corpusPath);
  const commands = extractCommands(items);
  console.log(`  commands: ${commands.length}\n`);

  let dfrotzRaw: string;
  let engineRaw: string;

  try {
    dfrotzRaw = runDfrotz(commands, { seed });
  } catch (err) {
    console.error('dfrotz runner failed:', err);
    return false;
  }

  try {
    // Use the same seed as dfrotz (from corpus header) so RNG-driven combat
    // and other per-turn randomness aligns between the two runs.
    engineRaw = await runEngine(commands, { seed });
  } catch (err) {
    console.error('engine runner failed:', err);
    return false;
  }

  const dfrotzTurns = normalizeDfrotz(dfrotzRaw);
  const engineTurns = normalizeEngine(engineRaw);

  const report = compareTurns(dfrotzTurns, engineTurns, items);
  console.log(formatReport(report));

  return report.divergences === 0 && report.dfrotzExtra === 0 && report.engineExtra === 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.length > 0
    ? args.map((a) => resolve(a))
    : corpusFiles();

  console.log(`Oracle harness: processing ${files.length} corpus file(s)`);

  let allPassed = true;
  for (const f of files) {
    const ok = await runFile(f);
    if (!ok) allPassed = false;
  }

  process.exit(allPassed ? 0 : 1);
}

// Only run when invoked directly as a script (not when imported by tests).
const isMain = process.argv[1]?.endsWith('run-corpus.ts') ||
               process.argv[1]?.endsWith('run-corpus.js');

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
