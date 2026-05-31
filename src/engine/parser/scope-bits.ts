/**
 * scope-bits.ts — ZIL scope bitmask constants and level constants.
 *
 * Port of gparser.zil:1032-1038.
 *
 * These constants are used by DO-SL / SEARCH-LIST to determine how deeply
 * to search containers and which tiers (room / inventory / global) to include.
 */

// ---------------------------------------------------------------------------
// Scope location bits (SLOCBITS field in syntax.json dobjLocBits/iobjLocBits)
// ---------------------------------------------------------------------------

/** SHAVE (2) — object must be HELD: in player inventory; else print "You don't have the X." */
export const SHAVE = 2;
/** SMANY (4) — object may be plural (ALL/AND expansion allowed). */
export const SMANY = 4;
/** STAKE (8) — object must be taken (auto-take before action). */
export const STAKE = 8;
/** SOG (16) — search object's GLOBAL-OBJECTS list (outer-room container). */
export const SOG = 16;
/** SIR (32) — search indirect-object recursively (inner room). */
export const SIR = 32;
/** SC (64) — search carried (player inventory, contents). */
export const SC = 64;
/** SH (128) — search held (player inventory, top-level). */
export const SH = 128;

// ---------------------------------------------------------------------------
// Search depth level constants (gparser.zil:1212-1214)
// ---------------------------------------------------------------------------

/** SRCTOP (0) — top-level only; only descend into Searchable/Surface containers. */
export const SRCTOP = 0;
/** SRCALL (1) — all levels; descend into any open/transparent container. */
export const SRCALL = 1;
/** SRCBOT (2) — bottom-level only; skip THIS-IT? check on the container node itself. */
export const SRCBOT = 2;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Returns true if `bit` is set in `mask`.
 * Port of ZIL BTST.
 */
export function hasBit(mask: number, bit: number): boolean {
  return (mask & bit) !== 0;
}
