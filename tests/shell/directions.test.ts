import { describe, it, expect } from 'vitest';
import { parseDirection, opposite } from '../../src/ui/directions.js';
import type { Dir } from '../../src/domain/game-object.js';

describe('parseDirection — direct tokens', () => {
  it.each([
    ['n',     'north'],
    ['north', 'north'],
    ['s',     'south'],
    ['south', 'south'],
    ['e',     'east'],
    ['east',  'east'],
    ['w',     'west'],
    ['west',  'west'],
    ['ne',    'ne'],
    ['nw',    'nw'],
    ['se',    'se'],
    ['sw',    'sw'],
    ['u',     'up'],
    ['up',    'up'],
    ['d',     'down'],
    ['down',  'down'],
    ['in',    'in'],
    ['out',   'out'],
  ] as [string, Dir][])('"%s" → %s', (input, expected) => {
    expect(parseDirection(input)).toBe(expected);
  });
});

describe('parseDirection — go <dir> synonyms', () => {
  it.each([
    ['go north', 'north'],
    ['go n',     'north'],
    ['go south', 'south'],
    ['go e',     'east'],
    ['go up',    'up'],
    ['go in',    'in'],
  ] as [string, Dir][])('"%s" → %s', (input, expected) => {
    expect(parseDirection(input)).toBe(expected);
  });
});

describe('parseDirection — non-movement returns null', () => {
  it.each([
    'look',
    'take lamp',
    'enter window',
    'open mailbox',
    'inventory',
    'examine sword',
    'climb tree',
    '',
  ])('"%s" → null', (input) => {
    expect(parseDirection(input)).toBeNull();
  });
});

describe('opposite — full compass table', () => {
  it.each([
    ['north', 'south'],
    ['south', 'north'],
    ['east',  'west'],
    ['west',  'east'],
    ['ne',    'sw'],
    ['sw',    'ne'],
    ['nw',    'se'],
    ['se',    'nw'],
    ['up',    'down'],
    ['down',  'up'],
    ['in',    'out'],
    ['out',   'in'],
  ] as [Dir, Dir][])('%s ↔ %s', (dir, expected) => {
    expect(opposite(dir)).toBe(expected);
  });
});
