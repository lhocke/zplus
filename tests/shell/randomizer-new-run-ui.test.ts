import { describe, it, expect } from 'vitest';
import { toEnginePlacementMap } from '../../src/ui/shell.js';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import { fillWithRetry } from '../../src/logic/fill.js';
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const graph = graphData as LogicGraph;

describe('toEnginePlacementMap', () => {
  it('translates every location->item placement into itemId->containerId', () => {
    const result = fillWithRetry(graph, 42);
    const placementMap = toEnginePlacementMap(graph, result.placements);
    expect(Object.keys(placementMap).length).toBe(graph.locations.length);
    for (const [itemId, containerId] of Object.entries(placementMap)) {
      const loc = Object.entries(result.placements).find(([, v]) => v === itemId)?.[0];
      expect(graph.locations.find(l => l.id === loc)?.containerId).toBe(containerId);
    }
  });
});
