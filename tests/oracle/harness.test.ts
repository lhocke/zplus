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
