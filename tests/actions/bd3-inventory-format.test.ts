/**
 * BD3 — V-INVENTORY PRINT-CONT rewrite (DGC-4).
 *
 * Verifies that inventory output matches dfrotz R119's PRINT-CONT format:
 *   - "A " article prefix on each carried item
 *   - "(providing light)" annotation when lamp is on
 *   - nested container contents (bottle contains water)
 * And checks the corpus file provenance header (L41).
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
  '../../tools/oracle/corpus/inventory-format.txt',
);

// Empty-handed state (start of game, before picking anything up).
const EMPTY_CMDS = ['inventory'] as const;

// Leaflet only — take leaflet, inventory.
const LEAFLET_CMDS = [
  'open mailbox', 'take leaflet', 'inventory',
] as const;

// Bottle + water (nested container) — enter kitchen, take bottle, inventory.
// Window must be opened first to enter kitchen via the east side.
const BOTTLE_CMDS = [
  'north', 'east', 'open window', 'west',  // → Kitchen
  'take bottle', 'inventory',
] as const;

// Lamp on → "(providing light)" annotation.
// Enter house, take lamp, turn it on, inventory.
const LAMP_LIT_CMDS = [
  'north', 'east', 'open window', 'west', 'west',  // → Living Room
  'take lamp', 'turn on lamp', 'inventory',
] as const;

// Lamp off → no annotation.
const LAMP_OFF_CMDS = [
  'north', 'east', 'open window', 'west', 'west',
  'take lamp', 'inventory',
] as const;

function reset() {
  resetKitchenWindowFlag();
  resetRugMoved();
}

describe('BD3 — inventory PRINT-CONT format (DGC-4)', () => {
  it('corpus file carries dfrotz-r119 provenance header (L41)', () => {
    const raw = readFileSync(CORPUS_PATH, 'utf8');
    const lines = raw.split('\n');
    expect(lines[1]).toMatch(/^# generated-by: dfrotz-r119 /);
  });

  it('empty-handed stays as-is', async () => {
    reset();
    const out = await runEngine(EMPTY_CMDS);
    expect(out).toContain('You are empty-handed.');
  });

  it('single item uses "A " article prefix', async () => {
    reset();
    const out = await runEngine(LEAFLET_CMDS);
    expect(out).toContain('You are carrying:');
    expect(out).toContain('  A leaflet');
    // old flat-list form must be gone
    expect(out).not.toContain('\n  leaflet\n');
  });

  it('transparent container shows nested contents', async () => {
    reset();
    const out = await runEngine(BOTTLE_CMDS);
    expect(out).toContain('You are carrying:');
    expect(out).toContain('  A glass bottle');
    expect(out).toContain('  The glass bottle contains:');
    expect(out).toContain('    A quantity of water');
  });

  it('lit lamp shows "(providing light)"', async () => {
    reset();
    const out = await runEngine(LAMP_LIT_CMDS);
    expect(out).toContain('  A brass lantern (providing light)');
  });

  it('unlit lamp has no "(providing light)"', async () => {
    reset();
    const out = await runEngine(LAMP_OFF_CMDS);
    expect(out).toContain('  A brass lantern');
    expect(out).not.toContain('providing light');
  });
});
