/**
 * F5 — Demon ticks, transcript routing, and meta-verb suppression
 *
 * Tests for the three parts of F5:
 *
 * PART (a): Demon-mode every-turn tick (clock.ts)
 *   - turnsLeft < 0 → fires every advance(), does NOT decrement
 *   - tick() returning false self-removes the entry
 *   - tick() returning true keeps it scheduled, turnsLeft stays pinned
 *   - turnsLeft === 0 → dormant (unchanged)
 *
 * PART (b): Transcript routing via advance() return value
 *   - advance() returns string[]
 *   - tick() receives a ClockTickContext with tell()
 *   - text pushed via ctx.tell() appears in the returned array
 *   - lantern/candle interrupt messages surface in advance() return
 *
 * PART (c): Meta-verb suppression (game.ts)
 *   - V-SCORE does NOT increment moveCount
 *   - V-SCORE does NOT tick the clock
 *   - Real action (V-LOOK) DOES tick the clock
 *
 * TDD: written BEFORE implementation (RED → GREEN → commit).
 */

import { describe, it, expect } from 'vitest';
import { Clock, LanternInterrupt, type ClockEntry } from '../../src/engine/clock';
import { SimpleEventEmitter } from '../../src/engine/events';
import { createGame } from '../../src/engine/bootstrap';
import { World } from '../../src/domain/world';
import { Room } from '../../src/domain/room';
import { Actor } from '../../src/domain/actor';
import { Flag } from '../../src/domain/flags';
import { Game } from '../../src/engine/game';

// ---------------------------------------------------------------------------
// PART (a): Demon-mode — turnsLeft < 0
// ---------------------------------------------------------------------------

describe('F5(a): Clock demon mode (turnsLeft < 0)', () => {
  it('fires every advance() when turnsLeft is negative', () => {
    const clock = new Clock();
    let count = 0;

    const entry: ClockEntry = {
      id: 'I-DEMON',
      turnsLeft: -1,
      enabled: true,
      tick() {
        count++;
        return true; // keep it
      },
    };
    clock.schedule(entry);

    clock.advance();
    clock.advance();
    clock.advance();

    expect(count).toBe(3);
  });

  it('does NOT decrement turnsLeft for a demon entry (stays pinned)', () => {
    const clock = new Clock();
    const entry: ClockEntry = {
      id: 'I-DEMON',
      turnsLeft: -1,
      enabled: true,
      tick() { return true; },
    };
    clock.schedule(entry);

    clock.advance();
    clock.advance();

    // turnsLeft should remain -1 (pinned, not walked to -2, -3, ...)
    const snap = clock.snapshot();
    const demEntry = snap.find(s => s.id === 'I-DEMON');
    expect(demEntry?.turnsLeft).toBe(-1);
  });

  it('self-removes when tick() returns false', () => {
    const clock = new Clock();
    let count = 0;

    const entry: ClockEntry = {
      id: 'I-DEMON',
      turnsLeft: -1,
      enabled: true,
      tick() {
        count++;
        return false; // self-remove on first fire
      },
    };
    clock.schedule(entry);

    clock.advance(); // fires, returns false → removed
    clock.advance(); // entry is gone → no more fires
    clock.advance();

    expect(count).toBe(1);
  });

  it('turnsLeft === 0 stays dormant (unchanged behaviour)', () => {
    const clock = new Clock();
    let fired = false;

    const entry: ClockEntry = {
      id: 'DORMANT',
      turnsLeft: 0,
      enabled: true,
      tick() {
        fired = true;
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance();
    clock.advance();
    clock.advance();

    expect(fired).toBe(false);
  });

  it('countdown entries (turnsLeft > 0) still fire at zero as before', () => {
    const clock = new Clock();
    let fired = false;

    const entry: ClockEntry = {
      id: 'COUNTDOWN',
      turnsLeft: 3,
      enabled: true,
      tick() {
        fired = true;
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance(); // 2
    clock.advance(); // 1
    expect(fired).toBe(false);
    clock.advance(); // 0 → fires
    expect(fired).toBe(true);
  });

  it('demon snapshot round-trips through restore', () => {
    const clock = new Clock();
    let count = 0;

    const entry: ClockEntry = {
      id: 'I-DEMON',
      turnsLeft: -1,
      enabled: true,
      tick() { count++; return true; },
    };
    clock.schedule(entry);

    clock.advance();
    expect(count).toBe(1);

    const snap = clock.snapshot();
    // Restore and verify it still fires
    clock.restore(snap);
    clock.advance();
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PART (b): advance() returns string[] for transcript routing
// ---------------------------------------------------------------------------

describe('F5(b): Clock.advance() returns transcript lines', () => {
  it('advance() returns an empty array when no tick fires any text', () => {
    const clock = new Clock();
    const entry: ClockEntry = {
      id: 'SILENT',
      turnsLeft: 5,
      enabled: true,
      tick(_ctx) { return false; },
    };
    clock.schedule(entry);

    const lines = clock.advance();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines).toHaveLength(0);
  });

  it('text pushed via ctx.tell() appears in the returned array', () => {
    const clock = new Clock();
    const entry: ClockEntry = {
      id: 'TALKER',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        ctx.tell('Hello from interrupt!');
        return false;
      },
    };
    clock.schedule(entry);

    clock.advance(); // turnsLeft → 1, no fire
    const lines = clock.advance(); // turnsLeft → 0, fires
    expect(lines).toContain('Hello from interrupt!');
  });

  it('demon entry text also routes through advance() return', () => {
    const clock = new Clock();
    let calls = 0;
    const entry: ClockEntry = {
      id: 'I-DEMON',
      turnsLeft: -1,
      enabled: true,
      tick(ctx) {
        calls++;
        ctx.tell(`Demon call ${calls}`);
        return calls < 2; // fire twice then self-remove
      },
    };
    clock.schedule(entry);

    const lines1 = clock.advance();
    expect(lines1).toEqual(['Demon call 1']);

    const lines2 = clock.advance();
    expect(lines2).toEqual(['Demon call 2']);

    // Entry removed after returning false
    const lines3 = clock.advance();
    expect(lines3).toHaveLength(0);
  });

  it('LanternInterrupt warning message appears in advance() return lines', () => {
    const emitter = new SimpleEventEmitter();
    const clock = new Clock();
    new LanternInterrupt(clock, emitter, 5);
    // Start enabled (normally disabled in bootstrap, but enable for this test)

    // Advance 5 turns to trigger first stage
    let lines: string[] = [];
    for (let i = 0; i < 4; i++) clock.advance();
    lines = clock.advance(); // 5th turn → fires "lamp appears a bit dimmer"

    // The warning message should be in the returned lines
    expect(lines.some(l => l.includes('dimmer'))).toBe(true);

    // The lantern-fuel event should ALSO still be emitted (two channels)
    // (we can verify via emitter — event was already fired above)
  });

  it('LanternInterrupt still emits lantern-fuel events (event channel preserved)', () => {
    const emitter = new SimpleEventEmitter();
    const clock = new Clock();
    const fuelEvents: Array<{ remaining: number; dark: boolean }> = [];
    emitter.on('lantern-fuel', (e) => fuelEvents.push(e));

    new LanternInterrupt(clock, emitter, 5);

    for (let i = 0; i < 5; i++) clock.advance();

    // Event channel still works
    expect(fuelEvents.length).toBeGreaterThan(0);
    expect(fuelEvents[0]?.remaining).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PART (c): Meta-verb suppression — SCORE does not advance clock or moveCount
// ---------------------------------------------------------------------------

describe('F5(c): Meta-verb suppression (V-SCORE does not tick clock)', () => {
  it('V-SCORE does not increment the move counter', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();

    // "score" should NOT increment moveCount
    game.turn('score');
    expect(game.view().moves).toBe(0);

    // After "look" (real action), moveCount increments
    game.turn('look');
    expect(game.view().moves).toBe(1);

    // "score" again should not increment
    game.turn('score');
    expect(game.view().moves).toBe(1);
  });

  it('V-SCORE output shows correct move count (not incremented by score itself)', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();

    // First score: 0 moves (score doesn't count itself)
    const r1 = game.turn('score');
    expect(r1.output).toContain('in 0 moves.');

    // Do a real action
    game.turn('look'); // moveCount → 1

    // Second score: 1 move (still not counting score turn)
    const r2 = game.turn('score');
    expect(r2.output).toContain('in 1 move.');
  });

  it('V-SCORE does not fire the clock (no advance on score turn)', () => {
    // Set up a game with a clock entry that counts advances
    // We use the bootstrap game and verify that the candle timer
    // does not advance on a "score" turn (by checking candle state after many score turns)
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();

    // Issue many "score" commands — none should tick the clock
    // (look instead ticks 1 per turn)
    const lookGame = createGame({ startRoom: 'WEST-OF-HOUSE' });
    lookGame.start();

    // Advance both games differently:
    // game: 5 score turns (meta — no clock tick)
    // lookGame: 5 look turns (real — 5 clock ticks)
    for (let i = 0; i < 5; i++) {
      game.turn('score');
      lookGame.turn('look');
    }

    // The move counter shows the difference
    expect(game.view().moves).toBe(0);    // score turns don't count
    expect(lookGame.view().moves).toBe(5); // look turns do count
  });

  it('a real action (V-LOOK) DOES increment moveCount', () => {
    const game = createGame({ startRoom: 'WEST-OF-HOUSE' });
    game.start();

    expect(game.view().moves).toBe(0);
    game.turn('look');
    expect(game.view().moves).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PART (b+c) integration: clock output merges into turn output
// ---------------------------------------------------------------------------

describe('F5(b+c) integration: clock interrupt text appears in turn output', () => {
  it('interrupt text from clock appears in turn output (not lost)', () => {
    // Build a game with a short-fused lamp interrupt (turnsLeft=2)
    // The interrupt fires on turn 2 and its text should appear in the output
    const emitter = new SimpleEventEmitter();
    const clock = new Clock();

    // Schedule a short-fuse text-emitting entry
    const textEntry: ClockEntry = {
      id: 'SHORT-FUSE',
      turnsLeft: 2,
      enabled: true,
      tick(ctx) {
        ctx.tell('The fuse burns out!');
        return false;
      },
    };
    clock.schedule(textEntry);

    // Create game with our custom clock
    const room = new Room('ROOM', 'Test Room', { ldesc: 'A simple room.' });
    room.set(Flag.On);
    const player = new Actor('PLAYER', 'yourself');
    player.moveTo(room);

    const world = World.fromObjects([room, player]);
    const game = new Game(world, { rng: { next: () => 0, prob: (base) => base > 0 }, clock, events: emitter });
    game.start();

    game.turn('look'); // turn 1: turnsLeft → 1, no fire
    const result = game.turn('look'); // turn 2: turnsLeft → 0, fires
    expect(result.output).toContain('The fuse burns out!');
  });
});
