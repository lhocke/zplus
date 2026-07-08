import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';

describe('randomizer run timer', () => {
  it('a vanilla game (no setRandomizerRun) always reports 0 elapsed', async () => {
    const game = createGame({ seed: 42 });
    await game.turn('look');
    expect(game.getRandomizerElapsedMs()).toBe(0);
  });

  it('does not start ticking until the first command is submitted', () => {
    const game = createGame({ seed: 42, placementMap: {} });
    game.setRandomizerRun('ZR1.x', []);
    expect(game.getRandomizerElapsedMs()).toBe(0); // no turn() yet
  });

  it('starts ticking on the first submitted command', async () => {
    vi.useFakeTimers();
    const game = createGame({ seed: 42, placementMap: {} });
    game.setRandomizerRun('ZR1.x', []);
    await game.turn('look');
    vi.advanceTimersByTime(5000);
    expect(game.getRandomizerElapsedMs()).toBeGreaterThanOrEqual(5000);
    vi.useRealTimers();
  });

  it('accumulates across snapshot/restore without counting real-world gap between them', async () => {
    vi.useFakeTimers();
    const game = createGame({ seed: 42, placementMap: {} });
    game.setRandomizerRun('ZR1.x', []);
    await game.turn('look');
    vi.advanceTimersByTime(3000);
    const state = game.snapshot();
    expect(state.randomizer?.timerMs).toBeGreaterThanOrEqual(3000);

    // Simulate a huge real-world gap (browser closed for a day) before restore.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    const fresh = createGame({ seed: 1 });
    fresh.restore(state);
    // Elapsed right after restore should still be ~3000ms, NOT 3000ms + a day.
    expect(fresh.getRandomizerElapsedMs()).toBeLessThan(4000);
    vi.useRealTimers();
  });
});
