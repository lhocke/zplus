/**
 * harness.test.ts
 *
 * Unit tests for the oracle harness normalizer and comparator.
 *
 * Scope: validates that the harness machinery (normalization + diffing) works
 * correctly on synthetic input.  Does NOT assert that our engine matches the
 * original Zork I binary — the engine has known gaps and faithfulness testing
 * is a separate concern.
 *
 * dfrotz -p output structure (observed):
 *   - Loading noise lines
 *   - Initial status bar: " West of House   Score: 0   Moves: 0"
 *   - Intro/copyright block
 *   - First room description (blank-line terminated)
 *   - Per-command: "> West of House   Score: 0   Moves: 1" then blank then game text
 *   NOTE: dfrotz does NOT echo the input command; only the status bar follows ">".
 */

import { describe, it, expect } from 'vitest';
import { normalizeDfrotz, normalizeEngine } from '../../tools/oracle/normalizer.js';
import { compareTurns } from '../../tools/oracle/comparator.js';
import { extractSeedFromHeader, loadCorpusItems, extractCommands } from '../../tools/oracle/run-corpus.js';

// ---------------------------------------------------------------------------
// Normalizer — dfrotz transcript
// ---------------------------------------------------------------------------

describe('normalizeDfrotz', () => {
  it('strips the dfrotz status bar and loading noise, extracts room text', () => {
    const raw = [
      'Using normal formatting.',
      'Loading /path/to/zork1.z3.',
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'ZORK I: The Great Underground Empire',
      'Infocom interactive fiction - a fantasy story',
      'Copyright (c) 1981, 1982, 1983 Infocom, Inc. All rights reserved.',
      'ZORK is a registered trademark of Infocom, Inc.',
      'Release 119 / Serial number 880429',
      '',
      'West of House',
      'You are standing in an open field west of a white house.',
      'There is a small mailbox here.',
      '',
      '> West of House                                    Score: 0        Moves: 1',
      '',
      'Opening the small mailbox reveals a leaflet.',
      '',
    ].join('\n');

    const turns = normalizeDfrotz(raw);

    // First turn: the initial room description
    expect(turns[0]?.text).toContain('West of House');
    expect(turns[0]?.text).toContain('You are standing in an open field');
    expect(turns[0]?.text).not.toContain('Score: 0');
    expect(turns[0]?.text).not.toContain('ZORK I:');
    expect(turns[0]?.text).not.toContain('Infocom interactive fiction');

    // Second turn: the "open mailbox" response
    expect(turns[1]?.text).toBe('Opening the small mailbox reveals a leaflet.');
  });

  it('strips loading noise', () => {
    const raw = [
      'Using normal formatting.',
      'Loading /some/path.z3.',
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'West of House',
      'You are in a field.',
      '',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    expect(turns[0]?.text).not.toContain('Using normal formatting');
    expect(turns[0]?.text).not.toContain('Loading');
  });

  it('splits into multiple turns on dfrotz status-bar prompt lines', () => {
    const raw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'West of House',
      'You are here.',
      '',
      '> North of House                                  Score: 0        Moves: 1',
      '',
      'North of House',
      'You walk north.',
      '',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.text).toContain('You are here.');
    expect(turns[1]?.text).toContain('North of House');
    expect(turns[1]?.text).toContain('You walk north.');
  });
});

// ---------------------------------------------------------------------------
// Normalizer — engine transcript
// ---------------------------------------------------------------------------

describe('normalizeEngine', () => {
  it('strips the engine intro banner', () => {
    const raw = [
      'ZORK I: The Great Underground Empire',
      'Copyright (c) 1981, 1982, 1983 Infocom, Inc. All rights reserved.',
      'ZORK is a registered trademark of Infocom, Inc.',
      'Revision 88 / Serial number 840726',
      '',
      'West of House',
      'You are in a field.',
      'There is a mailbox here.',
      '',
      '> open mailbox',
      'Opening the mailbox reveals a leaflet.',
      '',
    ].join('\n');

    const turns = normalizeEngine(raw);
    expect(turns[0]?.text).not.toContain('ZORK I:');
    expect(turns[0]?.text).not.toContain('Copyright');
    expect(turns[0]?.text).toContain('West of House');
    expect(turns[1]?.command).toBe('open mailbox');
    expect(turns[1]?.text).toContain('leaflet');
  });

  it('captures command from "> <cmd>" prompt lines', () => {
    const raw = [
      'West of House',
      'You are here.',
      '',
      '> go north',
      'You walk north.',
      '',
    ].join('\n');

    const turns = normalizeEngine(raw);
    expect(turns[1]?.command).toBe('go north');
  });
});

// ---------------------------------------------------------------------------
// Normalizer — hard-wrap rejoining
// ---------------------------------------------------------------------------

describe('normalizer hard-wrap rejoining', () => {
  it('rejoins lines wrapped mid-sentence', () => {
    const raw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'West of House',
      'You are standing in an open field west of a white house, with a boarded',
      'front door.',
      'There is a small mailbox here.',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    // The wrapped description should be rejoined
    expect(turns[0]?.text).toContain(
      'You are standing in an open field west of a white house, with a boarded front door.',
    );
  });

  it('preserves paragraph breaks (blank lines become \\n in output)', () => {
    // The initial status bar produces no text, so the second block (after the
    // second status-bar turn separator) becomes turns[0] after empty-filtering.
    const raw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      '> West of House                                    Score: 0        Moves: 1',
      '',
      '(Taken)',
      '',
      '"WELCOME TO ZORK!',
      '',
      'ZORK is a game."',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    // The first non-empty turn contains the leaflet text
    const leafletTurn = turns.find((t) => t.text.includes('Taken'));
    expect(leafletTurn).toBeDefined();
    expect(leafletTurn?.text).toContain('(Taken)');
    expect(leafletTurn?.text).toContain('WELCOME TO ZORK!');
    // Paragraph separator preserved
    expect(leafletTurn?.text).toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

describe('compareTurns', () => {
  it('reports exact match when texts are identical', () => {
    const dfrotz = [
      { command: '', text: 'West of House\nYou are in a field.' },
      { command: '', text: 'Opening the mailbox reveals a leaflet.' },
    ];
    const engine = [
      { command: '', text: 'West of House\nYou are in a field.' },
      { command: 'open mailbox', text: 'Opening the mailbox reveals a leaflet.' },
    ];

    const report = compareTurns(dfrotz, engine);
    expect(report.exactMatches).toBe(2);
    expect(report.divergences).toBe(0);
    expect(report.firstDivergenceIndex).toBe(-1);
  });

  it('reports divergence when texts differ', () => {
    const dfrotz = [
      { command: '', text: 'West of House' },
      { command: '', text: 'North of House\nYou are at the north.' },
    ];
    const engine = [
      { command: '', text: 'West of House' },
      { command: 'go north', text: 'North of House\nSlightly different text.' },
    ];

    const report = compareTurns(dfrotz, engine);
    expect(report.exactMatches).toBe(1);
    expect(report.divergences).toBe(1);
    expect(report.firstDivergenceIndex).toBe(1);
    expect(report.turns[1]?.match).toBe(false);
    expect(report.turns[1]?.dfrotzText).toBe('North of House\nYou are at the north.');
    expect(report.turns[1]?.engineText).toBe('North of House\nSlightly different text.');
  });

  it('handles length mismatch gracefully', () => {
    const dfrotz = [
      { command: '', text: 'Room A' },
      { command: '', text: 'Room B' },
      { command: '', text: 'Room C' },
    ];
    const engine = [{ command: '', text: 'Room A' }];

    const report = compareTurns(dfrotz, engine);
    expect(report.totalCompared).toBe(1);
    expect(report.exactMatches).toBe(1);
    expect(report.dfrotzExtra).toBe(2);
    expect(report.engineExtra).toBe(0);
  });

  it('trims leading/trailing whitespace before comparing', () => {
    const dfrotz = [{ command: '', text: '  Some text.  ' }];
    const engine = [{ command: 'look', text: 'Some text.' }];

    const report = compareTurns(dfrotz, engine);
    expect(report.exactMatches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Normalizer — ambient-line stripping (dfrotz only)
// ---------------------------------------------------------------------------

describe('normalizeDfrotz ambient-line stripping', () => {
  it('strips ambient random lines from dfrotz output (e.g. "You hear...song bird")', () => {
    const raw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'West of House',
      'You are in a field.',
      'You hear in the distance the chirping of a song bird.',
      '',
      '> West of House                                    Score: 0        Moves: 1',
      '',
      'North of House',
      'You walk north.',
      'You hear in the distance the chirping of a song bird.',
      '',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    // Ambient lines must be stripped
    expect(turns[0]?.text).not.toContain('You hear in the distance');
    expect(turns[0]?.text).toContain('You are in a field.');
    expect(turns[1]?.text).not.toContain('You hear in the distance');
    expect(turns[1]?.text).toContain('North of House');
  });

  it('strips "You hear ... in the distance" variants', () => {
    const raw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'Room',
      'Normal text.',
      'You hear nearby the chirping of a song bird.',
      '',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    expect(turns[0]?.text).not.toContain('You hear nearby');
    expect(turns[0]?.text).toContain('Normal text.');
  });
});

// ---------------------------------------------------------------------------
// Normalizer — dfrotz inline meta-verb response (verbose/brief without status bar)
// ---------------------------------------------------------------------------

describe('normalizeDfrotz inline meta-verb responses', () => {
  it('splits ">Maximum verbosity." into its own turn (not merged into initial block)', () => {
    // In dfrotz -p output, meta-verb responses like verbose appear without a
    // status-bar line: ">Maximum verbosity." is emitted inline after the initial
    // room display, before the first status-bar separator.
    const raw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'West of House',
      'You are in a field.',
      '',
      '>Maximum verbosity.',
      '',
      '> North of House                                   Score: 0        Moves: 1',
      '',
      'North of House',
      'You are at the north.',
      '',
    ].join('\n');

    const turns = normalizeDfrotz(raw);
    // Turn 0: initial room (no verbose response)
    expect(turns[0]?.text).toContain('You are in a field.');
    expect(turns[0]?.text).not.toContain('Maximum verbosity');
    // Turn 1: verbose response as its own turn
    expect(turns[1]?.text).toBe('Maximum verbosity.');
    // Turn 2: north response
    expect(turns[2]?.text).toContain('North of House');
  });

  it('handles verbose as first command — matches engine turn layout', () => {
    // The corpus files prepend "verbose" as the first command.  dfrotz emits
    // ">Maximum verbosity." before the first status-bar separator; the engine
    // emits it as its own turn.  Both must produce the same number of turns.
    const dfrotzRaw = [
      ' West of House                                    Score: 0        Moves: 0',
      '',
      'West of House',
      'You are in a field.',
      '',
      '>Maximum verbosity.',
      '',
      '> North of House                                   Score: 0        Moves: 1',
      '',
      'North of House',
      'You are here.',
    ].join('\n');

    const engineRaw = [
      'West of House',
      'You are in a field.',
      '',
      '> verbose',
      'Maximum verbosity.',
      '',
      '> north',
      'North of House',
      'You are here.',
    ].join('\n');

    const dfrotzTurns = normalizeDfrotz(dfrotzRaw);
    const engineTurns = normalizeEngine(engineRaw);
    expect(dfrotzTurns).toHaveLength(3);
    expect(engineTurns).toHaveLength(3);
    // All three turns should match
    expect(dfrotzTurns[0]?.text).toBe(engineTurns[0]?.text);
    expect(dfrotzTurns[1]?.text).toBe(engineTurns[1]?.text);
    expect(dfrotzTurns[2]?.text).toBe(engineTurns[2]?.text);
  });
});

// ---------------------------------------------------------------------------
// run-corpus seed extraction
// ---------------------------------------------------------------------------

describe('extractSeedFromHeader', () => {
  it('extracts seed from a -s N dfrotz header', () => {
    const header = [
      '# C-DAM corpus',
      '# Run with:',
      '#   dfrotz -s 1 /path/to/zork1.z3 < tools/oracle/corpus/c-dam.txt',
      '#',
      'north',
    ].join('\n');
    expect(extractSeedFromHeader(header)).toBe(1);
  });

  it('returns undefined when no seed in header', () => {
    const header = [
      '# C-SAND corpus',
      '# Run with:',
      '#   dfrotz /path/to/zork1.z3 < tools/oracle/corpus/c-sand.txt',
      '#',
      'north',
    ].join('\n');
    expect(extractSeedFromHeader(header)).toBeUndefined();
  });

  it('returns undefined when no header at all', () => {
    expect(extractSeedFromHeader('north\neast\n')).toBeUndefined();
  });

  it('stops scanning at first non-comment line', () => {
    const withSeedAfterCommands = [
      '# comment',
      'north',
      '# Run with: dfrotz -s 99 /path',
    ].join('\n');
    // The seed directive is after the first non-comment line — should NOT be found
    expect(extractSeedFromHeader(withSeedAfterCommands)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Corpus annotation parsing (~ and @resync)
// ---------------------------------------------------------------------------

describe('loadCorpusItems', () => {
  // Write a temporary in-memory corpus to test via the exported parsers.
  // We test extractCommands and loadCorpusItems together with synthetic content.

  it('extracts plain commands with rngVariable=false', () => {
    // Use extractCommands on a plain corpus
    const corpusPath = '/Users/lhocke/Code/zork-test-dam/tools/oracle/corpus/c-rainbow.txt';
    const items = loadCorpusItems(corpusPath);
    const cmds = extractCommands(items);
    expect(cmds.length).toBeGreaterThan(0);
    // All entries from c-rainbow (no ~) should be rngVariable=false
    const entries = items.filter((i) => !('kind' in i));
    for (const e of entries) {
      // c-rainbow.txt has no ~ annotations
      if (!('kind' in e)) {
        expect(e.rngVariable).toBe(false);
      }
    }
  });

  it('parses ~ prefix as rngVariable=true and strips the tilde', () => {
    // c-dam.txt now has ~kill troll with sword
    const corpusPath = '/Users/lhocke/Code/zork-test-dam/tools/oracle/corpus/c-dam.txt';
    const items = loadCorpusItems(corpusPath);
    const rngItems = items.filter((i) => !('kind' in i) && (i as { rngVariable: boolean }).rngVariable);
    expect(rngItems.length).toBeGreaterThan(0);
    // The command text should not start with ~
    for (const item of rngItems) {
      if (!('kind' in item)) {
        expect(item.command).not.toMatch(/^~/);
        expect(item.command).toContain('kill troll');
      }
    }
  });

  it('parses @resync directives', () => {
    // c-dam.txt has @resync East-West Passage
    const corpusPath = '/Users/lhocke/Code/zork-test-dam/tools/oracle/corpus/c-dam.txt';
    const items = loadCorpusItems(corpusPath);
    const resyncs = items.filter((i) => 'kind' in i);
    expect(resyncs.length).toBeGreaterThan(0);
    if ('kind' in resyncs[0]!) {
      expect(resyncs[0]!.pattern).toBe('East-West Passage');
    }
  });

  it('excludes @resync and # lines from extractCommands', () => {
    const corpusPath = '/Users/lhocke/Code/zork-test-dam/tools/oracle/corpus/c-dam.txt';
    const items = loadCorpusItems(corpusPath);
    const cmds = extractCommands(items);
    // Commands must not contain @resync or start with #
    for (const c of cmds) {
      expect(c).not.toMatch(/^@resync/);
      expect(c).not.toMatch(/^#/);
      expect(c).not.toMatch(/^~/);
    }
  });
});

// ---------------------------------------------------------------------------
// Comparator — structural matching and @resync support
// ---------------------------------------------------------------------------

describe('compareTurns with annotation metadata', () => {
  it('uses structural-landmark comparison for rngVariable=true entries', () => {
    // The annotated compareTurns path always consumes dfrotz[0]/engine[0] as the
    // "initial" room turn (pre-command output).  Provide a matching initial turn,
    // then the two command turns.
    const dfrotz = [
      { command: '', text: 'West of House\nYou are here.' },   // initial (turn 0)
      { command: '', text: 'Troll Room\nWith a mighty swing, you score a partial hit!' },
      { command: '', text: 'East-West Passage\nYou are here.' },
    ];
    const engine = [
      { command: '', text: 'West of House\nYou are here.' },   // initial (turn 0)
      { command: '', text: 'Troll Room\nThe troll hits you with a glancing blow.' },
      { command: '', text: 'East-West Passage\nYou are here.' },
    ];
    const items = [
      { command: 'kill troll with sword', rngVariable: true },
      { command: 'east', rngVariable: false },
    ];

    const report = compareTurns(dfrotz, engine, items);
    // Turn 0: initial room (exact match, added automatically)
    expect(report.turns[0]?.kind).toBe('exact');
    // Turn 1: structural match (room name "Troll Room" matches, combat text differs)
    expect(report.structuralMatches).toBe(1);
    expect(report.turns[1]?.match).toBe(true);
    expect(report.turns[1]?.kind).toBe('structural');
    // Turn 2: exact match (east → east-west passage)
    expect(report.exactMatches).toBe(2); // initial + east
    expect(report.turns[2]?.match).toBe(true);
    expect(report.turns[2]?.kind).toBe('exact');
    expect(report.divergences).toBe(0);
  });

  it('marks structural turns as skipped (not diverged) when room name differs', () => {
    // rngVariable=true turns are NEVER counted as divergences — they are annotated
    // as "expected to vary" and get kind='skipped' when structural landmarks differ.
    const dfrotz = [
      { command: '', text: 'West of House\nYou are here.' },   // initial
      { command: '', text: 'Troll Room\nWith a mighty swing!' },
    ];
    const engine = [
      { command: '', text: 'West of House\nYou are here.' },   // initial
      { command: '', text: 'Different Room\nThe troll hits you.' },
    ];
    const items = [{ command: 'kill troll', rngVariable: true }];

    const report = compareTurns(dfrotz, engine, items);
    // rng-variable turns are always "pass" — divergence=0
    expect(report.divergences).toBe(0);
    expect(report.turns[1]?.kind).toBe('skipped'); // annotated RNG skip
    expect(report.skipped).toBe(1);
  });

  it('skips turns during @resync and does not count them as divergences', () => {
    // dfrotz has extra combat turns before the resync pattern; engine aligns sooner.
    // Both transcripts start with a matching initial turn.
    const dfrotz = [
      { command: '', text: 'West of House\nYou are here.' },   // initial
      { command: '', text: 'Troll Room\nThe troll attacks.' },
      { command: '', text: 'Troll Room\nA critical hit!' },
      { command: '', text: 'East-West Passage\nYou are in the passage.' },
      { command: '', text: 'Round Room\nYou are in a round room.' },
    ];
    const engine = [
      { command: '', text: 'West of House\nYou are here.' },   // initial
      { command: '', text: 'East-West Passage\nYou are in the passage.' },
      { command: '', text: 'Round Room\nYou are in a round room.' },
    ];
    const items = [
      { kind: 'resync' as const, pattern: 'east-west passage' },
      { command: 'east', rngVariable: false },
    ];

    const report = compareTurns(dfrotz, engine, items);
    // Two dfrotz turns were skipped (troll attacks, critical hit); then east-west passage aligned
    expect(report.skipped).toBeGreaterThan(0);
    expect(report.divergences).toBe(0);
  });

  it('falls back to exact comparison when no corpusItems provided', () => {
    const dfrotz = [{ command: '', text: 'Same text.' }];
    const engine = [{ command: '', text: 'Same text.' }];
    const report = compareTurns(dfrotz, engine);
    expect(report.exactMatches).toBe(1);
    expect(report.divergences).toBe(0);
  });
});
