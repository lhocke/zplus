import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import graphData from '../../src/logic/logic-graph.json' with { type: 'json' };
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';
import objectsData from '../../src/data/objects.json' with { type: 'json' };
import roomsData from '../../src/data/rooms.json' with { type: 'json' };
import { ROOM_BY_ID, type RegionKey } from '../../src/ui/map-layout.js';
import { computeLocationPool, DOCUMENTED_EXCLUSIONS } from '../../tools/logic/derive-location-pool.js';
import { GOLDEN_COMMANDS } from '../../tools/oracle/golden-commands.js';
import { computeReachable } from '../../src/logic/reachability.js';

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

  it('troll-inventory slot is excluded and AXE is pinned (AMENDMENT 4 repair task 3R3)', () => {
    // Death-handler destruction invariant: F_DEAD on TROLL (troll-fcn.ts,
    // 1actions.zil:665-670) only ever rescues AXE — it drops the axe to the
    // room if the troll is holding it, and nothing else. If fill() ever
    // placed a DIFFERENT item in the troll's inventory slot, that item would
    // be stranded when the troll dies (no code path drops it), the same
    // permanent-destruction class AMENDMENT 4 closes for the thief. Fix:
    // exclude the troll-inventory location from the pool and pin AXE at its
    // vanilla spot, exactly like the six AMENDMENT 3 vessels — generalize
    // this pattern only if another death-handler-owned slot turns up.
    const axeItem = graph.items.find(i => i.id === 'AXE');
    expect(axeItem?.pinned, 'AXE must be pinned:true').toBe(true);
    expect(
      graph.locations.some(l => l.id === 'AXE'),
      'troll-inventory (AXE) location must not be in the pool',
    ).toBe(false);
  });

  const WEAPON_IDS = ['SWORD', 'KNIFE', 'RUSTY-KNIFE'];
  function requiresAnyWeapon(rule: AccessRuleLike): boolean {
    return (rule.any ?? []).some(
      sub => (sub.needs?.length ?? 0) === 1 && WEAPON_IDS.includes(sub.needs![0]),
    );
  }

  function requiresLampAnywhere(rule: AccessRuleLike): boolean {
    if ((rule.needs ?? []).includes('LAMP')) return true;
    if ((rule.any ?? []).some(requiresLampAnywhere)) return true;
    if ((rule.all ?? []).some(requiresLampAnywhere)) return true;
    return false;
  }

  it('troll gate: cellar-core region access requires a weapon (AMENDMENT 5 repair task 3R4)', () => {
    // cellar-core's access rule previously omitted the troll's weapon
    // requirement entirely (bare-handed kills are luck; logic never
    // requires luck). Structural check (the rule cites one of the three
    // obtainable Weapon-flagged items) plus a functional check (the region
    // is actually unreachable without one, even though the surface region
    // it gates from is trivially reachable).
    const region = graph.regions.find(r => r.id === 'cellar-core');
    expect(region, 'cellar-core region missing').toBeDefined();
    expect(
      requiresAnyWeapon(region!.access as AccessRuleLike),
      'cellar-core region access must require one of SWORD/KNIFE/RUSTY-KNIFE',
    ).toBe(true);
    const unarmed = computeReachable(graph, { ownedItems: new Set(), flags: new Set() });
    expect(unarmed.reachableRegions.has('surface'), 'surface should be trivially reachable').toBe(true);
    expect(unarmed.reachableRegions.has('cellar-core'), 'cellar-core must NOT be reachable unarmed').toBe(false);
    // A weapon alone is NOT enough post-AMENDMENT-7 (see the light-gate test
    // below): every non-Gallery cellar-core room is dark, so LAMP is also
    // required to actually traverse in.
    const weaponOnly = computeReachable(graph, { ownedItems: new Set(['SWORD']), flags: new Set() });
    expect(
      weaponOnly.reachableRegions.has('cellar-core'),
      'cellar-core must NOT be reachable on a weapon alone, with no light (AMENDMENT 7)',
    ).toBe(false);
    const armed = computeReachable(graph, { ownedItems: new Set(['SWORD', 'LAMP']), flags: new Set() });
    expect(armed.reachableRegions.has('cellar-core'), 'cellar-core must be reachable owning SWORD + LAMP').toBe(true);
  });

  it('light gate: cellar-core region access requires LAMP, and every region gated behind it inherits the requirement (AMENDMENT 7 repair task 3R6)', () => {
    // Every non-Gallery cellar-core room is dark (src/data/rooms.json — no
    // "On" flag): CELLAR, TROLL-ROOM, ROUND-ROOM, EW-PASSAGE, LOUD-ROOM,
    // NS-PASSAGE, DEEP-CANYON, CHASM-ROOM, EAST-OF-CHASM, DAMP-CAVE, STUDIO,
    // ENGRAVINGS-CAVE. The region-level access rules never modeled a light
    // requirement at all (only a handful of specific ITEM locations did:
    // mine/mine-maze's needs:[GARLIC,LAMP], temple/river/attic-table's
    // needs:[LAMP]) — so the assumed-fill solver could place LAMP itself (or
    // MATCH/CANDLES) behind a dark, weapon-only-gated region, producing a
    // genuine circular deadlock the solver cannot see (AccessRule has no
    // darkness/grue concept). Fix: cellar-core's access rule gains
    // needs:["LAMP"] alongside its existing weapon `any`. Every other
    // underground region already depends on cellar-core transitively
    // (dam, mirror, river, thief-maze all cite {"region":"cellar-core"};
    // mine cites {"region":"mirror"}; cyclops cites {"region":"thief-maze"};
    // mine-maze cites {"region":"mine", needs:[GARLIC,LAMP]}; temple cites
    // mirror or cellar-core+ROPE) — so this single fix closes the gap for
    // the entire dark underground without a per-region patch. canyon stays
    // untouched: every canyon room carries the "On" flag (it's an outdoor,
    // lit region), so it never needed a light gate.
    const region = graph.regions.find(r => r.id === 'cellar-core');
    expect(region!.access.needs, 'cellar-core region access must require LAMP').toContain('LAMP');

    const DARK_DEPENDENT_REGIONS = ['dam', 'mirror', 'river', 'thief-maze', 'mine', 'cyclops', 'mine-maze', 'temple'];
    const swordNoLamp = computeReachable(graph, { ownedItems: new Set(['SWORD']), flags: new Set() });
    for (const id of DARK_DEPENDENT_REGIONS) {
      expect(
        swordNoLamp.reachableRegions.has(id),
        `region "${id}" must NOT be reachable on a weapon alone with no light (transitively gated behind cellar-core's LAMP requirement)`,
      ).toBe(false);
    }
    const swordAndLamp = computeReachable(graph, { ownedItems: new Set(['SWORD', 'LAMP', 'GARLIC', 'ROPE']), flags: new Set() });
    for (const id of DARK_DEPENDENT_REGIONS) {
      expect(
        swordAndLamp.reachableRegions.has(id),
        `region "${id}" must be reachable once SWORD/LAMP/GARLIC/ROPE are all owned`,
      ).toBe(true);
    }
    // canyon is unaffected: fully lit, no light gate expected or wanted.
    expect(
      requiresLampAnywhere(graph.regions.find(r => r.id === 'canyon')!.access as AccessRuleLike),
      'canyon region access must stay light-free (every canyon room is lit)',
    ).toBe(false);
  });

  it('light bootstrap: at least one light source is placeable on a path that never itself requires LAMP (AMENDMENT 7 repair task 3R6)', () => {
    // The circular-deadlock class this amendment closes: LAMP/MATCH/CANDLES
    // could all land behind locations whose access rule (directly or via
    // region) needs LAMP, leaving no way to ever obtain light in the first
    // place. Structural guard: every location a light-source item could
    // occupy must NOT need LAMP itself (directly, or via its region's access
    // chain being unreachable without LAMP) — i.e. computing reachability
    // with every OTHER progression item owned (never LAMP) must reach at
    // least one empty-eligible location outside the LAMP-gated set.
    const LIGHT_SOURCE_IDS = ['LAMP', 'MATCH', 'CANDLES'];
    const progressionIds = graph.items.filter(i => i.class === 'progression').map(i => i.id);
    const ownedExceptLamp = new Set(progressionIds.filter(id => id !== 'LAMP'));
    const reach = computeReachable(graph, { ownedItems: ownedExceptLamp, flags: new Set() });
    const bootstrapCandidateLocations = graph.locations.filter(
      loc => reach.reachableLocations.has(loc.id) && !(loc.access.needs ?? []).includes('LAMP'),
    );
    expect(
      bootstrapCandidateLocations.length,
      'at least one location reachable without LAMP must exist, or no light source could ever be bootstrapped',
    ).toBeGreaterThan(0);
    // Sanity: every LIGHT_SOURCE_IDS entry is itself a placeable (has a
    // matching location) progression item, so the bootstrap guarantee above
    // actually applies to them.
    const locationObjectIds = new Set(graph.locations.map(l => l.objectId));
    for (const id of LIGHT_SOURCE_IDS) {
      const item = graph.items.find(i => i.id === id);
      expect(item?.class, `${id} must be class "progression"`).toBe('progression');
      expect(locationObjectIds.has(id), `${id} must have a matching placeable location`).toBe(true);
    }
  });

  it('thief gate: CHALICE access requires a weapon (kill-and-loot route, AMENDMENT 5 repair task 3R4)', () => {
    // CHALICE sits in TREASURE-ROOM, guarded by the thief (CHALICE-FCN,
    // zil/1actions.zil:2123-2136: "You'd be stabbed in the back first" while
    // the thief is alive and fighting) — taking it, like recovering any
    // item the thief is holding, requires defeating him first.
    const chalice = graph.locations.find(l => l.id === 'CHALICE');
    expect(chalice, 'CHALICE location missing').toBeDefined();
    expect(
      requiresAnyWeapon(chalice!.access as AccessRuleLike),
      'CHALICE access must require one of SWORD/KNIFE/RUSTY-KNIFE',
    ).toBe(true);
  });

  it('cyclops stays word-passable: no weapon requirement at the region level (AMENDMENT 5 repair task 3R4)', () => {
    // The cyclops can be scared off by the magic word (ODYSSEUS/ULYSSES,
    // zil/1actions.zil CYCLOPS-FCN) with zero combat — the design's audit
    // confirms the graph must NOT gain a weapon rule here (that would
    // over-constrain fill for no faithfulness reason).
    const region = graph.regions.find(r => r.id === 'cyclops');
    expect(region, 'cyclops region missing').toBeDefined();
    expect(
      requiresAnyWeapon(region!.access as AccessRuleLike),
      'cyclops region access must stay weapon-free (word path bypasses combat)',
    ).toBe(false);
  });

  it('CANARY (egg interior) is excludeProgression: true (AMENDMENT 5 repair task 3R4)', () => {
    // EGG-OBJECT's force-open path (src/actions/above-ground.ts badEgg(),
    // zil/1actions.zil:2919-2966) can permanently destroy the egg's
    // contents — a progression item placed here would be unrecoverable
    // through ordinary reachability play, so fill() must never place one.
    const canary = graph.locations.find(l => l.id === 'CANARY');
    expect(canary, 'CANARY location missing').toBeDefined();
    expect(
      canary!.excludeProgression,
      'CANARY (EGG interior) must be excludeProgression:true',
    ).toBe(true);
  });

  it('excludeProgression is only set true where present, and only on real location ids', () => {
    for (const loc of graph.locations) {
      if (loc.excludeProgression !== undefined) {
        expect(loc.excludeProgression, `location ${loc.id}: excludeProgression must be true or absent`).toBe(true);
      }
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
