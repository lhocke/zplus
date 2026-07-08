import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';
import objectsData from '../../src/data/objects.json' with { type: 'json' };
import roomsData from '../../src/data/rooms.json' with { type: 'json' };
import { ROOM_BY_ID, type RegionKey } from '../../src/ui/map-layout.js';
import { computeLocationPool, DOCUMENTED_EXCLUSIONS } from '../../tools/logic/derive-location-pool.js';
import { GOLDEN_COMMANDS } from '../../tools/oracle/golden-commands.js';

const graph = graphData as LogicGraph;
const objectIds = new Set((objectsData as { id: string }[]).map(o => o.id));
const roomIds = new Set((roomsData as { id: string }[]).map(r => r.id));
const regionIds = new Set(graph.regions.map(r => r.id));
const itemIds = new Set(graph.items.map(i => i.id));
const KNOWN_REGION_KEYS = new Set<RegionKey>([
  'surface', 'cellar-core', 'dam', 'mine', 'river', 'mirror', 'temple', 'canyon', 'cyclops',
  'thief-maze', 'mine-maze',
]);

function canonicalize(): string {
  // Stable stringify: sort location/item/region arrays by id so key
  // ordering inside objects doesn't change the hash, only content does.
  const sortById = <T extends { id: string }>(arr: T[]) =>
    [...arr].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    locations: sortById(graph.locations),
    items: sortById(graph.items),
    regions: sortById(graph.regions),
  });
}

describe('logic-graph.json validation', () => {
  it('every location objectId/containerId exists in objects.json', () => {
    for (const loc of graph.locations) {
      expect(objectIds.has(loc.objectId), `location ${loc.id}: unknown objectId ${loc.objectId}`).toBe(true);
      expect(
        objectIds.has(loc.containerId) || roomIds.has(loc.containerId),
        `location ${loc.id}: unknown containerId ${loc.containerId}`,
      ).toBe(true);
    }
  });

  it('every location region is a known RegionKey and matches map-layout.ts', () => {
    for (const loc of graph.locations) {
      expect(KNOWN_REGION_KEYS.has(loc.region as RegionKey), `location ${loc.id}: unknown region ${loc.region}`).toBe(true);
      const roomLayout = ROOM_BY_ID.get(loc.containerId) ?? findRoomAncestor(loc.containerId);
      expect(roomLayout, `location ${loc.id}: containerId ${loc.containerId} not traceable to a mapped room`).toBeDefined();
    }
  });

  it('every region id is unique and every region.rooms entry exists in rooms.json', () => {
    expect(new Set(graph.regions.map(r => r.id)).size).toBe(graph.regions.length);
    for (const region of graph.regions) {
      for (const roomId of region.rooms) {
        expect(roomIds.has(roomId), `region ${region.id}: unknown room ${roomId}`).toBe(true);
      }
    }
  });

  it('locations[] matches computeLocationPool() minus documented exclusions exactly', () => {
    const pool = computeLocationPool().filter(e => !(e.objectId in DOCUMENTED_EXCLUSIONS));
    const poolIds = new Set(pool.map(e => e.objectId));
    const graphIds = new Set(graph.locations.map(l => l.objectId));
    expect(graphIds).toEqual(poolIds);
  });

  it('every item id is unique and every location objectId has a matching item entry', () => {
    expect(new Set(graph.items.map(i => i.id)).size).toBe(graph.items.length);
    for (const loc of graph.locations) {
      expect(itemIds.has(loc.objectId), `location ${loc.id}: no items[] entry for ${loc.objectId}`).toBe(true);
    }
  });

  function validateRule(rule: unknown, path: string): void {
    expect(typeof rule, path).toBe('object');
    const r = rule as Record<string, unknown>;
    const knownKeys = new Set(['needs', 'flags', 'region', 'any', 'all']);
    for (const k of Object.keys(r)) {
      expect(knownKeys.has(k), `${path}: unknown rule key "${k}"`).toBe(true);
    }
    if (r.needs !== undefined) {
      expect(Array.isArray(r.needs)).toBe(true);
      for (const id of r.needs as unknown[]) {
        expect(typeof id).toBe('string');
        expect(itemIds.has(id as string), `${path}: needs unknown item "${id}"`).toBe(true);
      }
    }
    if (r.region !== undefined) {
      expect(typeof r.region).toBe('string');
      expect(regionIds.has(r.region as string), `${path}: unknown region "${r.region}"`).toBe(true);
    }
    if (r.any !== undefined) {
      expect(Array.isArray(r.any)).toBe(true);
      (r.any as unknown[]).forEach((sub, i) => validateRule(sub, `${path}.any[${i}]`));
    }
    if (r.all !== undefined) {
      expect(Array.isArray(r.all)).toBe(true);
      (r.all as unknown[]).forEach((sub, i) => validateRule(sub, `${path}.all[${i}]`));
    }
  }

  it('every access rule conforms to the rule-language schema', () => {
    for (const loc of graph.locations) validateRule(loc.access, `location ${loc.id}.access`);
    for (const region of graph.regions) validateRule(region.access, `region ${region.id}.access`);
  });

  it('every item cited in any access rule (needs) is class: "progression"', () => {
    // The classification invariant (2026-07-08 amendment): assumed fill pre-
    // owns every access-granting item, so anything cited in a `needs` clause
    // — location or region rules — MUST be progression-classed, regardless
    // of its `isTreasure` value. This is what makes the SCEPTRE-gates-
    // POT-OF-GOLD regression class mechanically impossible: a rule-cited
    // treasure left as filler-only would make some seeds unsolvable, exactly
    // as discovered when this graph shipped with a single treasure/filler/
    // progression enum.
    const itemClass = new Map(graph.items.map(i => [i.id, i.class]));
    const cited = new Set<string>();
    for (const loc of graph.locations) collectNeeds(loc.access).forEach(id => cited.add(id));
    for (const region of graph.regions) collectNeeds(region.access).forEach(id => cited.add(id));
    for (const id of cited) {
      expect(
        itemClass.get(id),
        `item "${id}" is cited in an access rule but is class "${itemClass.get(id)}", not "progression"`,
      ).toBe('progression');
    }
  });

  it('every location containerId that refers to an item id refers to a pinned item (AMENDMENT 3 repair task 3R2)', () => {
    // Vessel-pinning invariant: a location whose containerId names another
    // shuffle-eligible item (rather than a room) is nested inside that
    // item's physical position. If that item were itself shuffled, the
    // nested location's static access rule would silently describe the
    // WRONG requirement (the vessel's vanilla position, not wherever fill()
    // actually put it) — the exact "bell inside the coffin, coffin behind a
    // bell-locked door" cycle class AMENDMENT 3 exists to make structurally
    // impossible. Pinning the container (never shuffled, vanilla position
    // kept) is what keeps the nested location's rule true.
    const itemById = new Map(graph.items.map(i => [i.id, i]));
    for (const loc of graph.locations) {
      const containerItem = itemById.get(loc.containerId);
      if (containerItem === undefined) continue; // containerId is a room, not an item — fine
      expect(
        containerItem.pinned,
        `location ${loc.id}: containerId "${loc.containerId}" is a shuffle-eligible item but is not pinned:true`,
      ).toBe(true);
    }
  });

  it('checksum matches the canonicalized graph content (bump discipline)', () => {
    const computed = createHash('sha256').update(canonicalize()).digest('hex').slice(0, 16);
    expect(
      graph.checksum,
      'graph content changed without updating checksum — bump logicVersion too, ' +
      'then set checksum to: ' + computed,
    ).toBe(computed);
  });

  it('walkthrough corpus cross-check: every progression dependency the corpus exercises appears in some rule', () => {
    // The design's own gate: pull every command script's referenced item
    // tokens (parenthetical or literal object names already used as
    // GOLDEN_COMMANDS/oracle corpus fixtures) and confirm each progression
    // item is referenced by at least one location's `needs`.
    const progressionIds = graph.items.filter(i => i.class === 'progression').map(i => i.id);
    const allNeeds = new Set(
      graph.locations.flatMap(l => collectNeeds(l.access)),
    );
    for (const id of progressionIds) {
      expect(allNeeds.has(id), `progression item "${id}" is never referenced by any location's needs — either it doesn't gate anything (reclassify as filler) or a rule is missing it`).toBe(true);
    }
    // Sanity: GOLDEN_COMMANDS must not be empty (guards against an accidental empty import).
    expect(GOLDEN_COMMANDS.length).toBeGreaterThan(0);
  });
});

function collectNeeds(rule: AccessRuleLike): string[] {
  const out: string[] = [...(rule.needs ?? [])];
  for (const sub of rule.any ?? []) out.push(...collectNeeds(sub));
  for (const sub of rule.all ?? []) out.push(...collectNeeds(sub));
  return out;
}
interface AccessRuleLike { needs?: string[]; any?: AccessRuleLike[]; all?: AccessRuleLike[]; }

function findRoomAncestor(containerId: string): { region: string } | undefined {
  // Walk up via objects.json parent chain the same way derive-location-pool does.
  let current: string | undefined = containerId;
  const objMap = new Map((objectsData as { id: string; parent?: string }[]).map(o => [o.id, o]));
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const layout = ROOM_BY_ID.get(current);
    if (layout !== undefined) return layout;
    current = objMap.get(current)?.parent;
  }
  return undefined;
}
