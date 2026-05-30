import { describe, expect, it } from 'vitest';
import { tokenize, splitChained } from '../../src/engine/parser/tokenizer';

describe('tokenize', () => {
  it('lowercases input', () => {
    expect(tokenize('OPEN MAILBOX')).toEqual(['open', 'mailbox']);
  });

  it('drops articles: a, an, the', () => {
    expect(tokenize('open the mailbox')).toEqual(['open', 'mailbox']);
    expect(tokenize('take a lamp')).toEqual(['take', 'lamp']);
    expect(tokenize('read an inscription')).toEqual(['read', 'inscription']);
  });

  it('keeps adjectives', () => {
    expect(tokenize('open the small mailbox')).toEqual(['open', 'small', 'mailbox']);
    expect(tokenize('take brass lantern')).toEqual(['take', 'brass', 'lantern']);
  });

  it('handles extra whitespace', () => {
    expect(tokenize('  open   the   mailbox  ')).toEqual(['open', 'mailbox']);
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

describe('splitChained', () => {
  it('returns a single segment for a plain command', () => {
    expect(splitChained('open mailbox')).toEqual([['open', 'mailbox']]);
  });

  it('splits on "." producing tokenized segments', () => {
    const result = splitChained('n. e. take lamp');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(['n']);
    expect(result[1]).toEqual(['e']);
    expect(result[2]).toEqual(['take', 'lamp']);
  });

  it('splits on "then"', () => {
    const result = splitChained('open mailbox then read leaflet');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['open', 'mailbox']);
    expect(result[1]).toEqual(['read', 'leaflet']);
  });

  it('splits on both "." and "then" in one input', () => {
    const result = splitChained('n. open door then go west');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(['n']);
    expect(result[1]).toEqual(['open', 'door']);
    expect(result[2]).toEqual(['go', 'west']);
  });

  it('drops articles within each chained segment', () => {
    const result = splitChained('open the mailbox. read the leaflet');
    expect(result[0]).toEqual(['open', 'mailbox']);
    expect(result[1]).toEqual(['read', 'leaflet']);
  });

  it('ignores empty segments from consecutive separators', () => {
    const result = splitChained('n.. e');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['n']);
    expect(result[1]).toEqual(['e']);
  });
});
