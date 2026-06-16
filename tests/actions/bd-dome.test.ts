/**
 * BD-DOME — DOME-ROOM-FCN M-ENTER dead-branch suppresses room auto-describe.
 *
 * ZIL 1actions.zil:1041–1047: the M-ENTER DEAD branch tells the wind message,
 * teleports to TORCH-ROOM, and returns RTRUE.  In ZIL, RTRUE from M-ENTER
 * suppresses the engine's V-FIRST-LOOK for that move — no automatic room
 * description is emitted for either DOME-ROOM or TORCH-ROOM.
 *
 * Engine fix: when M-ENTER returns handled (true), suppress the verbResult
 * room desc that V-WALK already embedded, and also suppress the M-END
 * movement-detection describe for the teleport destination.
 */

import { describe, it, expect } from 'vitest';
import { Flag } from '../../src/domain/flags.js';
import { newGameAt } from '../helpers/new-game.js';

function giveLantern(g: ReturnType<typeof newGameAt>): void {
  const lamp = g.world.get('LAMP')!;
  lamp.moveTo(g.player);
  lamp.set(Flag.OnFire);
  lamp.set(Flag.Light);
}

function deadGame(roomId: string) {
  const g = newGameAt(roomId);
  g.start();
  giveLantern(g);
  (g as unknown as { dead: boolean }).dead = true;
  (g as unknown as { alwaysLit: boolean }).alwaysLit = true;
  return g;
}

describe('BD-DOME: M-ENTER RTRUE suppresses auto room-describe (1actions.zil:1041–1047)', () => {
  it('dead player entering DOME-ROOM lands in TORCH-ROOM', () => {
    const g = deadGame('ENGRAVINGS-CAVE');
    g.turn('east');
    expect(g.view().here).toBe('TORCH-ROOM');
  });

  it('dead player entering DOME-ROOM: output contains wind message', () => {
    const g = deadGame('ENGRAVINGS-CAVE');
    const out = g.turn('east').output;
    expect(out).toContain('strong pull');
  });

  it('dead player entering DOME-ROOM: DOME-ROOM description is suppressed (M-ENTER RTRUE)', () => {
    // ZIL RTRUE from M-ENTER skips V-FIRST-LOOK — no "periphery of a large dome".
    const g = deadGame('ENGRAVINGS-CAVE');
    const out = g.turn('east').output;
    expect(out).not.toContain('periphery of a large dome');
  });

  it('dead player entering DOME-ROOM: TORCH-ROOM not auto-described (no second GOTO)', () => {
    // ZIL does not fire a second GOTO after M-ENTER teleport — TORCH-ROOM stays undescribed.
    const g = deadGame('ENGRAVINGS-CAVE');
    const out = g.turn('east').output;
    expect(out).not.toContain('white marble pedestal');
  });

  it('living player entering DOME-ROOM: room is described normally', () => {
    // Regression guard: living-player path must not be affected.
    const g = newGameAt('ENGRAVINGS-CAVE');
    g.start();
    giveLantern(g);
    const out = g.turn('east').output;
    expect(out).toContain('periphery of a large dome');
  });
});
