/**
 * I-SWORD demon (glow interrupt) — zil/1actions.zil:3849–3877.
 *
 * Glow levels: 0 = none, 1 = faint blue, 2 = very bright.
 * Transitions print on change only; no print when level is unchanged.
 * Demon disables itself when sword leaves ADVENTURER.
 *
 * dfrotz evidence (zork1.z3, Revision 119):
 *   take sword → down (Living Room → Cellar):
 *     "Your sword is glowing with a faint blue glow."   [adjacent infested room]
 *   → north (Cellar → Troll Room):
 *     "Your sword has begun to glow very brightly."     [current room infested]
 *   → look (in Troll Room):
 *     [no message — level unchanged]
 *   → south (Troll Room → Cellar):
 *     "Your sword is glowing with a faint blue glow."   [back to adjacent infested]
 *   → south (Cellar → East of Chasm):
 *     "Your sword is no longer glowing."                [no adjacent infested room]
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Clock } from '../../src/engine/clock.js';
import { Flag } from '../../src/domain/flags.js';
import type { Game } from '../../src/engine/game.js';
import type { World } from '../../src/domain/world.js';

function worldOf(g: Game): World {
  return (g as unknown as { world: World }).world;
}

function clockOf(g: Game): Clock {
  return (g as unknown as { clock: Clock }).clock;
}

// RNG stub — deterministic, no combat draws.
const fixedRng = { next: () => 0.1, prob: () => false, zprob: () => false };

// ---------------------------------------------------------------------------
// Registration — I-SWORD must be a registered clock entry after bootstrap
// ---------------------------------------------------------------------------

describe('I-SWORD: registered in clock after bootstrap', () => {
  it('clock.getEntry("I-SWORD") is defined', () => {
    const g = createGame();
    const clock = clockOf(g);
    expect(clock.getEntry('I-SWORD')).toBeDefined();
  });

  it('starts disabled (turnsLeft=-1, enabled=false)', () => {
    const g = createGame();
    const clock = clockOf(g);
    const entry = clock.getEntry('I-SWORD')!;
    expect(entry.turnsLeft).toBe(-1);
    expect(entry.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Glow transitions — tested on live turn() path
// ---------------------------------------------------------------------------

describe('I-SWORD glow: adjacent infested room (Cellar) → faint blue', () => {
  it('prints faint-blue on first turn in Cellar (Troll Room adjacent)', () => {
    // Troll Room is north of Cellar and contains the troll (ACTORBIT, not invisible)
    const g = createGame({ startRoom: 'CELLAR', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);
    sword.props.set('TVALUE', 0);
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    const r = g.turn('look');
    expect(r.output).toContain('Your sword is glowing with a faint blue glow.');
  });

  it('no glow message when level is unchanged (second turn in Cellar)', () => {
    const g = createGame({ startRoom: 'CELLAR', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);
    sword.props.set('TVALUE', 1);  // already at faint-blue level
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    const r = g.turn('look');
    // Level stays 1 (adjacent troll room) — no transition message
    expect(r.output).not.toContain('glowing');
  });
});

describe('I-SWORD glow: current room infested (Troll Room) → bright', () => {
  it('prints "begun to glow very brightly" when entering Troll Room', () => {
    const g = createGame({ startRoom: 'TROLL-ROOM', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);
    sword.props.set('TVALUE', 1);  // was faint-blue; now in infested room → bright
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    const r = g.turn('look');
    expect(r.output).toContain('Your sword has begun to glow very brightly.');
  });
});

describe('I-SWORD glow: no infested room → extinguish', () => {
  it('prints "no longer glowing" when moving away from all infested rooms', () => {
    // East of Chasm has no adjacent infested rooms
    const g = createGame({ startRoom: 'EAST-OF-CHASM', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);
    sword.props.set('TVALUE', 1);  // was faint-blue; now no infested rooms → 0
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    const r = g.turn('look');
    expect(r.output).toContain('Your sword is no longer glowing.');
  });
});

describe('I-SWORD glow: demon disables when sword dropped', () => {
  it('demon disables itself when sword not in player inventory', () => {
    const g = createGame({ startRoom: 'CELLAR', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    // Sword is NOT in player — put it in the room
    const cellar = w.get('CELLAR')!;
    sword.moveTo(cellar);
    sword.props.set('TVALUE', 2);
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    g.turn('look');  // demon fires, sword not in player → disables

    const entry = clock.getEntry('I-SWORD')!;
    expect(entry.enabled).toBe(false);
  });

  it('no glow message when sword not held', () => {
    const g = createGame({ startRoom: 'TROLL-ROOM', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    const troll = w.get('TROLL-ROOM')!;
    sword.moveTo(troll);  // sword in room, not held
    sword.props.set('TVALUE', 0);
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    const r = g.turn('look');
    expect(r.output).not.toContain('glow');
  });
});

// ---------------------------------------------------------------------------
// Live turn() path — Cellar → Troll Room → Cellar round-trip
// (mirrors the dfrotz walkthrough evidence exactly)
// ---------------------------------------------------------------------------

describe('I-SWORD glow: live turn() round-trip Cellar → Troll Room → Cellar', () => {
  it('glow transitions on movement match dfrotz evidence', () => {
    // Start in Cellar with sword (glow=0). Enable I-SWORD.
    // Turn 1: look → glow 0→1 → "faint blue glow"
    // Turn 2: look → glow stays 1 → no message
    // Move to Troll Room via the game engine is hard without walk verb in tests;
    // instead we simulate by changing player location between turns.

    const g = createGame({ startRoom: 'CELLAR', rng: fixedRng });
    const w = worldOf(g);
    const sword = w.get('SWORD')!;
    const lamp = w.get('LAMP')!;
    const player = w.get('PLAYER')!;
    lamp.moveTo(player);
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    sword.moveTo(player);
    sword.props.set('TVALUE', 0);
    g.start();
    const clock = clockOf(g);
    clock.enable('I-SWORD');

    // Turn 1 in Cellar: 0→1
    const r1 = g.turn('look');
    expect(r1.output).toContain('Your sword is glowing with a faint blue glow.');

    // Turn 2 in Cellar: 1→1 (unchanged)
    const r2 = g.turn('look');
    expect(r2.output).not.toContain('glow');

    // Teleport to Troll Room: 1→2
    const troll = w.get('TROLL-ROOM')!;
    player.moveTo(troll);
    const r3 = g.turn('look');
    expect(r3.output).toContain('Your sword has begun to glow very brightly.');

    // Still in Troll Room: 2→2 (unchanged)
    const r4 = g.turn('look');
    expect(r4.output).not.toContain('glow');

    // Teleport back to Cellar: 2→1
    const cellar = w.get('CELLAR')!;
    player.moveTo(cellar);
    const r5 = g.turn('look');
    expect(r5.output).toContain('Your sword is glowing with a faint blue glow.');

    // Teleport to East of Chasm: 1→0
    const eoc = w.get('EAST-OF-CHASM')!;
    player.moveTo(eoc);
    const r6 = g.turn('look');
    expect(r6.output).toContain('Your sword is no longer glowing.');
  });
});
