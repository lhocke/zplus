/**
 * Task A2 — vocabulary.json split into typed tables.
 *
 * Verifies:
 *   1. The three typed tables (verbSynonyms / directionSynonyms / prepSynonyms)
 *      are present and correctly populated by extractVocabulary().
 *   2. GIVE→HAND synonym is present (was missing from vocabulary.json;
 *      in Zork I the COND on gsyntax.zil:234-235 always fires since
 *      ZORK-NUMBER != 3).
 *   3. Direction synonyms (e.g. NORTH→N) are in directionSynonyms, NOT verbSynonyms.
 *   4. Prep synonyms (e.g. WITH→[USING, THROUGH, THRU]) are in prepSynonyms, NOT verbSynonyms.
 *   5. The generated src/data/vocabulary.json (live file) conforms to the new shape.
 */

import { describe, test, expect } from 'vitest';
import { extractVocabulary } from '../../tools/extract-zil/extract.js';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';
import type { VocabularyData } from '../../tools/extract-zil/extract.js';

// ---------------------------------------------------------------------------
// Fixture ZIL covering all three synonym categories + BUZZ
// ---------------------------------------------------------------------------

const FIXTURE_ZIL = `
<SYNONYM WITH USING THROUGH THRU>
<SYNONYM IN INSIDE INTO>
<SYNONYM ON ONTO>
<SYNONYM UNDER UNDERNEATH BENEATH BELOW>
<SYNONYM NORTH N>
<SYNONYM SOUTH S>
<SYNONYM EAST E>
<SYNONYM WEST W>
<SYNONYM DOWN D>
<SYNONYM UP U>
<SYNONYM NW NORTHWEST>
<SYNONYM NE NORTHE>
<SYNONYM SW SOUTHWEST>
<SYNONYM SE SOUTHE>
<SYNONYM GIVE DONATE OFFER FEED>
<SYNONYM GIVE HAND>
<SYNONYM TAKE GET HOLD CARRY REMOVE GRAB CATCH>
<SYNONYM LOOK L STARE GAZE>
<SYNONYM TURN SET FLIP SHUT>
<BUZZ A AN THE IS AND>
`;

// ---------------------------------------------------------------------------
// extractVocabulary produces three typed tables
// ---------------------------------------------------------------------------

describe('extractVocabulary — typed tables present', () => {
  const nodes = parseSexpr(FIXTURE_ZIL);
  const vocab = extractVocabulary(nodes);

  test('verbSynonyms is defined and is a record', () => {
    expect(vocab.verbSynonyms).toBeDefined();
    expect(typeof vocab.verbSynonyms).toBe('object');
  });

  test('directionSynonyms is defined and is a record', () => {
    expect(vocab.directionSynonyms).toBeDefined();
    expect(typeof vocab.directionSynonyms).toBe('object');
  });

  test('prepSynonyms is defined and is a record', () => {
    expect(vocab.prepSynonyms).toBeDefined();
    expect(typeof vocab.prepSynonyms).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// Direction synonyms are in directionSynonyms (NOT verbSynonyms)
// ---------------------------------------------------------------------------

describe('extractVocabulary — direction synonyms correctly classified', () => {
  const nodes = parseSexpr(FIXTURE_ZIL);
  const vocab = extractVocabulary(nodes);

  test('NORTH is in directionSynonyms', () => {
    expect(vocab.directionSynonyms['NORTH']).toBeDefined();
  });

  test('NORTH→N alias is in directionSynonyms', () => {
    expect(vocab.directionSynonyms['NORTH']).toContain('N');
  });

  test('NE→NORTHE alias is in directionSynonyms', () => {
    expect(vocab.directionSynonyms['NE']).toContain('NORTHE');
  });

  test('SW→SOUTHWEST alias is in directionSynonyms', () => {
    expect(vocab.directionSynonyms['SW']).toContain('SOUTHWEST');
  });

  test('direction canonicals do NOT appear in verbSynonyms', () => {
    expect(vocab.verbSynonyms['NORTH']).toBeUndefined();
    expect(vocab.verbSynonyms['SOUTH']).toBeUndefined();
    expect(vocab.verbSynonyms['NW']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Prep synonyms are in prepSynonyms (NOT verbSynonyms)
// ---------------------------------------------------------------------------

describe('extractVocabulary — prep synonyms correctly classified', () => {
  const nodes = parseSexpr(FIXTURE_ZIL);
  const vocab = extractVocabulary(nodes);

  test('WITH is in prepSynonyms', () => {
    expect(vocab.prepSynonyms['WITH']).toBeDefined();
  });

  test('WITH→USING alias is in prepSynonyms', () => {
    expect(vocab.prepSynonyms['WITH']).toContain('USING');
  });

  test('WITH→THROUGH alias is in prepSynonyms', () => {
    expect(vocab.prepSynonyms['WITH']).toContain('THROUGH');
  });

  test('UNDER→UNDERNEATH alias is in prepSynonyms', () => {
    expect(vocab.prepSynonyms['UNDER']).toContain('UNDERNEATH');
  });

  test('prep canonicals do NOT appear in verbSynonyms', () => {
    expect(vocab.verbSynonyms['WITH']).toBeUndefined();
    expect(vocab.verbSynonyms['IN']).toBeUndefined();
    expect(vocab.verbSynonyms['UNDER']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Verb synonyms (including GIVE→HAND)
// ---------------------------------------------------------------------------

describe('extractVocabulary — verb synonyms including GIVE→HAND', () => {
  const nodes = parseSexpr(FIXTURE_ZIL);
  const vocab = extractVocabulary(nodes);

  test('GIVE is in verbSynonyms', () => {
    expect(vocab.verbSynonyms['GIVE']).toBeDefined();
  });

  test('GIVE synonyms include DONATE, OFFER, FEED', () => {
    const syns = vocab.verbSynonyms['GIVE'];
    expect(syns).toContain('DONATE');
    expect(syns).toContain('OFFER');
    expect(syns).toContain('FEED');
  });

  test('GIVE synonyms include HAND (the missing Zork I synonym)', () => {
    const syns = vocab.verbSynonyms['GIVE'];
    expect(syns).toContain('HAND');
  });

  test('TAKE synonyms are in verbSynonyms', () => {
    const syns = vocab.verbSynonyms['TAKE'];
    expect(syns).toContain('GET');
    expect(syns).toContain('HOLD');
    expect(syns).toContain('CARRY');
  });

  test('TURN→SHUT is in verbSynonyms', () => {
    expect(vocab.verbSynonyms['TURN']).toContain('SHUT');
  });

  test('LOOK→L is in verbSynonyms', () => {
    expect(vocab.verbSynonyms['LOOK']).toContain('L');
  });
});

// ---------------------------------------------------------------------------
// Buzzwords still present
// ---------------------------------------------------------------------------

describe('extractVocabulary — buzzwords still present', () => {
  const nodes = parseSexpr(FIXTURE_ZIL);
  const vocab = extractVocabulary(nodes);

  test('buzzwords array is non-empty', () => {
    expect(vocab.buzzwords.length).toBeGreaterThan(0);
  });

  test('buzzwords include A, AN, THE', () => {
    expect(vocab.buzzwords).toContain('A');
    expect(vocab.buzzwords).toContain('AN');
    expect(vocab.buzzwords).toContain('THE');
  });
});

// ---------------------------------------------------------------------------
// Live vocabulary.json — conforms to new typed-table shape
// ---------------------------------------------------------------------------

import vocabJson from '../../src/data/vocabulary.json';

describe('vocabulary.json — live file conforms to new schema', () => {
  // Cast through unknown to assert structural shape without TypeScript fighting us.
  const raw = vocabJson as unknown as Record<string, unknown>;
  const vocab = vocabJson as unknown as VocabularyData;

  test('has verbSynonyms at top level', () => {
    expect(raw['verbSynonyms']).toBeDefined();
  });

  test('does NOT have flat synonyms (old schema)', () => {
    expect(raw['synonyms']).toBeUndefined();
  });

  test('has directionSynonyms at top level', () => {
    expect(raw['directionSynonyms']).toBeDefined();
  });

  test('has prepSynonyms at top level', () => {
    expect(raw['prepSynonyms']).toBeDefined();
  });

  test('verbSynonyms contains GIVE with HAND', () => {
    expect(vocab.verbSynonyms['GIVE']).toContain('HAND');
  });

  test('directionSynonyms contains NORTH with N', () => {
    expect(vocab.directionSynonyms['NORTH']).toContain('N');
  });

  test('prepSynonyms contains WITH with USING', () => {
    expect(vocab.prepSynonyms['WITH']).toContain('USING');
  });

  test('NORTH is NOT in verbSynonyms', () => {
    expect(vocab.verbSynonyms['NORTH']).toBeUndefined();
  });

  test('WITH is NOT in verbSynonyms', () => {
    expect(vocab.verbSynonyms['WITH']).toBeUndefined();
  });

  test('buzzwords still present', () => {
    expect(Array.isArray(vocab.buzzwords)).toBe(true);
    expect(vocab.buzzwords.length).toBeGreaterThan(0);
  });
});
