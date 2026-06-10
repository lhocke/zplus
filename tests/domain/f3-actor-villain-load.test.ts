/**
 * F3 — Actor combat state + VillainEntry + LOAD globals
 *
 * TDD: written RED before implementation.
 *
 * Coverage:
 *   1. Actor.pStrength exists and defaults to 0.
 *   2. pStrength is mutable (set/read).
 *   3. VillainEntry type: vBest, vBestAdv, vProb, vMsgs, action fields.
 *   4. Villain base strengths load from STRENGTH prop at bootstrap
 *      (Troll 2, Thief 5, Cyclops 10000).
 *   5. Player pStrength is 0 after bootstrap (no STRENGTH on player).
 *   6. Game.loadAllowed and Game.loadMax init to 100 (gglobals.zil:92,94).
 *   7. VillainEntry is keyed by object id, not stored on Actor.
 *
 * ZIL refs:
 *   gglobals.zil:92  <GLOBAL LOAD-MAX 100>
 *   gglobals.zil:94  <GLOBAL LOAD-ALLOWED 100>
 *   1actions.zil:3791–3804  VILLAINS LTABLE
 *   1actions.zil:3383  VILLAIN-STRENGTH reads od = villain.pStrength
 */

import { describe, test, expect } from 'vitest';
import { Actor } from '../../src/domain/actor.js';
import type { VillainEntry } from '../../src/domain/villain-entry.js';
import { createGame } from '../../src/engine/bootstrap.js';

// ---------------------------------------------------------------------------
// 1 + 2. Actor.pStrength — exists, defaults 0, is mutable
// ---------------------------------------------------------------------------

describe('Actor.pStrength', () => {
  test('defaults to 0', () => {
    const a = new Actor('TROLL', 'troll');
    expect(a.pStrength).toBe(0);
  });

  test('is mutable', () => {
    const a = new Actor('THIEF', 'thief');
    a.pStrength = 5;
    expect(a.pStrength).toBe(5);
    a.pStrength = -2;
    expect(a.pStrength).toBe(-2);
  });

  test('dead sentinel -10000 round-trips', () => {
    const a = new Actor('CYCLOPS', 'cyclops');
    a.pStrength = -10000;
    expect(a.pStrength).toBe(-10000);
  });
});

// ---------------------------------------------------------------------------
// 3. VillainEntry type — structural check
// ---------------------------------------------------------------------------

describe('VillainEntry structure', () => {
  test('can construct a VillainEntry with all required fields', () => {
    const entry: VillainEntry = {
      vBest: 'SWORD',
      vBestAdv: 1,
      vProb: 0,
      vMsgs: [],
      action: (_fcode: number) => false,
    };
    expect(entry.vBest).toBe('SWORD');
    expect(entry.vBestAdv).toBe(1);
    expect(entry.vProb).toBe(0);
    expect(typeof entry.action).toBe('function');
  });

  test('vBest can be null (Cyclops has no best weapon)', () => {
    const entry: VillainEntry = {
      vBest: null,
      vBestAdv: 0,
      vProb: 0,
      vMsgs: [],
      action: () => false,
    };
    expect(entry.vBest).toBeNull();
  });

  test('action callback receives f-code and returns boolean', () => {
    let received = -1;
    const entry: VillainEntry = {
      vBest: null,
      vBestAdv: 0,
      vProb: 0,
      vMsgs: [],
      action: (fcode: number) => { received = fcode; return true; },
    };
    const result = entry.action(2); // F_DEAD
    expect(received).toBe(2);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4 + 5. Bootstrap: villain pStrength from STRENGTH prop; player pStrength = 0
// ---------------------------------------------------------------------------

describe('Bootstrap villain pStrength loading', () => {
  test('Troll pStrength = 2 after bootstrap (objects.json:2249 STRENGTH:2)', () => {
    const g = createGame();
    const troll = g.world.get('TROLL') as Actor;
    expect(troll).toBeDefined();
    expect(troll.pStrength).toBe(2);
  });

  test('Thief pStrength = 5 after bootstrap (objects.json:2146 STRENGTH:5)', () => {
    const g = createGame();
    const thief = g.world.get('THIEF') as Actor;
    expect(thief).toBeDefined();
    expect(thief.pStrength).toBe(5);
  });

  test('Cyclops pStrength = 10000 after bootstrap (objects.json:873 STRENGTH:10000)', () => {
    const g = createGame();
    const cyclops = g.world.get('CYCLOPS') as Actor;
    expect(cyclops).toBeDefined();
    expect(cyclops.pStrength).toBe(10000);
  });

  test('Player pStrength = 0 after bootstrap (no P-STRENGTH global, gglobals.zil:94)', () => {
    const g = createGame();
    expect(g.player.pStrength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Game.loadAllowed and Game.loadMax — init 100 (gglobals.zil:92,94)
// ---------------------------------------------------------------------------

describe('Game encumbrance globals', () => {
  test('loadAllowed starts at 100', () => {
    const g = createGame();
    expect(g.loadAllowed).toBe(100);
  });

  test('loadMax starts at 100', () => {
    const g = createGame();
    expect(g.loadMax).toBe(100);
  });

  test('loadAllowed is mutable', () => {
    const g = createGame();
    g.loadAllowed = 80;
    expect(g.loadAllowed).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 7. VillainEntry is NOT on Actor — metadata lives in parallel record
// ---------------------------------------------------------------------------

describe('Actor has no villain metadata fields', () => {
  test('Actor has no vBest property', () => {
    const a = new Actor('TROLL', 'troll');
    expect((a as unknown as Record<string, unknown>)['vBest']).toBeUndefined();
  });

  test('Actor has no vMsgs property', () => {
    const a = new Actor('TROLL', 'troll');
    expect((a as unknown as Record<string, unknown>)['vMsgs']).toBeUndefined();
  });
});
