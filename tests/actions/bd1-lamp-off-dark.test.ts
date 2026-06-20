/**
 * BD1 — lamp-off pitch-black corpus test.
 *
 * Asserts the L41 provenance header on the corpus file and verifies the
 * engine emits "It is now pitch black." when turning off the lamp in an
 * unlit room (gverbs.zil:780-781, DGC-3).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine } from '../../tools/oracle/engine-runner.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
} from '../../src/actions/above-ground.js';

const CORPUS_PATH = join(
  import.meta.dirname,
  '../../tools/oracle/corpus/lamp-off-dark.txt',
);

const COMMANDS = [
  'north', 'east', 'open window', 'west', 'west',
  'take lamp', 'move rug', 'open trap door', 'turn on lamp',
  'down', 'look', 'turn off lamp', 'look',
] as const;

describe('BD1 — lamp-off pitch-black (DGC-3)', () => {
  it('corpus file carries dfrotz-r119 provenance header (L41)', () => {
    const raw = readFileSync(CORPUS_PATH, 'utf8');
    const lines = raw.split('\n');
    expect(lines[1]).toMatch(/^# generated-by: dfrotz-r119 /);
  });

  it('turn off lamp in dark Cellar appends "It is now pitch black."', () => {
    resetKitchenWindowFlag();
    resetRugMoved();
    const transcript = runEngine(COMMANDS);
    // Find the turn output for "turn off lamp"
    const idx = transcript.indexOf('> turn off lamp');
    expect(idx).toBeGreaterThan(-1);
    const after = transcript.slice(idx);
    expect(after).toContain('The brass lantern is now off.');
    expect(after).toContain('It is now pitch black.');
  });

  it('subsequent look reports pitch-black grue warning', () => {
    resetKitchenWindowFlag();
    resetRugMoved();
    const transcript = runEngine(COMMANDS);
    const idx = transcript.indexOf('> look', transcript.indexOf('> turn off lamp'));
    expect(idx).toBeGreaterThan(-1);
    const after = transcript.slice(idx);
    expect(after).toContain('It is pitch black. You are likely to be eaten by a grue.');
  });
});
