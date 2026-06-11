/**
 * Module-level state for the thief and cyclops actors.
 *
 * Mirrors ZIL GLOBAL variables defined in 1actions.zil.  Pattern mirrors
 * the existing region-level globals in above-ground.ts (KITCHEN-WINDOW-FLAG,
 * SING-SONG etc.) — a module-level let with getter + setter + reset.
 *
 * SING-SONG reconciliation (F1 mandate): the canonical SING-SONG state is the
 * `singSong` variable already in src/actions/above-ground.ts:55, with its
 * existing `resetSingSong` wiring in session.ts.  That field IS the SING-SONG
 * global; this module does NOT add a parallel one.  Downstream thief code
 * reads/writes SING-SONG via the exported getter/setter in above-ground.ts.
 *
 * CYCLOPS-FLAG and MAGIC-FLAG are FlagStore keys (boolean globals gating exits;
 * mirroring the TROLL-FLAG D3 decision from phase-2-combat.md).  They are NOT
 * duplicated here — the Game's FlagStore is the single source of truth.
 */

// THIEF-HERE — 1actions.zil:1754  (<GLOBAL THIEF-HERE <>>)
let _thiefHere = false;
export function thiefHere(): boolean  { return _thiefHere; }
export function setThiefHere(v: boolean): void { _thiefHere = v; }

// THIEF-ENGROSSED — 1actions.zil:1945  (<GLOBAL THIEF-ENGROSSED <>>)
let _thiefEngrossed = false;
export function thiefEngrossed(): boolean  { return _thiefEngrossed; }
export function setThiefEngrossed(v: boolean): void { _thiefEngrossed = v; }

// EGG-SOLVE — 1actions.zil:1748  (<GLOBAL EGG-SOLVE <>>)
let _eggSolve = false;
export function eggSolve(): boolean  { return _eggSolve; }
export function setEggSolve(v: boolean): void { _eggSolve = v; }

// CYCLOWRATH — 1actions.zil:1513  (<GLOBAL CYCLOWRATH 0>)
let _cyclowrath = 0;
export function cyclowrath(): number { return _cyclowrath; }
export function setCyclowrath(v: number): void { _cyclowrath = v; }

// ROBBER-C-DESC — 1actions.zil:2086–2088
// The thief's conscious LDESC; used by F-CONSCIOUS, LARGE-BAG-F, give-while-KO.
export const ROBBER_C_DESC =
  'There is a suspicious-looking individual, holding a bag, leaning\n' +
  'against one wall. He is armed with a vicious-looking stiletto.';

// ROBBER-U-DESC — 1actions.zil:2090–2092
export const ROBBER_U_DESC =
  'There is a suspicious-looking individual lying unconscious on the\n' +
  'ground.';

// Mutable thief LDESC — ZIL PUTP THIEF P?LDESC in F-UNCONSCIOUS/F-CONSCIOUS.
// Starts at ROBBER_C_DESC (thief begins conscious).
let _thiefLdesc = ROBBER_C_DESC;
export function thiefLdesc(): string { return _thiefLdesc; }
export function setThiefLdesc(v: string): void { _thiefLdesc = v; }

/** Reset all thief-state module globals for test isolation. */
export function resetThiefState(): void {
  _thiefHere      = false;
  _thiefEngrossed = false;
  _eggSolve       = false;
  _cyclowrath     = 0;
  _thiefLdesc     = ROBBER_C_DESC;
}
