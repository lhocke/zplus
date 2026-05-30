import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emitData } from '../../tools/extract-zil/emit.js';
import type { ObjectData, VocabularyData } from '../../tools/extract-zil/extract.js';
import type { SyntaxEntryRaw } from '../../tools/extract-zil/extract.js';
import type { SyntaxEntryOut } from '../../tools/extract-zil/syntax-normalize.js';

// ---------------------------------------------------------------------------
// Minimal in-memory dataset — two rooms and one object
// ---------------------------------------------------------------------------

const ROOMS: ObjectData[] = [
  {
    id: 'WEST-OF-HOUSE',
    kind: 'room',
    desc: 'West of House',
    ldesc: 'This is an open field west of a white house, with a boarded front door.',
    flags: ['Land'],
    props: {},
    synonyms: [],
    adjectives: [],
    exits: [{ dir: 'north', to: 'NORTH-OF-HOUSE' }],
  },
  {
    id: 'NORTH-OF-HOUSE',
    kind: 'room',
    desc: 'North of House',
    flags: ['Land'],
    props: {},
    synonyms: [],
    adjectives: [],
    exits: [{ dir: 'south', to: 'WEST-OF-HOUSE' }],
  },
];

const OBJECTS: ObjectData[] = [
  {
    id: 'MAILBOX',
    kind: 'container',
    desc: 'small mailbox',
    flags: ['Container', 'Open'],
    props: {},
    parent: 'WEST-OF-HOUSE',
    synonyms: ['MAILBOX', 'BOX'],
    adjectives: ['SMALL'],
  },
];

const ALL_OBJECTS = [...ROOMS, ...OBJECTS];

// The fixture uses SyntaxEntryRaw (the extractor's intermediate format).
// emitData normalizes it to SyntaxEntryOut before writing to syntax.json.
const SYNTAX: SyntaxEntryRaw[] = [
  {
    verb: 'TAKE',
    directObject: { find: 'TAKEBIT', where: ['ON-GROUND', 'IN-ROOM', 'MANY'] },
    action: 'V-TAKE',
    preAction: 'PRE-TAKE',
  },
];

const VOCAB: VocabularyData = {
  verbSynonyms: { TAKE: ['GET', 'GRAB'], LOOK: ['L'] },
  directionSynonyms: { NORTH: ['N'], SOUTH: ['S'] },
  prepSynonyms: { WITH: ['USING', 'THROUGH', 'THRU'] },
  buzzwords: ['A', 'AN', 'THE'],
};

// ---------------------------------------------------------------------------
// Test fixture — run emitData into a temp directory
// ---------------------------------------------------------------------------

let tmpDir: string;
let dataDir: string;
let domainDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'emit-test-'));
  dataDir = join(tmpDir, 'data');
  domainDir = join(tmpDir, 'domain');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// emitData — JSON files
// ---------------------------------------------------------------------------

describe('emitData — rooms.json', () => {
  test('writes valid JSON array with room records', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const raw = readFileSync(join(dataDir, 'rooms.json'), 'utf8');
    const parsed: ObjectData[] = JSON.parse(raw);
    expect(parsed).toHaveLength(2);
  });

  test('contains only room-kind entries', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: ObjectData[] = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'));
    expect(parsed.every(r => r.kind === 'room')).toBe(true);
  });

  test('room entry preserves id, desc, exits, flags', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: ObjectData[] = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'));
    const woh = parsed.find(r => r.id === 'WEST-OF-HOUSE');
    expect(woh).toBeDefined();
    expect(woh!.desc).toBe('West of House');
    expect(woh!.exits).toHaveLength(1);
    expect(woh!.exits![0].dir).toBe('north');
    expect(woh!.exits![0].to).toBe('NORTH-OF-HOUSE');
    expect(woh!.flags).toContain('Land');
  });
});

describe('emitData — objects.json', () => {
  test('writes valid JSON array with non-room records', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: ObjectData[] = JSON.parse(readFileSync(join(dataDir, 'objects.json'), 'utf8'));
    expect(parsed).toHaveLength(1);
  });

  test('contains only non-room-kind entries', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: ObjectData[] = JSON.parse(readFileSync(join(dataDir, 'objects.json'), 'utf8'));
    expect(parsed.every(r => r.kind !== 'room')).toBe(true);
  });

  test('object entry preserves id, kind, desc, parent, synonyms, flags', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: ObjectData[] = JSON.parse(readFileSync(join(dataDir, 'objects.json'), 'utf8'));
    const mb = parsed.find(o => o.id === 'MAILBOX');
    expect(mb).toBeDefined();
    expect(mb!.kind).toBe('container');
    expect(mb!.parent).toBe('WEST-OF-HOUSE');
    expect(mb!.synonyms).toContain('BOX');
  });
});

describe('emitData — syntax.json (port-native SyntaxEntryOut schema)', () => {
  test('writes valid JSON array of syntax entries', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  test('entry preserves verb and action', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(parsed[0].verb).toBe('TAKE');
    expect(parsed[0].action).toBe('V-TAKE');
  });

  test('entry has numObjects = 1 (one direct-object slot)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(parsed[0].numObjects).toBe(1);
  });

  test('entry has port-native dobjFindBit (not directObject.find)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(parsed[0].dobjFindBit).toBe('TAKEBIT');
    expect(parsed[0]).not.toHaveProperty('directObject');
  });

  test('entry has dobjLocBits = 52 (ON-GROUND+IN-ROOM+MANY = 16+32+4)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(parsed[0].dobjLocBits).toBe(52);
  });

  test('entry has preAction = PRE-TAKE (not undefined)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(parsed[0].preAction).toBe('PRE-TAKE');
  });

  test('entry has prep1 = null and prep2 = null (no prepositions)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: SyntaxEntryOut[] = JSON.parse(readFileSync(join(dataDir, 'syntax.json'), 'utf8'));
    expect(parsed[0].prep1).toBeNull();
    expect(parsed[0].prep2).toBeNull();
  });
});

describe('emitData — vocabulary.json', () => {
  test('writes valid JSON matching VocabularyData shape (three typed tables)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: VocabularyData = JSON.parse(readFileSync(join(dataDir, 'vocabulary.json'), 'utf8'));
    expect(parsed.verbSynonyms).toBeDefined();
    expect(parsed.directionSynonyms).toBeDefined();
    expect(parsed.prepSynonyms).toBeDefined();
    expect(parsed.buzzwords).toBeDefined();
  });

  test('verbSynonyms and buzzwords are preserved', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: VocabularyData = JSON.parse(readFileSync(join(dataDir, 'vocabulary.json'), 'utf8'));
    expect(parsed.verbSynonyms['TAKE']).toContain('GET');
    expect(parsed.buzzwords).toContain('THE');
  });

  test('directionSynonyms are preserved', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: VocabularyData = JSON.parse(readFileSync(join(dataDir, 'vocabulary.json'), 'utf8'));
    expect(parsed.directionSynonyms['NORTH']).toContain('N');
  });

  test('prepSynonyms are preserved', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const parsed: VocabularyData = JSON.parse(readFileSync(join(dataDir, 'vocabulary.json'), 'utf8'));
    expect(parsed.prepSynonyms['WITH']).toContain('USING');
  });
});

// ---------------------------------------------------------------------------
// emitData — src/domain/ids.ts generation
// ---------------------------------------------------------------------------

describe('emitData — ids.ts', () => {
  test('writes ids.ts file to the domain directory', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const content = readFileSync(join(domainDir, 'ids.ts'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  test('exported type is named ObjectId', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const content = readFileSync(join(domainDir, 'ids.ts'), 'utf8');
    expect(content).toContain('export type ObjectId =');
  });

  test('union contains all object ids', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const content = readFileSync(join(domainDir, 'ids.ts'), 'utf8');
    expect(content).toContain("'WEST-OF-HOUSE'");
    expect(content).toContain("'NORTH-OF-HOUSE'");
    expect(content).toContain("'MAILBOX'");
  });

  test('ids appear as a string-literal union (pipe-separated)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const content = readFileSync(join(domainDir, 'ids.ts'), 'utf8');
    // The union must use | as a separator
    expect(content).toMatch(/\|\s*'/);
  });

  test('file ends with a semicolon (well-formed TS type alias)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const content = readFileSync(join(domainDir, 'ids.ts'), 'utf8').trim();
    expect(content.endsWith(';')).toBe(true);
  });

  test('only contains ids from the input dataset (no extra entries)', () => {
    emitData(ALL_OBJECTS, SYNTAX, VOCAB, { dataDir, domainDir });
    const content = readFileSync(join(domainDir, 'ids.ts'), 'utf8');
    // Strip everything before the '=' to isolate the union
    const afterEq = content.slice(content.indexOf('=') + 1);
    // Extract all quoted tokens from the union
    const quoted = [...afterEq.matchAll(/'([^']+)'/g)].map(m => m[1]);
    const ids = ALL_OBJECTS.map(o => o.id);
    for (const q of quoted) {
      expect(ids).toContain(q);
    }
    expect(quoted).toHaveLength(ids.length);
  });
});
