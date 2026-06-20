/**
 * BD7 — chimney-arrival brief revisit
 *
 * UP-CHIMNEY-FUNCTION (1actions.zil:553) returns KITCHEN as the destination.
 * If the player already visited Kitchen, describeRoomShared must use brief mode
 * (V?=false: title + objects, no ldesc body).
 *
 * The old engine bug: the per-routine path called enterDest which re-used
 * describeRoom with lookFlag=false, but Kitchen's Flag.Touched had not been
 * set yet via a prior normal-route visit (or the flag wasn't propagating).
 * dfrotz R119 transcript confirms brief arrival — turn 17 of chimney-arrival.txt.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';

function resetState(): void {
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
}

describe('BD7 — chimney arrival into already-visited Kitchen is brief', () => {
  it('real-game-flow: Kitchen visited first via window, then reached again via chimney UP — arrival is brief', () => {
    resetState();
    const g = createGame({ seed: 42 });
    g.start();

    // ── Visit Kitchen via open window (sets Flag.Touched on Kitchen) ──────
    g.turn('north');       // west-of-house → north-of-house
    g.turn('east');        // → behind house
    g.turn('open window');
    g.turn('west');        // → Kitchen (first visit; Flag.Touched set here)

    // ── Go underground with lamp ──────────────────────────────────────────
    g.turn('west');        // Kitchen → Living Room
    g.turn('take lamp');
    g.turn('move rug');
    g.turn('open trap door');
    g.turn('turn on lamp');
    g.turn('down');        // → Cellar
    g.turn('south');       // → East of Chasm
    g.turn('east');        // → Gallery
    g.turn('take painting');
    g.turn('north');       // → Studio

    // ── Climb chimney UP → Kitchen (should be BRIEF revisit) ─────────────
    const r = g.turn('up');

    // Room name always appears.
    expect(r.output).toContain('Kitchen');
    // DESCRIBE-OBJECTS runs outside the V? gate — items on table present.
    expect(r.output).toContain('bottle');
    // Brief mode: ldesc body MUST NOT appear.
    expect(r.output).not.toContain('kitchen of the white house');
    expect(r.output).not.toContain('A table seems to have been used');
  });
});
