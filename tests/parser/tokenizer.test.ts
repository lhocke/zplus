/**
 * Tokenizer tests — Wave C1
 *
 * Tests for the new Token[] tokenizer.  Key behaviors:
 *  - SIBREAKS (period, comma, double-quote) become standalone tokens
 *  - Nothing is dropped up front — articles, buzzwords, structural words
 *    (AND/ALL/BUT/THEN) are all preserved for the scan loop to handle
 *  - "n,e" → ['n', ',', 'e']   (comma is a standalone SIBREAK token)
 *  - "then" is preserved as-is (not consumed as a segment boundary here)
 *  - splitChained is gone — lazy drive is Wave C9 / Game.turn
 */
import { describe, expect, it } from 'vitest';
import { tokenize, SIBREAK_CHARS } from '../../src/engine/parser/tokenizer';

describe('tokenize — basic word splitting', () => {
  it('lowercases input', () => {
    expect(tokenize('OPEN MAILBOX')).toEqual(['open', 'mailbox']);
  });

  it('handles extra whitespace', () => {
    expect(tokenize('  open   the   mailbox  ')).toEqual(['open', 'the', 'mailbox']);
  });

  it('produces an empty array for blank input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('handles single-word compass abbreviations', () => {
    expect(tokenize('n')).toEqual(['n']);
    expect(tokenize('go north')).toEqual(['go', 'north']);
  });
});

describe('tokenize — articles and buzzwords are PRESERVED (not dropped)', () => {
  it('keeps "the" in the token stream', () => {
    expect(tokenize('open the mailbox')).toEqual(['open', 'the', 'mailbox']);
  });

  it('keeps "a" in the token stream', () => {
    expect(tokenize('take a lamp')).toEqual(['take', 'a', 'lamp']);
  });

  it('keeps "an" in the token stream', () => {
    expect(tokenize('read an inscription')).toEqual(['read', 'an', 'inscription']);
  });

  it('keeps "and" as a structural token', () => {
    expect(tokenize('take lamp and sword')).toEqual(['take', 'lamp', 'and', 'sword']);
  });

  it('keeps "all" as a structural token', () => {
    expect(tokenize('take all')).toEqual(['take', 'all']);
  });

  it('keeps "but" as a structural token', () => {
    expect(tokenize('take all but lamp')).toEqual(['take', 'all', 'but', 'lamp']);
  });

  it('keeps "then" as a structural token', () => {
    expect(tokenize('open mailbox then read it')).toEqual([
      'open', 'mailbox', 'then', 'read', 'it',
    ]);
  });
});

describe('tokenize — SIBREAKS become standalone tokens', () => {
  it('period becomes a standalone token', () => {
    expect(tokenize('n. e')).toEqual(['n', '.', 'e']);
  });

  it('period with no trailing word', () => {
    expect(tokenize('n.')).toEqual(['n', '.']);
  });

  it('comma becomes a standalone token', () => {
    expect(tokenize('n,e')).toEqual(['n', ',', 'e']);
  });

  it('"n,e,s" produces comma-delimited direction tokens', () => {
    expect(tokenize('n,e,s')).toEqual(['n', ',', 'e', ',', 's']);
  });

  it('double-quote becomes a standalone token', () => {
    const result = tokenize('say "hello"');
    expect(result).toEqual(['say', '"', 'hello', '"']);
  });

  it('consecutive periods each become standalone tokens', () => {
    // "n.. e" → n, ., ., e  (two separate SIBREAK tokens)
    expect(tokenize('n.. e')).toEqual(['n', '.', '.', 'e']);
  });

  it('period directly attached to a word', () => {
    expect(tokenize('open mailbox. read it')).toEqual([
      'open', 'mailbox', '.', 'read', 'it',
    ]);
  });

  it('comma directly attached to words', () => {
    expect(tokenize('north,east,south')).toEqual([
      'north', ',', 'east', ',', 'south',
    ]);
  });
});

describe('tokenize — adjectives and nouns preserved', () => {
  it('keeps adjectives', () => {
    expect(tokenize('open the small mailbox')).toEqual(['open', 'the', 'small', 'mailbox']);
    expect(tokenize('take brass lantern')).toEqual(['take', 'brass', 'lantern']);
  });
});

describe('SIBREAK_CHARS constant', () => {
  it('contains the three SIBREAK characters', () => {
    expect(SIBREAK_CHARS.has('.')).toBe(true);
    expect(SIBREAK_CHARS.has(',')).toBe(true);
    expect(SIBREAK_CHARS.has('"')).toBe(true);
    expect(SIBREAK_CHARS.size).toBe(3);
  });
});
