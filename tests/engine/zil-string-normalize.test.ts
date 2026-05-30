/**
 * Tests for ZIL string normalization.
 *
 * In ZIL, a '|' character inside a string literal means "newline" (the
 * equivalent of a CRLF line break in the output). A bare newline inside the
 * string source is just a word separator (collapses to a single space).
 *
 * normalizeZilString must:
 *   - Replace every '|' with '\n'.
 *   - Collapse sequences of (whitespace* newline whitespace*) inside the
 *     string to a single space (ZIL source line-break = word separator).
 */

import { describe, test, expect } from 'vitest';
import { normalizeZilString } from '../../tools/extract-zil/extract.js';
import { extractObjects } from '../../tools/extract-zil/extract.js';
import { parseSexpr } from '../../tools/extract-zil/parse-sexpr.js';

// ---------------------------------------------------------------------------
// Unit tests for normalizeZilString
// ---------------------------------------------------------------------------

describe('normalizeZilString', () => {
  test('replaces a single | with a newline', () => {
    expect(normalizeZilString('Hello|World')).toBe('Hello\nWorld');
  });

  test('replaces multiple | chars each with a newline', () => {
    expect(normalizeZilString('A|B|C')).toBe('A\nB\nC');
  });

  test('collapses source newline + surrounding whitespace to a single space', () => {
    // ZIL source-level line continuation: "foo\n   bar" → "foo bar"
    expect(normalizeZilString('foo\n   bar')).toBe('foo bar');
  });

  test('handles | at start and end', () => {
    expect(normalizeZilString('|text|')).toBe('\ntext\n');
  });

  test('representative leaflet fixture: | → newlines, source newlines → spaces', () => {
    // Mimics the leaflet TEXT value as it comes out of the s-expr parser:
    //   "WELCOME TO ZORK!|\n|\nZORK is a game of adventure, danger..."
    const input = '"WELCOME TO ZORK!|\n|\nZORK is a game of adventure, danger, and low cunning. In it you\nwill explore some of the most amazing territory ever seen by mortals.\nNo computer should be without one!"';
    const result = normalizeZilString(input);
    expect(result).not.toContain('|');
    // The | chars become \n; source newlines become spaces
    expect(result).toContain('WELCOME TO ZORK!\n\nZORK');
    expect(result).toContain('In it you will explore');
  });
});

// ---------------------------------------------------------------------------
// Integration: extractor applies normalization to string fields
// ---------------------------------------------------------------------------

describe('extractObjects — ZIL string normalization applied', () => {
  const LEAFLET_ZIL = `<OBJECT ADVERTISEMENT
  (IN MAILBOX)
  (SYNONYM ADVERTISEMENT LEAFLET BOOKLET MAIL)
  (ADJECTIVE SMALL)
  (DESC "leaflet")
  (FLAGS READBIT TAKEBIT BURNBIT)
  (TEXT
"WELCOME TO ZORK!|
|
ZORK is a game of adventure, danger, and low cunning. In it you
will explore some of the most amazing territory ever seen by mortals.
No computer should be without one!")
  (SIZE 2)>`;

  const results = extractObjects(parseSexpr(LEAFLET_ZIL));
  const text = results[0]?.props?.['TEXT'] as string | undefined;

  test('TEXT prop is extracted', () => {
    expect(text).toBeDefined();
  });

  test('TEXT prop contains no | characters', () => {
    expect(text).not.toContain('|');
  });

  test('TEXT prop has newline where | was', () => {
    // "WELCOME TO ZORK!|" → "WELCOME TO ZORK!\n"
    expect(text).toContain('WELCOME TO ZORK!\n');
  });

  test('TEXT prop collapses source newlines to spaces', () => {
    // "In it you\nwill explore" → "In it you will explore"
    expect(text).toContain('In it you will explore');
  });
});
