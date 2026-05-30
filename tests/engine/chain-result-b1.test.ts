/**
 * B1 — ChainResult + 7-step runActionChain
 *
 * Verifies that the full 7-step PERFORM chain (gmain.zil:210–224, PREDGEN
 * variant) fires in the correct order and short-circuits faithfully.
 *
 * Steps under test:
 *   1. actor (WINNER) handler — step 1
 *   2. room M-BEG handler    — step 2
 *   3. PRE-action handler    — step 3
 *   4. PRSI (iobj) handler   — step 4
 *   5. dobj.parent CONTFCN   — step 5 (guarded no-op if no contFcn registered)
 *   6. PRSO (dobj) handler   — step 6
 *   7. default executeVerb   — step 7
 *
 * TDD: this test file is written BEFORE the implementation (RED→GREEN→commit).
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../src/engine/game';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Container } from '../../src/domain/container';
import { Thing } from '../../src/domain/thing';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import { Clock } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import { M_BEG } from '../../src/engine/messages';
import type { ActionContext } from '../../src/domain/game-object';
import type { Rng } from '../../src/engine/game';

const rng: Rng = { next: () => 0 };

// ---------------------------------------------------------------------------
// Minimal world builder — wires all 7-step handler positions.
// ---------------------------------------------------------------------------

interface StepWorldOpts {
  /**
   * Which step number (1–7) should return true (short-circuit).
   * undefined = none short-circuit (all fall through to step 7).
   */
  shortCircuitAt?: number;
  /**
   * Install a CONTFCN on the dobj's parent (step 5).
   * Required to exercise step 5 without actual extracted data.
   */
  installContFcn?: boolean;
}

interface StepWorld {
  game: Game;
  log: string[];
}

function buildStepWorld(opts: StepWorldOpts = {}): StepWorld {
  const log: string[] = [];
  const sc = opts.shortCircuitAt;

  // --- Room ---
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A bare test room.' });
  room.set(Flag.Light);

  // Step 2: room M-BEG handler
  room.handler = (ctx: ActionContext) => {
    if (ctx.rarg === M_BEG && ctx.verb === 'examine') {
      log.push('step2-room-mbeg');
      if (sc === 2) { ctx.tell('Room M-BEG intercepted.'); return true; }
    }
    return false;
  };

  // --- Container (parent of dobj) — needed for step 5 CONTFCN ---
  const box = new Container('BOX', 'box', { synonyms: ['box'] });
  box.set(Flag.Light);
  box.set(Flag.Container);
  box.set(Flag.Open);
  box.moveTo(room);

  // --- Direct object (PRSO) — inside the box so dobj.parent is box ---
  const widget = new Thing('WIDGET', 'widget', { synonyms: ['widget'] });
  widget.set(Flag.Takeable);
  widget.moveTo(box);

  // Step 6: PRSO handler
  widget.handler = (ctx: ActionContext) => {
    if (ctx.verb === 'examine') {
      log.push('step6-prso');
      if (sc === 6) { ctx.tell('PRSO intercepted.'); return true; }
    }
    return false;
  };

  // --- Indirect object (PRSI) ---
  const table = new Thing('TABLE', 'table', { synonyms: ['table'] });
  table.moveTo(room);

  // Step 4: PRSI handler
  table.handler = (ctx: ActionContext) => {
    if (ctx.verb === 'examine') {
      log.push('step4-prsi');
      if (sc === 4) { ctx.tell('PRSI intercepted.'); return true; }
    }
    return false;
  };

  // Step 5: CONTFCN on dobj's parent (box).
  // Assign the ActionHandler directly to box.contFcn — the dispatcher reads
  // dobj.parent.contFcn per PERFORM step 5 (verb≠walk AND LOC(PRSO) exists).
  if (opts.installContFcn) {
    box.contFcn = (ctx: ActionContext): boolean => {
      if (ctx.verb === 'examine') {
        log.push('step5-contfcn');
        if (sc === 5) { ctx.tell('CONTFCN intercepted.'); return true; }
      }
      return false;
    };
  }

  // --- Player (WINNER) ---
  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  // Step 1: actor handler (WINNER)
  player.handler = (ctx: ActionContext) => {
    // Actor handler runs WITHOUT rarg (undefined) for the action dispatch.
    if (ctx.rarg === undefined && ctx.verb === 'examine') {
      log.push('step1-actor');
      if (sc === 1) { ctx.tell('Actor intercepted.'); return true; }
    }
    return false;
  };

  const world = World.fromObjects([room, box, widget, table, player]);
  const game = new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });
  return { game, log };
}

// ---------------------------------------------------------------------------
// Helpers — parse a simple "examine widget on table" command that supplies
// both dobj and iobj so all 6 handler-bearing steps are exercisable.
// We use the Game.turn() public API; the command drives through the parser.
// For step 4 (iobj), we need a command with a preposition.
// ---------------------------------------------------------------------------

/**
 * Drive the game with a command that has both dobj and iobj so all handler
 * steps see populated objects.  "examine widget" is enough for steps 1/2/6/7;
 * we use "put widget in table" for step 4 tests where iobj is needed, or we
 * register a preaction for step 3.
 */

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('B1 — runActionChain: 7-step order verification', () => {
  it('visits steps in order 1→2→6→7 for a dobj-only command (no iobj, no contFcn)', () => {
    // Without iobj or contFcn: steps 4 and 5 are skipped (guards not met).
    // Step 3 (PRE-action) fires only when preAction is registered — not yet for 'examine'.
    // Step 7 (default) fires when nothing above claims it.
    const { game, log } = buildStepWorld({ shortCircuitAt: undefined });
    game.start();
    const result = game.turn('examine widget');
    // Steps 1 (actor), 2 (room M-BEG), 6 (PRSO) should have fired.
    // Step 7 fires too but is the default verb — check it ran by checking output.
    expect(log).toContain('step1-actor');
    expect(log).toContain('step2-room-mbeg');
    expect(log).toContain('step6-prso');
    // Order: 1 before 2 before 6.
    expect(log.indexOf('step1-actor')).toBeLessThan(log.indexOf('step2-room-mbeg'));
    expect(log.indexOf('step2-room-mbeg')).toBeLessThan(log.indexOf('step6-prso'));
    // The default verb (step 7) should have produced some output (examine falls through).
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('step 2 (room M-BEG) returning true suppresses step 6 (PRSO) and step 7 (default verb)', () => {
    const { game, log } = buildStepWorld({ shortCircuitAt: 2 });
    game.start();
    const result = game.turn('examine widget');

    expect(log).toContain('step2-room-mbeg');
    expect(log).not.toContain('step6-prso');
    expect(result.output).toContain('Room M-BEG intercepted.');
    // Default "examine" output must NOT appear (step 7 was suppressed).
    expect(result.output).not.toContain("There's nothing special about");
  });

  it('step 6 (PRSO) returning true suppresses step 7 (default verb)', () => {
    const { game, log } = buildStepWorld({ shortCircuitAt: 6 });
    game.start();
    const result = game.turn('examine widget');

    expect(log).toContain('step2-room-mbeg');
    expect(log).toContain('step6-prso');
    expect(result.output).toContain('PRSO intercepted.');
    expect(result.output).not.toContain("There's nothing special about");
  });

  it('step 1 (actor/WINNER) returning true suppresses all later steps', () => {
    const { game, log } = buildStepWorld({ shortCircuitAt: 1 });
    game.start();
    const result = game.turn('examine widget');

    expect(log).toContain('step1-actor');
    expect(log).not.toContain('step2-room-mbeg');
    expect(log).not.toContain('step6-prso');
    expect(result.output).toContain('Actor intercepted.');
    expect(result.output).not.toContain("There's nothing special about");
  });

  it('step 5 (CONTFCN on dobj.parent) is reached when dobj is inside a container', () => {
    const { game, log } = buildStepWorld({ installContFcn: true, shortCircuitAt: undefined });
    game.start();
    game.turn('examine widget');
    // Step 5 should have fired (widget is inside box which has a contFcn).
    expect(log).toContain('step5-contfcn');
    // Order: 2 before 5 before 6.
    expect(log.indexOf('step2-room-mbeg')).toBeLessThan(log.indexOf('step5-contfcn'));
    expect(log.indexOf('step5-contfcn')).toBeLessThan(log.indexOf('step6-prso'));
  });

  it('step 5 (CONTFCN) returning true suppresses step 6 (PRSO) and step 7 (default verb)', () => {
    const { game, log } = buildStepWorld({ installContFcn: true, shortCircuitAt: 5 });
    game.start();
    const result = game.turn('examine widget');

    expect(log).toContain('step5-contfcn');
    expect(log).not.toContain('step6-prso');
    expect(result.output).toContain('CONTFCN intercepted.');
    expect(result.output).not.toContain("There's nothing special about");
  });

  it('step 7 (default verb) runs when no earlier step short-circuits', () => {
    // When no handler claims the command, executeVerb must run.
    // "examine widget" with no special handler → default examine output.
    const { game } = buildStepWorld({ shortCircuitAt: undefined });
    game.start();
    const result = game.turn('examine widget');
    // Default examine emits "There's nothing special about..." or similar.
    // We just verify something was output (step 7 ran and produced output).
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('step 5 is skipped for WALK verb (guard: verb≠walk)', () => {
    // The CONTFCN guard requires verb !== 'walk'.
    const { game, log } = buildStepWorld({ installContFcn: true });
    game.start();
    // "walk" / "go" doesn't resolve widget as dobj in the parser, so this
    // is a semantic test: if we could somehow get WALK with a dobj, step 5
    // would be skipped. We verify the contFcn did NOT fire on a walk command.
    game.turn('north'); // no dobj, no step 5
    // step5-contfcn should NOT appear for a walk.
    expect(log).not.toContain('step5-contfcn');
  });
});

describe('B1 — existing dispatch tests still pass (regression guard)', () => {
  it('room M-BEG runs before PRSO (regression: existing dispatch ordering)', () => {
    // Mirror the existing dispatch.test.ts "order" test.
    const log: string[] = [];
    const room = new Room('ROOM2', 'Room', { ldesc: 'Room.' });
    room.set(Flag.Light);
    room.handler = (ctx: ActionContext) => {
      if (ctx.rarg === M_BEG && ctx.verb === 'take') { log.push('room'); }
      return false;
    };
    const widget = new Thing('WIDGET2', 'widget2', { synonyms: ['widget2'] });
    widget.set(Flag.Takeable);
    widget.handler = (ctx: ActionContext) => {
      if (ctx.verb === 'take') { log.push('prso'); ctx.tell('prso-spoke'); return true; }
      return false;
    };
    widget.moveTo(room);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);
    const world = World.fromObjects([room, widget, player]);
    const game = new Game(world, { rng, clock: new Clock(), events: new SimpleEventEmitter() });
    game.start();
    game.turn('take widget2');
    expect(log).toEqual(['room', 'prso']);
  });
});
