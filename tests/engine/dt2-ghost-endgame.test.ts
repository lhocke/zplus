/**
 * DT2 — Ghost dispatch + endgame.
 *
 * Spec §9.5/§9.6 + §12 DT2 done-criteria:
 *   - Ghost verb table transcribed verbatim from 1actions.zil:3113–3173
 *   - Dispatch is a dead===true branch in turn() — NOT an Actor.action handler (B8)
 *   - PRAY at SOUTH-TEMPLE resurrects (clears dead, alwaysLit, clears LAMP.INVISIBLE,
 *     clears trollFlag if troll in troll-room, trumpets, goes to FOREST-1) — D4
 *   - PRAY elsewhere → "Your prayers are not heard."
 *   - Web-shell finish(): render V-SCORE, set gameOver=true, print terminal string (B7)
 *   - STONE-BARROW-FCN: endgame text + finish() on ENTER/WALK-WEST/THROUGH-BARROW
 *   - RESTORE/RESTART no-ops
 *
 * ZIL: 1actions.zil:3113–3173, 403–430, gverbs.zil:33–53
 */

import { describe, it, expect } from 'vitest';
import { Flag } from '../../src/domain/flags';
import { newGameAt } from '../helpers/new-game.js';
import type { Rng } from '../../src/engine/game.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const grueRng = (): Rng =>
  ({ next: () => 0.5, prob: (b: number) => 0.5 * 100 < b }) as unknown as Rng;

/** Build a game in ghost mode (dead=true) at the given room. */
function ghostGame(roomId: string) {
  const g = newGameAt(roomId);
  g.start();
  (g as unknown as { dead: boolean }).dead = true;
  (g as unknown as { alwaysLit: boolean }).alwaysLit = true;
  return g;
}

// ---------------------------------------------------------------------------
// A. turn() ghost-branch exists and is active when dead===true
// ---------------------------------------------------------------------------

describe('DT2-A: ghost-dispatch branch in turn()', () => {
  it('when dead=true, unknown actions produce the ghost fallback ("You can\'t even do that")', () => {
    // Use 'yell' (V-YELL, 0 objects) — hits the ghost fallback T-clause.
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('yell');
    expect(r.output).toContain("can't even do that");
  });

  it('when dead=false, normal parse occurs (no ghost fallback)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    // dead defaults false; should NOT produce ghost fallback
    const r = g.turn('wave');
    expect(r.output).not.toContain("can't even do that");
  });
});

// ---------------------------------------------------------------------------
// B. Ghost verb responses — verbatim from 1actions.zil:3113–3173
// ---------------------------------------------------------------------------

describe('DT2-B: ghost verb responses', () => {
  it('WALK in Timber Room toward west is blocked (1actions.zil:3115–3117)', () => {
    const g = ghostGame('TIMBER-ROOM');
    const r = g.turn('west');
    expect(r.output).toContain('cannot enter in your condition');
  });

  it('WALK in other rooms is not blocked by ghost text', () => {
    // Ghost allows movement in non-Timber-Room locations (pass-through to normal walk)
    // Just verify the specific "cannot enter" line does NOT appear elsewhere
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('north');
    expect(r.output).not.toContain('cannot enter in your condition');
  });

  it('ATTACK/MUNG/SWING produces ghost vain-attacks message (1actions.zil:3121–3122)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('attack');
    expect(r.output).toContain('vain in your condition');
  });

  it('WAIT produces ghost eternity message (1actions.zil:3128–3129)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('wait');
    expect(r.output).toContain("eternity");
  });

  it('LAMP-ON produces ghost no-light message (1actions.zil:3130–3131)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    // Give the player the lamp so the parser can resolve it.
    const lamp = g.world.get('LAMP')!;
    lamp.set(Flag.Light);
    lamp.moveTo(g.player);
    const r = g.turn('turn on lamp');
    expect(r.output).toContain('need no light');
  });

  it('SCORE produces ghost score-is-dead message (1actions.zil:3132–3133)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('score');
    expect(r.output).toContain("dead");
    expect(r.output).toContain("score");
  });

  it('TAKE/RUB: hand passes through (1actions.zil:3134–3135)', () => {
    // Use inventory (no object required) to verify possession message, and
    // use take-with-present-object for the hand-passes-through path.
    const g = ghostGame('ENTRANCE-TO-HADES');
    // The player is at ENTRANCE-TO-HADES; place something there to take.
    const lantern = g.world.get('LAMP')!;
    lantern.set(Flag.Light);
    lantern.moveTo(g.player.parent!);
    const r = g.turn('take lamp');
    expect(r.output).toContain('passes through');
  });

  it('DROP/THROW/INVENTORY: no possessions (1actions.zil:3136–3137)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('inventory');
    expect(r.output).toContain('no possessions');
  });

  it('DIAGNOSE: you are dead (1actions.zil:3138–3139)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('diagnose');
    expect(r.output).toContain('You are dead');
  });

  it('LOOK: unearthly description when objects present (1actions.zil:3140–3150)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('look');
    expect(r.output).toContain('unearthly');
  });

  it('EXAMINE/LOOK-AT: fallback "You can\'t even do that" — no EXAMINE clause in ZIL table (1actions.zil:3140/3170)', () => {
    // <VERB? LOOK> at ZIL:3140 tests PRSA==V?LOOK only.
    // EXAMINE and LOOK AT both map to V-EXAMINE (gsyntax.zil:199,301), not V-LOOK,
    // so they fall to the T-clause (ZIL:3170-3173): "You can't even do that."
    const g = ghostGame('SOUTH-TEMPLE');
    // ALTAR already lives in SOUTH-TEMPLE in the world data — no manual move needed.
    const examineResult = g.turn('examine altar');
    expect(examineResult.output).toContain("can't even do that");
    const lookAtResult = g.turn('look at altar');
    expect(lookAtResult.output).toContain("can't even do that");
  });

  it('meta verbs pass through (BRIEF/VERBOSE — 1actions.zil:3118–3120)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    // These verbs return <> (false) in ZIL so normal dispatch continues
    const r = g.turn('brief');
    expect(r.output).not.toContain("can't even do that");
  });

  it('ghost fallback fires for unrecognized verbs (1actions.zil:3170–3173)', () => {
    // Use 'yell' (V-YELL, 0 required objects) — hits the ghost T-clause fallback.
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('yell');
    expect(r.output).toContain("can't even do that");
  });
});

// ---------------------------------------------------------------------------
// C. PRAY at SOUTH-TEMPLE — resurrection (1actions.zil:3152–3168) — D4
// ---------------------------------------------------------------------------

describe('DT2-C: PRAY resurrection at SOUTH-TEMPLE', () => {
  it('PRAY at SOUTH-TEMPLE clears dead flag', () => {
    const g = ghostGame('SOUTH-TEMPLE');
    // Need to have visited SOUTH-TEMPLE
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    g.turn('pray');
    expect((g as unknown as { dead: boolean }).dead).toBe(false);
  });

  it('PRAY at SOUTH-TEMPLE clears alwaysLit', () => {
    const g = ghostGame('SOUTH-TEMPLE');
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    g.turn('pray');
    expect((g as unknown as { alwaysLit: boolean }).alwaysLit).toBe(false);
  });

  it('PRAY at SOUTH-TEMPLE clears LAMP INVISIBLE flag (1actions.zil:3154)', () => {
    const g = ghostGame('SOUTH-TEMPLE');
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    const lamp = g.world.get('LAMP')!;
    lamp.set(Flag.Invisible);
    g.turn('pray');
    expect(lamp.has(Flag.Invisible)).toBe(false);
  });

  it('PRAY at SOUTH-TEMPLE: if troll is in TROLL-ROOM, clears TROLL-FLAG (1actions.zil:3159–3160)', () => {
    const g = ghostGame('SOUTH-TEMPLE');
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    // Set TROLL-FLAG and ensure troll is in TROLL-ROOM
    const flags = (g as unknown as { flags: { set(k: string, v: boolean): void; get(k: string): boolean } }).flags;
    flags.set('TROLL-FLAG', true);
    const troll = g.world.get('TROLL');
    const trollRoom = g.world.get('TROLL-ROOM');
    if (troll && trollRoom) troll.moveTo(trollRoom);
    g.turn('pray');
    expect(flags.get('TROLL-FLAG')).toBe(false);
  });

  it('PRAY at SOUTH-TEMPLE moves player to FOREST-1 (1actions.zil:3167)', () => {
    const g = ghostGame('SOUTH-TEMPLE');
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    g.turn('pray');
    expect(g.view().here).toBe('FOREST-1');
  });

  it('PRAY at SOUTH-TEMPLE output contains trumpet/resurrection text', () => {
    const g = ghostGame('SOUTH-TEMPLE');
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    const r = g.turn('pray');
    expect(r.output).toMatch(/trumpet|bright|disembod/i);
  });

  it('PRAY elsewhere → "Your prayers are not heard." (1actions.zil:3168–3169)', () => {
    const g = ghostGame('ENTRANCE-TO-HADES');
    const r = g.turn('pray');
    expect(r.output).toContain('not heard');
  });
});

// ---------------------------------------------------------------------------
// D. finish() — web-shell (B7): V-SCORE output + gameOver + terminal string
// ---------------------------------------------------------------------------

describe('DT2-D: finish() web-shell behavior (B7)', () => {
  it('finish() sets gameOver (subsequent turn returns empty)', () => {
    // Trigger endgame by entering STONE-BARROW
    const g = newGameAt('STONE-BARROW');
    g.start();
    // Directly call finish via a death path where deaths>=2
    (g as unknown as { rng: Rng }).rng = grueRng();
    // Force deaths=2 then die
    (g as unknown as { deaths: number }).deaths = 2;
    const hadesGame = newGameAt('MAZE-1');
    hadesGame.start();
    (hadesGame as unknown as { rng: Rng }).rng = grueRng();
    (hadesGame as unknown as { deaths: number }).deaths = 2;
    hadesGame.turn('north'); // 3rd death → gameOver
    expect(hadesGame.turn('look').output).toBe('');
  });

  it('finish() output includes V-SCORE text (score + rank)', () => {
    const g = newGameAt('MAZE-1');
    g.start();
    (g as unknown as { rng: Rng }).rng = grueRng();
    (g as unknown as { deaths: number }).deaths = 2;
    const r = g.turn('north');
    expect(r.output).toMatch(/score|rank/i);
  });

  it('RESTORE is a no-op during finish (B7)', () => {
    // After gameOver, any turn returns '' — restore never crashes
    const g = newGameAt('MAZE-1');
    g.start();
    (g as unknown as { rng: Rng }).rng = grueRng();
    (g as unknown as { deaths: number }).deaths = 2;
    g.turn('north'); // gameOver
    const r = g.turn('restore');
    expect(r.output).toBe('');
  });

  it('RESTART is a no-op during finish (B7)', () => {
    const g = newGameAt('MAZE-1');
    g.start();
    (g as unknown as { rng: Rng }).rng = grueRng();
    (g as unknown as { deaths: number }).deaths = 2;
    g.turn('north');
    const r = g.turn('restart');
    expect(r.output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// E. STONE-BARROW-FCN endgame (spec §9.6 / 1actions.zil:403–430)
// ---------------------------------------------------------------------------

describe('DT2-E: STONE-BARROW-FCN endgame', () => {
  it('entering STONE-BARROW outputs victory text', () => {
    const g = newGameAt('STONE-BARROW');
    g.start();
    // STONE-BARROW-FCN fires on M-BEG when entering; try ENTER verb
    const r = g.turn('enter barrow');
    expect(r.output).toMatch(/barrow|bridge|adventure|ZORK/i);
  });

  it('entering STONE-BARROW sets gameOver', () => {
    const g = newGameAt('STONE-BARROW');
    g.start();
    g.turn('enter barrow');
    expect(g.turn('look').output).toBe('');
  });

  it('STONE-BARROW endgame output contains "ZORK: The Great Underground Empire."', () => {
    const g = newGameAt('STONE-BARROW');
    g.start();
    const r = g.turn('enter barrow');
    expect(r.output).toContain('ZORK: The Great Underground Empire.');
  });

  it('walk west into STONE-BARROW also triggers endgame (WALK + WEST/IN)', () => {
    // The M-BEG handler fires on WALK+WEST as per spec §9.6 / ZIL:407
    // We can test this by being at a room adjacent to STONE-BARROW
    // STONE-BARROW has exit ne -> WEST-OF-HOUSE; for the reverse direction
    // test the room itself since the handler fires on M-BEG
    // Actually the handler fires before the move — test from outside
    // Use startRoom=STONE-BARROW and walk 'west' or 'in'
    const g = newGameAt('STONE-BARROW');
    g.start();
    const r = g.turn('go in');
    expect(r.output).toContain('ZORK: The Great Underground Empire.');
  });
});

// ---------------------------------------------------------------------------
// F. ghost mode: alwaysLit suppresses grue (spec §9.5)
// ---------------------------------------------------------------------------

describe('DT2-F: ghost mode alwaysLit suppresses grue', () => {
  it('in ghost mode, dark rooms do not produce pitch-black message', () => {
    const g = newGameAt('MAZE-1');
    g.start();
    (g as unknown as { dead: boolean }).dead = true;
    (g as unknown as { alwaysLit: boolean }).alwaysLit = true;
    const r = g.turn('look');
    // Ghost LOOK produces unearthly text, not "It is pitch black"
    expect(r.output).not.toContain('pitch black');
    expect(r.output).toContain('unearthly');
  });
});

// ---------------------------------------------------------------------------
// G. Source structure check: ghost dispatch is in turn(), not Actor.action (B8/OQ-4)
// ---------------------------------------------------------------------------

describe('DT2-G: ghost dispatch is a turn() branch (B8)', () => {
  it('dead===true branch exists in game.ts (not DEAD-FUNCTION as Actor handler)', () => {
    const path = require('path');
    const fs = require('fs');
    const repo = path.resolve(__dirname, '../..');
    const src = fs.readFileSync(path.join(repo, 'src/engine/game.ts'), 'utf8');
    // Must have a dead-state branch in turn()
    expect(src).toMatch(/this\.dead/);
    // Must NOT install DEAD-FUNCTION as an Actor.action or player.handler
    expect(src).not.toMatch(/player\.handler\s*=\s*dead/i);
  });
});
