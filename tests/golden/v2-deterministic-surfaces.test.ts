/**
 * V2 — Golden deterministic-surface extensions (spec §11.5/§11.2 + §12 V2).
 *
 * Corpus additions for the deterministic surfaces that the PATH-B fence
 * (§11.1) allows: V-ATTACK guards, troll fend-off, death/resurrection
 * shell, STONE-BARROW endgame.  No RNG-driven combat outcomes are
 * golden-diffed here (the fence is absolute).
 *
 * Each sub-corpus has its own .txt file so failures are localized.
 * Files are generated/updated with UPDATE_GOLDEN=1.
 *
 * Deps: G1 (troll wiring, Phase-1 override removed), DT1 (jigsUp full),
 *       DT2 (ghost dispatch + STONE-BARROW).
 *
 * ZIL refs:
 *   gverbs.zil:176–193     V-ATTACK entry guards
 *   1dungeon.zil:1487–1490  TROLL-ROOM exit gating (ifFlag TROLL-FLAG)
 *   1actions.zil:4046–4099  JIGS-UP (death + FOREST-1 resurrection)
 *   1actions.zil:403–430    STONE-BARROW-FCN endgame
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runEngine } from '../../tools/oracle/engine-runner.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { Game } from '../../src/engine/game.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';

// Reset module-level action globals between runs so each runEngine() call
// starts clean — mirrors the pattern in walkthrough-master.test.ts.
function resetActionState(): void {
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
}

type World = { get(id: string): { set(f: unknown): void; moveTo(d: unknown): void } | undefined };
type Flags = { set(k: string, v: boolean): void };

// runEngineFrom — like runEngine but supports startRoom + a post-start setup
// callback.  Kept local so tools/oracle/engine-runner.ts stays untouched.
function runEngineFrom(
  commands: readonly string[],
  opts: { startRoom?: string; seed?: number; setup?: (g: Game) => void } = {},
): string {
  const game = createGame({ seed: opts.seed ?? 42, startRoom: opts.startRoom });
  const lines: string[] = [];
  lines.push(game.start());
  opts.setup?.(game);
  for (const cmd of commands) {
    lines.push('');
    lines.push(`> ${cmd}`);
    const result = game.turn(cmd);
    if (result.output.length > 0) lines.push(result.output);
  }
  return lines.join('\n');
}

const DIR = import.meta.dirname;

function saveOrCompare(name: string, actual: string): void {
  const path = join(DIR, `${name}.txt`);
  if (process.env['UPDATE_GOLDEN'] === '1') {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, actual, 'utf8');
    console.log(`Golden updated: ${path}`);
    return;
  }
  const expected = readFileSync(path, 'utf8');
  expect(actual).toBe(expected);
}

// ---------------------------------------------------------------------------
// Corpus 1 — V-ATTACK entry guards (gverbs.zil:176–193)
//
// Guard 1: !ACTORBIT(PRSO)  → "I've known strange people, but fighting a X?"
// Guard 2: !PRSI || PRSI==HANDS → "Trying to attack a X with your bare hands..."
//   (reached via KNOCK DOWN which maps to V-ATTACK with numObjects=1)
// Guard 3: iobjFindBit=WEAPONBIT + SHAVE → "You don't have the X."
//   (the parser's SHAVE bit catches this before verbAttack guard 3 fires)
// Guard 4: !WEAPONBIT(PRSI) → "Trying to attack the X with a Y is suicidal."
//
// Test setup: player in TROLL-ROOM with lamp + sword held.
// Guard 1 uses 'attack lamp with sword' (lamp is not ACTORBIT).
// Guard 2 uses 'knock down troll' (1-obj V-ATTACK, no PRSI).
// Guard 3 uses 'attack troll with axe' (axe held by troll, not player).
// Guard 4 uses 'attack troll with lamp' (lamp in inventory, no WEAPONBIT).
// ---------------------------------------------------------------------------

const VATK_COMMANDS = [
  // Guard 1 — non-actor target (lamp has no ACTORBIT)
  'attack lamp with sword',
  // Guard 2 — bare hands (KNOCK DOWN maps to 1-obj V-ATTACK, no weapon slot)
  'knock down troll',
  // Guard 3 — not holding the weapon (parser SHAVE: axe held by troll)
  'attack troll with axe',
  // Guard 4 — non-weapon held (lamp: no WEAPONBIT)
  'attack troll with lamp',
] as const;

describe('V2 corpus 1 — V-ATTACK guards (gverbs.zil:176–193)', () => {
  it('guard transcripts are byte-identical to committed golden', () => {
    const setup = (g: Game) => {
      const w = (g as unknown as { world: World }).world;
      const player = w.get('PLAYER') as never;
      const lamp = w.get('LAMP');
      const sword = w.get('SWORD');
      // Lit lamp so the room isn't dark.
      lamp?.moveTo(player);
      lamp?.set(Flag.OnFire);
      lamp?.set(Flag.Light);
      // Sword in player's inventory (needed for guard 1).
      sword?.moveTo(player);
    };

    const run1 = runEngineFrom(VATK_COMMANDS, { startRoom: 'TROLL-ROOM', seed: 42, setup });
    const run2 = runEngineFrom(VATK_COMMANDS, { startRoom: 'TROLL-ROOM', seed: 42, setup });
    expect(run1).toBe(run2);

    saveOrCompare('v2-vatk-guards', run1);
  });
});

// ---------------------------------------------------------------------------
// Corpus 2 — Troll fend-off (1dungeon.zil:1487–1490, ifFlag TROLL-FLAG)
//
// While TROLL-FLAG is false (troll alive), east and west from TROLL-ROOM
// both return the fixed string "The troll fends you off with a menacing
// gesture."  This is data-driven (ifFlag TROLL-FLAG in rooms.json) and
// has no RNG component.
// ---------------------------------------------------------------------------

const TROLL_FEND_COMMANDS = [
  'east',
  'west',
] as const;

describe('V2 corpus 2 — troll fend-off (ifFlag TROLL-FLAG)', () => {
  it('fend-off transcript is byte-identical to committed golden', () => {
    const setup = (g: Game) => {
      const w = (g as unknown as { world: World }).world;
      const player = w.get('PLAYER') as never;
      const lamp = w.get('LAMP');
      lamp?.moveTo(player);
      lamp?.set(Flag.OnFire);
      lamp?.set(Flag.Light);
    };

    const run1 = runEngineFrom(TROLL_FEND_COMMANDS, { startRoom: 'TROLL-ROOM', seed: 42, setup });
    const run2 = runEngineFrom(TROLL_FEND_COMMANDS, { startRoom: 'TROLL-ROOM', seed: 42, setup });
    expect(run1).toBe(run2);

    saveOrCompare('v2-troll-fend', run1);
  });
});

// ---------------------------------------------------------------------------
// Corpus 3 — Death / resurrection shell (1actions.zil:4046–4099)
//
// Deterministic surfaces only (no RNG-driven combat outcome):
//   - grue death messages (fixed: "Oh, no! A lurking grue...") — seed 42 grue path
//   - "****  You have died  ****"
//   - "Now, let's take a look here..."
//   - "Well, you probably deserve another chance..." → FOREST-1
//   - death penalty: score goes down by 10
//   - FOREST-1 room description on arrival
//   - diagnose shows "killed once"
//   - inventory after death: lamp + sword scattered (empty-handed)
//
// Follows the same seed-42 grue sequence used by the 218-command master
// (rng.next() call #1 = 0.601 < 0.80 → grue fires).
// ---------------------------------------------------------------------------

const DEATH_SHELL_COMMANDS = [
  // Navigate to cellar and trigger grue death
  'north',               // WEST-OF-HOUSE → NORTH-OF-HOUSE
  'east',                // → EAST-OF-HOUSE
  'open window',         // opens kitchen window
  'west',                // → KITCHEN
  'west',                // → LIVING-ROOM
  'take lamp',
  'move rug',
  'open trap door',
  'turn on lamp',
  'down',                // → CELLAR
  'turn off lamp',       // lamp off: cellar now dark
  'south',               // CELLAR(dark) → EAST-OF-CHASM(dark) → grue → FOREST-1
  // Post-resurrection at FOREST-1
  'look',
  'inventory',           // empty-handed (RANDOMIZE-OBJECTS moved lamp to LIVING-ROOM)
  'diagnose',            // "killed once"
  'score',               // score is down 10 from grue death
] as const;

describe('V2 corpus 3 — death/resurrection shell (1actions.zil:4046–4099)', () => {
  it('death shell transcript is byte-identical to committed golden', () => {
    resetActionState();
    const run1 = runEngine(DEATH_SHELL_COMMANDS, { seed: 42 });
    resetActionState();
    const run2 = runEngine(DEATH_SHELL_COMMANDS, { seed: 42 });
    expect(run1).toBe(run2);

    saveOrCompare('v2-death-shell', run1);
  });
});

// ---------------------------------------------------------------------------
// Corpus 4 — STONE-BARROW endgame (1actions.zil:403–430, §9.6)
//
// With WON-FLAG set, the WEST-OF-HOUSE → SW exit leads to STONE-BARROW.
// Entering the barrow fires STONE-BARROW-FCN (M-BEG on ENTER verb) which
// prints the victory text, "ZORK: The Great Underground Empire.", and
// sets gameOver via finish().
//
// Deterministic: no RNG, fully score-driven.
// ---------------------------------------------------------------------------

const STONE_BARROW_COMMANDS = [
  'sw',          // WEST-OF-HOUSE → STONE-BARROW (WON-FLAG gated)
  'enter barrow', // triggers STONE-BARROW-FCN → victory text + finish()
  'look',         // gameOver: should return empty string
] as const;

describe('V2 corpus 4 — STONE-BARROW endgame (1actions.zil:403–430)', () => {
  it('STONE-BARROW transcript is byte-identical to committed golden', () => {
    const setup = (g: Game) => {
      (g as unknown as { flags: Flags }).flags.set('WON-FLAG', true);
    };

    const run1 = runEngineFrom(STONE_BARROW_COMMANDS, { startRoom: 'WEST-OF-HOUSE', seed: 42, setup });
    const run2 = runEngineFrom(STONE_BARROW_COMMANDS, { startRoom: 'WEST-OF-HOUSE', seed: 42, setup });
    expect(run1).toBe(run2);

    saveOrCompare('v2-stone-barrow', run1);
  });
});
