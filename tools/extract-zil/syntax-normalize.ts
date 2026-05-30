/**
 * SyntaxEntry schema normalization — raw extractor format → port-native format.
 *
 * The ZIL extractor (extract.ts) parses SYNTAX forms into a raw intermediate
 * representation (SyntaxEntryRaw) that mirrors the ZIL source structure.
 * This module converts the raw format into the port-native SyntaxEntryOut schema
 * consumed by the data-driven parser.
 *
 * Key transformations:
 *   - preposition → prep1, preposition2 → prep2 (null when absent)
 *   - directObject.find → dobjFindBit (null when absent)
 *   - directObject.where → dobjLocBits (integer bitmask, 0 when absent)
 *   - indirectObject.find → iobjFindBit (null when absent)
 *   - indirectObject.where → iobjLocBits (integer bitmask, 0 when absent)
 *   - adds explicit numObjects: 0 | 1 | 2
 *
 * Scope bit constants from gparser.zil:1032-1038:
 *   SH=128, SC=64, SIR=32, SOG=16, STAKE=8, SMANY=4, SHAVE=2
 *
 * HELD=128 (SH): The reconciliation doc §3 C1 listed "HELD=192" which is a typo.
 * The authoritative source is gparser.zil:1032 `<CONSTANT SH 128>`, confirmed by
 * the sample records in td1-grammar-spec.md §6 (e.g. ATTACK iobj: 128+64+2=194).
 */

import type { SyntaxEntryRaw } from './extract.js';

// ---------------------------------------------------------------------------
// Bit constants (gparser.zil:1032-1038)
// ---------------------------------------------------------------------------

/** HELD — directly in player inventory (SH, gparser.zil:1032) */
export const HELD_BIT = 128;
/** CARRIED — recursively in player containers (SC, gparser.zil:1033) */
export const CARRIED_BIT = 64;
/** IN-ROOM — at room floor level (SIR, gparser.zil:1034) */
export const IN_ROOM_BIT = 32;
/** ON-GROUND — room top-level only (SOG, gparser.zil:1035) */
export const ON_GROUND_BIT = 16;
/** TAKE — auto-take if not held before action fires (STAKE, gparser.zil:1036) */
export const TAKE_BIT = 8;
/** MANY — accepts ALL/multiple objects (SMANY, gparser.zil:1037) */
export const MANY_BIT = 4;
/** HAVE — must already be held; hard error if not (SHAVE, gparser.zil:1038) */
export const HAVE_BIT = 2;

const SCOPE_BIT_MAP: Record<string, number> = {
  'HELD':      HELD_BIT,
  'CARRIED':   CARRIED_BIT,
  'IN-ROOM':   IN_ROOM_BIT,
  'ON-GROUND': ON_GROUND_BIT,
  'TAKE':      TAKE_BIT,
  'MANY':      MANY_BIT,
  'HAVE':      HAVE_BIT,
};

// ---------------------------------------------------------------------------
// Port-native output type (the schema written to syntax.json)
// ---------------------------------------------------------------------------

/**
 * Port-native SyntaxEntry — the schema written to src/data/syntax.json and
 * consumed by the data-driven parser.
 *
 * All fields are explicit (never undefined); absent values use null/0.
 * Array order = ZIL declaration order = match priority (first full match wins).
 */
export interface SyntaxEntryOut {
  /** Canonical verb word (UPPERCASE). */
  verb: string;

  /**
   * Number of object slots: 0 = intransitive, 1 = transitive, 2 = ditransitive.
   * Derived from presence of directObject/indirectObject in the raw form.
   */
  numObjects: 0 | 1 | 2;

  /**
   * Preposition/particle required before PRSO slot (null = none).
   * E.g. "UP" in "BLOW UP OBJECT", "IN" in "LOOK IN OBJECT".
   * Renamed from raw `preposition`.
   */
  prep1: string | null;

  /**
   * Preposition required before PRSI slot (null = none).
   * E.g. "WITH" in "ATTACK X WITH Y", "FROM" in "TAKE X FROM Y".
   * Renamed from raw `preposition2`.
   */
  prep2: string | null;

  /**
   * FIND flag bit name for PRSO (null = no flag constraint).
   * E.g. "TAKEBIT", "ACTORBIT", "RMUNGBIT".
   * Flattened from raw `directObject.find`.
   */
  dobjFindBit: string | null;

  /**
   * Scope bits for PRSO as a bitmask integer.
   * 0 = unconstrained (search everywhere accessible).
   * Bit encoding: HELD=128, CARRIED=64, IN-ROOM=32, ON-GROUND=16,
   *               TAKE=8 (auto-take), MANY=4 (allow ALL), HAVE=2 (must-hold).
   * Flattened+converted from raw `directObject.where` string array.
   */
  dobjLocBits: number;

  /**
   * FIND flag bit name for PRSI (null = no constraint or numObjects < 2).
   * Flattened from raw `indirectObject.find`.
   */
  iobjFindBit: string | null;

  /**
   * Scope bits for PRSI as a bitmask integer (same encoding as dobjLocBits).
   * 0 when numObjects < 2 or no scope constraint.
   * Flattened+converted from raw `indirectObject.where` string array.
   */
  iobjLocBits: number;

  /**
   * Port-native action id. Maps to a V-* handler.
   * E.g. "V-TAKE", "V-ATTACK", "V-LOOK".
   */
  action: string;

  /**
   * Port-native pre-action id, or null.
   * Maps to a PRE-* handler. E.g. "PRE-TAKE", "PRE-DROP".
   * Renamed from raw `preAction` (undefined → null).
   */
  preAction: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a scope string token ("HELD", "IN-ROOM", etc.) to its bit value.
 * Returns 0 for unknown tokens (safe for OR-accumulation).
 */
function scopeTokenToBit(token: string): number {
  return SCOPE_BIT_MAP[token] ?? 0;
}

/**
 * Convert a `where` string array from the raw extractor format to an integer
 * bitmask. Empty array → 0 (unconstrained search).
 *
 * Each recognized token contributes its bit via bitwise OR.
 * Unrecognized tokens contribute 0 (no effect) and are silently ignored.
 */
export function whereToBitmask(where: string[]): number {
  let bits = 0;
  for (const token of where) {
    bits |= scopeTokenToBit(token);
  }
  return bits;
}

/**
 * Normalize a raw SyntaxEntry (extractor's intermediate format) to the
 * port-native SyntaxEntryOut schema.
 *
 * This is a pure, order-preserving transformation — it does not sort or
 * reorder entries. Call it on each element of the extractSyntax() result
 * array to produce the array written to syntax.json.
 */
export function normalizeSyntaxEntry(raw: SyntaxEntryRaw): SyntaxEntryOut {
  const hasDobj = raw.directObject !== undefined;
  const hasIobj = raw.indirectObject !== undefined;

  const numObjects: 0 | 1 | 2 = hasIobj ? 2 : hasDobj ? 1 : 0;

  return {
    verb: raw.verb,
    numObjects,
    prep1: raw.preposition ?? null,
    prep2: raw.preposition2 ?? null,
    dobjFindBit: hasDobj ? (raw.directObject!.find ?? null) : null,
    dobjLocBits: hasDobj ? whereToBitmask(raw.directObject!.where) : 0,
    iobjFindBit: hasIobj ? (raw.indirectObject!.find ?? null) : null,
    iobjLocBits: hasIobj ? whereToBitmask(raw.indirectObject!.where) : 0,
    action: raw.action,
    preAction: raw.preAction ?? null,
  };
}
