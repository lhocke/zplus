// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { computeTrackerRows, computeObtainedProgression, buildTrackerPanel } from '../../src/ui/tracker-panel.js';
import type { LogicGraph } from '../../src/logic/logic-graph-types.js';
import type { GameView } from '../../src/engine/game.js';

const GRAPH: LogicGraph = {
  logicVersion: 1, checksum: 'x',
  regions: [{ id: 'surface', rooms: ['A'], access: {} }],
  items: [
    { id: 'lamp', class: 'progression', isTreasure: false },
    { id: 'painting', class: 'filler', isTreasure: true },
  ],
  locations: [
    { id: 'loc-a', objectId: 'lamp', containerId: 'LIVING-ROOM', region: 'surface', access: {} },
    { id: 'loc-b', objectId: 'painting', containerId: 'GALLERY', region: 'surface', access: {} },
  ],
};

describe('tracker panel logic', () => {
  it('reports 0/N checked when every item is still at its shuffled container', () => {
    const parents = new Map([['lamp', 'LIVING-ROOM'], ['painting', 'GALLERY']]);
    const rows = computeTrackerRows(GRAPH, parents);
    expect(rows).toEqual([{ region: 'surface', label: 'Surface', checked: 0, total: 2 }]);
  });

  it('counts a location checked once its item has moved away from its shuffled container', () => {
    const parents = new Map([['lamp', 'PLAYER'], ['painting', 'GALLERY']]);
    const rows = computeTrackerRows(GRAPH, parents);
    expect(rows[0].checked).toBe(1);
  });

  it('a thief-moved item (parent = THIEF room, not PLAYER) still counts as checked', () => {
    const parents = new Map([['lamp', 'ROUND-ROOM'], ['painting', 'GALLERY']]);
    expect(computeTrackerRows(GRAPH, parents)[0].checked).toBe(1);
  });

  it('never exposes an unchecked location\'s target container (spoiler-free contract)', () => {
    const parents = new Map([['lamp', 'LIVING-ROOM'], ['painting', 'GALLERY']]);
    const rows = computeTrackerRows(GRAPH, parents);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('LIVING-ROOM');
    expect(serialized).not.toContain('GALLERY');
  });

  it('computeObtainedProgression lists only progression items currently held by PLAYER', () => {
    const parents = new Map([['lamp', 'PLAYER'], ['painting', 'PLAYER']]);
    expect(computeObtainedProgression(GRAPH, parents)).toEqual(['lamp']);
  });
});

// AMENDMENT 9 (repair 3R7): the tracker gains a lamp-fuel row — turns of
// light remaining, straight from the engine's I-LANTERN clock state via the
// GameView snapshot. Pure information: fuel stays unmodeled in logic
// (Amendment 8 boundary), and lamp exhaustion stays a real way to lose; the
// row just lets the player budget the bridge the lamp is.
describe('tracker panel lamp-fuel row (jsdom)', () => {
  function makeView(overrides: Partial<GameView>): GameView {
    return {
      here: 'WEST-OF-HOUSE',
      hereName: 'West of House',
      exits: [],
      visibleObjects: [],
      score: 0,
      maxScore: 350,
      moves: 0,
      inMaze: false,
      gameOver: false,
      randomizerSeedString: 'seedy',
      randomizerObjectParents: {},
      ...overrides,
    } as GameView;
  }
  const parents = new Map([['lamp', 'LIVING-ROOM'], ['painting', 'GALLERY']]);

  it('renders the turns of light remaining, in voice', () => {
    const panel = buildTrackerPanel(GRAPH);
    panel.update(makeView({ randomizerLampTurnsLeft: 185 }), parents);
    const row = panel.element.querySelector('[data-testid="tracker-lamp-fuel"]');
    expect(row, 'lamp-fuel row must render').not.toBeNull();
    expect(row!.textContent).toBe('Brass lantern: 185 turns of light');
  });

  it('reads burned out at zero', () => {
    const panel = buildTrackerPanel(GRAPH);
    panel.update(makeView({ randomizerLampTurnsLeft: 0 }), parents);
    const row = panel.element.querySelector('[data-testid="tracker-lamp-fuel"]');
    expect(row!.textContent).toBe('Brass lantern: burned out');
  });

  it('renders no fuel row when the snapshot carries no lamp state', () => {
    const panel = buildTrackerPanel(GRAPH);
    panel.update(makeView({}), parents);
    expect(panel.element.querySelector('[data-testid="tracker-lamp-fuel"]')).toBeNull();
  });

  it('stays hidden entirely outside a randomized run (desktop-gating contract unchanged)', () => {
    const panel = buildTrackerPanel(GRAPH);
    panel.update(makeView({ randomizerSeedString: undefined, randomizerLampTurnsLeft: 100 }), parents);
    expect(panel.element.classList.contains('hidden')).toBe(true);
  });
});
