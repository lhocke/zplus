/**
 * NO-OBJS room action routine — coal mine shaft region.
 * ZIL: 1actions.zil:2558-2571.
 *
 * Covers:
 *   - LIGHT-SHAFT award (+13) fires exactly once when LOWER-SHAFT is lit.
 *   - No award in darkness.
 *   - EMPTY-HANDED gate: empty hands → west reaches LOWER-SHAFT.
 *   - EMPTY-HANDED gate: heavy item (SIZE > 4) → west is blocked.
 *   - weight() boundary: SIZE-4 item does not block; default-SIZE (5) does.
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import { Flag } from '../../src/domain/flags.js';
import type { World } from '../../src/domain/world.js';
import type { Game } from '../../src/engine/game.js';
import { createGame } from '../../src/engine/bootstrap.js';

function worldOf(g: Game): World {
  return (g as unknown as { world: World }).world;
}

function equipLamp(g: Game): void {
  const w = worldOf(g);
  const lamp = w.get('LAMP')!;
  const player = w.get('PLAYER')!;
  lamp.moveTo(player);
  lamp.set(Flag.OnFire);
  lamp.set(Flag.Light);
}

// ---------------------------------------------------------------------------
// LIGHT-SHAFT award
// ---------------------------------------------------------------------------

describe('NO-OBJS LOWER-SHAFT — LIGHT-SHAFT award', () => {
  it('awards +13 on first command when lit', () => {
    const g = newGameAt('LOWER-SHAFT');
    equipLamp(g);
    g.start();
    const before = g.view().score;
    g.turn('look');
    expect(g.view().score).toBe(before + 13);
  });

  it('does not award again on subsequent command', () => {
    const g = newGameAt('LOWER-SHAFT');
    equipLamp(g);
    g.start();
    g.turn('look');
    const after1 = g.view().score;
    g.turn('look');
    expect(g.view().score).toBe(after1);
  });

  it('does not award in darkness (no light source)', () => {
    const g = newGameAt('LOWER-SHAFT');
    // no lamp equipped — room is dark
    g.start();
    const before = g.view().score;
    // In darkness any command still fires M-BEG but LIT is false → no award
    // (room is dark so look gives pitch-black, but M-BEG still runs)
    g.turn('look');
    expect(g.view().score).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// EMPTY-HANDED gate — movement from TIMBER-ROOM
// ---------------------------------------------------------------------------

// Grue is disabled (prob always false) so dark→dark transit doesn't kill the
// player before we can observe the destination.
const noGrueRng = { next: () => 0, prob: () => false };

describe('NO-OBJS TIMBER-ROOM — EMPTY-HANDED gate', () => {
  // The tight passage requires truly empty hands — even the lamp (SIZE 15)
  // is too heavy. LOWER-SHAFT is dark (no Flag.On) without a light source.
  it('empty-handed player can go west into LOWER-SHAFT', () => {
    const g = createGame({ startRoom: 'TIMBER-ROOM', rng: noGrueRng });
    g.start();
    const r = g.turn('west');
    expect(r.output).toContain('dark place');
    expect(g.view().here).toBe('LOWER-SHAFT');
  });

  it('player holding a heavy item (SIZE > 4) is blocked going west', () => {
    const g = createGame({ startRoom: 'TIMBER-ROOM', rng: noGrueRng });
    const w = worldOf(g);
    const player = w.get('PLAYER')!;
    // KEYS has SIZE 10 — well above threshold
    const keys = w.get('KEYS')!;
    keys.moveTo(player);
    g.start();
    const r = g.turn('west');
    expect(r.output).toContain('You cannot fit through this passage with that load.');
    expect(g.view().here).toBe('TIMBER-ROOM');
  });
});

// ---------------------------------------------------------------------------
// weight() boundary
// ---------------------------------------------------------------------------

describe('NO-OBJS weight threshold', () => {
  // SIZE-4 item: weight == 4, not > 4 → EMPTY-HANDED stays true.
  it('SIZE-4 item (WATER) does not block (weight <= 4)', () => {
    const g = createGame({ startRoom: 'TIMBER-ROOM', rng: noGrueRng });
    const w = worldOf(g);
    const player = w.get('PLAYER')!;
    const water = w.get('WATER')!;
    water.moveTo(player);
    g.start();
    const r = g.turn('west');
    expect(r.output).toContain('dark place');
    expect(g.view().here).toBe('LOWER-SHAFT');
  });

  it('SIZE-5 item (TUBE) blocks (weight > 4)', () => {
    const g = createGame({ startRoom: 'TIMBER-ROOM', rng: noGrueRng });
    const w = worldOf(g);
    const player = w.get('PLAYER')!;
    const tube = w.get('TUBE')!;
    tube.moveTo(player);
    g.start();
    const r = g.turn('west');
    expect(r.output).toContain('You cannot fit through this passage with that load.');
    expect(g.view().here).toBe('TIMBER-ROOM');
  });
});
