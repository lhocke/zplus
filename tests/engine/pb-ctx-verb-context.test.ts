/**
 * PB-CTX — VerbContext save/restore/restart callbacks.
 *
 * Verifies that a verb body can trigger save, restore, and restart via the
 * context without holding a direct Game reference or SavePort directly.
 * The SavePort is threaded through game.ts's context construction.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import type { SavePort } from '../../src/shell/save-port.js';
import type { SaveState } from '../../src/engine/save-state.js';

// Minimal in-memory SavePort stub — no localStorage dependency.
function makeStubPort(): SavePort & { store: Map<string, SaveState> } {
  const store = new Map<string, SaveState>();
  return {
    store,
    write(slot, state) { store.set(slot, state); },
    read(slot) { return store.get(slot); },
    readWithReason(slot) { return store.get(slot) ?? 'empty'; },
    list() { return []; },
    remove(slot) { store.delete(slot); },
  };
}

describe('PB-CTX VerbContext save/restore/restart callbacks', () => {
  it('saveGame callback writes to the SavePort slot', () => {
    const port = makeStubPort();
    const restartFn = vi.fn();
    const game = createGame({ seed: 42, savePort: port, restartFn });

    // Advance a turn so state is non-trivial.
    game.turn('look');

    // The only way to exercise ctx.saveGame is to trigger V-SAVE.
    const result = game.turn('save');

    // Verb body prints Ok. on success (spec §4.2).
    expect(result.output).toBe('Ok.');
    // Port must have written to the default slot.
    expect(port.store.size).toBeGreaterThan(0);
  });

  it('restoreGame callback reads from the SavePort slot', () => {
    const port = makeStubPort();
    const restartFn = vi.fn();
    const game = createGame({ seed: 42, savePort: port, restartFn });

    // Build a state, save it, advance, then restore.
    game.turn('look');
    game.turn('save');
    game.turn('look'); // advance one more turn

    const result = game.turn('restore');

    // Verb body prints Ok. on a successful restore (spec §4.3).
    expect(result.output).toContain('Ok.');
  });

  it('restoreGame from empty slot prints Failed.', () => {
    const port = makeStubPort();
    const restartFn = vi.fn();
    const game = createGame({ seed: 42, savePort: port, restartFn });

    // No save written — slot is empty.
    const result = game.turn('restore');

    expect(result.output).toBe('Failed.');
  });

  it('restart callback invokes the provided restartFn', () => {
    const port = makeStubPort();
    const restartFn = vi.fn();
    const game = createGame({ seed: 42, savePort: port, restartFn });

    game.turn('restart');

    expect(restartFn).toHaveBeenCalledOnce();
  });

  it('verb body never holds a Game or SavePort reference — callbacks are the only path', () => {
    // Structural: if saveGame/restoreGame/restart are absent from VerbContext,
    // the verb bodies cannot compile (tsc catches it). This test is a runtime
    // sanity check that the context wiring is present: call save, confirm the
    // port received the write — if it did, the callback ran through ctx.
    const port = makeStubPort();
    const game = createGame({ seed: 42, savePort: port, restartFn: () => {} });

    game.turn('save');
    // If the callback were absent the port would be empty.
    expect(port.store.size).toBe(1);
  });
});
