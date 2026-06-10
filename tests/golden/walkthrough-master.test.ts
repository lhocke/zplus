import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine } from '../../tools/oracle/engine-runner.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';

// Reset all module-level action globals so each runEngine() call starts clean.
// These mirror ZIL GLOBAL variables that persist across game sessions in tests.
function resetActionState(): void {
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
}

const GOLDEN_PATH = join(import.meta.dirname, 'walkthrough-master.txt');

// Wide scripted walkthrough — seed 42, ~200 commands.
//
// Verified room sequence (tested against the live engine):
//   Start: WEST-OF-HOUSE
//   north → NORTH-OF-HOUSE → east → EAST-OF-HOUSE (Behind House)
//   [open window] → west → KITCHEN → up → ATTIC → down → KITCHEN
//   → west → LIVING-ROOM
//   [take lamp, move rug, open trap door, turn on lamp, down] → CELLAR
//   north → TROLL-ROOM → south → CELLAR
//   south → EAST-OF-CHASM → east → GALLERY → north → STUDIO
//   south → GALLERY → west → EAST-OF-CHASM → north → CELLAR
//   north → TROLL-ROOM → south → CELLAR
//   [turn off lamp] → south → *** GRUE (seed 42 rng#1=0.601) *** → FOREST-1
//   east → PATH → north → GRATING-CLEARING → south → PATH → west → FOREST-1
//   south → FOREST-3 → nw → SOUTH-OF-HOUSE → east → EAST-OF-HOUSE
//   east → CLEARING → north → FOREST-2 → east → MOUNTAINS → west → FOREST-2
//   west → PATH → north → GRATING-CLEARING → west → FOREST-1
//   east → GRATING-CLEARING → east → FOREST-2 → south → CLEARING
//   east → CANYON-VIEW → down → CLIFF-MIDDLE → down → CANYON-BOTTOM
//   north → END-OF-RAINBOW → sw → CANYON-BOTTOM → up → CLIFF-MIDDLE → up → CANYON-VIEW
//   nw → CLEARING → west → EAST-OF-HOUSE → south → SOUTH-OF-HOUSE → west → WEST-OF-HOUSE
//   north → NORTH-OF-HOUSE → east → EAST-OF-HOUSE → west → KITCHEN → west → LIVING-ROOM
//   [open trap door, open trophy case, put painting in trophy case]
//
// Covers:
//   - All reachable above-ground rooms (13 rooms)
//   - House interior: Kitchen, Attic (dark), Living Room
//   - Underground: Cellar, Troll Room, East-of-Chasm, Gallery, Studio (5 rooms)
//   - look/examine across rooms and objects (mailbox, window, table, bottle,
//     chimney, trophy case, rug, trap door, sword, door, troll, painting,
//     canyon, river, mountain, cliff, rainbow, grate, tree)
//   - take/drop/inventory/read (leaflet, lamp, bottle, painting)
//   - open/close (mailbox, window, trap door, trophy case)
//   - lamp on/off + dark-room pitch-black (Attic, Living Room, Cellar pre-grue)
//   - GRUE DEATH + RESURRECTION: lamp off in CELLAR, south to EAST-OF-CHASM.
//     Seed 42, rng.next() call #1 = 0.601 < 0.80 → grue fires. Resurrects at FOREST-1.
//     lamp + painting scattered on death (RANDOMIZE-OBJECTS)
//   - flag-gated blocked exits: troll (TROLL-ROOM east/west), nailed door
//     (Living Room west), boarded windows (North/South of House), locked grate
//   - scoring: TAKE painting (VALUE=4); room first-visit points; trophy-case
//     deposit (TVALUE=6); score/diagnose at multiple checkpoints
//   - meta-verbs: score, verbose, brief, diagnose (no clock-tick)
//   - chained multi-command turns via "." separator
//   - easter eggs: xyzzy, plugh, frobozz
//   - error/edge cases: unknown word, unknown verb, bare take, bare examine,
//     boarded front door (East from West-of-House), blocked exits
//
// NOT covered (not built or gated by troll):
//   - MAZE-1+ (troll blocks the only unlocked path at TROLL-ROOM west)
//   - Combat system (not implemented)
//   - Items/rooms past Troll Room (EW-PASSAGE, deeper dungeon)
//   - Dam/river/boat area (no navigable path from starting rooms)
//   - Candles/South Temple (no path built from start)
const COMMANDS: readonly string[] = [
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
  'north',                  // WEST-OF-HOUSE → North of House
  'look',
  'examine house',
  'south',                  // blocked: windows boarded
  // ── East of House (Behind House) ─────────────────────────────────────────
  'west',                   // → West of House
  'north',                  // → North of House
  'east',                   // → East of House (Behind House)
  'look',
  'examine window',
  'open window',            // opens the kitchen window
  'examine window',
  // ── South of House (quick visit) ─────────────────────────────────────────
  'south',                  // East of House → South of House
  'look',
  'examine house',
  'north',                  // blocked: windows boarded
  'east',                   // South of House → East of House
  // ── Enter Kitchen via open window ─────────────────────────────────────────
  'west',                   // East of House → Kitchen
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
  'up',                     // Kitchen → Attic (dark)
  'look',                   // pitch-black
  'down',                   // → Kitchen
  // ── Living Room ───────────────────────────────────────────────────────────
  'west',                   // Kitchen → Living Room
  'look',
  'examine trophy case',
  'examine rug',
  'examine trap door',
  'examine sword',
  'examine door',
  'take sword',             // sword is scenery / not takeable
  'west',                   // blocked: nailed shut
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
  'zorkify',                // unknown word
  'take',                   // bare take — no object
  'frotz lamp',             // unknown verb
  'examine',                // bare examine — no object
  // ── chained multi-command turns ──────────────────────────────────────────
  'look. score',
  'inventory. diagnose',
  // ── underground descent ───────────────────────────────────────────────────
  'move rug',
  'open trap door',
  'turn on lamp',
  'look',
  'down',                   // Living Room → Cellar (lamp lit, trap door open)
  'look',
  'score',
  'examine ramp',
  // ── Troll Room ────────────────────────────────────────────────────────────
  'north',                  // Cellar → Troll Room
  'look',
  'examine troll',
  'east',                   // blocked: troll fends you off
  'west',                   // blocked: troll fends you off
  'south',                  // → Cellar
  // ── East of Chasm + Gallery + Studio ─────────────────────────────────────
  'south',                  // Cellar → East of Chasm
  'look',
  'examine chasm',
  'east',                   // East of Chasm → Gallery
  'look',
  'examine painting',
  'take painting',          // VALUE=4 scored
  'score',
  'inventory',
  'drop painting',
  'take painting',
  'north',                  // Gallery → Studio
  'look',
  'examine studio',
  'south',                  // → Gallery
  'west',                   // Gallery → East of Chasm
  'examine east of chasm',
  'north',                  // East of Chasm → Cellar
  'look',
  'inventory',
  // ── Troll Room (second visit) ─────────────────────────────────────────────
  'north',                  // Cellar → Troll Room
  'look',
  'south',                  // → Cellar
  // ── GRUE DEATH ────────────────────────────────────────────────────────────
  'turn off lamp',          // lamp off: Cellar is now dark
  'look',                   // pitch-black in Cellar
  'south',                  // CELLAR(dark) → EAST-OF-CHASM(dark) → GRUE → FOREST-1
  // ── Post-resurrection at FOREST-1 ─────────────────────────────────────────
  'look',
  'inventory',              // lamp + painting scattered on death (RANDOMIZE-OBJECTS)
  'diagnose',               // reports "killed once"
  'score',
  'examine forest',
  // ── Forest Path ───────────────────────────────────────────────────────────
  'east',                   // Forest 1 → Forest Path
  'look',
  'examine tree',
  'examine path',
  'up',                     // Forest Path → Up a Tree
  'look',
  'examine view',
  'examine birds',
  'down',                   // → Forest Path
  // ── Grating Clearing ──────────────────────────────────────────────────────
  'north',                  // Forest Path → Grating Clearing
  'look',
  'examine grate',
  'open grate',             // locked: The grating is locked.
  // ── Forest 1 ─────────────────────────────────────────────────────────────
  'south',                  // Grating Clearing → Forest Path
  'west',                   // Forest Path → Forest 1
  'look',
  'north',                  // Forest 1 → Grating Clearing
  'south',                  // → Forest 1
  // ── Forest 3 → South of House ─────────────────────────────────────────────
  'south',                  // Forest 1 → Forest 3
  'look',
  'examine forest',
  'examine trees',
  'north',                  // Forest 3 → Clearing (north exit)
  'look',
  'south',                  // Clearing → Forest 3
  'nw',                     // Forest 3 → South of House
  'look',
  'examine house',
  // ── East of House → Clearing ──────────────────────────────────────────────
  'east',                   // South of House → East of House
  'east',                   // East of House → Clearing
  'look',
  'examine clearing',
  // ── Forest 2 + Mountains ──────────────────────────────────────────────────
  'north',                  // Clearing → Forest 2
  'look',
  'east',                   // Forest 2 → Mountains
  'look',
  'examine mountain',
  'up',                     // blocked: impassable
  'west',                   // Mountains → Forest 2
  'west',                   // Forest 2 → Forest Path
  'north',                  // Forest Path → Grating Clearing
  'west',                   // Grating Clearing → Forest 1
  'east',                   // Forest 1 → Grating Clearing
  'east',                   // Grating Clearing → Forest 2
  'south',                  // Forest 2 → Clearing
  // ── Canyon area ───────────────────────────────────────────────────────────
  'east',                   // Clearing → Canyon View
  'look',
  'examine canyon',
  'examine river',
  'examine view',
  'south',                  // blocked: storm-tossed trees
  'down',                   // Canyon View → Rocky Ledge (CLIFF-MIDDLE)
  'look',
  'examine cliff',
  'examine falls',
  'down',                   // Rocky Ledge → Canyon Bottom
  'look',
  'up',                     // Canyon Bottom → Rocky Ledge
  'down',                   // Rocky Ledge → Canyon Bottom
  'north',                  // Canyon Bottom → End of Rainbow
  'look',
  'examine rainbow',
  'examine beach',
  'examine falls',
  'ne',                     // → On Rainbow (End of Rainbow ne→On Rainbow)
  'look',
  'east',                   // → Aragain Falls
  'look',
  'west',                   // → On Rainbow
  'west',                   // On Rainbow → End of Rainbow
  'sw',                     // End of Rainbow → Canyon Bottom
  'up',                     // Canyon Bottom → Rocky Ledge
  'up',                     // Rocky Ledge → Canyon View
  'nw',                     // Canyon View → Clearing
  // ── Return to house ───────────────────────────────────────────────────────
  'west',                   // Clearing → East of House
  'south',                  // East of House → South of House
  'look',
  'west',                   // South of House → West of House
  'look',
  'east',                   // West of House → front door (boarded — blocked)
  'north',                  // West of House → North of House
  'east',                   // North of House → East of House (Behind House)
  'look',
  'west',                   // East of House → Kitchen (window still open)
  'look',
  'examine sandwich bag',
  'east',                   // Kitchen → East of House
  'west',                   // → Kitchen
  'west',                   // Kitchen → Living Room
  // ── Trophy case deposit + scoring ─────────────────────────────────────────
  'open trap door',
  'open trophy case',
  'put painting in trophy case',  // TVALUE=6 scored via LIVING-ROOM M-END recompute
  'score',
  'examine trophy case',
  'diagnose',
  'look',
  // ── More Living Room verbs ────────────────────────────────────────────────
  'close trophy case',
  'open trophy case',
  'take painting',          // take back from trophy case
  'drop painting',
  'put painting in trophy case',
  'score',
  // ── Lamp off / dark in Living Room ───────────────────────────────────────
  'turn off lamp',
  'look',                   // pitch-black
  'turn on lamp',
  'look',                   // lit
  // ── Chained commands ─────────────────────────────────────────────────────
  'look. score. inventory',
  // ── Final stats ──────────────────────────────────────────────────────────
  'score',
  'diagnose',
  'inventory',
];

describe('golden master walkthrough', () => {
  it('transcript is byte-identical to the committed golden', () => {
    resetActionState();
    const run1 = runEngine(COMMANDS, { seed: 42 });
    resetActionState();
    const run2 = runEngine(COMMANDS, { seed: 42 });
    // Determinism proof: two fresh runs with the same seed must be identical.
    // Fails if any module-level state or non-seeded randomness leaks between runs.
    expect(run1).toBe(run2);

    if (process.env['UPDATE_GOLDEN'] === '1') {
      mkdirSync(import.meta.dirname, { recursive: true });
      writeFileSync(GOLDEN_PATH, run1, 'utf8');
      console.log(`Golden updated: ${GOLDEN_PATH} (${run1.split('\n').length} lines)`);
      return;
    }

    const golden = readFileSync(GOLDEN_PATH, 'utf8');
    // The real assertion: replay must match committed golden byte-for-byte.
    expect(run1).toBe(golden);
  });
});
