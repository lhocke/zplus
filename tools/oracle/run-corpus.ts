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
 * Exit codes:
 *   0 — all corpus files: all turns matched exactly
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

function loadCorpus(filePath: string): string[] {
  if (!existsSync(filePath)) {
    throw new Error(`Corpus file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
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

  const commands = loadCorpus(corpusPath);
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
    engineRaw = runEngine(commands, { seed });
  } catch (err) {
    console.error('engine runner failed:', err);
    return false;
  }

  const dfrotzTurns = normalizeDfrotz(dfrotzRaw);
  const engineTurns = normalizeEngine(engineRaw);

  const report = compareTurns(dfrotzTurns, engineTurns);
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
