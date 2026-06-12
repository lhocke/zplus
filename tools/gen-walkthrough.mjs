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

// Exact copy of COMMANDS from tests/golden/walkthrough-master.test.ts
const COMMANDS = [
  // ── West of House — opening ─────────────────────────────────────────────
  'look',
  'examine mailbox',
  'open mailbox',
  'take leaflet',
  'read leaflet',
  'close mailbox',
  'examine mailbox',
  'inventory',
  'score',
  'diagnose',
  // ── North of House ────────────────────────────────────────────────────────
  'north',
  'look',
  'examine house',
  'south',
  // ── East of House (Behind House) ─────────────────────────────────────────
  'west',
  'north',
  'east',
  'look',
  'examine window',
  'open window',
  'examine window',
  // ── South of House (quick visit) ─────────────────────────────────────────
  'south',
  'look',
  'examine house',
  'north',
  'east',
  // ── Enter Kitchen via open window ─────────────────────────────────────────
  'west',
  'look',
  'examine table',
  'examine bottle',
  'take bottle',
  'examine sandwich bag',
  'take sandwich bag',
  'examine chimney',
  'inventory',
  'drop bottle',
  'drop sandwich bag',
  // ── Attic (dark — lit→dark, no grue since Kitchen was lit) ───────────────
  'up',
  'look',
  'down',
  // ── Living Room ───────────────────────────────────────────────────────────
  'west',
  'look',
  'examine trophy case',
  'examine rug',
  'examine trap door',
  'examine sword',
  'examine door',
  'take sword',
  'west',
  'take lamp',
  'inventory',
  'score',
  // ── meta-verbs (no clock tick) ────────────────────────────────────────────
  'verbose',
  'brief',
  // ── easter eggs ───────────────────────────────────────────────────────────
  'xyzzy',
  'plugh',
  'frobozz',
  // ── error / edge cases ────────────────────────────────────────────────────
  'zorkify',
  'take',
  'frotz lamp',
  'examine',
  // ── chained multi-command turns ──────────────────────────────────────────
  'look. score',
  'inventory. diagnose',
  // ── underground descent ───────────────────────────────────────────────────
  'move rug',
  'open trap door',
  'turn on lamp',
  'look',
  'down',
  'look',
  'score',
  'examine ramp',
  // ── Troll Room ────────────────────────────────────────────────────────────
  'north',
  'look',
  'examine troll',
  'east',
  'west',
  'south',
  // ── East of Chasm + Gallery + Studio ─────────────────────────────────────
  'south',
  'look',
  'examine chasm',
  'east',
  'look',
  'examine painting',
  'take painting',
  'score',
  'inventory',
  'drop painting',
  'take painting',
  'north',
  'look',
  'examine studio',
  'south',
  'west',
  'examine east of chasm',
  'north',
  'look',
  'inventory',
  // ── Troll Room (second visit) ─────────────────────────────────────────────
  'north',
  'look',
  'south',
  // ── GRUE DEATH ────────────────────────────────────────────────────────────
  'turn off lamp',
  'look',
  'south',
  // ── Post-resurrection at FOREST-1 ─────────────────────────────────────────
  'look',
  'inventory',
  'diagnose',
  'score',
  'examine forest',
  // ── Forest Path ───────────────────────────────────────────────────────────
  'east',
  'look',
  'examine tree',
  'examine path',
  'up',
  'look',
  'examine view',
  'examine birds',
  'down',
  // ── Grating Clearing ──────────────────────────────────────────────────────
  'north',
  'look',
  'examine grate',
  'open grate',
  // ── Forest 1 ─────────────────────────────────────────────────────────────
  'south',
  'west',
  'look',
  'north',
  'south',
  // ── Forest 3 → South of House ─────────────────────────────────────────────
  'south',
  'look',
  'examine forest',
  'examine trees',
  'north',
  'look',
  'south',
  'nw',
  'look',
  'examine house',
  // ── East of House → Clearing ──────────────────────────────────────────────
  'east',
  'east',
  'look',
  'examine clearing',
  // ── Forest 2 + Mountains ──────────────────────────────────────────────────
  'north',
  'look',
  'east',
  'look',
  'examine mountain',
  'up',
  'west',
  'west',
  'north',
  'west',
  'east',
  'east',
  'south',
  // ── Canyon area ───────────────────────────────────────────────────────────
  'east',
  'look',
  'examine canyon',
  'examine river',
  'examine view',
  'south',
  'down',
  'look',
  'examine cliff',
  'examine falls',
  'down',
  'look',
  'up',
  'down',
  'north',
  'look',
  'examine rainbow',
  'examine beach',
  'examine falls',
  'ne',
  'look',
  'east',
  'look',
  'west',
  'west',
  'sw',
  'up',
  'up',
  'nw',
  // ── Return to house ───────────────────────────────────────────────────────
  'west',
  'south',
  'look',
  'west',
  'look',
  'east',
  'north',
  'east',
  'look',
  'west',
  'look',
  'examine sandwich bag',
  'east',
  'west',
  'west',
  // ── Trophy case deposit + scoring ─────────────────────────────────────────
  'open trap door',
  'open trophy case',
  'put painting in trophy case',
  'score',
  'examine trophy case',
  'diagnose',
  'look',
  // ── More Living Room verbs ────────────────────────────────────────────────
  'close trophy case',
  'open trophy case',
  'take painting',
  'drop painting',
  'put painting in trophy case',
  'score',
  // ── Lamp off / dark in Living Room ───────────────────────────────────────
  'turn off lamp',
  'look',
  'turn on lamp',
  'look',
  // ── Chained commands ─────────────────────────────────────────────────────
  'look. score. inventory',
  // ── Final stats ──────────────────────────────────────────────────────────
  'score',
  'diagnose',
  'inventory',
];

resetActionState();
const output = runEngine(COMMANDS, { seed: 42 });
const outPath = join(dirname(fileURLToPath(import.meta.url)), '../tests/golden/walkthrough-master.txt');
writeFileSync(outPath, output, 'utf8');
process.stderr.write('Written to: ' + outPath + '\n');
process.stderr.write('Lines: ' + output.split('\n').length + '\n');
