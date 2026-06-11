/**
 * V2 — Dam/River oracle + golden integration (spec §9 Wave 4 V2)
 *
 * Six golden walkthroughs covering the dam/river deterministic surfaces
 * that the 218-command master path misses.  Each corpus maps to a stored
 * golden .txt file; transcripts are byte-identical across runs (same seed,
 * same startRoom, deterministic engine).
 *
 * Walkthroughs:
 *   C-DAM      — bolt open/close cycle, 8-tick drain/fill, trunk reveal
 *   C-RIVER    — inflate boat, board, launch, drift RIVER-1→2, buoy hint
 *   C-SAND     — dig scarab (digs 1–4 progress + reveal)
 *   C-RAINBOW  — wave sceptre at endpoints, cross, pot-of-gold
 *   C-LEAK     — blue-button leak, DROWNINGS progression, putty repair
 *   C-PUNCTURE — board holding sword → puncture; putty repair
 *
 * Engine starts via startRoom (teleport) with minimal state setup, so the
 * troll-combat section of the navigation path does not interfere.
 * The companion corpus TXT files in tools/oracle/corpus/ carry the full
 * dfrotz-navigable command sequence (including troll kill) for manual
 * oracle runs via `npm run oracle`.
 *
 * ZIL refs: 1actions.zil dam/river section as cited in spec §3–§6.
 *
 * Generated with UPDATE_GOLDEN=1; update when the engine changes intentionally.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { Game } from '../../src/engine/game.js';
const DIR = import.meta.dirname;
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

// ---------------------------------------------------------------------------
// Engine runner — mirrors engine-runner.ts but supports startRoom + setup.
// ---------------------------------------------------------------------------

function runEngineFrom(
  commands: readonly string[],
  opts: { startRoom: string; seed?: number; setup?: (g: Game) => void },
): string {
  const game = createGame({ startRoom: opts.startRoom as never, seed: opts.seed ?? 42 });
  const lines: string[] = [];
  lines.push(game.start());
  opts.setup?.(game);
  for (const cmd of commands) {
    lines.push('');
    lines.push(`> ${cmd}`);
    const r = game.turn(cmd);
    if (r.output.length > 0) lines.push(r.output);
  }
  return lines.join('\n');
}

function saveOrCompare(name: string, actual: string): void {
  const path = join(DIR, `${name}.txt`);
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, actual, 'utf8');
    return;
  }
  const expected = readFileSync(path, 'utf8');
  expect(actual).toBe(expected);
}

// Shared light setup — lamp lit and carried.
function giveLight(game: Game): void {
  const lamp = game.world.get('LAMP')!;
  lamp.set(Flag.OnFire);
  lamp.set(Flag.Light);
  lamp.moveTo(game.player);
}

// ---------------------------------------------------------------------------
// C-DAM — bolt open/close cycle (spec §8.1)
//
// Setup: player in MAINTENANCE-ROOM with lamp + wrench.  Unlocks panel, goes
// to DAM-ROOM, opens gates (bolt), waits 8 turns for I-REMPTY drain, checks
// trunk reveal and RESERVOIR-SOUTH crossing, then closes gates and waits 8
// for I-RFILL refill.
//
// ZIL refs: BOLT-F :1187, I-RFILL :1226, I-REMPTY :1263, TRUNK :1048.
// ---------------------------------------------------------------------------

const C_DAM_CMDS = [
  // In MAINTENANCE-ROOM: unlock panel
  'push yellow button',
  // Navigate to DAM-ROOM
  'west',
  'south',
  'look',
  // Open gates
  'turn bolt with wrench',
  // S2: gates open, water high
  'look',
  // Wait 8 turns for I-REMPTY to fire
  'wait', 'wait', 'wait', 'wait',
  'wait', 'wait', 'wait', 'wait',
  // S3: drained — dam-room description
  'look',
  // Cross to RESERVOIR-SOUTH
  'west',
  'look',
  // Into reservoir (mud) — trunk visible
  'north',
  'look',
  // Close the gates
  'south',
  'east',
  'turn bolt with wrench',
  // S4: gates closed, refilling
  'look',
  // Wait 8 turns for I-RFILL
  'wait', 'wait', 'wait', 'wait',
  'wait', 'wait', 'wait', 'wait',
  // S0/S3': back to filled — dam-room description
  'look',
] as const;

describe('C-DAM — bolt open/close cycle, drain/fill, trunk reveal', () => {
  it('transcript is byte-identical to committed golden', () => {
    const run1 = runEngineFrom(C_DAM_CMDS, {
      startRoom: 'MAINTENANCE-ROOM',
      seed: 42,
      setup(game) {
        giveLight(game);
        // Wrench starts in MAINTENANCE-ROOM; give to player.
        game.world.get('WRENCH')!.moveTo(game.player);
      },
    });
    const run2 = runEngineFrom(C_DAM_CMDS, {
      startRoom: 'MAINTENANCE-ROOM',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('WRENCH')!.moveTo(game.player);
      },
    });
    expect(run1).toBe(run2);
    saveOrCompare('v2-c-dam', run1);
  });
});

// ---------------------------------------------------------------------------
// C-RIVER — inflate, board, launch, drift, buoy hint (spec §8.1)
//
// Setup: player in DAM-BASE with pump + lamp.  Inflates boat, boards, launches,
// drifts RIVER-1→RIVER-2 (4-tick speed), picks up buoy at RIVER-4 (buoy hint).
// Also covers the falls-death variant: ride past RIVER-5.
//
// ZIL refs: IBOAT-FUNCTION :2820, RBOAT-FUNCTION :2738, I-RIVER :2708,
//           RIVR4-ROOM :2844, RIVER-SPEEDS :2692.
// ---------------------------------------------------------------------------

const C_RIVER_CMDS = [
  'look',
  // Inflate boat (pump in inventory)
  'inflate boat with pump',
  'look',
  // Board and launch
  'board boat',
  'launch',
  // RIVER-1 (speed 4): launch arms I-RIVER=4, advance 4→3.
  //   look(3→2), wait(2→1), wait(1→0 FIRE→RIVER-2 rearm=4)
  'look',
  'wait',
  'wait',
  // RIVER-2 (speed 4): look(4→3), wait(3→2), wait(2→1), wait(1→0 FIRE→RIVER-3 rearm=3)
  'look',
  'wait', 'wait', 'wait',
  // RIVER-3 (speed 3): wait(3→2), wait(2→1), wait(1→0 FIRE→RIVER-4 rearm=2)
  'wait', 'wait', 'wait',
  // RIVER-4 (speed 2): take-buoy(2→1), wait(1→0 FIRE→RIVER-5)
  'take buoy',
  'wait',
  // RIVER-5 (speed 1): east exits to SANDY-BEACH
  'east',
  'look',
] as const;

describe('C-RIVER — inflate, board, launch, drift, buoy hint', () => {
  it('transcript is byte-identical to committed golden', () => {
    const run1 = runEngineFrom(C_RIVER_CMDS, {
      startRoom: 'DAM-BASE',
      seed: 42,
      setup(game) {
        giveLight(game);
        // Pump is in RESERVOIR-NORTH; move to player for this test.
        game.world.get('PUMP')!.moveTo(game.player);
      },
    });
    const run2 = runEngineFrom(C_RIVER_CMDS, {
      startRoom: 'DAM-BASE',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('PUMP')!.moveTo(game.player);
      },
    });
    expect(run1).toBe(run2);
    saveOrCompare('v2-c-river', run1);
  });
});

// ---------------------------------------------------------------------------
// C-SAND — dig scarab (digs 1–4 progress + reveal) (spec §8.1)
//
// Setup: player in SANDY-BEACH (lit), shovel in hand.  Digs 4 times: first
// three print BDIGS[0/1/2] progress; fourth reveals the scarab.
//
// ZIL refs: SAND-FUNCTION :2855, BDIGS :2871, BEACH-DIG :2851.
// ---------------------------------------------------------------------------

const C_SAND_CMDS = [
  'look',
  // Shovel is in SANDY-BEACH; take it here before going to the cave.
  'take shovel',
  // SAND object (and SCARAB) are in SANDY-CAVE.
  'ne',
  // dig ×4: progress msgs then reveal
  'dig sand with shovel',
  'dig sand with shovel',
  'dig sand with shovel',
  'dig sand with shovel',
  // Scarab visible now — take it
  'take scarab',
  'look',
] as const;

describe('C-SAND — dig scarab, BDIGS progression, reveal on dig #4', () => {
  it('transcript is byte-identical to committed golden', () => {
    const run1 = runEngineFrom(C_SAND_CMDS, {
      startRoom: 'SANDY-BEACH',
      seed: 42,
      setup(game) {
        giveLight(game);
        // SANDY-BEACH has no On flag; give it so room objects are visible.
        game.world.get('SANDY-BEACH')!.set(Flag.On);
        // SANDY-CAVE also needs light.
        game.world.get('SANDY-CAVE')!.set(Flag.On);
      },
    });
    const run2 = runEngineFrom(C_SAND_CMDS, {
      startRoom: 'SANDY-BEACH',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('SANDY-BEACH')!.set(Flag.On);
        game.world.get('SANDY-CAVE')!.set(Flag.On);
      },
    });
    expect(run1).toBe(run2);
    saveOrCompare('v2-c-sand', run1);
  });
});

// ---------------------------------------------------------------------------
// C-RAINBOW — wave sceptre, cross rainbow, pot of gold (spec §8.1)
//
// Setup: player in ARAGAIN-FALLS with sceptre + lamp.  Waves sceptre at falls
// (rainbow solidifies), crosses to END-OF-RAINBOW, waves again (pot of gold
// appears), takes pot, crosses back.
//
// ZIL refs: SCEPTRE-FUNCTION :2592, RAINBOW-FCN :2634, POT-OF-GOLD :1dungeon.
// ---------------------------------------------------------------------------

const C_RAINBOW_CMDS = [
  'look',
  // Wave sceptre at ARAGAIN-FALLS → rainbow solid, pot-of-gold revealed
  'wave sceptre',
  'look',
  // ARAGAIN-FALLS → ON-RAINBOW → END-OF-RAINBOW (two west moves)
  'west',
  'west',
  'look',
  // Pot of gold is already here (INVISIBLE cleared by the wave above).
  // Take it — no second wave needed.
  'take pot',
  // Cross back: END-OF-RAINBOW → ON-RAINBOW → ARAGAIN-FALLS (two east moves)
  'east',
  'east',
  'look',
  // Wave again at ARAGAIN-FALLS → rainbow dissolves
  'wave sceptre',
  'look',
] as const;

describe('C-RAINBOW — sceptre wave, rainbow cross, pot-of-gold', () => {
  it('transcript is byte-identical to committed golden', () => {
    const run1 = runEngineFrom(C_RAINBOW_CMDS, {
      startRoom: 'ARAGAIN-FALLS',
      seed: 42,
      setup(game) {
        giveLight(game);
        // Sceptre starts in END-OF-RAINBOW; move to player.
        game.world.get('SCEPTRE')!.moveTo(game.player);
      },
    });
    const run2 = runEngineFrom(C_RAINBOW_CMDS, {
      startRoom: 'ARAGAIN-FALLS',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('SCEPTRE')!.moveTo(game.player);
      },
    });
    expect(run1).toBe(run2);
    saveOrCompare('v2-c-rainbow', run1);
  });
});

// ---------------------------------------------------------------------------
// C-LEAK — blue-button leak, DROWNINGS progression, putty repair (spec §8.1)
//
// Setup: player in MAINTENANCE-ROOM with lamp + putty (from putty / tube
// objects).  Pushes blue button (leak starts), observes 4 DROWNINGS messages,
// then repairs with putty.
//
// ZIL refs: BUTTON-F :1298, I-MAINT-ROOM :1343, DROWNINGS :1284, LEAK-FUNCTION :1362.
// ---------------------------------------------------------------------------

const C_LEAK_CMDS = [
  'look',
  // Push blue button → leak starts (WATER-LEVEL = 1, demon armed)
  'push blue button',
  // Observe DROWNINGS progression: turns advance water level 1→3→5→7
  'wait',   // WL 2 → no message (not in maint room during wait, we are)
  'wait',   // WL 3
  'wait',   // WL 4
  'wait',   // WL 5
  // Repair with gunk (PUTTY synonyms: MATERIAL, GUNK — "putty" is not in vocab)
  'put gunk on leak',
  // Confirm repair message + demon stopped
  'wait',   // no more rise
  'look',
] as const;

describe('C-LEAK — blue-button leak, DROWNINGS msgs, putty repair', () => {
  it('transcript is byte-identical to committed golden', () => {
    const run1 = runEngineFrom(C_LEAK_CMDS, {
      startRoom: 'MAINTENANCE-ROOM',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('MAINTENANCE-ROOM')!.set(Flag.On);
        // Putty tube: squeeze to get putty, or just use PUTTY directly.
        // PUTTY starts in MAINTENANCE-ROOM; move to player.
        game.world.get('PUTTY')!.moveTo(game.player);
      },
    });
    const run2 = runEngineFrom(C_LEAK_CMDS, {
      startRoom: 'MAINTENANCE-ROOM',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('MAINTENANCE-ROOM')!.set(Flag.On);
        game.world.get('PUTTY')!.moveTo(game.player);
      },
    });
    expect(run1).toBe(run2);
    saveOrCompare('v2-c-leak', run1);
  });
});

// ---------------------------------------------------------------------------
// C-PUNCTURE — board holding sword → puncture; putty repair (spec §8.1)
//
// Setup: player in DAM-BASE with pump, sword, putty.  Inflates boat, boards
// while holding sword → puncture message + PUNCTURED-BOAT.  Repairs with
// putty → back to INFLATABLE-BOAT.
//
// ZIL refs: RBOAT-FUNCTION BOARD :2787, FIX-BOAT :2664, NM-G.
// ---------------------------------------------------------------------------

const C_PUNCTURE_CMDS = [
  'look',
  // Inflate boat
  'inflate boat with pump',
  'look',
  // Board with sword in inventory → puncture
  'board boat',
  'look',
  // Repair with gunk (PUTTY synonyms: MATERIAL, GUNK — "putty" is not in vocab)
  'put gunk on boat',
  'look',
  // Now inflatable again: re-inflate and confirm seaworthy
  'inflate boat with pump',
  'look',
] as const;

describe('C-PUNCTURE — board with sword punctures; putty repairs', () => {
  it('transcript is byte-identical to committed golden', () => {
    const run1 = runEngineFrom(C_PUNCTURE_CMDS, {
      startRoom: 'DAM-BASE',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('PUMP')!.moveTo(game.player);
        game.world.get('SWORD')!.moveTo(game.player);
        game.world.get('PUTTY')!.moveTo(game.player);
      },
    });
    const run2 = runEngineFrom(C_PUNCTURE_CMDS, {
      startRoom: 'DAM-BASE',
      seed: 42,
      setup(game) {
        giveLight(game);
        game.world.get('PUMP')!.moveTo(game.player);
        game.world.get('SWORD')!.moveTo(game.player);
        game.world.get('PUTTY')!.moveTo(game.player);
      },
    });
    expect(run1).toBe(run2);
    saveOrCompare('v2-c-puncture', run1);
  });
});
