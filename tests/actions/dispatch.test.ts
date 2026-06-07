/**
 * End-to-end proof of the ZIL action-dispatch layer (PERFORM model).
 *
 * Each test drives a translated routine through the real world data via
 * createGame/newGameAt, asserting on transcript text taken verbatim from the
 * ZIL TELL strings.  Together they exercise the three handler shapes:
 *
 *   - PER routine (exit resolution)      → MAZE-DIODES
 *   - Room ACTION routine (rarg M-LOOK)  → WEST-HOUSE
 *   - Object ACTION routine (verb branch)→ MAILBOX-F
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap';
import { Game } from '../../src/engine/game';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import { Clock } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import { M_BEG } from '../../src/engine/messages';
import type { Rng } from '../../src/engine/game';

const rng: Rng = { next: () => 0, prob: (base) => base > 0 };

describe('action dispatch — MAZE-DIODES (PER routine)', () => {
  it('is a one-way passage that warns and lands deterministically in MAZE-4', () => {
    // Use seed 999999 which produces values > 0.8 (safe from grue) so the
    // MAZE-DIODES routing can be verified without interference from the grue gate.
    const g = createGame({ startRoom: 'MAZE-2', seed: 999999 });
    // Override rng to never trigger grue (rng.next()=0.99 → 99 ≥ 80 → no grue).
    (g as unknown as { rng: Rng }).rng = { next: () => 0.99, prob: (base) => 0.99 * 100 < base };
    const r = g.turn('down');

    // The no-return warning from <ROUTINE MAZE-DIODES> (1actions.zil:898).
    expect(r.output).toContain("You won't be able to get back up");
    expect(r.moved).toBe(true);
    // Deterministic destination — MAZE-2 maps to MAZE-4, not a random room.
    expect(g.view().here).toBe('MAZE-4');
  });
});

describe('action dispatch — WEST-HOUSE (room M-LOOK handler)', () => {
  it("start() renders the field description via the room's M-LOOK action", () => {
    const output = createGame().start();
    // Verbatim from the M-LOOK branch of <ROUTINE WEST-HOUSE> (1actions.zil:7).
    expect(output).toContain(
      'You are standing in an open field west of a white house, with a boarded\n' +
        'front door.',
    );
  });

  it('does NOT print the secret-path clause before the endgame', () => {
    const output = createGame().start();
    expect(output).not.toContain('secret path');
  });
});

describe('action dispatch — MAILBOX-F (object handler short-circuits default)', () => {
  it('intercepts TAKE on the mailbox even though it carries TAKEBIT', () => {
    const g = createGame();
    g.start();
    const r = g.turn('take mailbox');
    // <ROUTINE MAILBOX-F> RTRUEs, suppressing the default TAKE ("Taken.").
    expect(r.output).toContain('It is securely anchored.');
    expect(r.output).not.toContain('Taken.');
  });

  it('leaves an unhandled verb to fall through to the default routine', () => {
    const g = createGame();
    g.start();
    // OPEN is not claimed by MAILBOX-F → default verbOpen runs and lists contents.
    const r = g.turn('open mailbox');
    expect(r.output).toContain('leaflet');
  });
});

describe('action dispatch — order and short-circuit semantics', () => {
  // Hand-wire a room (M-BEG handler) and a takeable object (PRSO handler),
  // both attached to the same verb, and observe which one wins.  This is the
  // load-bearing PERFORM property: room M-BEG runs before the PRSO handler,
  // and a handler returning true (RTRUE) suppresses everything after it.
  function makeOrderGame(opts: { roomHandled: boolean }): {
    game: Game;
    log: string[];
  } {
    const log: string[] = [];

    const room = new Room('ROOM', 'Test Room', { ldesc: 'A bare test room.' });
    room.set(Flag.On);
    room.handler = (ctx) => {
      if (ctx.rarg === M_BEG && ctx.verb === 'take') {
        log.push('room');
        if (opts.roomHandled) {
          ctx.tell('Room intercepts.');
          return true;
        }
      }
      return false;
    };

    const widget = new Thing('WIDGET', 'widget', { synonyms: ['widget'] });
    widget.set(Flag.Takeable);
    widget.handler = (ctx) => {
      if (ctx.verb === 'take') {
        log.push('prso');
        ctx.tell('Object intercepts.');
        return true;
      }
      return false;
    };
    widget.moveTo(room);

    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, widget, player]);
    const game = new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });
    return { game, log };
  }

  it('runs the room M-BEG handler before the PRSO handler', () => {
    const { game, log } = makeOrderGame({ roomHandled: false });
    game.start();
    game.turn('take widget');
    // Room handler observed the verb first, then the PRSO handler claimed it.
    expect(log).toEqual(['room', 'prso']);
  });

  it('short-circuits: a true from M-BEG suppresses the PRSO handler and default', () => {
    const { game, log } = makeOrderGame({ roomHandled: true });
    game.start();
    const r = game.turn('take widget');
    // Only the room ran; PRSO never fired and the default TAKE never spoke.
    expect(log).toEqual(['room']);
    expect(r.output).toContain('Room intercepts.');
    expect(r.output).not.toContain('Object intercepts.');
    expect(r.output).not.toContain('Taken.');
  });
});
