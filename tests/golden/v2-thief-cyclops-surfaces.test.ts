/**
 * V2 — Golden deterministic-surface extensions (phase-3-thief-cyclops spec §8 V2).
 *
 * Corpus additions for the deterministic thief/cyclops surfaces permitted by
 * the PATH-B fence (spec §7.1): give-responses, ODYSSEUS, treasure-room
 * reveal on thief death, cyclops M-LOOK state branches, egg-solve score line.
 * No RNG-driven thief outcomes are golden-diffed here.
 *
 * Files generated/updated with UPDATE_GOLDEN=1.
 *
 * ZIL refs:
 *   1actions.zil:1515–1594   CYCLOPS-FCN (give branches)
 *   1actions.zil:1616–1642   CYCLOPS-ROOM-FCN (M-LOOK states)
 *   1actions.zil:1947–2024   ROBBER-FUNCTION verb dispatch (give-responses)
 *   1actions.zil:2035–2062   ROBBER-FUNCTION F_DEAD (treasure-room reveal)
 *   gverbs.zil:945–961       V-ODYSSEUS (wall-break + Sailor)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { Game } from '../../src/engine/game.js';
import { resetThiefState, setCyclowrath } from '../../src/actions/thief-state.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../../src/actions/above-ground.js';
import { resetMatchCount } from '../../src/actions/light-sources.js';

// Reset all module-level globals so each corpus run starts clean.
function resetAll(): void {
  resetThiefState();
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
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

// runEngineFrom — like runEngine but takes a startRoom + post-start setup callback.
// Keeps tools/oracle/engine-runner.ts untouched.
async function runEngineFrom(
  commands: readonly string[],
  opts: { startRoom?: string; seed?: number; setup?: (g: Game) => void } = {},
): Promise<string> {
  const game = createGame({ seed: opts.seed ?? 42, startRoom: opts.startRoom });
  const lines: string[] = [];
  lines.push(game.start());
  opts.setup?.(game);
  for (const cmd of commands) {
    lines.push('');
    lines.push(`> ${cmd}`);
    const result = await game.turn(cmd);
    if (result.output.length > 0) lines.push(result.output);
  }
  return lines.join('\n');
}

// -------------------------------------------------------------------------
// Corpus 1 — Cyclops give-responses (1actions.zil:1543–1574)
//
// All five give branches are fixed strings with no RNG draw:
//   lunch (CYCLOWRATH>=0) → pepper message + I-CYCLOPS enabled
//   garlic → "there is a limit"
//   water (not thirsty, CYCLOWRATH>=0) → refusal
//   water (thirsty, CYCLOWRATH<0) → sleep message
//   other food/junk → "not so stupid"
//
// Each sub-case is a separate run to avoid _cyclowrath module-state leaking
// between runs (giving lunch sets _cyclowrath negative for the duration of
// that game; the next game must start fresh).
// -------------------------------------------------------------------------

describe('V2 corpus 1 — cyclops give-responses (1actions.zil:1543–1574)', () => {
  it('give-responses are byte-identical to committed golden', async () => {
    const withLamp = (g: Game) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);
    };

    // --- sub-run A: give lunch (CYCLOWRATH=0 → pepper message) ---
    resetAll();
    const setupLunch = (g: Game) => {
      withLamp(g);
      g.world.get('LUNCH')?.moveTo(g.world.get('PLAYER')!);
    };
    const runLunch1 = await runEngineFrom(['give lunch to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupLunch });
    resetAll();
    const runLunch2 = await runEngineFrom(['give lunch to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupLunch });
    expect(runLunch1).toBe(runLunch2);

    // --- sub-run B: give garlic → "there is a limit" ---
    resetAll();
    const setupGarlic = (g: Game) => {
      withLamp(g);
      g.world.get('GARLIC')?.moveTo(g.world.get('PLAYER')!);
    };
    const runGarlic1 = await runEngineFrom(['give garlic to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupGarlic });
    resetAll();
    const runGarlic2 = await runEngineFrom(['give garlic to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupGarlic });
    expect(runGarlic1).toBe(runGarlic2);

    // --- sub-run C: give water (not thirsty, CYCLOWRATH=0) → refusal ---
    resetAll();
    const setupWaterNotThirsty = (g: Game) => {
      withLamp(g);
      g.world.get('WATER')?.moveTo(g.world.get('PLAYER')!);
      // CYCLOWRATH=0 (default) — cyclops not thirsty
    };
    const runWaterNo1 = await runEngineFrom(['give water to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupWaterNotThirsty });
    resetAll();
    const runWaterNo2 = await runEngineFrom(['give water to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupWaterNotThirsty });
    expect(runWaterNo1).toBe(runWaterNo2);

    // --- sub-run D: give water (thirsty, CYCLOWRATH<0) → sleep ---
    resetAll();
    const setupWaterThirsty = (g: Game) => {
      withLamp(g);
      g.world.get('WATER')?.moveTo(g.world.get('PLAYER')!);
      setCyclowrath(-2);  // already thirsty
    };
    const runWaterYes1 = await runEngineFrom(['give water to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupWaterThirsty });
    resetAll();
    const runWaterYes2 = await runEngineFrom(['give water to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupWaterThirsty });
    expect(runWaterYes1).toBe(runWaterYes2);

    // --- sub-run E: give inedible (sword) → "not so stupid" ---
    resetAll();
    const setupJunk = (g: Game) => {
      withLamp(g);
      g.world.get('SWORD')?.moveTo(g.world.get('PLAYER')!);
    };
    const runJunk1 = await runEngineFrom(['give sword to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupJunk });
    resetAll();
    const runJunk2 = await runEngineFrom(['give sword to cyclops'], { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupJunk });
    expect(runJunk1).toBe(runJunk2);

    const combined = [runLunch1, '', runGarlic1, '', runWaterNo1, '', runWaterYes1, '', runJunk1].join('\n');
    saveOrCompare('v2-cyclops-give-responses', combined);
  });
});

// -------------------------------------------------------------------------
// Corpus 2 — ROBBER-FUNCTION give-responses (1actions.zil:1986–2012)
//
// Two give-to-thief arms: TVALUE>0 → engrossed; TVALUE==0 → bag.
// Deterministic: no RNG (the give branch doesn't draw PROB).
//
// Each give runs in its own game instance so I-THIEF's post-turn tick
// doesn't move the thief between the treasure-give and the junk-give.
// -------------------------------------------------------------------------

describe('V2 corpus 2 — thief give-responses (1actions.zil:1986–2012)', () => {
  it('give-treasure and give-junk responses are byte-identical to committed golden', async () => {
    // Use TROLL-ROOM as a neutral lit room (troll present but the give commands
    // target the thief, which we place in the room explicitly).

    const withThiefVisible = (g: Game, extraItem: string) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);
      const thief = w.get('THIEF')!;
      thief.moveTo(player.parent!);
      thief.clear(Flag.Invisible);
      w.get(extraItem)?.moveTo(player);
    };

    // Sub-run A: give treasure (EGG, TVALUE=5) → engrossed message
    resetAll();
    const setupTreasure = (g: Game) => withThiefVisible(g, 'EGG');
    const runTreasure1 = await runEngineFrom(['give egg to thief'], { startRoom: 'TROLL-ROOM', seed: 42, setup: setupTreasure });
    resetAll();
    const runTreasure2 = await runEngineFrom(['give egg to thief'], { startRoom: 'TROLL-ROOM', seed: 42, setup: setupTreasure });
    expect(runTreasure1).toBe(runTreasure2);

    // Sub-run B: give junk (KNIFE, TVALUE=0) → places in bag
    resetAll();
    const setupJunk = (g: Game) => withThiefVisible(g, 'KNIFE');
    const runJunk1 = await runEngineFrom(['give knife to thief'], { startRoom: 'TROLL-ROOM', seed: 42, setup: setupJunk });
    resetAll();
    const runJunk2 = await runEngineFrom(['give knife to thief'], { startRoom: 'TROLL-ROOM', seed: 42, setup: setupJunk });
    expect(runJunk1).toBe(runJunk2);

    const combined = [runTreasure1, '', runJunk1].join('\n');
    saveOrCompare('v2-thief-give-responses', combined);
  });
});

// -------------------------------------------------------------------------
// Corpus 3 — V-ODYSSEUS wall-break + off-room "sailor" (gverbs.zil:945–961)
//
// In-room (CYCLOPS-ROOM with awake cyclops): fixed wall-break message.
// Off-room: "Wasn't he a sailor?"
// Both are deterministic.
// -------------------------------------------------------------------------

describe('V2 corpus 3 — V-ODYSSEUS (gverbs.zil:945–961)', () => {
  it('wall-break message is byte-identical to committed golden', async () => {
    resetAll();

    const setup = (g: Game) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp   = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);
    };

    const cmds = ['odysseus'] as const;

    // In CYCLOPS-ROOM with awake cyclops → wall-break + MAGIC-FLAG
    const runInRoom1 = await runEngineFrom(cmds, { startRoom: 'CYCLOPS-ROOM', seed: 42, setup });
    resetAll();
    const runInRoom2 = await runEngineFrom(cmds, { startRoom: 'CYCLOPS-ROOM', seed: 42, setup });
    expect(runInRoom1).toBe(runInRoom2);

    // Off-room → "Wasn't he a sailor?"
    const setupOffRoom = (g: Game) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);
    };

    resetAll();
    const runOffRoom1 = await runEngineFrom(cmds, { startRoom: 'TROLL-ROOM', seed: 42, setup: setupOffRoom });
    resetAll();
    const runOffRoom2 = await runEngineFrom(cmds, { startRoom: 'TROLL-ROOM', seed: 42, setup: setupOffRoom });
    expect(runOffRoom1).toBe(runOffRoom2);

    // After the wall-break: look at CYCLOPS-ROOM to confirm MAGIC-FLAG re-description.
    const setupAfterOdysseus = (g: Game) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);
      // Pre-set MAGIC-FLAG so we can confirm the re-description without running odysseus first.
      (g as unknown as { flags: { set(k: string, v: boolean): void } }).flags.set('MAGIC-FLAG', true);
      // Remove cyclops from world (odysseus removes it).
      w.get('CYCLOPS')?.moveTo(null);
    };

    const cmdsLook = ['look'] as const;
    resetAll();
    const runPostOdysseus1 = await runEngineFrom(cmdsLook, { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupAfterOdysseus });
    resetAll();
    const runPostOdysseus2 = await runEngineFrom(cmdsLook, { startRoom: 'CYCLOPS-ROOM', seed: 42, setup: setupAfterOdysseus });
    expect(runPostOdysseus1).toBe(runPostOdysseus2);

    const combined = [runInRoom1, '', runOffRoom1, '', runPostOdysseus1].join('\n');
    saveOrCompare('v2-odysseus', combined);
  });
});

// -------------------------------------------------------------------------
// Corpus 4 — Treasure-room reveal on thief death (1actions.zil:2040–2059)
//
// F_DEAD in TREASURE-ROOM: treasures revealed list + chalice safe message.
// Deterministic given forced treasures in the room.
// -------------------------------------------------------------------------

describe('V2 corpus 4 — treasure-room reveal on thief death (1actions.zil:2040–2059)', () => {
  it('treasure-room reveal is byte-identical to committed golden', async () => {
    resetAll();

    // Strategy: set thief pStrength to -1 (already KO'd) so heroBlow's
    // "unconscious villain cannot defend himself: He dies." path fires
    // unconditionally (no RNG draw needed).  This is the "forced F-DEAD"
    // approach: def < 0 in heroBlow → res=KILLED → villainResult(def=0) →
    // F_DEAD fires → reveal list printed.  Entirely deterministic.
    //
    // Setup: player in TREASURE-ROOM with lamp + sword; thief in room
    // with pStrength=-1, FIGHTBIT set, INVISIBLE cleared; CHALICE +
    // DIAMOND placed as visible treasures to populate the reveal list.

    const setup = (g: Game) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp   = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);

      const sword = w.get('SWORD')!;
      sword.moveTo(player);

      const thief = w.get('THIEF')!;
      const treasureRoom = w.get('TREASURE-ROOM')!;
      thief.moveTo(treasureRoom);
      thief.clear(Flag.Invisible);
      thief.set(Flag.Fight);

      // Treasures for the reveal list: CHALICE (TVALUE=5) + DIAMOND (TVALUE=10).
      // CHALICE is the one marked "safe to take" at the end; DIAMOND appears in
      // the "A diamond" line of the reveal list.
      w.get('CHALICE')?.moveTo(treasureRoom);
      w.get('DIAMOND')?.moveTo(treasureRoom);

      // pStrength=-1: already unconscious → heroBlow instant-kill branch fires
      // (no RNG draw, deterministic regardless of seed).
      const thiefActor = thief as unknown as { pStrength: number };
      thiefActor.pStrength = -1;
    };

    const cmds = ['attack thief with sword'] as const;

    const run1 = await runEngineFrom(cmds, { startRoom: 'TREASURE-ROOM', seed: 42, setup });
    resetAll();
    const run2 = await runEngineFrom(cmds, { startRoom: 'TREASURE-ROOM', seed: 42, setup });
    expect(run1).toBe(run2);

    saveOrCompare('v2-treasure-room-reveal', run1);
  });
});

// -------------------------------------------------------------------------
// Corpus 5 — CYCLOPS-ROOM-FCN M-LOOK state branches (1actions.zil:1616–1642)
//
// Five mutually exclusive descriptions gated on CYCLOWRATH / CYCLOPS-FLAG /
// MAGIC-FLAG.  Drive each branch by setting the flags directly pre-start.
// All are deterministic (no RNG).
// -------------------------------------------------------------------------

describe('V2 corpus 5 — cyclops M-LOOK state branches (1actions.zil:1616–1642)', () => {
  it('all five state branches are byte-identical to committed golden', async () => {
    type Flags = { set(k: string, v: boolean): void };

    const withLamp = (g: Game) => {
      const w = g.world;
      const player = w.get('PLAYER')!;
      const lamp = w.get('LAMP')!;
      lamp.moveTo(player);
      lamp.set(Flag.OnFire);
      lamp.set(Flag.Light);
    };

    const look = ['look'] as const;

    // Branch 1 — neutral, CYCLOWRATH=0, cyclops awake (default state)
    resetAll();
    const run1 = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => { withLamp(g); /* CYCLOWRATH=0 is the reset default */ },
    });
    resetAll();
    const run1b = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => { withLamp(g); },
    });
    expect(run1).toBe(run1b);

    // Branch 2 — CYCLOWRATH > 0 (angry)
    resetAll();
    const run2 = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => { withLamp(g); setCyclowrath(3); },
    });
    resetAll();
    const run2b = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => { withLamp(g); setCyclowrath(3); },
    });
    expect(run2).toBe(run2b);

    // Branch 3 — CYCLOWRATH < 0 (thirsty/gasping after peppers)
    resetAll();
    const run3 = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => { withLamp(g); setCyclowrath(-2); },
    });
    resetAll();
    const run3b = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => { withLamp(g); setCyclowrath(-2); },
    });
    expect(run3).toBe(run3b);

    // Branch 4 — CYCLOPS-FLAG=true (sleeping), MAGIC-FLAG=false
    resetAll();
    const run4 = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => {
        withLamp(g);
        (g as unknown as { flags: Flags }).flags.set('CYCLOPS-FLAG', true);
      },
    });
    resetAll();
    const run4b = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => {
        withLamp(g);
        (g as unknown as { flags: Flags }).flags.set('CYCLOPS-FLAG', true);
      },
    });
    expect(run4).toBe(run4b);

    // Branch 5 — MAGIC-FLAG=true (wall broken by ODYSSEUS)
    resetAll();
    const run5 = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => {
        withLamp(g);
        (g as unknown as { flags: Flags }).flags.set('MAGIC-FLAG', true);
        // Remove the cyclops so the room desc is clean.
        g.world.get('CYCLOPS')?.moveTo(null);
      },
    });
    resetAll();
    const run5b = await runEngineFrom(look, {
      startRoom: 'CYCLOPS-ROOM', seed: 42,
      setup: (g) => {
        withLamp(g);
        (g as unknown as { flags: Flags }).flags.set('MAGIC-FLAG', true);
        g.world.get('CYCLOPS')?.moveTo(null);
      },
    });
    expect(run5).toBe(run5b);

    const combined = [run1, '', run2, '', run3, '', run4, '', run5].join('\n');
    saveOrCompare('v2-cyclops-mlook-states', combined);
  });
});
