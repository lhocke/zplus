import { describe, test, expect } from 'vitest';
import { extractSyntax, extractVocabulary } from '../../tools/extract-zil/extract.js';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';

// ---------------------------------------------------------------------------
// SYNTAX fixtures — representative subset of gsyntax.zil
//
// The TAKE family is the task's required fixture.  A few adjacent forms test
// the full range of slot shapes:
//   - verb only (no objects)
//   - verb + DO (direct object with find + scope)
//   - verb + DO + prep + IO (two objects)
//   - verb + particle (UP/DOWN/IN/…) + DO
// ---------------------------------------------------------------------------

const TAKE_SYNTAX_ZIL = `
<SYNTAX TAKE OBJECT (FIND TAKEBIT) (ON-GROUND IN-ROOM MANY) = V-TAKE PRE-TAKE>
<SYNTAX TAKE OBJECT (FIND TAKEBIT) (CARRIED IN-ROOM MANY)
    FROM OBJECT = V-TAKE PRE-TAKE>
<SYNONYM TAKE GET HOLD CARRY REMOVE GRAB CATCH>
`;

// Verb-only (no objects, no prepositions)
const LOOK_SYNTAX_ZIL = `
<SYNTAX LOOK = V-LOOK>
<SYNTAX LOOK IN OBJECT (HELD CARRIED ON-GROUND IN-ROOM MANY) = V-LOOK-INSIDE>
<SYNONYM LOOK L STARE GAZE>
`;

// Two-object form: DROP … IN …
const DROP_SYNTAX_ZIL = `
<SYNTAX DROP OBJECT (HELD MANY HAVE) = V-DROP PRE-DROP>
<SYNTAX DROP OBJECT (HELD MANY HAVE) IN OBJECT = V-PUT PRE-PUT>
<SYNONYM DROP DISCARD DUMP>
`;

// BUZZ form — filler words that the parser should ignore
const BUZZ_ZIL = `
<BUZZ A AN THE IS AND OF THEN ALL ONE BUT EXCEPT>
`;

// ---------------------------------------------------------------------------
// extractSyntax — <SYNTAX …> forms → SyntaxEntry[]
// ---------------------------------------------------------------------------

describe('extractSyntax — TAKE fixture', () => {
  const nodes = parseSexpr(TAKE_SYNTAX_ZIL);
  const entries = extractSyntax(nodes);

  test('produces two entries for the two TAKE syntax forms', () => {
    expect(entries).toHaveLength(2);
  });

  test('first entry: verb is TAKE', () => {
    expect(entries[0].verb).toBe('TAKE');
  });

  test('first entry: directObject find = TAKEBIT', () => {
    expect(entries[0].directObject).toBeDefined();
    expect(entries[0].directObject!.find).toBe('TAKEBIT');
  });

  test('first entry: directObject scope includes ON-GROUND, IN-ROOM, MANY', () => {
    const where = entries[0].directObject!.where;
    expect(where).toContain('ON-GROUND');
    expect(where).toContain('IN-ROOM');
    expect(where).toContain('MANY');
  });

  test('first entry: action is V-TAKE', () => {
    expect(entries[0].action).toBe('V-TAKE');
  });

  test('first entry: preAction is PRE-TAKE', () => {
    expect(entries[0].preAction).toBe('PRE-TAKE');
  });

  test('first entry: no preposition before the object', () => {
    expect(entries[0].preposition).toBeUndefined();
  });

  test('second entry: preposition2 is FROM', () => {
    // <SYNTAX TAKE OBJECT … FROM OBJECT = V-TAKE PRE-TAKE>
    expect(entries[1].preposition2).toBe('FROM');
    expect(entries[1].indirectObject).toBeDefined();
  });
});

describe('extractSyntax — LOOK fixture (verb-only + prep+DO)', () => {
  const nodes = parseSexpr(LOOK_SYNTAX_ZIL);
  const entries = extractSyntax(nodes);

  test('produces two entries', () => {
    expect(entries).toHaveLength(2);
  });

  test('first entry: verb-only form — no directObject', () => {
    expect(entries[0].verb).toBe('LOOK');
    expect(entries[0].directObject).toBeUndefined();
    expect(entries[0].action).toBe('V-LOOK');
  });

  test('second entry: verb + particle IN + DO', () => {
    expect(entries[1].preposition).toBe('IN');
    expect(entries[1].directObject).toBeDefined();
    expect(entries[1].action).toBe('V-LOOK-INSIDE');
  });
});

describe('extractSyntax — DROP fixture (two-object form)', () => {
  const nodes = parseSexpr(DROP_SYNTAX_ZIL);
  const entries = extractSyntax(nodes);

  test('produces two entries', () => {
    expect(entries).toHaveLength(2);
  });

  test('first entry: verb + DO only', () => {
    expect(entries[0].verb).toBe('DROP');
    expect(entries[0].directObject).toBeDefined();
    expect(entries[0].indirectObject).toBeUndefined();
  });

  test('second entry: verb + DO + prep IN + IO', () => {
    expect(entries[1].preposition2).toBe('IN');
    expect(entries[1].indirectObject).toBeDefined();
    expect(entries[1].action).toBe('V-PUT');
  });
});

// ---------------------------------------------------------------------------
// extractVocabulary — SYNONYM + BUZZ → VocabularyData
// ---------------------------------------------------------------------------

describe('extractVocabulary — TAKE synonyms', () => {
  const nodes = parseSexpr(TAKE_SYNTAX_ZIL);
  const vocab = extractVocabulary(nodes);

  test('TAKE is a key in synonyms', () => {
    expect(vocab.synonyms['TAKE']).toBeDefined();
  });

  test('TAKE synonyms include GET, HOLD, CARRY, REMOVE, GRAB, CATCH', () => {
    const syns = vocab.synonyms['TAKE'];
    expect(syns).toContain('GET');
    expect(syns).toContain('HOLD');
    expect(syns).toContain('CARRY');
    expect(syns).toContain('REMOVE');
    expect(syns).toContain('GRAB');
    expect(syns).toContain('CATCH');
  });

  test('canonical word itself is not listed as its own synonym', () => {
    // The <SYNONYM TAKE GET HOLD …> form: first atom is the canonical;
    // the rest are aliases.  TAKE should not appear in its own alias list.
    expect(vocab.synonyms['TAKE']).not.toContain('TAKE');
  });
});

describe('extractVocabulary — LOOK synonyms', () => {
  const nodes = parseSexpr(LOOK_SYNTAX_ZIL);
  const vocab = extractVocabulary(nodes);

  test('LOOK is a key in synonyms', () => {
    expect(vocab.synonyms['LOOK']).toBeDefined();
  });

  test('LOOK synonyms include L, STARE, GAZE', () => {
    const syns = vocab.synonyms['LOOK'];
    expect(syns).toContain('L');
    expect(syns).toContain('STARE');
    expect(syns).toContain('GAZE');
  });
});

describe('extractVocabulary — DROP synonyms', () => {
  const nodes = parseSexpr(DROP_SYNTAX_ZIL);
  const vocab = extractVocabulary(nodes);

  test('DROP synonyms include DISCARD, DUMP', () => {
    const syns = vocab.synonyms['DROP'];
    expect(syns).toContain('DISCARD');
    expect(syns).toContain('DUMP');
  });
});

describe('extractVocabulary — BUZZ words', () => {
  const nodes = parseSexpr(BUZZ_ZIL);
  const vocab = extractVocabulary(nodes);

  test('buzzwords list is non-empty', () => {
    expect(vocab.buzzwords.length).toBeGreaterThan(0);
  });

  test('buzzwords include A, AN, THE', () => {
    expect(vocab.buzzwords).toContain('A');
    expect(vocab.buzzwords).toContain('AN');
    expect(vocab.buzzwords).toContain('THE');
  });

  test('buzzwords include AND, OF, THEN', () => {
    expect(vocab.buzzwords).toContain('AND');
    expect(vocab.buzzwords).toContain('OF');
    expect(vocab.buzzwords).toContain('THEN');
  });
});
