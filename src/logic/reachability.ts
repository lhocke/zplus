// src/logic/reachability.ts
import type { LogicGraph, AccessRule } from './logic-graph-types.js';

export interface ReachabilityContext {
  ownedItems: ReadonlySet<string>;
  flags: ReadonlySet<string>;
}

export interface ReachabilityResult {
  reachableRegions: Set<string>;
  reachableLocations: Set<string>;
}

function evaluate(
  rule: AccessRule,
  ctx: ReachabilityContext,
  reachableRegions: ReadonlySet<string>,
): boolean {
  if (rule.needs !== undefined && !rule.needs.every(id => ctx.ownedItems.has(id))) return false;
  if (rule.flags !== undefined && !rule.flags.every(f => ctx.flags.has(f))) return false;
  if (rule.region !== undefined && !reachableRegions.has(rule.region)) return false;
  if (rule.all !== undefined && !rule.all.every(sub => evaluate(sub, ctx, reachableRegions))) return false;
  if (rule.any !== undefined && !rule.any.some(sub => evaluate(sub, ctx, reachableRegions))) return false;
  return true;
}

/**
 * Pure fixpoint evaluator: which regions and locations are reachable given
 * an owned-items set and a flags set. Regions are resolved to a fixpoint
 * first (a region can require another region), then locations are checked
 * against the final reachable-regions set. No mutation, no I/O — safe to
 * call many times per fill step.
 */
export function computeReachable(graph: LogicGraph, ctx: ReachabilityContext): ReachabilityResult {
  const reachableRegions = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of graph.regions) {
      if (reachableRegions.has(region.id)) continue;
      if (evaluate(region.access, ctx, reachableRegions)) {
        reachableRegions.add(region.id);
        changed = true;
      }
    }
  }

  const reachableLocations = new Set<string>();
  for (const loc of graph.locations) {
    if (!reachableRegions.has(loc.region)) continue;
    if (evaluate(loc.access, ctx, reachableRegions)) reachableLocations.add(loc.id);
  }

  return { reachableRegions, reachableLocations };
}
