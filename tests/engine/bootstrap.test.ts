/**
 * Bootstrap factory integration tests — real world data, real verbs.
 *
 * These tests exercise createGame() against the actual extracted rooms.json
 * and objects.json.  Any verb-on-real-data failures surface here before Phase 3
 * fan-out begins.
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { newGameAt } from '../helpers/new-game.js';

// ---------------------------------------------------------------------------
// createGame() — default start room
// ---------------------------------------------------------------------------

describe('createGame() default', () => {
  it('places the player in WEST-OF-HOUSE', () => {
    const g = createGame();
    expect(g.view().here).toBe('WEST-OF-HOUSE');
  });

  it('start() contains "West of House"', () => {
    const g = createGame();
    const output = g.start();
    expect(output).toContain('West of House');
  });
});

// ---------------------------------------------------------------------------
// open mailbox
// ---------------------------------------------------------------------------

describe('open mailbox on real data', () => {
  it('output contains "leaflet"', () => {
    const g = createGame();
    g.start();
    const result = g.turn('open mailbox');
    expect(result.output.toLowerCase()).toContain('leaflet');
  });
});

// ---------------------------------------------------------------------------
// read leaflet
// ---------------------------------------------------------------------------

describe('read leaflet on real data', () => {
  it('output contains "WELCOME TO ZORK"', () => {
    const g = createGame();
    g.start();
    // Open mailbox first so the leaflet is accessible.
    g.turn('open mailbox');
    // Take the leaflet so it is in inventory.
    g.turn('take leaflet');
    const result = g.turn('read leaflet');
    expect(result.output).toContain('WELCOME TO ZORK');
  });
});

// ---------------------------------------------------------------------------
// north movement
// ---------------------------------------------------------------------------

describe('movement on real data', () => {
  it('going north from WEST-OF-HOUSE reaches NORTH-OF-HOUSE', () => {
    const g = createGame();
    g.start();
    const result = g.turn('north');
    expect(result.moved).toBe(true);
    expect(g.view().here).toBe('NORTH-OF-HOUSE');
  });
});

// ---------------------------------------------------------------------------
// newGameAt helper
// ---------------------------------------------------------------------------

describe('newGameAt helper', () => {
  it('places the player in the requested room', () => {
    const g = newGameAt('MAZE-2');
    expect(g.view().here).toBe('MAZE-2');
  });
});
