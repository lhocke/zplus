// tests/logic/reachability.test.ts
import { describe, it, expect } from 'vitest';
import { computeReachable } from '../../src/logic/reachability.js';
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';

const TINY_GRAPH: LogicGraph = {
  logicVersion: 1,
  checksum: 'test',
  regions: [
    { id: 'start', rooms: ['A'], access: {} },
    { id: 'locked', rooms: ['B'], access: { needs: ['key'] } },
    { id: 'chained', rooms: ['C'], access: { region: 'locked' } },
  ],
  items: [
    { id: 'key', class: 'progression' },
    { id: 'treasure1', class: 'treasure' },
  ],
  locations: [
    { id: 'loc-a', objectId: 'key', containerId: 'A', region: 'start', access: {} },
    { id: 'loc-b', objectId: 'treasure1', containerId: 'B', region: 'locked', access: {} },
    { id: 'loc-c', objectId: 'filler1', containerId: 'C', region: 'chained', access: { needs: ['key'] } },
  ],
};

describe('computeReachable', () => {
  it('with nothing owned: only the unconditional start region/location is reachable', () => {
    const r = computeReachable(TINY_GRAPH, { ownedItems: new Set(), flags: new Set() });
    expect(r.reachableRegions).toEqual(new Set(['start']));
    expect(r.reachableLocations).toEqual(new Set(['loc-a']));
  });

  it('owning the key unlocks the region chain (locked -> chained) and their locations', () => {
    const r = computeReachable(TINY_GRAPH, { ownedItems: new Set(['key']), flags: new Set() });
    expect(r.reachableRegions).toEqual(new Set(['start', 'locked', 'chained']));
    expect(r.reachableLocations).toEqual(new Set(['loc-a', 'loc-b', 'loc-c']));
  });

  it('any/all combinators evaluate correctly', () => {
    const graph: LogicGraph = {
      ...TINY_GRAPH,
      locations: [
        ...TINY_GRAPH.locations,
        { id: 'loc-d', objectId: 'filler2', containerId: 'A', region: 'start', access: { any: [{ needs: ['nope'] }, { needs: ['key'] }] } },
      ],
    };
    expect(computeReachable(graph, { ownedItems: new Set(), flags: new Set() }).reachableLocations.has('loc-d')).toBe(false);
    expect(computeReachable(graph, { ownedItems: new Set(['key']), flags: new Set() }).reachableLocations.has('loc-d')).toBe(true);
  });

  it('is a pure function: does not mutate the graph or the context sets', () => {
    const owned = new Set(['key']);
    const snapshot = JSON.stringify(TINY_GRAPH);
    computeReachable(TINY_GRAPH, { ownedItems: owned, flags: new Set() });
    expect(JSON.stringify(TINY_GRAPH)).toBe(snapshot);
    expect(owned).toEqual(new Set(['key']));
  });
});

// appended to tests/logic/reachability.test.ts
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };

describe('computeReachable against the real logic-graph.json', () => {
  const graph = graphData as LogicGraph;
  const allItems = new Set(graph.items.map(i => i.id));
  const allFlags = new Set(graph.locations.flatMap(l => l.access.flags ?? []));

  it('every region and every location is reachable when the player owns everything', () => {
    const r = computeReachable(graph, { ownedItems: allItems, flags: allFlags });
    expect(r.reachableRegions.size).toBe(graph.regions.length);
    expect(r.reachableLocations.size).toBe(graph.locations.length);
  });

  it('with nothing owned, at least the start region (surface) is reachable', () => {
    const r = computeReachable(graph, { ownedItems: new Set(), flags: new Set() });
    expect(r.reachableRegions.has('surface')).toBe(true);
  });
});
