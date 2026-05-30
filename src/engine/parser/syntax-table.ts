/**
 * Syntax table — memoized index over src/data/syntax.json.
 *
 * Builds a Map<UPPERCASE-verb, SyntaxEntry[]> once at module load, preserving
 * declaration order (= match priority per grammar-spec §5.1).  Re-indexing 267
 * records per keystroke would be wasteful and break stable object-identity test
 * assertions, so the index is a singleton built exactly once.
 *
 * KEY INVARIANT: verb keys are UPPERCASE ("LOOK", not "look").  lookupVerb()
 * returns lowercase; callers must .toUpperCase() before calling getForms().
 *
 * null → undefined normalization for prep1/prep2/findBits/preAction happens
 * here so that syntaxCheck's prepEq() never sees null.
 */

import type { SyntaxEntry } from './types.js';
import syntaxJson from '../../data/syntax.json' assert { type: 'json' };

// Re-export SyntaxEntry for consumers who import from this module.
export type { SyntaxEntry };

// ---------------------------------------------------------------------------
// JSON shape (raw, with null fields).
// ---------------------------------------------------------------------------

interface SyntaxEntryRaw {
  verb: string;
  numObjects: number;
  prep1: string | null;
  prep2: string | null;
  dobjFindBit: string | null;
  dobjLocBits: number;
  iobjFindBit: string | null;
  iobjLocBits: number;
  action: string;
  preAction: string | null;
}

// ---------------------------------------------------------------------------
// Module-level singleton index.
// ---------------------------------------------------------------------------

const _index: Map<string, SyntaxEntry[]> = new Map();

for (const raw of syntaxJson as SyntaxEntryRaw[]) {
  const entry: SyntaxEntry = {
    verb: raw.verb,
    numObjects: raw.numObjects as 0 | 1 | 2,
    // null → undefined normalization: prepEq() must never see null.
    prep1:        raw.prep1        ?? undefined,
    prep2:        raw.prep2        ?? undefined,
    dobjFindBit:  raw.dobjFindBit  ?? undefined,
    dobjLocBits:  raw.dobjLocBits,
    iobjFindBit:  raw.iobjFindBit  ?? undefined,
    iobjLocBits:  raw.iobjLocBits,
    action:       raw.action,
    preAction:    raw.preAction    ?? undefined,
  };

  // Verb key is UPPERCASE (e.g. "LOOK") — callers must pass UPPERCASE.
  const key = raw.verb.toUpperCase();
  let list = _index.get(key);
  if (list === undefined) {
    list = [];
    _index.set(key, list);
  }
  list.push(entry);
}

/**
 * Return all SyntaxEntry forms for a given UPPERCASE verb, in declaration order.
 * Declaration order = match priority (first full match wins).
 * Returns [] for unknown verbs.
 *
 * @param verbUpper  UPPERCASE verb key (e.g. "LOOK", "TAKE").
 */
export function getForms(verbUpper: string): SyntaxEntry[] {
  return _index.get(verbUpper) ?? [];
}
