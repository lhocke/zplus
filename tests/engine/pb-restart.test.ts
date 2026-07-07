/**
 * PB-RESTART — V-RESTART body + session re-bootstrap.
 *
 * Done-criteria (spec §9 Wave 1 PB-RESTART, §4.4):
 *   - `restart` (confirmed) prints exactly "Restarting." (gverbs.zil:67, FD-2)
 *   - restart returns the game to opening room / score 0 / moves 0 with all
 *     module globals reset
 *   - V-RESTART is in META_ACTIONS (no clock tick)
 *   - GameSession.restart() is present
 *   - session re-bootstrap: state after restart === fresh session state
 */

import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { META_ACTIONS, executeVerb } from '../../src/engine/verbs/index.js';
import type { VerbContext } from '../../src/engine/verbs/index.js';
import { createSession } from '../../src/shell/session.js';
import { nullSink } from '../../src/shell/sink.js';

// ---------------------------------------------------------------------------
// 1. verbRestart via VerbContext — text contracts
// ---------------------------------------------------------------------------

describe('PB-RESTART verbRestart — text contracts', () => {
  it('emits exactly "Restarting." when restart is wired', async () => {
    const restartFn = vi.fn();
    const ctx: VerbContext = {
      verb: 'restart',
      action: 'V-RESTART',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
      restart: restartFn,
    };
    const r = await executeVerb(ctx, 'V-RESTART');
    expect(r.output).toBe('Restarting.');
    expect(restartFn).toHaveBeenCalledOnce();
  });

  it('emits "Restarting." even when restart is absent (no-op path)', async () => {
    // When ctx.restart is absent the engine still prints Restarting.
    // (Shell-level no-confirm = shell never calls the verb at all.)
    const ctx: VerbContext = {
      verb: 'restart',
      action: 'V-RESTART',
      player: {} as VerbContext['player'],
      here: {} as VerbContext['here'],
      world: {} as VerbContext['world'],
    };
    const r = await executeVerb(ctx, 'V-RESTART');
    expect(r.output).toBe('Restarting.');
  });
});

// ---------------------------------------------------------------------------
// 2. V-RESTART stays in META_ACTIONS (no clock tick)
// ---------------------------------------------------------------------------

describe('PB-RESTART — V-RESTART is in META_ACTIONS', () => {
  it('META_ACTIONS contains V-RESTART', () => {
    expect(META_ACTIONS.has('V-RESTART')).toBe(true);
  });

  it('RESTART is meta — move count does not advance', async () => {
    const restartFn = vi.fn();
    const game = createGame({ seed: 42, restartFn });
    game.start();
    const before = game.view().moves;
    await game.turn('restart');
    // restartFn is a no-op stub — game state is unchanged except the fn was called
    const after = game.view().moves;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. Game.turn('restart') — Restarting. output + restartFn invoked
// ---------------------------------------------------------------------------

describe('PB-RESTART — Game.turn restart output', () => {
  it('turn("restart") returns "Restarting." when restartFn is wired', async () => {
    const restartFn = vi.fn();
    const game = createGame({ seed: 42, restartFn });
    game.start();
    const result = await game.turn('restart');
    expect(result.output).toBe('Restarting.');
    expect(restartFn).toHaveBeenCalledOnce();
  });

  it('turn("restart") returns "Restarting." even with no restartFn', async () => {
    const game = createGame({ seed: 42 });
    game.start();
    const result = await game.turn('restart');
    expect(result.output).toBe('Restarting.');
  });
});

// ---------------------------------------------------------------------------
// 4. Session re-bootstrap via createSession.restart()
// ---------------------------------------------------------------------------

describe('PB-RESTART — session re-bootstrap', () => {
  it('restart() resets state to fresh game (score 0, moves 0, opening room)', async () => {
    const session = createSession({ sink: nullSink, seed: 42 });
    session.start();

    // Advance state — move around, accrue moves
    await session.submit('open mailbox');
    await session.submit('take leaflet');
    await session.submit('north');
    await session.submit('north');

    const before = session.snapshot();
    expect(before.moves).toBeGreaterThan(0);

    // Restart re-bootstraps
    session.restart();

    const after = session.snapshot();
    expect(after.moves).toBe(0);
    expect(after.score).toBe(0);
  });

  it('restart() restores opening room', async () => {
    const session = createSession({ sink: nullSink, seed: 42 });
    session.start();
    // Get fresh starting room
    const freshRoom = session.snapshot().here;

    await session.submit('north');
    await session.submit('north');
    expect(session.snapshot().here).not.toBe(freshRoom);

    session.restart();
    expect(session.snapshot().here).toBe(freshRoom);
  });

  it('submit after restart works as a fresh game', async () => {
    const session = createSession({ sink: nullSink, seed: 42 });
    const startOutput = session.start();

    // Advance
    await session.submit('north');
    await session.submit('north');

    // Restart
    session.restart();

    // The next start()-equivalent should see fresh state
    // (submit 'look' should produce opening room description)
    const output = await session.submit('look');
    expect(output).toBeTruthy();
    expect(session.snapshot().moves).toBe(1); // one move after restart
    void startOutput;
  });

  it('submit("restart") via session produces "Restarting." and resets state', async () => {
    const session = createSession({ sink: nullSink, seed: 42 });
    session.start();

    await session.submit('north');
    await session.submit('north');
    const movesBeforeRestart = session.snapshot().moves;
    expect(movesBeforeRestart).toBeGreaterThan(0);

    const output = await session.submit('restart');
    expect(output).toBe('Restarting.');

    // State is reset after the restart command
    expect(session.snapshot().moves).toBe(0);
    expect(session.snapshot().score).toBe(0);
  });

  it('restart() is present on GameSession interface', () => {
    const session = createSession({ sink: nullSink, seed: 42 });
    expect(typeof session.restart).toBe('function');
  });
});
