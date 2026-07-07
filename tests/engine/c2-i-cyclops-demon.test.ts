/**
 * C2 — I-CYCLOPS wrath timer (phase-3-thief-cyclops §8 Wave 3)
 *
 * Done-criteria (spec §8 Wave 3, C2 / TS-J):
 *   - set CYCLOWRATH=1, advance I-CYCLOPS in CYCLOPS-ROOM:
 *       magnitude escalates by 1/tick
 *       CYCLOMAD message indexed correctly (abs(new_wrath)-1, 0-based)
 *   - at abs(CYCLOWRATH) > 5 on entry (i.e. already 6): jigsUp fires, I-CYCLOPS self-disables
 *   - off-room (HERE != CYCLOPS-ROOM): I-CYCLOPS self-disables, no message
 *   - CYCLOPS-FLAG=true (sleeping): RTRUE no-op, stays enabled
 *   - DEAD=true: RTRUE no-op, stays enabled
 *   - CYCLOWRATH<0: magnitude still escalates (decreases by 1 each tick)
 *
 * ZIL control flow (1actions.zil:1596–1614):
 *   1. CYCLOPS-FLAG || DEAD → RTRUE (no-op, stay enabled)
 *   2. HERE != CYCLOPS-ROOM → DISABLE
 *   3. abs(CYCLOWRATH) > 5 → DISABLE + JIGS-UP   ← checks BEFORE increment
 *   4. else: increment CYCLOWRATH (−1 if <0, +1 if ≥0), tell CYCLOMAD[abs(new)-1]
 *
 * ZIL citations:
 *   I-CYCLOPS   1actions.zil:1596–1614
 *   CYCLOMAD    1actions.zil:1644–1652
 *
 * Integration smoke (via createGame + game.turn):
 *   - I-CYCLOPS is registered disabled in the clock at bootstrap
 *   - cyclopsFcn enableClock path arms I-CYCLOPS via the live game
 */

import { describe, it, expect } from 'vitest';
import {
  iCyclops,
  CYCLOMAD,
  type ICyclopsCtx,
} from '../../src/actions/cyclops.js';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';

// ---------------------------------------------------------------------------
// Minimal test context factory
// ---------------------------------------------------------------------------

function makeCtx(opts: {
  hereId?: string;
  cyclopsFlag?: boolean;
  dead?: boolean;
  cyclowrath?: number;
} = {}): ICyclopsCtx & {
  readonly _jigsUpCalled: boolean;
  readonly _jigsUpMsg: string;
  readonly _disabled: boolean;
  readonly _output: string[];
  readonly cyclowrath: number;
} {
  let _cyclowrath = opts.cyclowrath ?? 0;
  const _output: string[] = [];
  let _disabled = false;
  let _jigsUpCalled = false;
  let _jigsUpMsg = '';

  return {
    hereId: opts.hereId ?? 'CYCLOPS-ROOM',
    getCyclopsFlag: () => opts.cyclopsFlag ?? false,
    isDead: () => opts.dead ?? false,
    getCyclowrath: () => _cyclowrath,
    setCyclowrath: (v) => { _cyclowrath = v; },
    disableSelf: () => { _disabled = true; },
    jigsUp: (msg) => { _jigsUpCalled = true; _jigsUpMsg = msg; },
    tell: (s) => { _output.push(s); },

    get _jigsUpCalled() { return _jigsUpCalled; },
    get _jigsUpMsg() { return _jigsUpMsg; },
    get _disabled() { return _disabled; },
    get _output() { return _output; },
    get cyclowrath() { return _cyclowrath; },
  };
}

// ---------------------------------------------------------------------------
// TS-J: Wrath escalation (positive CYCLOWRATH)
//
// ZIL check order: abs > 5 gate runs BEFORE increment.  From CYCLOWRATH=1:
//   tick 1: 1→2 CYCLOMAD[1]; tick 2: 2→3 CYCLOMAD[2]; ...
//   tick 5: 5→6 CYCLOMAD[5]; tick 6: abs(6)>5 → jigsUp.
// ---------------------------------------------------------------------------

describe('I-CYCLOPS: wrath escalation (CYCLOWRATH > 0, CYCLOPS-ROOM)', () => {
  it('CYCLOWRATH=1 → increments to 2, emits CYCLOMAD[1]', () => {
    const ctx = makeCtx({ cyclowrath: 1 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(2);
    // CYCLOMAD[abs(2)-1] = CYCLOMAD[1]
    expect(ctx._output.join('\n')).toContain(CYCLOMAD[1]);
    expect(ctx._jigsUpCalled).toBe(false);
    expect(ctx._disabled).toBe(false);
  });

  it('CYCLOWRATH=2 → increments to 3, emits CYCLOMAD[2]', () => {
    const ctx = makeCtx({ cyclowrath: 2 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(3);
    expect(ctx._output.join('\n')).toContain(CYCLOMAD[2]);
  });

  it('CYCLOWRATH=5 → increments to 6, emits CYCLOMAD[5], no jigsUp yet', () => {
    // abs(5) is NOT > 5, so we escalate to 6 and print CYCLOMAD[5].
    // jigsUp fires on the NEXT tick when abs(6) > 5.
    const ctx = makeCtx({ cyclowrath: 5 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(6);
    expect(ctx._output.join('\n')).toContain(CYCLOMAD[5]);
    expect(ctx._jigsUpCalled).toBe(false);
    expect(ctx._disabled).toBe(false);
  });

  it('CYCLOWRATH=6 → abs(6)>5 → jigsUp + disable, no CYCLOMAD message', () => {
    const ctx = makeCtx({ cyclowrath: 6 });
    iCyclops(ctx);
    expect(ctx._jigsUpCalled).toBe(true);
    expect(ctx._jigsUpMsg).toContain('cyclops');
    expect(ctx._disabled).toBe(true);
    // jigsUp fires before any CYCLOMAD tell (the G? branch exits early)
    expect(ctx._output).toHaveLength(0);
  });

  it('6 sequential ticks from CYCLOWRATH=1: jigsUp fires on the 6th tick', () => {
    const ctx = makeCtx({ cyclowrath: 1 });
    for (let i = 0; i < 5; i++) {
      iCyclops(ctx);
      expect(ctx._jigsUpCalled).toBe(false);
    }
    // 6th tick: wrath was 6 (from 5 increments), abs(6)>5 → jigsUp
    iCyclops(ctx);
    expect(ctx._jigsUpCalled).toBe(true);
    expect(ctx._disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TS-J: Wrath escalation (negative CYCLOWRATH — thirsty path)
// ZIL: CYCLOWRATH < 0 → CYCLOWRATH - 1 (more negative each tick)
// ---------------------------------------------------------------------------

describe('I-CYCLOPS: wrath escalation (CYCLOWRATH < 0)', () => {
  it('CYCLOWRATH=-1 → decreases to -2, emits CYCLOMAD[1]', () => {
    const ctx = makeCtx({ cyclowrath: -1 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(-2);
    // abs(-2)-1 = 1
    expect(ctx._output.join('\n')).toContain(CYCLOMAD[1]);
  });

  it('CYCLOWRATH=-5 → decreases to -6, emits CYCLOMAD[5], no jigsUp', () => {
    // abs(-5)=5, NOT > 5 → escalate to -6 and print CYCLOMAD[5]
    const ctx = makeCtx({ cyclowrath: -5 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(-6);
    expect(ctx._output.join('\n')).toContain(CYCLOMAD[5]);
    expect(ctx._jigsUpCalled).toBe(false);
  });

  it('CYCLOWRATH=-6 → abs(-6)>5 → jigsUp + disable', () => {
    const ctx = makeCtx({ cyclowrath: -6 });
    iCyclops(ctx);
    expect(ctx._jigsUpCalled).toBe(true);
    expect(ctx._disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TS-J: CYCLOMAD table indexing — all 6 entries accessible
// ---------------------------------------------------------------------------

describe('I-CYCLOPS: CYCLOMAD table (1actions.zil:1644–1652)', () => {
  it('CYCLOMAD has exactly 6 entries', () => {
    expect(CYCLOMAD).toHaveLength(6);
  });

  it('CYCLOMAD[5]: final warning (two choices)', () => {
    expect(CYCLOMAD[5]).toContain('two choices');
  });

  it('each tick n (CYCLOWRATH=n → n+1) uses CYCLOMAD[n]', () => {
    // After incrementing from `n` to `n+1`, the index is abs(n+1)-1 = n.
    // Verify for n = 1..5.
    for (let n = 1; n <= 5; n++) {
      const ctx = makeCtx({ cyclowrath: n });
      iCyclops(ctx);
      expect(ctx._output.join('\n')).toContain(CYCLOMAD[n]!);
    }
  });
});

// ---------------------------------------------------------------------------
// TS-J: Off-room disable (HERE != CYCLOPS-ROOM)
// ---------------------------------------------------------------------------

describe('I-CYCLOPS: off-room self-disable', () => {
  it('HERE != CYCLOPS-ROOM: self-disables, no message, no jigsUp', () => {
    const ctx = makeCtx({ hereId: 'LIVING-ROOM', cyclowrath: 3 });
    iCyclops(ctx);
    expect(ctx._disabled).toBe(true);
    expect(ctx._jigsUpCalled).toBe(false);
    expect(ctx._output).toHaveLength(0);
    // CYCLOWRATH unchanged when off-room
    expect(ctx.cyclowrath).toBe(3);
  });

  it('HERE == CYCLOPS-ROOM: no self-disable at normal wrath', () => {
    const ctx = makeCtx({ hereId: 'CYCLOPS-ROOM', cyclowrath: 2 });
    iCyclops(ctx);
    expect(ctx._disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TS-J: CYCLOPS-FLAG (sleeping) and DEAD no-op branches
// ZIL: <OR ,CYCLOPS-FLAG ,DEAD> → RTRUE (keep enabled, no-op body)
// ---------------------------------------------------------------------------

describe('I-CYCLOPS: sleeping and dead no-ops', () => {
  it('CYCLOPS-FLAG=true (sleeping): no-op, no escalation, no message', () => {
    const ctx = makeCtx({ cyclopsFlag: true, cyclowrath: 3 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(3);
    expect(ctx._output).toHaveLength(0);
    expect(ctx._disabled).toBe(false);
    expect(ctx._jigsUpCalled).toBe(false);
  });

  it('DEAD=true: no-op, stays enabled', () => {
    const ctx = makeCtx({ dead: true, cyclowrath: 3 });
    iCyclops(ctx);
    expect(ctx.cyclowrath).toBe(3);
    expect(ctx._output).toHaveLength(0);
    expect(ctx._disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CYCLOMAD verbatim text — anchor the exact ZIL strings (1actions.zil:1646–1652)
// ---------------------------------------------------------------------------

describe('CYCLOMAD verbatim transcription', () => {
  it('all 6 entries match ZIL source exactly', () => {
    expect(CYCLOMAD[0]).toBe('The cyclops seems somewhat agitated.');
    expect(CYCLOMAD[1]).toBe('The cyclops appears to be getting more agitated.');
    expect(CYCLOMAD[2]).toBe('The cyclops is moving about the room, looking for something.');
    expect(CYCLOMAD[3]).toBe(
      'The cyclops was looking for salt and pepper. No doubt they are\n' +
      'condiments for his upcoming snack.',
    );
    expect(CYCLOMAD[4]).toBe('The cyclops is moving toward you in an unfriendly manner.');
    expect(CYCLOMAD[5]).toBe('You have two choices: 1. Leave  2. Become dinner.');
  });
});

// ---------------------------------------------------------------------------
// Integration smoke: I-CYCLOPS registered in clock, arms via cyclopsFcn path
// ---------------------------------------------------------------------------

type ClockHandle = { getEntry(id: string): { enabled: boolean; turnsLeft: number } | undefined };
type WorldHandle = { get(id: string): { moveTo(d: unknown): void; set(f: Flag): void } | undefined };

describe('I-CYCLOPS: integration smoke via createGame', () => {
  it('I-CYCLOPS is registered in clock at bootstrap (disabled)', () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    const entry = (g as unknown as { clock: ClockHandle }).clock.getEntry('I-CYCLOPS');
    expect(entry).toBeDefined();
    expect(entry!.enabled).toBe(false);
    expect(entry!.turnsLeft).toBe(-1);
  });

  it('give lunch to cyclops arms I-CYCLOPS (enabled in clock)', async () => {
    const g = createGame({ startRoom: 'CYCLOPS-ROOM' });
    g.start();
    const world = (g as unknown as { world: WorldHandle }).world;
    const player = world.get('PLAYER') as never;
    const lamp = world.get('LAMP');
    lamp?.moveTo(player);
    lamp?.set(Flag.OnFire);
    lamp?.set(Flag.Light);
    const lunch = world.get('LUNCH');
    lunch?.moveTo(player);

    await g.turn('give lunch to cyclops');

    const entry = (g as unknown as { clock: ClockHandle }).clock.getEntry('I-CYCLOPS');
    expect(entry!.enabled).toBe(true);
  });
});
