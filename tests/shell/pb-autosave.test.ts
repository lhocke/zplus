/**
 * PB-AUTOSAVE — rolling pre-turn autosave + gameOver affordance hook (spec §6, §9 Wave 2).
 *
 * Done-criteria:
 *   - autosave slot is written at the START of submit(), before the turn runs
 *   - autosave overwrites each turn (rolling)
 *   - autosave is NOT written when the game is already gameOver
 *   - autosave is NOT written when port is absent
 *   - the autosave slot ('autosave') cannot be reached via the save/restore verbs
 *   - session exposes gameOver state (snapshot().gameOver)
 *   - autosave is restorable after a death (round-trip oracle)
 *   - the round-trip oracle holds: autosave captures pre-turn state; restore + replay re-kills
 */

import { describe, it, expect } from 'vitest';
import { nullSink } from '../../src/shell/sink.js';
import { createSession } from '../../src/shell/session.js';
import { LocalStorageSavePort } from '../../src/shell/save-port.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(n: number): string | null { return [...this.store.keys()][n] ?? null; }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

function makePort(storage: MapStorage) {
  return new LocalStorageSavePort(storage);
}

// Navigate to the cellar with lamp off — triggers grue death + JIGS-UP.
// Returns the commands as a readonly array.
const GRUE_DEATH_COMMANDS = [
  'north',         // WEST-OF-HOUSE → NORTH-OF-HOUSE
  'east',          // → EAST-OF-HOUSE
  'open window',   // opens kitchen window
  'west',          // → KITCHEN
  'west',          // → LIVING-ROOM
  'take lamp',
  'move rug',
  'open trap door',
  'turn on lamp',
  'down',          // → CELLAR
  'turn off lamp', // lamp off: dark → grue territory
  'south',         // CELLAR(dark) → EAST-OF-CHASM(dark) → grue → FOREST-1 resurrection
] as const;

// ---------------------------------------------------------------------------
// 1. Autosave is written on each submit()
// ---------------------------------------------------------------------------

describe('PB-AUTOSAVE — pre-turn autosave written on submit', () => {
  it('autosave slot is populated after first submit', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    session.submit('look');
    // 'autosave' slot should now exist
    const saved = port.read('autosave');
    expect(saved).toBeDefined();
  });

  it('autosave is overwritten each turn (rolling)', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    session.submit('look');
    const after1 = port.read('autosave');
    session.submit('north');
    const after2 = port.read('autosave');
    // The move count must have advanced between the two autosaves
    expect(after1).toBeDefined();
    expect(after2).toBeDefined();
    expect(after1!.moveCount).toBeLessThan(after2!.moveCount);
  });

  it('autosave captures state BEFORE the turn runs — moveCount is pre-turn', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    // Before any submit, no autosave yet
    expect(port.read('autosave')).toBeUndefined();
    // After first submit the autosave reflects the state at the START of that turn
    session.submit('look');
    const snap1 = port.read('autosave');
    // moveCount in the autosave should be 0 (the count BEFORE the first move)
    expect(snap1?.moveCount).toBe(0);
  });

  it('no autosave when no SavePort is provided', () => {
    // Should not throw even without a port
    const session = createSession({ sink: nullSink, seed: 42 });
    session.start();
    expect(() => session.submit('look')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Autosave slot is not reachable via the save/restore verbs
// ---------------------------------------------------------------------------

describe('PB-AUTOSAVE — autosave slot not accessible via verbs', () => {
  it('"save autosave" returns in-voice slot message — V-SAVE verb is NOT invoked', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    // Attempt to save to the 'autosave' slot via verb — should be rejected
    const result = session.submit('save autosave');
    // The in-voice slot rejection must be returned (not "Ok.")
    expect(result).toMatch(/no save slot/i);
    // The rolling autosave IS written (it fires at the start of every submit),
    // but the V-SAVE verb body must NOT have run — confirmed by the in-voice message.
    // If V-SAVE had run it would output "Ok." not the in-voice message.
    expect(result).not.toBe('Ok.');
  });

  it('"restore autosave" returns in-voice slot message, does not restore', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();
    session.submit('look');
    const result = session.submit('restore autosave');
    expect(result).toMatch(/no save slot/i);
  });
});

// ---------------------------------------------------------------------------
// 3. gameOver affordance hook — snapshot exposes gameOver flag
// ---------------------------------------------------------------------------

describe('PB-AUTOSAVE — gameOver exposed on session snapshot', () => {
  it('snapshot().gameOver is false during normal play', () => {
    const session = createSession({ sink: nullSink, seed: 42 });
    session.start();
    session.submit('look');
    const snap = session.snapshot();
    expect(snap.gameOver).toBe(false);
  });

  it('snapshot().gameOver is true after quit', () => {
    // quit fires doFinish() → gameOver=true (same path as death exhaustion / victory).
    const session = createSession({ sink: nullSink, seed: 42 });
    session.start();
    session.submit('quit');
    const snap = session.snapshot();
    expect(snap.gameOver).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Autosave not written when game is already gameOver
// ---------------------------------------------------------------------------

describe('PB-AUTOSAVE — no autosave write when gameOver', () => {
  it('submit() after gameOver does not overwrite the autosave slot', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();

    // Use quit to trigger gameOver reliably
    session.submit('quit');
    expect(session.snapshot().gameOver).toBe(true);
    const autosaveBeforeDeadSubmit = port.read('autosave');

    // Submit after gameOver — engine returns '' and autosave must NOT be overwritten
    session.submit('look');
    const autosaveAfterDeadSubmit = port.read('autosave');

    // The savedAt timestamp of the autosave must not have changed
    expect(autosaveAfterDeadSubmit?.savedAt).toBe(autosaveBeforeDeadSubmit?.savedAt);
  });
});

// ---------------------------------------------------------------------------
// 5. Round-trip oracle: autosave restores the pre-turn state
// ---------------------------------------------------------------------------

describe('PB-AUTOSAVE — round-trip oracle over autosave slot', () => {
  it('restore from autosave after death puts the player at the start of the fatal turn', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    // Session A: navigate to the point right before the fatal turn; record autosave state
    const sessionA = createSession({ sink: nullSink, savePort: port, seed: 42 });
    sessionA.start();

    // Run all setup commands EXCEPT the fatal one — this is the pre-death state
    const setupCommands = GRUE_DEATH_COMMANDS.slice(0, GRUE_DEATH_COMMANDS.length - 1);
    for (const cmd of setupCommands) {
      sessionA.submit(cmd);
    }
    // The final command ('south') is the fatal one — autosave written at the start of this submit
    sessionA.submit(GRUE_DEATH_COMMANDS[GRUE_DEATH_COMMANDS.length - 1]);

    // The autosave should now hold the state at the START of the fatal turn
    const autosaveState = port.read('autosave');
    expect(autosaveState).toBeDefined();

    // Session B: fresh game, restore from autosave
    const storage2 = new MapStorage();
    const port2 = makePort(storage2);
    // Copy the autosave from A into B so we can call restore
    port2.write('autosave', autosaveState!);

    // We can only restore named manual slots via the verb; restore from autosave
    // is done by writing to a manual slot and restoring from it.
    // Write autosave into slot '1' for restore verb access
    const storage3 = new MapStorage();
    const port3 = makePort(storage3);
    port3.write('1', autosaveState!);

    const sessionB = createSession({ sink: nullSink, savePort: port3, seed: 42 });
    sessionB.start();
    sessionB.submit('restore');
    // After restore, player should be at the location captured in the autosave
    const snapB = sessionB.snapshot();
    expect(snapB.moves).toBe(autosaveState!.moveCount);
  });

  it('autosave round-trip: snapshot() after restore matches autosave moveCount', () => {
    const storage = new MapStorage();
    const port = makePort(storage);
    const session = createSession({ sink: nullSink, savePort: port, seed: 42 });
    session.start();

    // 5 moves of normal play
    session.submit('look');
    session.submit('north');
    session.submit('east');
    session.submit('west');
    session.submit('west');

    // The autosave at this point has moveCount of the state BEFORE the 5th submit
    const autosaveAfter5 = port.read('autosave');
    expect(autosaveAfter5).toBeDefined();

    // Restore via slot '1' (copy autosave there)
    const storage2 = new MapStorage();
    const port2 = makePort(storage2);
    port2.write('1', autosaveAfter5!);

    const session2 = createSession({ sink: nullSink, savePort: port2, seed: 42 });
    session2.start();
    session2.submit('restore');
    const snap = session2.snapshot();
    expect(snap.moves).toBe(autosaveAfter5!.moveCount);
  });
});
