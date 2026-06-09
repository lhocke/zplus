import type { Dir } from '../domain/game-object.js';

// Canonical direction aliases (lowercase input → Dir).
const ALIASES: Record<string, Dir> = {
  n: 'north', north: 'north',
  s: 'south', south: 'south',
  e: 'east',  east:  'east',
  w: 'west',  west:  'west',
  ne: 'ne', nw: 'nw', se: 'se', sw: 'sw',
  u: 'up',   up:   'up',
  d: 'down', down: 'down',
  in: 'in',  out:  'out',
};

// Compass-opposite pairs (bidirectional).
const OPPOSITE_MAP: Record<Dir, Dir> = {
  north: 'south', south: 'north',
  east:  'west',  west:  'east',
  ne:    'sw',    sw:    'ne',
  nw:    'se',    se:    'nw',
  up:    'down',  down:  'up',
  in:    'out',   out:   'in',
};

/**
 * Parse a raw player command into a canonical Dir token.
 * Recognises n/north/s/south/…/in/out and "go <dir>" synonyms.
 * Returns null for non-movement commands (look, take lamp, etc.).
 */
export function parseDirection(input: string): Dir | null {
  const trimmed = input.trim().toLowerCase();
  // Direct token.
  if (Object.prototype.hasOwnProperty.call(ALIASES, trimmed)) {
    return ALIASES[trimmed]!;
  }
  // "go <dir>" synonym.
  const goMatch = trimmed.match(/^go\s+(\S+)$/);
  if (goMatch) {
    const token = goMatch[1]!;
    if (Object.prototype.hasOwnProperty.call(ALIASES, token)) {
      return ALIASES[token]!;
    }
  }
  return null;
}

/**
 * Return the compass-opposite of a Dir.
 * Throws if called with an unrecognised token (defensive; callers always
 * pass a Dir value).
 */
export function opposite(dir: Dir): Dir {
  return OPPOSITE_MAP[dir];
}
