/**
 * parser-seam-c9.test.ts
 *
 * Integration tests for the two parser-engine SEAM bugs fixed in the C9 wave:
 *
 *   P1 — Direction fast-path: WALK <dir> (LEN==2 case) was missing.
 *        "go west" / "walk west" fell through to object resolution instead of
 *        short-circuiting to V-WALK.  Faithful to gparser.zil:281–283.
 *
 *   P2 — Dispatch keyed on cmd.action (resolved V-* id), not cmd.verb (verb word).
 *        "look at mailbox" resolves action: V-EXAMINE but was dispatching to
 *        verbLook (room description).  Faithful to ZIL PERFORM on PRSA
 *        (gmain.zil:283–284).
 *
 * All tests drive the LIVE path: createGame() + game.turn().  Parser-unit tests
 * are NOT sufficient — C9 integration bugs were invisible to per-unit tests.
 *
 * Baseline: WEST-OF-HOUSE (canonical Zork I start room).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../src/engine/bootstrap';
import type { Game } from '../../src/engine/game';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let game: Game;

beforeEach(() => {
  game = createGame();
  game.start(); // place player in WEST-OF-HOUSE
});

// ---------------------------------------------------------------------------
// P1 — Direction fast-path: "go/walk <dir>" must move the player
// ---------------------------------------------------------------------------

describe('P1 — WALK+direction fast-path (go/walk <dir>)', () => {
  it('"go west" from WEST-OF-HOUSE moves player to Forest (FOREST-1)', async () => {
    const result = await game.turn('go west');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('FOREST-1');
    // Room description must appear, not an error about "west"
    expect(result.output).toContain('Forest');
    expect(result.output).not.toContain("can't see any west");
    expect(result.output).not.toContain("don't know the word");
  });

  it('"walk west" from WEST-OF-HOUSE moves player to Forest (FOREST-1)', async () => {
    const result = await game.turn('walk west');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('FOREST-1');
    expect(result.output).toContain('Forest');
    expect(result.output).not.toContain("can't see any west");
    expect(result.output).not.toContain("don't know the word");
  });

  it('"go north" from WEST-OF-HOUSE moves player to NORTH-OF-HOUSE', async () => {
    const result = await game.turn('go north');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('NORTH-OF-HOUSE');
    expect(result.output).not.toContain("don't know the word");
  });

  it('"walk north" from WEST-OF-HOUSE moves player to NORTH-OF-HOUSE', async () => {
    const result = await game.turn('walk north');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('NORTH-OF-HOUSE');
    expect(result.output).not.toContain("don't know the word");
  });

  it('"go south" from WEST-OF-HOUSE moves player to SOUTH-OF-HOUSE', async () => {
    const result = await game.turn('go south');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('SOUTH-OF-HOUSE');
    expect(result.output).not.toContain("don't know the word");
  });

  it('"walk south" from WEST-OF-HOUSE moves player to SOUTH-OF-HOUSE', async () => {
    const result = await game.turn('walk south');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('SOUTH-OF-HOUSE');
    expect(result.output).not.toContain("don't know the word");
  });

  it('bare "west" (LEN==1 fast-path) still works after P1 fix', async () => {
    // Regression guard: ensure case A (bare direction) was not broken.
    const result = await game.turn('west');
    expect(result.moved).toBe(true);
    expect(game.view().here).toBe('FOREST-1');
  });

  it('"go east" reports the blocked-exit message (not a parser error)', async () => {
    // East exit from WEST-OF-HOUSE is blocked (boarded door), not a parse error.
    const result = await game.turn('go east');
    expect(result.moved).toBe(false);
    expect(result.output).toContain('boarded');
    expect(result.output).not.toContain("can't see any east");
    expect(result.output).not.toContain("don't know the word");
  });
});

// ---------------------------------------------------------------------------
// P2 — Dispatch on resolved action (cmd.action), not verb word (cmd.verb)
// ---------------------------------------------------------------------------

describe('P2 — dispatch on resolved action V-* id, not verb word', () => {
  it('"look at mailbox" runs verbExamine (object ldesc), not verbLook (room desc)', async () => {
    const result = await game.turn('look at mailbox');
    // verbExamine produces the mailbox ldesc / desc — NOT the room description.
    // The mailbox has no ldesc so verbExamine falls back to desc.
    expect(result.output).toContain('mailbox');
    // Must NOT produce the West-of-House room description (the P2 bug symptom).
    expect(result.output).not.toContain('West of House');
    expect(result.output).not.toContain('open field');
    expect(result.moved).toBe(false);
  });

  it('"examine mailbox" (V-EXAMINE via direct verb) also works', async () => {
    // Regression guard: the direct "examine" verb must still dispatch to verbExamine.
    const result = await game.turn('examine mailbox');
    expect(result.output).toContain('mailbox');
    expect(result.output).not.toContain('West of House');
    expect(result.moved).toBe(false);
  });

  it('"look" alone (V-LOOK, no object) produces the room description', async () => {
    // Regression guard: bare "look" must still produce the room description via V-LOOK.
    const result = await game.turn('look');
    expect(result.output).toContain('West of House');
    expect(result.moved).toBe(false);
  });

  it('"take mailbox" is intercepted by MAILBOX-F (object handler), not default take', async () => {
    // Regression: object-handler short-circuit must still work after P2 fix.
    const result = await game.turn('take mailbox');
    expect(result.output).toContain('It is securely anchored.');
    expect(result.output).not.toContain('Taken.');
  });
});
