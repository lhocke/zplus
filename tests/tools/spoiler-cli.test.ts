import { describe, it, expect } from 'vitest';
import { runSpoiler } from '../../tools/spoiler.js';
import { encodeSeedString } from '../../src/logic/seed-string.js';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const graph = graphData as LogicGraph;

describe('spoiler CLI', () => {
  it('--seed mode prints a seed string and the full placement list', () => {
    const out = runSpoiler(['--seed', '42']);
    expect(out).toContain('Seed string: ZR1.');
    expect(out).toContain('=== Placements (by location) ===');
    expect(out).toContain('=== Sphere-by-sphere progression order ===');
    for (const loc of graph.locations) expect(out).toContain(loc.id);
  });

  it('seed-string mode decodes and produces the identical placement to --seed mode for the same seed', () => {
    const bySeedString = runSpoiler([encodeSeedString(7, graph.logicVersion)]);
    const bySeedFlag = runSpoiler(['--seed', '7']);
    const extractPlacements = (s: string) => s.split('=== Sphere')[0];
    expect(extractPlacements(bySeedString)).toContain(extractPlacements(bySeedFlag).split('\n')[3]);
  });

  it('refuses a bad seed string with a clear message, does not throw', () => {
    expect(() => runSpoiler(['not-a-real-seed'])).not.toThrow();
    expect(runSpoiler(['not-a-real-seed'])).toContain('Failed to decode seed string');
  });
});
