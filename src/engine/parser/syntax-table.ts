/**
 * Memoized index over src/data/syntax.json.
 *
 * Builds a Map<UPPERCASE-verb, SyntaxEntry[]> once at module load, preserving
 * declaration order (match priority). Verb keys are UPPERCASE; callers must
 * .toUpperCase() before calling getForms(). null → undefined normalization
 * happens here so syntaxCheck's prepEq() never sees null.
 */

import type { SyntaxEntry } from './types.js';
import syntaxJson from '../../data/syntax.json' assert { type: 'json' };

export type { SyntaxEntry };

const _index: Map<string, SyntaxEntry[]> = new Map();

type SyntaxEntryRaw = {
  verb: string; numObjects: number;
  prep1: string | null; prep2: string | null;
  dobjFindBit: string | null; dobjLocBits: number;
  iobjFindBit: string | null; iobjLocBits: number;
  action: string; preAction: string | null;
};

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
 * Returns [] for unknown verbs.
 */
export function getForms(verbUpper: string): SyntaxEntry[] {
  return _index.get(verbUpper) ?? [];
}
