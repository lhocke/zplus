/**
 * T2 — THIEF-VS-ADVENTURER + I-THIEF demon (phase-3-thief-cyclops §8 Wave 2)
 *
 * Done-criteria:
 *   TS-A  Wander bounds: I-THIEF only moves to !SACREDBIT && RLANDBIT rooms,
 *         never above-ground (Sacred), and moves at most once per tick
 *         (the ONCE/<AGAIN> bound — structurally ≤2 passes per tick call).
 *   TS-E  Encounter tree: each PROB rung of THIEF-VS-ADVENTURER seeded;
 *         assert branch taken + THIEF-HERE/INVISIBLE/FIGHTBIT state after.
 *         Cover first-appearance vs already-here.
 *   Demon enabled at world start (turnsLeft=-1, enabled=true at registration).
 *   ≤2 passes per tick — enforced by a hard counter in iThief() itself (OQ-1).
 *
 * ZIL citations:
 *   I-THIEF              1actions.zil:3890–3931
 *   THIEF-VS-ADVENTURER  1actions.zil:1764–1873
 *
 * Notes:
 *   - All RNG is forced via ScriptedRng; wander tests assert structural
 *     membership (valid room class), never exact room identity.
 *   - NM-10 invariant: flee is only reachable via I-THIEF (THIEF-VS-ADVENTURER),
 *     never from DO-FIGHT. Tested in TS-E.
 *   - ONCE guard: ZIL local ONCE flips true after first wander move; the
 *     second pass (AGAIN) skips the move block. Equivalent to ≤2 passes total.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  thiefVsAdventurer,
  iThief,
  type IThiefCtx,
} from '../../src/actions/i-thief.js';
import { Flag } from '../../src/domain/flags.js';
import {
  thiefHere, setThiefHere,
  resetThiefState,
} from '../../src/actions/thief-state.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

interface StubRoom {
  id: string;
  flags: Set<Flag>;
}

function makeRoom(id: string, opts: { sacred?: boolean; land?: boolean; lit?: boolean } = {}): StubRoom {
  const flags = new Set<Flag>();
  if (opts.sacred) flags.add(Flag.Sacred);
  if (opts.land !== false) flags.add(Flag.Land);   // land by default
  if (opts.lit) flags.add(Flag.On);
  return { id, flags };
}

interface StubObj {
  id: string;
  parentId: string | null;
  flags: Set<Flag>;
  tvalue: number;
}

function makeObj(
  id: string,
  parentId: string | null,
  opts: { flags?: Flag[]; tvalue?: number } = {},
): StubObj {
  return {
    id,
    parentId,
    flags: new Set(opts.flags ?? []),
    tvalue: opts.tvalue ?? 0,
  };
}

// ---------------------------------------------------------------------------
// IThiefCtx builder
// ---------------------------------------------------------------------------

function makeCtx(opts: {
  hereId?: string;
  thiefRoomId?: string;
  rooms?: StubRoom[];
  objs?: StubObj[];
  rngDraws?: readonly number[];
  /** Whether HERE (player room) is lit — governed by ONBIT. */
  roomIsLit?: boolean;
  /** Whether the troll is visible in HERE. */
  trollHere?: boolean;
  dead?: boolean;
  /** Whether any room is considered touched (TOUCHBIT). Default false. */
  roomTouched?: boolean;
  /** Whether any room is considered maze (MAZEBIT). Default false. */
  roomMaze?: boolean;
}): {
  ctx: IThiefCtx;
  emitted: string[];
  movedTo: string[];
  flagOps: string[];
  thiefIdxState: { invisible: boolean; fightBit: boolean };
} {
  const hereId      = opts.hereId      ?? 'HERE';
  const thiefRoomId = opts.thiefRoomId ?? 'THIEF-ROOM';
  const rooms       = opts.rooms       ?? [makeRoom('THIEF-ROOM'), makeRoom('HERE')];
  const rngDraws    = opts.rngDraws    ?? [0.5];
  const roomIsLit   = opts.roomIsLit   ?? false;  // default: room not lit (ONBIT false)
  const dead        = opts.dead        ?? false;

  const emitted: string[] = [];
  const movedTo: string[] = [];   // records THIEF move destinations
  const flagOps: string[] = [];

  // Shared mutable state for the THIEF object flags
  const thiefFlags = new Set<Flag>([Flag.Actor, Flag.Invisible]);
  const thiefIdxState = {
    get invisible() { return thiefFlags.has(Flag.Invisible); },
    get fightBit()  { return thiefFlags.has(Flag.Fight); },
  };

  const objMap = new Map<string, StubObj>();
  for (const o of (opts.objs ?? [])) {
    objMap.set(o.id, o);
  }

  const rng = new ScriptedRng(rngDraws);

  const ctx: IThiefCtx = {
    hereId,

    getThiefRoomId: () => thiefRoomId,

    isDead: () => dead,

    isThiefInvisible: () => thiefFlags.has(Flag.Invisible),
    setThiefInvisible: () => {
      thiefFlags.add(Flag.Invisible);
      flagOps.push('setInvisible');
    },
    clearThiefInvisible: () => {
      thiefFlags.delete(Flag.Invisible);
      flagOps.push('clearInvisible');
    },
    isThiefFightBit: () => thiefFlags.has(Flag.Fight),
    clearThiefFightBit: () => {
      thiefFlags.delete(Flag.Fight);
      flagOps.push('clearFightBit');
    },

    isRoomLit: (roomId: string) => {
      const rm = rooms.find(r => r.id === roomId);
      if (rm) return rm.flags.has(Flag.On);
      return roomIsLit;
    },

    isTrollInHere: () => opts.trollHere ?? false,

    isTreasureRoom: (roomId: string) => roomId === 'TREASURE-ROOM',

    moveThiefTo: (roomId: string) => {
      movedTo.push(roomId);
      // Update internal thief location stub — callers track via getThiefRoomId closure
    },

    /** Returns all room ids the thief can wander into. */
    getRooms: () => rooms.map(r => r.id),

    isRoomSacred: (roomId: string) => {
      const rm = rooms.find(r => r.id === roomId);
      return rm?.flags.has(Flag.Sacred) ?? false;
    },
    isRoomLand: (roomId: string) => {
      const rm = rooms.find(r => r.id === roomId);
      return rm?.flags.has(Flag.Land) ?? true;
    },
    isRoomTouched: (_roomId: string) => opts.roomTouched ?? false,
    isRoomMaze: (_roomId: string) => opts.roomMaze ?? false,

    rng,
    getLucky: () => true,

    getObj: (id: string) => {
      const o = objMap.get(id);
      if (!o) return undefined;
      return {
        id: o.id,
        parentId: o.parentId,
        tvalue: o.tvalue,
        hasFlag: (f: Flag) => o.flags.has(f),
        setFlag: (f: Flag) => { o.flags.add(f); },
        clearFlag: (f: Flag) => { o.flags.delete(f); },
        moveTo: (destId: string) => {
          const old = objMap.get(o.parentId ?? '');
          if (old) {/* no children tracking in this stub */}
          o.parentId = destId;
        },
        get desc() { return o.id.toLowerCase().replace(/-/g, ' '); },
      };
    },

    childrenOf: (containerId: string): string[] => {
      return Array.from(objMap.values())
        .filter(o => o.parentId === containerId)
        .map(o => o.id);
    },

    tell: (s: string) => { emitted.push(s); },

    // Booty helpers — stubbed for T2 (their behavior is tested in T1)
    hackTreasures: () => {},
    depositBooty: (_rmId: string) => false,

    rob: (_whatId: string, _whereId: string, _prob?: number) => false,
    robMaze: (_rmId: string) => false,
    stealJunk: (_rmId: string) => false,
    dropJunk: (_rmId: string) => {},
    recoverStiletto: () => {},
    stoleLight: () => true,

    // Combat
    getThiefPStrength: () => 5,
    fightStrength: () => 2,
    isWinning: () => false,
  };

  return { ctx, emitted, movedTo, flagOps, thiefIdxState };
}

// ---------------------------------------------------------------------------
// TS-E: THIEF-VS-ADVENTURER — encounter tree (§3.2)
//
// ZIL branch order (1actions.zil:1764–1873):
//   1. Both alive + HERE==TREASURE-ROOM → return false (TREASURE-ROOM-FCN handles it)
//   2. !THIEF-HERE block (first appearance):
//     a. !dead && !here? && prob(30) → materialize (INVISIBLE cleared, THIEF-HERE=true)
//     b. here? && FIGHTBIT && !winning? → flee (INVISIBLE set, FIGHTBIT cleared)
//     c. here? && FIGHTBIT && prob(90) → stay & fight (return false)
//     d. here? && prob(30) → leave empty-handed (INVISIBLE set)
//     e. prob(70) → idle (return false)
//     f. !dead → rob
//   3. THIEF-HERE already:
//     a. here? && prob(30) → rob and leave
// ---------------------------------------------------------------------------

describe('TS-E: thiefVsAdventurer() — encounter tree', () => {
  beforeEach(() => { resetThiefState(); });

  // Branch 1: TREASURE-ROOM short-circuit — returns false immediately
  it('returns false when not dead and HERE == TREASURE-ROOM', () => {
    const { ctx } = makeCtx({ hereId: 'TREASURE-ROOM', thiefRoomId: 'OTHER' });
    // Override isDead to false (default)
    const result = thiefVsAdventurer(ctx, true);
    expect(result).toBe(false);
  });

  // Branch 2a: !THIEF-HERE, !dead, !here?, prob(30) true, stiletto in THIEF → materialize
  it('2a: materializes when !here? + prob(30) fires + stiletto in thief', () => {
    const stiletto = makeObj('STILETTO', 'THIEF');
    const { ctx, emitted, thiefIdxState } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      objs: [stiletto],
      rngDraws: [0.1],   // prob(30): 0.1*100=10 < 30 → true
    });

    const result = thiefVsAdventurer(ctx, false /* here?=false */);

    expect(result).toBe(true);
    expect(thiefIdxState.invisible).toBe(false);   // FCLEAR INVISIBLE
    expect(thiefHere()).toBe(true);                 // THIEF-HERE = true
    expect(emitted.some(m => m.includes('large bag'))).toBe(true);
  });

  // Branch 2a fails (prob(30) false) → falls through to 2b
  it('2a: does not materialize when prob(30) fails', () => {
    // With here?=false, !THIEF-HERE, prob(30) fails → falls to prob(70) idle → return false
    // Need enough draws to exhaust remaining branches
    const { ctx: ctx2 } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      rngDraws: [0.9, 0.1],  // 30 fail, then 70 pass → idle
    });
    const result = thiefVsAdventurer(ctx2, false);
    expect(result).toBe(false);
    expect(thiefHere()).toBe(false);  // not set
  });

  // Branch 2b: !THIEF-HERE, here?=true, FIGHTBIT set, !winning → flee
  it('2b: thief flees when here? + FIGHTBIT + !winning', () => {
    const { ctx, emitted, thiefIdxState, flagOps } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      rngDraws: [0.0],  // any draw; branch is deterministic (winning=false forced)
    });
    // Override FIGHTBIT and winning state
    ctx.isThiefFightBit = () => true;
    ctx.isWinning = () => false;   // !winning → flee

    const result = thiefVsAdventurer(ctx, true /* here? */);

    expect(result).toBe(true);
    expect(thiefIdxState.invisible).toBe(true);   // FSET INVISIBLE
    expect(flagOps).toContain('clearFightBit');   // FCLEAR FIGHTBIT
    expect(emitted.some(m => m.includes('discretion') || m.includes('disappears') || m.includes('valor'))).toBe(true);
  });

  // Branch 2c: !THIEF-HERE, here?=true, FIGHTBIT set, winning → prob(90) true → stay & fight
  it('2c: thief stays when here? + FIGHTBIT + winning + prob(90) true', () => {
    const { ctx } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      rngDraws: [0.05],  // prob(90): 0.05*100=5 < 90 → true → stay
    });
    ctx.isThiefFightBit = () => true;
    ctx.isWinning = () => true;   // winning → doesn't flee → 2c

    const result = thiefVsAdventurer(ctx, true);
    expect(result).toBe(false);   // stay & fight → return false
  });

  // Branch 2d: !THIEF-HERE, here?=true, no FIGHTBIT, prob(30) true → leave empty-handed
  it('2d: thief leaves empty-handed when here? + prob(30) fires', () => {
    const { ctx, emitted, thiefIdxState } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      rngDraws: [0.1],   // prob(30): 0.1*100=10 < 30 → true
    });
    ctx.isThiefFightBit = () => false;

    const result = thiefVsAdventurer(ctx, true);

    expect(result).toBe(true);
    expect(thiefIdxState.invisible).toBe(true);    // FSET INVISIBLE
    expect(emitted.some(m => m.includes('large bag') || m.includes('just left'))).toBe(true);
  });

  // Branch 2e: !THIEF-HERE, !here?, prob(30)=false, prob(70)=true → idle
  it('2e: idle when prob(70) fires', () => {
    const { ctx } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      // First draw: prob(30)=false (0.9); second draw: prob(70) true (0.1)
      rngDraws: [0.9, 0.1],
    });
    ctx.isThiefFightBit = () => false;

    const result = thiefVsAdventurer(ctx, false /* !here? */);
    expect(result).toBe(false);   // idle
    expect(thiefHere()).toBe(false);
  });

  // Branch 3a: THIEF-HERE already, here?=true, prob(30) → rob and leave
  it('3a: THIEF-HERE already, here?, prob(30) → rob and become invisible', () => {
    setThiefHere(true);   // already announced
    const { ctx, thiefIdxState } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      rngDraws: [0.1],   // prob(30): true
    });

    // rob returns false (no valuables); path still sets INVISIBLE + HERE?=false
    const result = thiefVsAdventurer(ctx, true);

    // Whether rob found something or not, branch 3a clears visibility after robbing
    expect(thiefIdxState.invisible).toBe(true);
    // Return value: false (3a falls through to RFALSE at end)
    expect(result).toBe(false);
  });

  // Branch 3 no-op: THIEF-HERE, here?=true, prob(30) fails
  it('3: THIEF-HERE + here? + prob(30) fails → no action, return false', () => {
    setThiefHere(true);
    const { ctx, thiefIdxState } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'HERE',
      rngDraws: [0.9],   // prob(30): 90 >= 30 → false
    });

    const result = thiefVsAdventurer(ctx, true);
    expect(result).toBe(false);
    expect(thiefIdxState.invisible).toBe(true);  // unchanged (was already invisible)
  });
});

// ---------------------------------------------------------------------------
// TS-A: I-THIEF wander bounds
//
// After iThief() fires, the thief must only land in !SACREDBIT && RLANDBIT rooms.
// Never in a SACRED room (above-ground). At most 1 move per tick (ONCE guard).
// ---------------------------------------------------------------------------

describe('TS-A: iThief() wander bounds', () => {
  beforeEach(() => { resetThiefState(); });

  it('thief only moves to !SACRED and LAND rooms', () => {
    // Setup: 3 valid rooms + 1 sacred + 1 non-land
    const rooms = [
      makeRoom('VALID-1', { land: true }),
      makeRoom('VALID-2', { land: true }),
      makeRoom('SACRED-R', { sacred: true, land: true }),
      makeRoom('NON-LAND', { land: false }),
    ];

    const movedDestinations: string[] = [];

    // Run iThief multiple times with the thief NOT in HERE and NOT in TREASURE-ROOM,
    // with prob forcing the wander path (ONCE=false to trigger move).
    // Draws: enough prob-false to reach the wander branch
    // The encounter tree checks many PROBs; we just want to reach the move.
    // With hereId different from thiefRoomId, we hit the 'else' branch which
    // only calls rob/stealJunk, then the ONCE/wander block.
    // Use rngDraws that deny all encounter probs to reach the wander block.

    const getRoomAtIdx = (idx: number) => rooms[idx % rooms.length]!.id;

    const { ctx } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: getRoomAtIdx(0),
      rooms,
      rngDraws: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    });

    // Override moveThiefTo to track destinations
    ctx.moveThiefTo = (roomId: string) => {
      movedDestinations.push(roomId);
    };

    // Override getThiefRoomId to rotate through rooms so ONCE is triggered
    let callCount = 0;
    ctx.getThiefRoomId = () => {
      // Return a non-HERE, non-TREASURE-ROOM room to hit the wander path
      return getRoomAtIdx(callCount++);
    };
    ctx.isTreasureRoom = (id: string) => id === 'TREASURE-ROOM';

    // Run several ticks
    for (let i = 0; i < 8; i++) {
      iThief(ctx);
    }

    // Every wander destination must be !Sacred && Land
    for (const dest of movedDestinations) {
      const rm = rooms.find(r => r.id === dest);
      if (rm !== undefined) {
        expect(rm.flags.has(Flag.Sacred)).toBe(false);
        expect(rm.flags.has(Flag.Land)).toBe(true);
      }
    }
  });

  it('at most 2 passes per tick (ONCE guard — OQ-1 structural bound)', () => {
    // The structural ≤2-pass bound means iThief() runs at most 2 iterations.
    // We cannot test the count directly from outside, but we can verify
    // that the thief moves at most ONCE per iThief() call (the ONCE guard
    // prevents a second move in the same tick).

    const rooms = [
      makeRoom('ROOM-A', { land: true }),
      makeRoom('ROOM-B', { land: true }),
      makeRoom('ROOM-C', { land: true }),
    ];

    let moveCount = 0;
    const { ctx } = makeCtx({
      hereId: 'OTHER',
      thiefRoomId: 'ROOM-A',
      rooms,
      rngDraws: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    });

    ctx.moveThiefTo = (_id: string) => {
      moveCount++;
    };

    // The ONCE guard ensures at most 1 move per tick invocation
    iThief(ctx);

    expect(moveCount).toBeLessThanOrEqual(1);
  });

  it('thief stays in TREASURE-ROOM path when there + player elsewhere (silent deposit)', () => {
    const { ctx } = makeCtx({
      hereId: 'HERE',
      thiefRoomId: 'TREASURE-ROOM',
      rngDraws: [0.9],
    });

    let depositCalled = false;
    ctx.depositBooty = (_rmId: string) => {
      depositCalled = true;
      return false;
    };

    iThief(ctx);

    expect(depositCalled).toBe(true);
    // Silent path: no messages emitted (player is not here)
    // (hackTreasures may or may not be called based on HERE? — not here, so silent)
  });

  it('calls hackTreasures when thief visible in TREASURE-ROOM and player NOT there', () => {
    // ZIL 1actions.zil:3895–3897: branch fires only when rm==TREASURE-ROOM && rm!=HERE
    // (player is elsewhere). When visible (HERE?=true), hackTreasures runs first.
    const { ctx } = makeCtx({
      hereId: 'OTHER-ROOM',         // player is NOT in treasure room
      thiefRoomId: 'TREASURE-ROOM',
      rngDraws: [0.9],
    });

    let hackCalled = false;
    ctx.hackTreasures = () => { hackCalled = true; };

    let depositCalled = false;
    ctx.depositBooty = (_rmId: string) => { depositCalled = true; return false; };

    // Thief is visible (HERE? = true since !INVISIBLE)
    ctx.isThiefInvisible = () => false;

    iThief(ctx);

    // hackTreasures must run when thief is visible in TREASURE-ROOM (player elsewhere)
    expect(hackCalled).toBe(true);
    expect(depositCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Demon registration invariant
//
// I-THIEF must be registered with turnsLeft=-1 and enabled=true at world start.
// (The actual wiring is in I1; this test asserts the ClockEntry contract that
// iThief is expected to be scheduled as a demon.)
// ---------------------------------------------------------------------------

describe('I-THIEF demon contract', () => {
  it('iThief returns true (keeps itself scheduled) after a normal tick', () => {
    // The demon must return true to stay scheduled each tick.
    // With an all-idle RNG (prob fails), the tick is a no-op but still returns true.
    const { ctx } = makeCtx({
      hereId: 'ELSEWHERE',
      thiefRoomId: 'SOMEWHERE',
      rooms: [makeRoom('SOMEWHERE', { land: true }), makeRoom('ELSEWHERE', { land: true })],
      rngDraws: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    });

    const result = iThief(ctx);
    // iThief always returns true (it's a standing demon)
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branch 3 faithfulness — TOUCHBIT gate + MAZEBIT dispatch
//
// ZIL 1actions.zil:3903–3914:
//   (T
//     <COND (<AND <IN? ,THIEF .RM> <NOT <FSET? ,THIEF ,INVISIBLE>>>
//            <FSET ,THIEF ,INVISIBLE> <SET HERE? <>>)>
//     <COND (<FSET? .RM ,TOUCHBIT>      ; only if room has been touched
//            <ROB .RM ,THIEF 75>
//            <SET FLG
//              <COND (<AND <FSET? .RM ,MAZEBIT> <FSET? ,HERE ,MAZEBIT>>
//                     <ROB-MAZE .RM>)
//                    (T <STEAL-JUNK .RM>)>>)>)>
//
// Two observable defects in the prior port:
//   1. rob+steal fired unconditionally — untouched rooms got robbed.
//   2. stealJunk was ALWAYS called; robMaze was dead code.
// ---------------------------------------------------------------------------

describe('Branch 3 faithfulness: TOUCHBIT gate + MAZEBIT dispatch', () => {
  beforeEach(() => { resetThiefState(); });

  // Helper: build a context where the thief is NOT in HERE and NOT in TREASURE-ROOM
  // (so we land in branch 3), with the player room tracked separately.
  function makeBranch3Ctx(opts: {
    thiefRoomId: string;
    hereId: string;
    roomTouched: boolean;
    thiefRoomMaze?: boolean;
    hereRoomMaze?: boolean;
  }) {
    const helperCalls: string[] = [];

    const rooms = [
      makeRoom(opts.thiefRoomId, { land: true }),
      makeRoom(opts.hereId, { land: true }),
    ];

    const ctx: IThiefCtx = {
      hereId: opts.hereId,
      getThiefRoomId: () => opts.thiefRoomId,
      isDead: () => false,
      isThiefInvisible: () => true,    // thief invisible → skip "victim left" sub-branch
      setThiefInvisible: () => {},
      clearThiefInvisible: () => {},
      isThiefFightBit: () => false,
      clearThiefFightBit: () => {},
      isRoomLit: (_id: string) => false,
      isTrollInHere: () => false,
      isTreasureRoom: (id: string) => id === 'TREASURE-ROOM',
      isRoomTouched: (_id: string) => opts.roomTouched,
      isRoomMaze: (id: string) => {
        if (id === opts.thiefRoomId) return opts.thiefRoomMaze ?? false;
        if (id === opts.hereId)      return opts.hereRoomMaze  ?? false;
        return false;
      },
      moveThiefTo: () => {},
      getRooms: () => rooms.map(r => r.id),
      isRoomSacred: (_id: string) => false,
      isRoomLand: (_id: string) => true,
      rng: new ScriptedRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]),
      getLucky: () => true,
      getObj: (_id: string) => undefined,
      childrenOf: (_id: string) => [],
      tell: (_s: string) => {},
      hackTreasures: () => {},
      depositBooty: (_rmId: string) => false,
      rob: (whatId: string, whereId: string, prob?: number) => {
        helperCalls.push(`rob:${whatId}/${whereId}/${prob ?? 'undef'}`);
        return false;
      },
      robMaze: (rmId: string) => {
        helperCalls.push(`robMaze:${rmId}`);
        return false;
      },
      stealJunk: (rmId: string) => {
        helperCalls.push(`stealJunk:${rmId}`);
        return false;
      },
      dropJunk: (_rmId: string) => {},
      recoverStiletto: () => {},
      stoleLight: () => false,
      getThiefPStrength: () => 5,
      fightStrength: () => 2,
      isWinning: () => false,
    };

    return { ctx, helperCalls };
  }

  // TOUCHBIT gate: an untouched room — rob, robMaze, stealJunk must NOT be called.
  it('untouched room: rob and steal helpers are not called (TOUCHBIT gate)', () => {
    const { ctx, helperCalls } = makeBranch3Ctx({
      thiefRoomId: 'MAZE-RM',
      hereId: 'OTHER-ROOM',
      roomTouched: false,
    });

    iThief(ctx);

    const booty = helperCalls.filter(c =>
      c.startsWith('rob:') || c.startsWith('robMaze:') || c.startsWith('stealJunk:'),
    );
    expect(booty).toHaveLength(0);
  });

  // TOUCHBIT gate: a touched, non-maze room → rob then stealJunk (no robMaze).
  it('touched non-maze room: rob called then stealJunk (no robMaze)', () => {
    const { ctx, helperCalls } = makeBranch3Ctx({
      thiefRoomId: 'WEST-OF-HOUSE',
      hereId: 'OTHER-ROOM',
      roomTouched: true,
      thiefRoomMaze: false,
      hereRoomMaze: false,
    });

    iThief(ctx);

    expect(helperCalls.some(c => c.startsWith('rob:WEST-OF-HOUSE'))).toBe(true);
    expect(helperCalls.some(c => c.startsWith('stealJunk:WEST-OF-HOUSE'))).toBe(true);
    expect(helperCalls.some(c => c.startsWith('robMaze:'))).toBe(false);
  });

  // MAZEBIT dispatch: touched maze room where BOTH RM and HERE have MAZEBIT
  // → rob then robMaze (no stealJunk).
  it('touched maze room (RM and HERE both maze): rob then robMaze, not stealJunk', () => {
    const { ctx, helperCalls } = makeBranch3Ctx({
      thiefRoomId: 'MAZE-RM',
      hereId: 'MAZE-HERE',
      roomTouched: true,
      thiefRoomMaze: true,
      hereRoomMaze: true,
    });

    iThief(ctx);

    expect(helperCalls.some(c => c.startsWith('rob:MAZE-RM'))).toBe(true);
    expect(helperCalls.some(c => c.startsWith('robMaze:MAZE-RM'))).toBe(true);
    expect(helperCalls.some(c => c.startsWith('stealJunk:'))).toBe(false);
  });

  // MAZEBIT dispatch: touched maze room where only RM has MAZEBIT (HERE does not)
  // → stealJunk (not robMaze — AND condition fails).
  it('touched maze room (only RM is maze, HERE is not): rob then stealJunk', () => {
    const { ctx, helperCalls } = makeBranch3Ctx({
      thiefRoomId: 'MAZE-RM',
      hereId: 'NON-MAZE-HERE',
      roomTouched: true,
      thiefRoomMaze: true,
      hereRoomMaze: false,
    });

    iThief(ctx);

    expect(helperCalls.some(c => c.startsWith('rob:MAZE-RM'))).toBe(true);
    expect(helperCalls.some(c => c.startsWith('stealJunk:MAZE-RM'))).toBe(true);
    expect(helperCalls.some(c => c.startsWith('robMaze:'))).toBe(false);
  });
});
