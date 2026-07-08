// Spoiler-free tracker panel — desktop-gated (§ Task 10). Reads engine state
// and visited placements only; never reasons about a target it hasn't shown
// the player yet.
import type { LogicGraph } from '../logic/logic-graph-types.js';
import type { GameView } from '../engine/game.js';
import { REGION_DISPLAY_NAMES, type RegionKey } from './map-layout.js';
import { el } from './shell.js';

export interface TrackerRegionRow {
  region: RegionKey;
  label: string;
  checked: number;
  total: number;
}

/**
 * Pure — no DOM, easy to unit test. Computes per-region checked/total
 * counts from the current object-parent snapshot.
 *
 * "Checked" semantics (design doc Open Item, resolved in Task 10): a
 * location counts as checked once its item's live parent no longer matches
 * the location's shuffled starting containerId — i.e. the player (or the
 * thief) has moved it away from its original slot. This is intentionally
 * permissive: if the thief relocates a shuffled item to his hoard, the
 * item's parent changes and the location reads as "checked" even though the
 * player hasn't personally picked it up yet, because distinguishing
 * "thief stole it" from "player hasn't found it" would require the tracker
 * to reason about *why* something moved — which the spoiler-free contract
 * forbids. Do not "fix" this into leaking placement info: this function
 * never returns anything about an UNCHECKED location's target container. */
export function computeTrackerRows(
  graph: LogicGraph,
  currentParentByObjectId: ReadonlyMap<string, string | null>,
): TrackerRegionRow[] {
  const byRegion = new Map<string, { checked: number; total: number }>();
  for (const loc of graph.locations) {
    const bucket = byRegion.get(loc.region) ?? { checked: 0, total: 0 };
    bucket.total += 1;
    const currentParent = currentParentByObjectId.get(loc.objectId) ?? null;
    if (currentParent !== loc.containerId) bucket.checked += 1;
    byRegion.set(loc.region, bucket);
  }
  return [...byRegion.entries()]
    .map(([region, { checked, total }]) => ({
      region: region as RegionKey,
      label: REGION_DISPLAY_NAMES[region as RegionKey] ?? region,
      checked,
      total,
    }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

export function computeObtainedProgression(
  graph: LogicGraph,
  currentParentByObjectId: ReadonlyMap<string, string | null>,
  playerObjectId = 'PLAYER',
): string[] {
  const progressionIds = new Set(graph.items.filter(i => i.class === 'progression').map(i => i.id));
  return graph.locations
    .filter(loc => progressionIds.has(loc.objectId) && currentParentByObjectId.get(loc.objectId) === playerObjectId)
    .map(loc => loc.objectId);
}

export function buildTrackerPanel(graph: LogicGraph): {
  element: HTMLElement;
  update: (view: GameView, parentByObjectId: ReadonlyMap<string, string | null>) => void;
} {
  const container = el('div', 'flex flex-col gap-1 mt-2 text-xs');
  container.setAttribute('data-testid', 'tracker-panel');
  const title = el('div', 'text-xs text-[var(--zork-accent)] uppercase tracking-wider');
  title.textContent = 'Tracker';
  const rowsEl = el('div', 'flex flex-col gap-0.5 font-mono');
  const progressionEl = el('div', 'flex flex-wrap gap-1 mt-1');
  container.appendChild(title);
  container.appendChild(rowsEl);
  container.appendChild(progressionEl);

  function update(view: GameView, parentByObjectId: ReadonlyMap<string, string | null>): void {
    if (view.randomizerSeedString === undefined) {
      container.classList.add('hidden');
      return;
    }
    container.classList.remove('hidden');
    rowsEl.innerHTML = '';
    for (const row of computeTrackerRows(graph, parentByObjectId)) {
      const rowEl = el('div', '');
      rowEl.textContent = `${row.label}: ${row.checked}/${row.total}`;
      rowsEl.appendChild(rowEl);
    }
    progressionEl.innerHTML = '';
    for (const itemId of computeObtainedProgression(graph, parentByObjectId)) {
      const badge = el('span', 'px-1 border border-[var(--zork-accent)] rounded');
      badge.textContent = itemId;
      progressionEl.appendChild(badge);
    }
  }

  return { element: container, update };
}
