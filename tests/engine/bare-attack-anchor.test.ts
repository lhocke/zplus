/**
 * Bare `attack` in Troll Room with sword held — dfrotz anchor.
 *
 * dfrotz evidence (zork1.z3, Revision 119, Release 119/880429):
 *   Input:  attack         (no noun specified, sword held)
 *   Output: "(troll)"
 *           "Trying to attack a troll with your bare hands is suicidal."
 *
 * Behaviour: parser GWIMs troll as dobj (ACTORBIT search), then the NO-WEAPON
 * gate fires because the attack syntax requires an explicit iobj weapon. The
 * troll is the only ACTORBIT object in scope → unambiguous GWIM.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { Game } from '../../src/engine/game.js';
import type { World } from '../../src/domain/world.js';

function worldOf(g: Game): World {
  return (g as unknown as { world: World }).world;
}

const fixedRng = { next: () => 0.1, prob: () => false, zprob: () => false };

describe('bare attack anchor (dfrotz-verified)', () => {
  it('bare "attack" in Troll Room with sword held → (troll) + bare-hands suicidal', async () => {
    // dfrotz (Release 119 / Serial 880429):
    //   > attack
    //   (troll)
    //   Trying to attack a troll with your bare hands is suicidal.
    const g = createGame({ startRoom: 'TROLL-ROOM', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);
    g.start();

    const r = await g.turn('attack');
    expect(r.output).toContain('(troll)');
    expect(r.output).toContain('Trying to attack a troll with your bare hands is suicidal.');
  });
});
