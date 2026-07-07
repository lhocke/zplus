/**
 * BD7 — chimney-arrival brief revisit (DGC-7).
 *
 * UP-CHIMNEY-FUNCTION (1actions.zil:553) returns KITCHEN as the destination.
 * When the player already visited KITCHEN (Flag.Touched set on first entry),
 * the arrival via chimney UP must render the abbreviated revisit view:
 * room name + objects only, no ldesc body.
 *
 * dfrotz R119 move 15 (corpus chimney-arrival.txt, turn "up") confirms
 * exactly: "Kitchen\n<bottle lines>" with no ldesc paragraph.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine } from '../../tools/oracle/engine-runner.js';

const CORPUS_PATH = join(
  import.meta.dirname,
  '../../tools/oracle/corpus/chimney-arrival.txt',
);

// Commands that take the player: window → Kitchen (first visit) →
// underground → Studio → UP chimney → Kitchen (brief revisit).
const COMMANDS = [
  'north', 'east', 'open window',
  'west',           // → Kitchen (first visit; Flag.Touched set)
  'west',           // → Living Room
  'take lamp', 'move rug', 'open trap door', 'turn on lamp',
  'down',           // → Cellar
  'south',          // → East of Chasm
  'east',           // → Gallery
  'take painting',
  'north',          // → Studio
  'up',             // UP-CHIMNEY-FUNCTION → Kitchen (brief revisit)
] as const;

describe('BD7 — chimney arrival brief revisit (DGC-7)', () => {
  it('corpus file carries dfrotz-r119 provenance header (L41)', () => {
    const raw = readFileSync(CORPUS_PATH, 'utf8');
    const lines = raw.split('\n');
    expect(lines[1]).toMatch(/^# generated-by: dfrotz-r119 /);
  });

  it('chimney UP into already-visited Kitchen shows brief arrival (name + objects, no ldesc)', async () => {
    const transcript = await runEngine(COMMANDS);

    // Find the last "> up" (the chimney ascent, not an earlier one).
    const lastUp = transcript.lastIndexOf('> up');
    expect(lastUp).toBeGreaterThan(-1);
    const after = transcript.slice(lastUp);

    // Room name appears.
    expect(after).toContain('Kitchen');
    // Objects from the table appear (DESCRIBE-OBJECTS outside V? gate).
    expect(after).toContain('bottle');
    // Brief mode: ldesc body must NOT be present.
    expect(after).not.toContain('kitchen of the white house');
    expect(after).not.toContain('A table seems to have been used');
  });
});
