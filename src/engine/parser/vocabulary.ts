/**
 * Verb and preposition vocabulary tables for the parser.
 *
 * Data is loaded from src/data/vocabulary.json. Preposition canonicals returned
 * by normalizePrep() are UPPERCASE and byte-identical to the prep1/prep2 values
 * in syntax.json.
 */

import vocabJson from '../../data/vocabulary.json' assert { type: 'json' };
import syntaxJson from '../../data/syntax.json' assert { type: 'json' };

const vocab = vocabJson as unknown as {
  verbSynonyms:      Record<string, string[]>;
  directionSynonyms: Record<string, string[]>;
  prepSynonyms:      Record<string, string[]>;
  buzzwords:         string[];
};

// Inverted verb lookup: any lowercase alias → lowercase canonical.
const VERB_LOOKUP = new Map<string, string>();

// Register all verbs from syntax.json first (some have no SYNONYM lines).
// Skip '#'/'$' meta-commands.
for (const entry of syntaxJson as Array<{ verb: string }>) {
  const v = entry.verb;
  if (v.startsWith('#') || v.startsWith('$')) continue;
  const lc = v.toLowerCase();
  if (!VERB_LOOKUP.has(lc)) {
    VERB_LOOKUP.set(lc, lc);
  }
}

for (const [canonicalUp, aliases] of Object.entries(vocab.verbSynonyms)) {
  const canonical = canonicalUp.toLowerCase();
  VERB_LOOKUP.set(canonical, canonical);
  for (const alias of aliases) {
    VERB_LOOKUP.set(alias.toLowerCase(), canonical);
  }
}

/** Return the canonical lowercase verb for a token, or undefined if unrecognized. */
export function lookupVerb(token: string): string | undefined {
  return VERB_LOOKUP.get(token.toLowerCase());
}

// Direction words (gglobals.zil:5): NORTH EAST WEST SOUTH NE NW SE SW UP DOWN IN OUT LAND
// plus synonyms from vocabulary.json.

/** All direction words (canonical + synonym), lowercase. */
export const DIRECTIONS = new Set<string>();

const DIR_CANONICALS = [
  'north', 'south', 'east', 'west',
  'ne', 'nw', 'se', 'sw',
  'up', 'down', 'in', 'out',
  'land',   // raft exit (gglobals.zil:5)
];
for (const d of DIR_CANONICALS) DIRECTIONS.add(d);

const DIR_NORMALIZE: Record<string, string> = {
  n:         'north',
  s:         'south',
  e:         'east',
  w:         'west',
  u:         'up',
  d:         'down',
};

for (const [canonicalUp, aliases] of Object.entries(vocab.directionSynonyms)) {
  const canonical = canonicalUp.toLowerCase();
  DIRECTIONS.add(canonical);
  for (const alias of aliases) {
    const aliasLc = alias.toLowerCase();
    DIRECTIONS.add(aliasLc);
    if (aliasLc !== canonical) {
      DIR_NORMALIZE[aliasLc] = canonical;
    }
  }
}

export function normalizeDir(token: string): string {
  const lc = token.toLowerCase();
  return DIR_NORMALIZE[lc] ?? lc;
}

/** True if the token is a direction word (primary or synonym). */
export function isDirection(token: string): boolean {
  return DIRECTIONS.has(token.toLowerCase());
}

// 18 canonical preps from gsyntax.zil §9 — must match syntax.json exactly.
const PREP_CANONICALS = [
  'ABOUT', 'ACROSS', 'AROUND', 'AT', 'AWAY', 'BEHIND',
  'DOWN', 'FOR', 'FROM', 'IN', 'OFF', 'ON', 'OUT', 'OVER',
  'TO', 'UNDER', 'UP', 'WITH',
] as const;

export const PREPOSITIONS = new Set<string>(PREP_CANONICALS);

const PREP_NORMALIZE_MAP: Record<string, string> = {};

for (const [canonicalUp, aliases] of Object.entries(vocab.prepSynonyms)) {
  for (const alias of aliases) {
    const aliasUp = alias.toUpperCase();
    PREPOSITIONS.add(aliasUp);
    PREP_NORMALIZE_MAP[aliasUp] = canonicalUp;
  }
}

/** Normalise a preposition token to its canonical UPPERCASE form (byte-identical to syntax.json). */
export function normalizePrep(token: string): string {
  const up = token.toUpperCase();
  return PREP_NORMALIZE_MAP[up] ?? up;
}

export function isPreposition(token: string): boolean {
  return PREPOSITIONS.has(token.toUpperCase());
}

const BUZZWORD_SET = new Set<string>(vocab.buzzwords);

/** True if token is a buzzword (structural or noise word per gsyntax.zil). */
export function isBuzzword(token: string): boolean {
  return BUZZWORD_SET.has(token.toUpperCase());
}
