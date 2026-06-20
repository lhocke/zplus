/**
 * gen-walkthrough.mjs — generates walkthrough-master.txt output for re-baseline.
 * Run with: npx tsx tools/gen-walkthrough.mjs (from repo root)
 * Writes directly to tests/golden/walkthrough-master.txt.
 *
 * Commands are the exact list from tests/golden/walkthrough-master.test.ts.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Work from the tools/ directory; imports are relative to it.
const { runEngine } = await import('./oracle/engine-runner.js');
const { resetKitchenWindowFlag, resetRugMoved, resetGrateRevealed, resetGrunlock, resetSingSong } =
  await import('../src/actions/above-ground.js');
const { resetMatchCount } = await import('../src/actions/light-sources.js');

function resetActionState() {
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
}

// Command sequence — imported from the shared source to avoid drift.
const { GOLDEN_COMMANDS } = await import('./oracle/golden-commands.js');
const COMMANDS = GOLDEN_COMMANDS;

resetActionState();
const output = runEngine(COMMANDS, { seed: 42 });
const outPath = join(dirname(fileURLToPath(import.meta.url)), '../tests/golden/walkthrough-master.txt');

// Prepend the provenance header (L41). The golden's BYTES are engine output (the
// engine's own seed-42 transcript), DGC-anchored to dfrotz-r119: every deterministic
// line is verified against dfrotz, seed-42 RNG lines are exempt (spec §8). The honest
// generator label is `engine`; the dfrotz anchoring is asserted by
// golden-rebaseline-audit.ts (Check 2 + Check 5), not claimed by the header.
const today = new Date().toISOString().slice(0, 10);
const header = `# generated-by: engine ${today} walkthrough-master (DGC-anchored to dfrotz-r119; seed-42 RNG lines engine-determinism-exempt per §8)\n`;
writeFileSync(outPath, header + output, 'utf8');
process.stderr.write('Written to: ' + outPath + '\n');
process.stderr.write('Lines: ' + (output.split('\n').length + 1) + ' (including provenance header)\n');
