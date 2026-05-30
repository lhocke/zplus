#!/usr/bin/env tsx
/**
 * run-corpus.ts
 *
 * CLI entry point for running a corpus file through the oracle harness.
 *
 * Usage:
 *   npx tsx tools/oracle/run-corpus.ts tools/oracle/corpus/opening-walkthrough.txt
 *   # or via npm script:
 *   npm run oracle -- tools/oracle/corpus/opening-walkthrough.txt
 *
 * If no file is provided, defaults to opening-walkthrough.txt.
 *
 * Corpus file format: one command per line; blank lines and lines starting
 * with '#' are ignored.
 *
 * Exit codes:
 *   0 — all turns matched exactly
 *   1 — one or more divergences (or error)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDfrotz } from './dfrotz-runner.js';
import { runEngine } from './engine-runner.js';
import { normalizeDfrotz, normalizeEngine } from './normalizer.js';
import { compareTurns, formatReport } from './comparator.js';

const DEFAULT_CORPUS = new URL('corpus/opening-walkthrough.txt', import.meta.url).pathname;

function loadCorpus(filePath: string): string[] {
  if (!existsSync(filePath)) {
    throw new Error(`Corpus file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const corpusPath = arg !== undefined ? resolve(arg) : DEFAULT_CORPUS;

  console.log(`Oracle harness: loading corpus from ${corpusPath}`);

  const commands = loadCorpus(corpusPath);
  console.log(`Running ${commands.length} commands...\n`);

  let dfrotzRaw: string;
  let engineRaw: string;

  try {
    dfrotzRaw = runDfrotz(commands);
  } catch (err) {
    console.error('dfrotz runner failed:', err);
    process.exit(1);
  }

  try {
    engineRaw = runEngine(commands);
  } catch (err) {
    console.error('engine runner failed:', err);
    process.exit(1);
  }

  const dfrotzTurns = normalizeDfrotz(dfrotzRaw);
  const engineTurns = normalizeEngine(engineRaw);

  const report = compareTurns(dfrotzTurns, engineTurns);
  console.log(formatReport(report));

  process.exit(report.divergences === 0 && report.dfrotzExtra === 0 && report.engineExtra === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
