/**
 * CC1 — Hades exorcism timer unit tests (spec §6.1, §10.3)
 *
 * LLD-ROOM FCN + I-XB/I-XC/I-XBH clock slots.
 * All tests drive the real world via newGameAt/createGame; no mocking.
 *
 * ZIL refs: 1actions.zil:1058–1150
 *
 * Timer done-criteria (spec §10.3):
 *   - ring arms I-XB(6) + I-XBH(20); candles-lit within 6 disables I-XB, arms I-XC(3)
 *   - read within 3 sets LLD-FLAG
 *   - let I-XB lapse → ceremony breaks
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';
import type { Game } from '../../src/engine/game.js';
import { Flag } from '../../src/domain/flags.js';
import { killInterrupts } from '../../src/engine/death.js';
import type { Clock } from '../../src/engine/clock.js';

// Internal game clock accessor — same pattern as other timer tests.
type ClockLike = {
  getEntry(id: string): { turnsLeft: number; enabled: boolean } | undefined;
  queue(id: string, period: number, enabled: boolean): void;
};

function clockOf(g: Game): ClockLike {
  return (g as unknown as { clock: ClockLike }).clock;
}

function flags(g: Game) {
  return (g as unknown as { flags: { get(n: string): boolean; set(n: string, v: boolean): void } }).flags;
}

// Set up a game at ENTRANCE-TO-HADES with the ceremony items in player inventory.
// BELL starts in NORTH-TEMPLE, BOOK in ALTAR, CANDLES in SOUTH-TEMPLE.
function gameWithCeremonyItems(
  opts: { withBell?: boolean; withBook?: boolean; withCandles?: boolean } = {},
): Game {
  const { withBell = true, withBook = true, withCandles = true } = opts;
  const g = newGameAt('ENTRANCE-TO-HADES');
  g.start();
  const w = g.world;
  const player = g.player;

  if (withBell) {
    const bell = w.get('BELL');
    expect(bell, 'BELL must exist in world').toBeDefined();
    bell!.moveTo(player);
  }
  if (withBook) {
    const book = w.get('BOOK');
    expect(book, 'BOOK must exist in world').toBeDefined();
    book!.moveTo(player);
  }
  if (withCandles) {
    const candles = w.get('CANDLES');
    expect(candles, 'CANDLES must exist in world').toBeDefined();
    candles!.moveTo(player);
  }
  return g;
}

// ---------------------------------------------------------------------------
// I-XB / I-XBH registration — slots must exist after bootstrap
// ---------------------------------------------------------------------------

describe('CC1 — I-XB/I-XBH slots registered (spec §6.1)', () => {
  it('I-XB slot is registered in the clock (accessible via getEntry)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const entry = clockOf(g).getEntry('I-XB');
    expect(entry, 'I-XB must be a registered clock slot').toBeDefined();
  });

  it('I-XC slot is registered in the clock', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const entry = clockOf(g).getEntry('I-XC');
    expect(entry, 'I-XC must be a registered clock slot').toBeDefined();
  });

  it('I-XBH slot is registered in the clock', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const entry = clockOf(g).getEntry('I-XBH');
    expect(entry, 'I-XBH must be a registered clock slot').toBeDefined();
  });

  it('I-XB starts parked (disabled, turnsLeft=0)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const entry = clockOf(g).getEntry('I-XB');
    expect(entry!.enabled).toBe(false);
    expect(entry!.turnsLeft).toBe(0);
  });

  it('I-XBH starts parked (disabled, turnsLeft=0)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const entry = clockOf(g).getEntry('I-XBH');
    expect(entry!.enabled).toBe(false);
    expect(entry!.turnsLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M-BEG: RING BELL → arms I-XB(6) + I-XBH(20)
// ---------------------------------------------------------------------------

describe('CC1 — ring bell arms I-XB(6) and I-XBH(20) (1actions.zil:1100–1101)', () => {
  it('ring bell output contains red-hot bell text', () => {
    const g = gameWithCeremonyItems();
    const out = g.turn('ring bell').output;
    expect(out).toContain('bell suddenly becomes red hot');
  });

  it('I-XB is enabled after ring (turnsLeft=5: queued at 6, one CLOCKER tick on ring turn)', () => {
    const g = gameWithCeremonyItems();
    g.turn('ring bell');
    const entry = clockOf(g).getEntry('I-XB');
    expect(entry!.enabled).toBe(true);
    // QUEUE I-XB 6, then CLOCKER ticks once on the ring turn → turnsLeft=5.
    expect(entry!.turnsLeft).toBe(5);
  });

  it('I-XBH is enabled after ring (turnsLeft=19: queued at 20, one CLOCKER tick on ring turn)', () => {
    const g = gameWithCeremonyItems();
    g.turn('ring bell');
    const entry = clockOf(g).getEntry('I-XBH');
    expect(entry!.enabled).toBe(true);
    // QUEUE I-XBH 20, then CLOCKER ticks once on the ring turn → turnsLeft=19.
    expect(entry!.turnsLeft).toBe(19);
  });

  it('BELL is removed from player after ring', () => {
    const g = gameWithCeremonyItems();
    g.turn('ring bell');
    const bell = g.world.get('BELL')!;
    expect(bell.parent?.id).not.toBe('PLAYER');
  });

  it('HOT-BELL moves to ENTRANCE-TO-HADES after ring', () => {
    const g = gameWithCeremonyItems();
    g.turn('ring bell');
    const hotBell = g.world.get('HOT-BELL')!;
    expect(hotBell.parent?.id).toBe('ENTRANCE-TO-HADES');
  });

  it('carried lit candles drop and extinguish on ring (1actions.zil:1094–1099)', () => {
    const g = gameWithCeremonyItems();
    const candles = g.world.get('CANDLES')!;
    const out = g.turn('ring bell').output;
    expect(out).toContain('candles drop to the ground');
    expect(candles.parent?.id).toBe('ENTRANCE-TO-HADES');
  });

  it('I-CANDLES disabled when candles drop on ring', () => {
    const g = gameWithCeremonyItems();
    g.turn('ring bell');
    const entry = clockOf(g).getEntry('I-CANDLES');
    expect(entry?.enabled ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M-END: lit candles held after ring → XC=T, arms I-XC(3)
// ---------------------------------------------------------------------------

describe('CC1 — lit candles after ring: M-END arms I-XC(3) (1actions.zil:1115–1125)', () => {
  it('XC global becomes true when lit candles held on M-END after ring', () => {
    // Do NOT include candles in initial inventory — ring with bell+book only.
    // Then give lit candles before the next turn so M-END fires the XC condition.
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    const bell = w.get('BELL')!;
    const book = w.get('BOOK')!;
    const candles = w.get('CANDLES')!;

    bell.moveTo(player);
    book.moveTo(player);

    g.turn('ring bell');

    // Give player lit candles after ring (so they weren't in inventory during ring).
    candles.moveTo(player);
    candles.set(Flag.OnFire);

    // V-LOOK fires 1 CLOCKER tick (unlike V-WAIT which fires 3, consuming I-XC).
    // M-END fires unconditionally → XC condition met.
    g.turn('look');
    expect(flags(g).get('XC')).toBe(true);
  });

  it('I-XC armed after XC condition fires (turnsLeft=2: queued at 3, one CLOCKER tick on look turn)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    const bell = w.get('BELL')!;
    const book = w.get('BOOK')!;
    const candles = w.get('CANDLES')!;

    bell.moveTo(player);
    book.moveTo(player);
    g.turn('ring bell');

    candles.moveTo(player);
    candles.set(Flag.OnFire);

    // V-LOOK: 1 CLOCKER tick; I-XC queued at 3, ticked once → turnsLeft=2.
    g.turn('look');
    const entry = clockOf(g).getEntry('I-XC');
    expect(entry!.enabled).toBe(true);
    // M-END queues I-XC at 3; CLOCKER ticks once on the look turn → turnsLeft=2.
    expect(entry!.turnsLeft).toBe(2);
  });

  it('I-XB disabled when XC fires (1actions.zil:1124)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    const bell = w.get('BELL')!;
    const book = w.get('BOOK')!;
    const candles = w.get('CANDLES')!;

    bell.moveTo(player);
    book.moveTo(player);
    g.turn('ring bell');

    candles.moveTo(player);
    candles.set(Flag.OnFire);

    g.turn('look');
    const ixb = clockOf(g).getEntry('I-XB');
    expect(ixb!.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M-BEG: READ BOOK (requires XC=T) → LLD-FLAG set, GHOSTS removed
// ---------------------------------------------------------------------------

describe('CC1 — read book sets LLD-FLAG (1actions.zil:1102–1113)', () => {
  it('read book without XC=T does not set LLD-FLAG', () => {
    const g = gameWithCeremonyItems();
    g.turn('ring bell');
    // XC not yet set — candles were dropped on ring
    g.turn('read book');
    expect(flags(g).get('LLD-FLAG')).toBe(false);
  });

  it('read book with XC=T sets LLD-FLAG', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;

    w.get('BELL')!.moveTo(player);
    w.get('BOOK')!.moveTo(player);

    g.turn('ring bell');

    const candles = w.get('CANDLES')!;
    candles.moveTo(player);
    candles.set(Flag.OnFire);

    g.turn('look'); // 1 CLOCKER tick; M-END fires → XC=T

    g.turn('read book');
    expect(flags(g).get('LLD-FLAG')).toBe(true);
  });

  it('read book with XC=T removes GHOSTS from room', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;

    w.get('BELL')!.moveTo(player);
    w.get('BOOK')!.moveTo(player);
    g.turn('ring bell');

    const candles = w.get('CANDLES')!;
    candles.moveTo(player);
    candles.set(Flag.OnFire);
    g.turn('look'); // 1 CLOCKER tick; M-END fires → XC=T

    const ghosts = w.get('GHOSTS')!;
    expect(ghosts, 'GHOSTS must exist in world').toBeDefined();
    g.turn('read book');
    expect(ghosts.parent).toBeNull();
  });

  it('read book with XC=T emits ceremony text', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;

    w.get('BELL')!.moveTo(player);
    w.get('BOOK')!.moveTo(player);
    g.turn('ring bell');

    const candles = w.get('CANDLES')!;
    candles.moveTo(player);
    candles.set(Flag.OnFire);
    g.turn('look'); // 1 CLOCKER tick; M-END fires → XC=T

    const out = g.turn('read book').output;
    expect(out).toContain('Begone, fiends!');
  });

  it('I-XC disabled after LLD-FLAG set (1actions.zil:1113)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;

    w.get('BELL')!.moveTo(player);
    w.get('BOOK')!.moveTo(player);
    g.turn('ring bell');

    const candles = w.get('CANDLES')!;
    candles.moveTo(player);
    candles.set(Flag.OnFire);
    g.turn('look'); // 1 CLOCKER tick; M-END fires → XC=T
    g.turn('read book');

    const ixc = clockOf(g).getEntry('I-XC');
    expect(ixc!.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I-XB fires after 6 ticks without XC: ceremony breaks
// ---------------------------------------------------------------------------

describe('CC1 — I-XB lapse breaks ceremony (1actions.zil:1131–1138)', () => {
  it('I-XB fire clears XB global (ceremony broken)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    w.get('BELL')!.moveTo(player);
    w.get('BOOK')!.moveTo(player);

    // Ring with candles NOT in inventory (so they can't drop; XC stays false).
    g.turn('ring bell');

    // I-XB was queued at 6, ticked once on ring turn → turnsLeft=5.
    // After 5 more waits it fires.
    for (let i = 0; i < 5; i++) g.turn('wait');

    expect(flags(g).get('XB')).toBe(false);
  });

  it('I-XB fire emits ceremony-break message when player is at ENTRANCE-TO-HADES', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    w.get('BELL')!.moveTo(player);
    w.get('BOOK')!.moveTo(player);

    g.turn('ring bell');

    let breakText = '';
    for (let i = 0; i < 5; i++) {
      const r = g.turn('wait');
      if (r.output.includes('wraiths') && r.output.includes('jeering')) {
        breakText = r.output;
      }
    }
    expect(breakText).toContain('tension of this ceremony is broken');
  });
});

// ---------------------------------------------------------------------------
// I-XBH fires after 20 ticks: BELL restored
// ---------------------------------------------------------------------------

describe('CC1 — I-XBH: bell cooldown restores BELL after 20 ticks (1actions.zil:1143–1147)', () => {
  it('BELL moves to ENTRANCE-TO-HADES when I-XBH fires', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    w.get('BELL')!.moveTo(player);

    g.turn('ring bell');

    // Arm I-XBH at 1 tick for the test (avoids 20-wait loop).
    clockOf(g).queue('I-XBH', 1, true);
    g.turn('wait');

    const bell = w.get('BELL')!;
    expect(bell.parent?.id).toBe('ENTRANCE-TO-HADES');
  });

  it('HOT-BELL removed from world when I-XBH fires', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    w.get('BELL')!.moveTo(player);

    g.turn('ring bell');

    clockOf(g).queue('I-XBH', 1, true);
    g.turn('wait');

    const hotBell = w.get('HOT-BELL')!;
    expect(hotBell.parent).toBeNull();
  });

  it('bell-cooled message emitted when player is at ENTRANCE-TO-HADES', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    w.get('BELL')!.moveTo(player);

    g.turn('ring bell');

    clockOf(g).queue('I-XBH', 1, true);
    const out = g.turn('wait').output;
    expect(out).toContain('bell appears to have cooled down');
  });
});

// ---------------------------------------------------------------------------
// GHOSTS-F: interactions with spirits
// ---------------------------------------------------------------------------

describe('CC1 — GHOSTS-F: spirit interactions (1actions.zil:264–273)', () => {
  it('tell ghosts: spirits jeer and ignore (V-TELL hits GHOSTS-F step 5)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    // V-TELL with ghosts as dobj — parser needs "talk to ghosts" or "tell ghosts"
    const out = g.turn('talk to ghosts').output;
    expect(out).toContain('jeer loudly and ignore you');
  });

  it('examine ghosts: cannot interact (T-case in GHOSTS-F)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const out = g.turn('examine ghosts').output;
    // GHOSTS-F T-case: "You seem unable to interact with these spirits."
    expect(out).toContain('unable to interact');
  });
});

// ---------------------------------------------------------------------------
// BELL-F: ring bell outside ENTRANCE-TO-HADES (or when LLD-FLAG set)
// ---------------------------------------------------------------------------

describe('CC1 — BELL-F: default ring response (1actions.zil:343–349)', () => {
  it('ring bell outside ENTRANCE-TO-HADES emits ding-dong', () => {
    // Bell starts in NORTH-TEMPLE
    const g = newGameAt('NORTH-TEMPLE');
    g.start();
    const bell = g.world.get('BELL')!;
    bell.moveTo(g.player);
    const out = g.turn('ring bell').output;
    expect(out).toContain('Ding, dong.');
  });

  it('ring bell at ENTRANCE-TO-HADES after LLD-FLAG set emits ding-dong', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    flags(g).set('LLD-FLAG', true);
    const bell = g.world.get('BELL')!;
    bell.moveTo(g.player);
    const out = g.turn('ring bell').output;
    expect(out).toContain('Ding, dong.');
  });
});

// ---------------------------------------------------------------------------
// HOT-BELL-F: interactions with the hot bell
// ---------------------------------------------------------------------------

describe('CC1 — HOT-BELL-F: hot bell interactions (1actions.zil:351–368)', () => {
  it('take hot-bell: cannot take (too hot)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const hotBell = w.get('HOT-BELL')!;
    hotBell.moveTo(w.get('ENTRANCE-TO-HADES')!);
    const out = g.turn('take bell').output;
    expect(out.toLowerCase()).toMatch(/hot|cannot be taken/);
  });
});

// ---------------------------------------------------------------------------
// BLACK-BOOK: book interactions
// ---------------------------------------------------------------------------

describe('CC1 — BLACK-BOOK: book interactions (1actions.zil:2187–2205)', () => {
  it('open book: already open to page 569', () => {
    const g = newGameAt('ALTAR');
    g.start();
    const book = g.world.get('BOOK')!;
    book.moveTo(g.player);
    const out = g.turn('open book').output;
    expect(out).toContain('already open to page 569');
  });

  it('close book: cannot be closed', () => {
    const g = newGameAt('ALTAR');
    g.start();
    const book = g.world.get('BOOK')!;
    book.moveTo(g.player);
    const out = g.turn('close book').output;
    expect(out).toContain('cannot be closed');
  });

  it('turn pages: other page discusses banishment', () => {
    const g = newGameAt('ALTAR');
    g.start();
    const book = g.world.get('BOOK')!;
    book.moveTo(g.player);
    const out = g.turn('turn page').output;
    expect(out).toContain('banishment');
  });
});

// ---------------------------------------------------------------------------
// LLD-ROOM M-LOOK: gateway description
// ---------------------------------------------------------------------------

describe('CC1 — LLD-ROOM M-LOOK: gateway description (1actions.zil:1059–1070)', () => {
  it('look at ENTRANCE-TO-HADES: Abandon every hope text', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const out = g.turn('look').output;
    expect(out).toContain('Abandon every hope');
  });

  it('look at ENTRANCE-TO-HADES without LLD-FLAG: barred by evil spirits line', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const out = g.turn('look').output;
    expect(out).toContain('barred by evil spirits');
  });

  it('look at ENTRANCE-TO-HADES with LLD-FLAG: no spirits line', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    flags(g).set('LLD-FLAG', true);
    const out = g.turn('look').output;
    expect(out).not.toContain('barred by evil spirits');
  });
});

// ---------------------------------------------------------------------------
// KILL-INTERRUPTS seam: I-XB and I-XC disabled on death
// ---------------------------------------------------------------------------

describe('CC1 — KILL-INTERRUPTS seam: I-XB/I-XC disabled on death', () => {
  it('I-XB is listed in KILL-INTERRUPTS (disabled when killAll fires)', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    const w = g.world;
    const player = g.player;
    w.get('BELL')!.moveTo(player);
    g.turn('ring bell');

    const before = clockOf(g).getEntry('I-XB');
    expect(before!.enabled).toBe(true);

    const clock = (g as unknown as { clock: Clock }).clock;
    killInterrupts(clock, w);

    const after = clockOf(g).getEntry('I-XB');
    expect(after!.enabled).toBe(false);
  });

  it('I-XC is disabled by KILL-INTERRUPTS after being armed', () => {
    const g = newGameAt('ENTRANCE-TO-HADES');
    g.start();
    clockOf(g).queue('I-XC', 3, true);
    const before = clockOf(g).getEntry('I-XC');
    expect(before!.enabled).toBe(true);

    const clock = (g as unknown as { clock: Clock }).clock;
    killInterrupts(clock, g.world);

    const after = clockOf(g).getEntry('I-XC');
    expect(after!.enabled).toBe(false);
  });
});
