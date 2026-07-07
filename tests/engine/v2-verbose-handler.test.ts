/**
 * V2 — V-VERBOSE handler test
 *
 * gverbs.zil:13–16: V-VERBOSE sets VERBOSE=T, clears SUPER-BRIEF, prints
 * "Maximum verbosity."  The engine is always verbose (no BRIEF mode here),
 * so the handler just confirms the state and returns the ZIL string.
 *
 * Done-criteria:
 *   1. 'verbose' command returns "Maximum verbosity." (not the unknown-verb fallback).
 *   2. It is a meta-verb — does NOT advance moveCount.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';

describe('V-VERBOSE handler', () => {
  it('returns "Maximum verbosity." (ZIL gverbs.zil:16)', async () => {
    const game = createGame({ seed: 42 });
    game.start();
    const r = await game.turn('verbose');
    expect(r.output).toBe('Maximum verbosity.');
  });

  it('is a meta-verb — does not advance the move counter', async () => {
    const game = createGame({ seed: 42 });
    game.start();
    const before = game.view().moves;
    await game.turn('verbose');
    expect(game.view().moves).toBe(before);
  });
});
