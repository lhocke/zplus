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

  it('start() does not list the player actor ("cretin") in room contents', () => {
    const g = createGame();
    const output = g.start();
    expect(output).not.toContain('cretin');
  });

  it('turn(north) does not list "cretin" in room contents', async () => {
    const g = createGame();
    g.start();
    const result = await g.turn('north');
    expect(result.output).not.toContain('cretin');
  });
});

// ---------------------------------------------------------------------------
// open mailbox
// ---------------------------------------------------------------------------

describe('open mailbox on real data', () => {
  it('output contains "leaflet"', async () => {
    const g = createGame();
    g.start();
    const result = await g.turn('open mailbox');
    expect(result.output.toLowerCase()).toContain('leaflet');
  });
});

// ---------------------------------------------------------------------------
// read leaflet
// ---------------------------------------------------------------------------

describe('read leaflet on real data', () => {
  it('output contains "WELCOME TO ZORK"', async () => {
    const g = createGame();
    g.start();
    // Open mailbox first so the leaflet is accessible.
    await g.turn('open mailbox');
    // Take the leaflet so it is in inventory.
    await g.turn('take leaflet');
    const result = await g.turn('read leaflet');
    expect(result.output).toContain('WELCOME TO ZORK');
  });
});

// ---------------------------------------------------------------------------
// north movement
// ---------------------------------------------------------------------------

describe('movement on real data', () => {
  it('going north from WEST-OF-HOUSE reaches NORTH-OF-HOUSE', async () => {
    const g = createGame();
    g.start();
    const result = await g.turn('north');
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
