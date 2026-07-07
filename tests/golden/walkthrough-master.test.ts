import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine } from '../../tools/oracle/engine-runner.js';
import { GOLDEN_COMMANDS } from '../../tools/oracle/golden-commands.js';
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
// Command sequence imported from tools/oracle/golden-commands.ts — single source of truth.
const COMMANDS = GOLDEN_COMMANDS;

describe('golden master walkthrough', () => {
  it('golden file carries engine provenance header (L41)', () => {
    const raw = readFileSync(GOLDEN_PATH, 'utf8');
    const firstLine = raw.split('\n')[0]!;
    // L41: a file asserts its generator before any byte comparison. The golden's
    // bytes are engine output (DGC-anchored to dfrotz), so the generator is `engine`.
    expect(firstLine).toMatch(/^# generated-by: engine /);
  });

  it('transcript is byte-identical to the committed golden', async () => {
    resetActionState();
    const run1 = await runEngine(COMMANDS, { seed: 42 });
    resetActionState();
    const run2 = await runEngine(COMMANDS, { seed: 42 });
    // Determinism proof: two fresh runs with the same seed must be identical.
    // Fails if any module-level state or non-seeded randomness leaks between runs.
    expect(run1).toBe(run2);

    // UPDATE_GOLDEN is BANNED for the golden (spec §8): regeneration must route
    // through gen-walkthrough.mjs + golden-rebaseline-audit.ts (which re-confirms the
    // DGC anchoring against dfrotz R119), never a casual test-side rewrite.

    const raw = readFileSync(GOLDEN_PATH, 'utf8');
    // Strip the provenance header before comparing — the header is metadata, not
    // game output.  An off-by-one strip would silently shorten the payload, so
    // the slice is on the first '\n' (not a fixed char count).
    const firstNewline = raw.indexOf('\n');
    const golden = raw.slice(firstNewline + 1);

    // The real assertion: replay must match committed golden byte-for-byte.
    expect(run1).toBe(golden);
  });

  it('UPDATE_GOLDEN write-path is absent (self-retiring guard, spec §8)', () => {
    // Ensures the env-triggered write-path cannot silently reappear.
    // If this test goes red, the banned hole has been re-opened.
    const src = readFileSync(join(import.meta.dirname, 'walkthrough-master.test.ts'), 'utf8');
    expect(src).not.toMatch(/process\.env\[['"]UPDATE_GOLDEN['"]\]/);
    expect(src).not.toMatch(/writeFileSync\s*\(\s*GOLDEN_PATH/);
  });
});
