/**
 * T3 engine-level wiring tests — THIEF VillainEntry + verb dispatch.
 *
 * Covers the two ROUTING defects from the verifier:
 *   1. getVillainEntry('THIEF') must return a VillainEntry (not undefined)
 *      — F-code callbacks must be reachable.
 *   2. THIEF object-action must be wired: when the thief is visible,
 *      "examine thief" must return ROBBER-FUNCTION's EXAMINE text, not the
 *      generic ldesc from objects.json.
 *
 * ZIL: 1actions.zil:1947–2084 (ROBBER-FUNCTION)
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import { F_UNCONSCIOUS } from '../../src/engine/combat.js';

// Expose the private getVillainEntry for assertion.
type GameInternals = {
  getVillainEntry(id: string, tell: (s: string) => void): unknown;
  world: { get(id: string): unknown };
};

// Set up a game with the thief visible in HERE (thief is initially invisible
// in ROUND-ROOM, its default parent; move it to a lit room and clear invisible).
function makeThiefGame() {
  const g = createGame({ startRoom: 'ROUND-ROOM' });
  g.start();
  const w = (g as unknown as { world: { get(id: string): unknown } }).world;
  type Obj = { set(f: Flag): void; clear(f: Flag): void; moveTo(d: unknown): void };
  const lamp   = w.get('LAMP')   as Obj | undefined;
  const player = w.get('PLAYER') as Obj | undefined;
  const thief  = w.get('THIEF')  as Obj | undefined;
  if (lamp  && player) { (lamp as Obj).moveTo(player); (lamp as Obj).set(Flag.OnFire); (lamp as Obj).set(Flag.Light); }
  if (thief) { (thief as Obj).clear(Flag.Invisible); }
  return g;
}

describe('THIEF VillainEntry wiring (ROUTING fix 1)', () => {
  it('getVillainEntry("THIEF") returns a VillainEntry with the expected shape', () => {
    const g = createGame({ startRoom: 'ROUND-ROOM' });
    g.start();
    const internals = g as unknown as GameInternals;
    const msgs: string[] = [];
    const entry = internals.getVillainEntry('THIEF', (s) => msgs.push(s));
    expect(entry).toBeDefined();
    expect(entry).not.toBeNull();
    // VillainEntry must have an action callback
    expect(typeof (entry as { action?: unknown })?.action).toBe('function');
  });

  it('getVillainEntry("THIEF").action(F_UNCONSCIOUS) fires without throwing', () => {
    // F_UNCONSCIOUS: disable I-THIEF, clear FIGHTBIT, drop stiletto, set U-DESC.
    // Verify the callback is reachable and returns a boolean.
    const g = createGame({ startRoom: 'ROUND-ROOM' });
    g.start();
    const internals = g as unknown as GameInternals;
    const msgs: string[] = [];
    const entry = internals.getVillainEntry('THIEF', (s) => msgs.push(s)) as { action(f: number): boolean } | undefined;
    expect(entry).toBeDefined();
    const result = entry!.action(F_UNCONSCIOUS);
    expect(typeof result).toBe('boolean');
  });
});

describe('THIEF verb-dispatch wiring (ROUTING fix 2)', () => {
  it('examine thief (visible) → ROBBER-FUNCTION EXAMINE text, not generic ldesc', async () => {
    const g = makeThiefGame();
    const r = await g.turn('examine thief');
    // ROBBER-FUNCTION EXAMINE branch — 1actions.zil:2016–2021
    expect(r.output).toContain('beady eyes');
    // Must NOT fall through to the generic ldesc from objects.json
    expect(r.output).not.toContain('suspicious-looking individual');
  });

  it('take thief (visible) → "what would you do with him?" (TAKE branch)', async () => {
    const g = makeThiefGame();
    // ROBBER-FUNCTION TAKE branch — 1actions.zil:2013–2015
    const r = await g.turn('take thief');
    expect(r.output).toContain('what would you do with him');
  });
});
