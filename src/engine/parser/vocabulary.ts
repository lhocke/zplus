/**
 * Verb and preposition vocabulary tables for the parser.
 *
 * REPLACE MAP (Task C2): data now loaded from src/data/vocabulary.json
 * (verbSynonyms / directionSynonyms / prepSynonyms / buzzwords).
 * The hand-maintained VERB_SYNONYMS table is removed; all synonym data
 * is derived from the JSON so it stays in sync with the extractor.
 *
 * KEY INVARIANT: Preposition canonical strings returned by normalizePrep()
 * are UPPERCASE and BYTE-IDENTICAL to the prep1/prep2 values in syntax.json.
 * Any mismatch causes SYNTAX-CHECK (C3) to silently fail to match a form.
 *
 * API surface (unchanged):
 *   lookupVerb(token)    → canonical lowercase verb or undefined
 *   normalizeDir(token)  → canonical lowercase direction string
 *   normalizePrep(token) → canonical UPPERCASE prep string (e.g. "IN", "WITH")
 *   isPreposition(token) → boolean
 *   isDirection(token)   → boolean  [NEW — C2]
 *   isBuzzword(token)    → boolean  [NEW — C2]
 *   DIRECTIONS           → Set<string> of all direction words (lowercase)
 */

import vocabJson from '../../data/vocabulary.json' assert { type: 'json' };
import syntaxJson from '../../data/syntax.json' assert { type: 'json' };

// ---------------------------------------------------------------------------
// Type-narrow the imported JSON.
// ---------------------------------------------------------------------------

interface VocabularyData {
  verbSynonyms:      Record<string, string[]>;
  directionSynonyms: Record<string, string[]>;
  prepSynonyms:      Record<string, string[]>;
  buzzwords:         string[];
}

const vocab = vocabJson as unknown as VocabularyData;

// ---------------------------------------------------------------------------
// Verb synonym table — loaded from vocabulary.json, inverted to lookup map.
// Canonical keys in vocabulary.json are UPPERCASE; we store lowercase.
// ---------------------------------------------------------------------------

/** Inverted lookup: any lowercase alias → lowercase canonical verb. */
const VERB_LOOKUP = new Map<string, string>();

// Step 1: Register all verbs that appear in syntax.json as their own canonical.
// These are the verbs the ZIL grammar accepts, even those without SYNONYM lines.
// Verbs starting with '#' or '$' are meta-commands; skip them.
for (const entry of syntaxJson as Array<{ verb: string }>) {
  const v = entry.verb;
  if (v.startsWith('#') || v.startsWith('$')) continue;
  const lc = v.toLowerCase();
  if (!VERB_LOOKUP.has(lc)) {
    VERB_LOOKUP.set(lc, lc);
  }
}

// Step 2: Register synonym mappings from vocabulary.json.
// An alias maps to the CANONICAL verb (first arg to SYNONYM in ZIL).
for (const [canonicalUp, aliases] of Object.entries(vocab.verbSynonyms)) {
  const canonical = canonicalUp.toLowerCase();
  // Ensure canonical is registered (may have been set in step 1 or be new).
  VERB_LOOKUP.set(canonical, canonical);
  for (const alias of aliases) {
    VERB_LOOKUP.set(alias.toLowerCase(), canonical);
  }
}

/**
 * Return the canonical verb for a given token, or undefined if the token
 * is not a recognized verb (or verb alias).
 * Canonical is always lowercase (e.g. 'take', 'look').
 */
export function lookupVerb(token: string): string | undefined {
  return VERB_LOOKUP.get(token.toLowerCase());
}

// ---------------------------------------------------------------------------
// Direction words — treated as shorthand "walk <dir>" commands.
//
// ZIL primary directions (gglobals.zil:5):
//   NORTH EAST WEST SOUTH NE NW SE SW UP DOWN IN OUT LAND
// Plus direction synonyms from vocabulary.json (N, S, E, W, D, U,
// NORTHWEST, NORTHE, SOUTHWEST, SOUTHE).
// All stored lowercase in DIRECTIONS for isPreposition/isDirection.
// ---------------------------------------------------------------------------

/** All direction words (canonical + synonym), lowercase. */
export const DIRECTIONS = new Set<string>();

// Primary directions (canonical).
const DIR_CANONICALS = [
  'north', 'south', 'east', 'west',
  'ne', 'nw', 'se', 'sw',
  'up', 'down', 'in', 'out',
  'land',           // valid direction for the raft exit (gglobals.zil:5)
];
for (const d of DIR_CANONICALS) DIRECTIONS.add(d);

// Normalisation map: alias lowercase → canonical lowercase direction.
// The "canonical" for multi-char abbreviations stays the short form (ne/nw/etc).
const DIR_NORMALIZE: Record<string, string> = {
  n:         'north',
  s:         'south',
  e:         'east',
  w:         'west',
  u:         'up',
  d:         'down',
};

// Add direction synonyms from vocabulary.json (canonical UPPERCASE → aliases).
for (const [canonicalUp, aliases] of Object.entries(vocab.directionSynonyms)) {
  const canonical = canonicalUp.toLowerCase();
  // Ensure the canonical itself is in the set (already added above for most).
  DIRECTIONS.add(canonical);
  for (const alias of aliases) {
    const aliasLc = alias.toLowerCase();
    DIRECTIONS.add(aliasLc);
    // Map alias → canonical only if it differs from the canonical.
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

// ---------------------------------------------------------------------------
// Prepositions — the 18 canonical prep words from gsyntax.zil §9, plus
// the aliases defined in prepSynonyms.
//
// CANONICAL FORM IS UPPERCASE (byte-identical to syntax.json prep1/prep2 fields).
// The PREPOSITIONS set contains both canonical (UPPERCASE) and alias (UPPERCASE)
// forms so that isPreposition() accepts any recognised word.
//
// Non-ZIL preps removed vs the old hand table: "about", "off", "out of".
// Wait — "ABOUT" and "OFF" DO appear in syntax.json as prep2 values ("about"
// once, "off" twice).  Per §9 of the spec they ARE canonical preps.
// The non-ZIL ones to drop are "out of" (multi-word, not in ZIL) and "on top of"
// (not in ZIL).  "about" and "off" stay because they appear in syntax.json.
//
// Canonical preps from syntax.json (all 18):
//   ABOUT ACROSS AROUND AT AWAY BEHIND DOWN FOR FROM IN OFF ON OUT OVER TO UNDER UP WITH
// ---------------------------------------------------------------------------

// All 18 canonical preps from gsyntax.zil §9 (must match syntax.json exactly).
const PREP_CANONICALS = [
  'ABOUT', 'ACROSS', 'AROUND', 'AT', 'AWAY', 'BEHIND',
  'DOWN', 'FOR', 'FROM', 'IN', 'OFF', 'ON', 'OUT', 'OVER',
  'TO', 'UNDER', 'UP', 'WITH',
] as const;

/** All recognised preposition words (canonical + aliases), UPPERCASE. */
export const PREPOSITIONS = new Set<string>(PREP_CANONICALS);

/** Normalise alias → UPPERCASE canonical prep. */
const PREP_NORMALIZE_MAP: Record<string, string> = {};

// Populate from prepSynonyms in vocabulary.json.
for (const [canonicalUp, aliases] of Object.entries(vocab.prepSynonyms)) {
  // canonical is already UPPERCASE in vocabulary.json (e.g. "WITH", "IN").
  for (const alias of aliases) {
    const aliasUp = alias.toUpperCase();
    PREPOSITIONS.add(aliasUp);
    PREP_NORMALIZE_MAP[aliasUp] = canonicalUp;
  }
}

/**
 * Normalise a preposition token to its canonical UPPERCASE form.
 * The canonical form is byte-identical to the prep1/prep2 values in syntax.json
 * so that SYNTAX-CHECK (C3) can do a direct string comparison.
 *
 * Examples:
 *   normalizePrep('into')  → 'IN'
 *   normalizePrep('using') → 'WITH'
 *   normalizePrep('on')    → 'ON'
 *   normalizePrep('off')   → 'OFF'
 */
export function normalizePrep(token: string): string {
  const up = token.toUpperCase();
  return PREP_NORMALIZE_MAP[up] ?? up;
}

export function isPreposition(token: string): boolean {
  return PREPOSITIONS.has(token.toUpperCase());
}

// ---------------------------------------------------------------------------
// Buzzwords — the 21 words from gsyntax.zil:9–11 that the parser handles
// structurally (AGAIN/G/THEN/AND/etc.) or silently ignores.
// Stored UPPERCASE (matching vocabulary.json) and checked case-insensitively.
// ---------------------------------------------------------------------------

const BUZZWORD_SET = new Set<string>(vocab.buzzwords);

/** True if token is a buzzword (structural or noise word per gsyntax.zil). */
export function isBuzzword(token: string): boolean {
  return BUZZWORD_SET.has(token.toUpperCase());
}
