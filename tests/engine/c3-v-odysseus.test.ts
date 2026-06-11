/**
 * C3 — V-ODYSSEUS + MAGIC-FLAG
 *
 * Done-criteria (spec §8 Wave 3, C3):
 *   - V-ODYSSEUS confirmed NEW (absent from verbs/index.ts ACTION_HANDLERS before this task)
 *   - In CYCLOPS-ROOM, cyclops present and awake (!CYCLOPS-FLAG):
 *       prints wall-break message; MAGIC-FLAG set; CYCLOPS-FLAG set;
 *       FIGHTBIT cleared on cyclops; cyclops removed from world; I-CYCLOPS disabled
 *   - All other conditions → "Wasn't he a sailor?"
 *       (off-room; or sleeping cyclops; or cyclops not in room)
 *   - MAGIC-FLAG opens LIVING-ROOM west exit and CYCLOPS-ROOM east exit (data-driven,
 *       exercised via game.turn end-to-end)
 *   - CYCLOPS-ROOM re-description after MAGIC-FLAG (cyclopsRoomFcn M-LOOK east-wall branch)
 *
 * ZIL citations:
 *   V-ODYSSEUS  gverbs.zil:945–961
 *   gsyntax.zil:334–335  (ODYSSEUS = V-ODYSSEUS; SYNONYM ODYSSEUS ULYSSES)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Flag } from '../../src/domain/flags.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { setCyclowrath } from '../../src/actions/thief-state.js';

// ---------------------------------------------------------------------------
// Helpers for poking game internals in tests
// ---------------------------------------------------------------------------

type WorldHandle = {
  get(id: string): {
    has(f: Flag): boolean;
    set(f: Flag): void;
    clear(f: Flag): void;
    moveTo(d: unknown): void;
    readonly parent: unknown;
  } | undefined;
};
type FlagsHandle = { get(k: string): boolean; set(k: string, v: boolean): void };
type GameInternals = { world: WorldHandle; flags: FlagsHandle };

function internals(g: ReturnType<typeof createGame>): GameInternals {
  return g as unknown as GameInternals;
}

function litLamp(g: ReturnType<typeof createGame>): void {
  const { world } = internals(g);
  const player = world.get('PLAYER') as never;
  const lamp = world.get('LAMP');
  lamp?.moveTo(player);
  lamp?.set(Flag.OnFire);
  lamp?.set(Flag.Light);
}

// ---------------------------------------------------------------------------
// Unit-level: V-ODYSSEUS via game.turn('odysseus') and game.turn('ulysses')
// ---------------------------------------------------------------------------

describe('V-ODYSSEUS: wall-break path (CYCLOPS-ROOM, cyclops awake)', () => {
  let g: ReturnType<typeof createGame>;
  beforeEach(() => {
    setCyclowrath(0);
    g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    // Ensure CYCLOPS-FLAG is not set (cyclops awake)
    internals(g).flags.set('CYCLOPS-FLAG', false);
  });

  it('prints the wall-break message', () => {
    const r = g.turn('odysseus');
    expect(r.output).toContain('hearing the name of his father');
    expect(r.output).toContain('knocking down the wall');
  });

  it('MAGIC-FLAG is set after the word', () => {
    g.turn('odysseus');
    expect(internals(g).flags.get('MAGIC-FLAG')).toBe(true);
  });

  it('CYCLOPS-FLAG is set (cyclops now asleep / gone)', () => {
    g.turn('odysseus');
    expect(internals(g).flags.get('CYCLOPS-FLAG')).toBe(true);
  });

  it('cyclops is removed from the world', () => {
    g.turn('odysseus');
    const cyclops = internals(g).world.get('CYCLOPS');
    // After REMOVE-CAREFULLY: parent is null (removed from world)
    expect(cyclops?.parent).toBeNull();
  });

  it('cyclops FIGHTBIT is cleared', () => {
    // Set FIGHTBIT first, then odysseus
    internals(g).world.get('CYCLOPS')?.set(Flag.Fight);
    g.turn('odysseus');
    expect(internals(g).world.get('CYCLOPS')?.has(Flag.Fight)).toBe(false);
  });

  it('"ulysses" synonym works identically (gsyntax.zil:335)', () => {
    const r = g.turn('ulysses');
    expect(r.output).toContain('hearing the name of his father');
    expect(internals(g).flags.get('MAGIC-FLAG')).toBe(true);
  });
});

describe('V-ODYSSEUS: sailor fallback', () => {
  beforeEach(() => setCyclowrath(0));

  it('off-room → "Wasn\'t he a sailor?"', () => {
    const g = createGame({ startRoom: 'WEST-OF-HOUSE' });
    g.start();
    litLamp(g);
    const r = g.turn('odysseus');
    expect(r.output).toContain("Wasn't he a sailor");
  });

  it('in CYCLOPS-ROOM but cyclops already sleeping (CYCLOPS-FLAG=true) → sailor', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    internals(g).flags.set('CYCLOPS-FLAG', true);
    const r = g.turn('odysseus');
    expect(r.output).toContain("Wasn't he a sailor");
  });

  it('in CYCLOPS-ROOM but cyclops not present → sailor', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    // Move cyclops out of the room before saying the word
    const { world } = internals(g);
    const maze15 = world.get('MAZE-15') as never;
    world.get('CYCLOPS')?.moveTo(maze15);
    const r = g.turn('odysseus');
    expect(r.output).toContain("Wasn't he a sailor");
  });
});

// ---------------------------------------------------------------------------
// MAGIC-FLAG gate: exit data-driven behavior
// ---------------------------------------------------------------------------

describe('MAGIC-FLAG exit gates', () => {
  beforeEach(() => setCyclowrath(0));

  it('MAGIC-FLAG opens CYCLOPS-ROOM east exit to STRANGE-PASSAGE', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    g.turn('odysseus');
    // East is now open
    const r = g.turn('east');
    // Should NOT see the "solid rock" block message
    expect(r.output).not.toContain('solid rock');
  });

  it('without MAGIC-FLAG, CYCLOPS-ROOM east is blocked', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    const r = g.turn('east');
    expect(r.output).toContain('solid rock');
  });

  it('MAGIC-FLAG opens LIVING-ROOM west exit to STRANGE-PASSAGE', () => {
    const g = createGame({ startRoom: 'LIVING-ROOM' });
    g.start();
    litLamp(g);
    internals(g).flags.set('MAGIC-FLAG', true);
    const r = g.turn('west');
    expect(r.output).not.toContain('nailed shut');
  });

  it('without MAGIC-FLAG, LIVING-ROOM west is blocked', () => {
    const g = createGame({ startRoom: 'LIVING-ROOM' });
    g.start();
    const r = g.turn('west');
    expect(r.output).toContain('nailed shut');
  });
});

// ---------------------------------------------------------------------------
// Post-ODYSSEUS re-descriptions
// ---------------------------------------------------------------------------

describe('room re-descriptions after MAGIC-FLAG', () => {
  beforeEach(() => setCyclowrath(0));

  it('CYCLOPS-ROOM look after odysseus → "cyclops-sized opening" (M-LOOK east-wall branch)', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    litLamp(g);
    g.turn('odysseus');
    const r = g.turn('look');
    expect(r.output).toContain('cyclops-sized opening');
  });

  it('LIVING-ROOM look with MAGIC-FLAG → cyclops-shaped opening in door text', () => {
    const g = createGame({ startRoom: 'LIVING-ROOM' });
    g.start();
    internals(g).flags.set('MAGIC-FLAG', true);
    const r = g.turn('look');
    expect(r.output).toContain('cyclops-shaped opening');
  });
});
