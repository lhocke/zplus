// i-thief.ts — THIEF-VS-ADVENTURER + I-THIEF per-turn demon.
//
// Transcription of:
//   THIEF-VS-ADVENTURER  1actions.zil:1764–1873
//   I-THIEF              1actions.zil:3890–3931
//
// OQ-1 (ratified 2026-06-10): the <AGAIN> re-entry in I-THIEF is ported as a
// do/while loop capped at MAX_PASSES=2.  The bound is STRUCTURAL — enforced by
// the hard counter in the loop itself, not only by a test.

import { Flag } from '../domain/flags.js';
import {
  thiefHere, setThiefHere,
  setThiefEngrossed as _setThiefEngrossed,
} from './thief-state.js';

// Maximum loop passes per tick — the ZIL ONCE guard allows exactly 1 re-entry
// (the second pass skips the wander block).  Structural cap = 2 (ratified OQ-1).
const MAX_PASSES = 2;

// Minimal object handle that the booty/encounter helpers need.
export interface ThiefObjHandle {
  readonly id: string;
  readonly parentId: string | null;
  readonly tvalue: number;
  readonly desc: string;
  hasFlag(f: Flag): boolean;
  setFlag(f: Flag): void;
  clearFlag(f: Flag): void;
  moveTo(destId: string): void;
}

// Everything I-THIEF and THIEF-VS-ADVENTURER need from the game context.
//
// Booty helper callbacks (rob, stealJunk, etc.) are stub-able separately so
// tests can drive THIEF-VS-ADVENTURER and I-THIEF in isolation from T1's
// booty logic.
export interface IThiefCtx {
  /** ZIL HERE — current player room. */
  readonly hereId: string;

  /** Current room the thief occupies. */
  getThiefRoomId(): string;

  /** Whether the player is dead (ghost mode). */
  isDead(): boolean;

  // ----- THIEF flag reads/writes -----
  isThiefInvisible(): boolean;
  setThiefInvisible(): void;
  clearThiefInvisible(): void;
  isThiefFightBit(): boolean;
  clearThiefFightBit(): void;

  /** ONBIT on the room — always-lit rooms (above-ground). */
  isRoomLit(roomId: string): boolean;

  /** Whether the troll is visible in HERE (I-THIEF branch 2 guard). */
  isTrollInHere(): boolean;

  /** Whether roomId is the TREASURE-ROOM. */
  isTreasureRoom(roomId: string): boolean;

  /** Move the THIEF object to a room. */
  moveThiefTo(roomId: string): void;

  /** All room ids in ROOMS order (ZIL ROOMS object chain). */
  getRooms(): string[];

  /** Whether a room has SACREDBIT (above-ground). */
  isRoomSacred(roomId: string): boolean;

  /** Whether a room has RLANDBIT (is a land room). */
  isRoomLand(roomId: string): boolean;

  /** Whether a room has TOUCHBIT (player has visited it). */
  isRoomTouched(roomId: string): boolean;

  /** Whether a room has MAZEBIT (maze area). */
  isRoomMaze(roomId: string): boolean;

  // ----- RNG -----
  rng: {
    prob(base: number): boolean;
    zprob(base: number, denom: number): boolean;
  };
  getLucky(): boolean;

  // ----- Object access (for rob/stealJunk helpers) -----
  getObj(id: string): ThiefObjHandle | undefined;
  childrenOf(containerId: string): string[];

  /** Emit text to the player. */
  tell(s: string): void;

  // ----- Booty/steal helpers (wired from thief.ts in T1) -----
  hackTreasures(): void;
  depositBooty(rmId: string): boolean;
  rob(whatId: string, whereId: string, prob?: number): boolean;
  robMaze(rmId: string): boolean;
  stealJunk(rmId: string): boolean;
  dropJunk(rmId: string): void;
  recoverStiletto(): void;
  stoleLight(): boolean;

  // ----- Combat -----
  /** Thief pStrength (for WINNING? flee decision). */
  getThiefPStrength(): number;
  /** Adjusted player fight-strength (ZIL FIGHT-STRENGTH). */
  fightStrength(): number;
  /** WINNING? result — pre-computed so the ctx can inject forced RNG. */
  isWinning(): boolean;
}

// ---------------------------------------------------------------------------
// THIEF-VS-ADVENTURER — 1actions.zil:1764–1873
//
// Returns true when the thief finished its interaction this tick (I-THIEF
// can return immediately).  Returns false to let I-THIEF continue.
//
// hereQ: whether the thief was visible in HERE at the start of I-THIEF
//         (the ZIL local HERE?).
// ---------------------------------------------------------------------------

export function thiefVsAdventurer(ctx: IThiefCtx, hereQ: boolean): boolean {
  const dead = ctx.isDead();
  const here = ctx.hereId;

  // 1actions.zil:1765–1766
  // if !DEAD and HERE==TREASURE-ROOM: let TREASURE-ROOM-FCN handle it
  if (!dead && ctx.isTreasureRoom(here)) return false;

  if (!thiefHere()) {
    // -----------------------------------------------------------------------
    // First-appearance block — 1actions.zil:1766–1847
    // -----------------------------------------------------------------------

    // 2a: !dead && !here? && prob(30) — materialize with stiletto
    // 1actions.zil:1767–1784
    if (!dead && !hereQ && ctx.rng.prob(30)) {
      const stiletto = ctx.getObj('STILETTO');
      if (stiletto !== undefined && stiletto.parentId === 'THIEF') {
        ctx.clearThiefInvisible();
        ctx.tell(
          'Someone carrying a large bag is casually leaning against one of the\n' +
          'walls here. He does not speak, but it is clear from his aspect that\n' +
          'the bag will be taken only over his dead body.',
        );
        setThiefHere(true);
        return true;
      }
    }

    // 2b: here? && FIGHTBIT && !winning → flee
    // 1actions.zil:1785–1795
    if (hereQ && ctx.isThiefFightBit() && !ctx.isWinning()) {
      ctx.tell(
        'Your opponent, determining discretion to be the better part of\n' +
        'valor, decides to terminate this little contretemps. With a rueful\n' +
        'nod of his head, he steps backward into the gloom and disappears.',
      );
      ctx.setThiefInvisible();
      ctx.clearThiefFightBit();
      ctx.recoverStiletto();
      return true;
    }

    // 2c: here? && FIGHTBIT && prob(90) → stay & fight
    // 1actions.zil:1796–1797
    if (hereQ && ctx.isThiefFightBit() && ctx.rng.prob(90)) {
      return false;
    }

    // 2d: here? && prob(30) → leave empty-handed
    // 1actions.zil:1798–1804
    if (hereQ && ctx.rng.prob(30)) {
      ctx.tell(
        'The holder of the large bag just left, looking disgusted.\n' +
        'Fortunately, he took nothing.',
      );
      ctx.setThiefInvisible();
      ctx.recoverStiletto();
      return true;
    }

    // 2e: prob(70) → idle
    // 1actions.zil:1805
    if (ctx.rng.prob(70)) return false;

    // 2f: !dead → rob
    // 1actions.zil:1806–1847
    if (!dead) {
      let robbed: string | null = null;
      if (ctx.rob(here, 'THIEF', 100)) {
        robbed = 'here';
      } else if (ctx.rob('PLAYER', 'THIEF')) {
        robbed = 'player';
      }
      setThiefHere(true);

      if (robbed !== null && !hereQ) {
        // Wandering through, not visible — "seedy-looking individual"
        ctx.tell(
          'A seedy-looking individual with a large bag just wandered through\n' +
          'the room. On the way through, he quietly abstracted some valuables from ' +
          (robbed === 'here' ? 'the room' : 'your possession') +
          ', mumbling something about\n"Doing unto others before..."',
        );
        ctx.stoleLight();
      } else if (hereQ) {
        ctx.recoverStiletto();
        if (robbed !== null) {
          ctx.tell(
            'The thief just left, still carrying his large bag. You may\n' +
            'not have noticed that he ' +
            (robbed === 'player' ? 'robbed you blind first.' : 'appropriated the valuables in the room.'),
          );
          ctx.stoleLight();
        } else {
          ctx.tell('The thief, finding nothing of value, left disgusted.');
        }
        ctx.setThiefInvisible();
        // hereQ = false (mutated in ZIL; no return value update needed in pure fn)
        return true;
      } else {
        ctx.tell(
          'A "lean and hungry" gentleman just wandered through, carrying a\n' +
          'large bag. Finding nothing of value, he left disgruntled.',
        );
        return true;
      }
    }
  } else {
    // -----------------------------------------------------------------------
    // THIEF-HERE already — 1actions.zil:1848–1872
    // -----------------------------------------------------------------------
    if (hereQ && ctx.rng.prob(30)) {
      let robbed: string | null = null;
      if (ctx.rob(here, 'THIEF', 100)) {
        robbed = 'here';
      } else if (ctx.rob('PLAYER', 'THIEF')) {
        robbed = 'player';
      }
      if (robbed !== null) {
        ctx.tell(
          'The thief just left, still carrying his large bag. You may\n' +
          'not have noticed that he ' +
          (robbed === 'player' ? 'robbed you blind first.' : 'appropriated the valuables in the room.'),
        );
        ctx.stoleLight();
      } else {
        ctx.tell('The thief, finding nothing of value, left disgusted.');
      }
      ctx.setThiefInvisible();
      // hereQ = false in ZIL; fall through to RFALSE
      ctx.recoverStiletto();
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// I-THIEF — 1actions.zil:3890–3931
//
// Per-turn demon (turnsLeft=-1).  Returns true to stay scheduled.
//
// ZIL <AGAIN> semantic (OQ-1 ratified): re-runs the PROG body from the top
// in the thief's new room (after a wander move).  The ONCE local prevents a
// second wander move on the re-entry.  Ported as a do/while capped at
// MAX_PASSES=2 — the hard counter is the structural bound.
// ---------------------------------------------------------------------------

export function iThief(ctx: IThiefCtx): boolean {
  let pass = 0;

  // ONCE guard mirrors the ZIL local <ONCE <>>
  // false = first pass (wander block allowed); true = second pass (skip wander)
  let once = false;

  do {
    pass++;

    let rmId = ctx.getThiefRoomId();

    // HERE? = !INVISIBLE(THIEF) — and refresh RM when visible
    let hereQ = !ctx.isThiefInvisible();
    if (hereQ) {
      rmId = ctx.getThiefRoomId();
    }

    const hereId = ctx.hereId;
    const inTreasureRoom = ctx.isTreasureRoom(rmId);
    const playerInRoom   = rmId === hereId;

    // -----------------------------------------------------------------------
    // Branch 1: thief in TREASURE-ROOM + player elsewhere — 1actions.zil:3895–3897
    // -----------------------------------------------------------------------
    if (inTreasureRoom && !playerInRoom) {
      if (hereQ) {
        ctx.hackTreasures();
        hereQ = false;
      }
      ctx.depositBooty('TREASURE-ROOM');  // silent
    }

    // -----------------------------------------------------------------------
    // Branch 2: thief in HERE + room not lit + no troll — 1actions.zil:3898–3902
    // -----------------------------------------------------------------------
    else if (playerInRoom && !ctx.isRoomLit(rmId) && !ctx.isTrollInHere()) {
      if (thiefVsAdventurer(ctx, hereQ)) {
        return true;
      }
      if (ctx.isThiefInvisible()) hereQ = false;
    }

    // -----------------------------------------------------------------------
    // Branch 3: else — 1actions.zil:3903–3914
    // -----------------------------------------------------------------------
    else {
      if (playerInRoom && !ctx.isThiefInvisible()) {
        // Victim left — hide the thief  (1actions.zil:3904–3907)
        ctx.setThiefInvisible();
        hereQ = false;
      }
      // 1actions.zil:3908–3914: only hack belongings if the room has been touched.
      // <COND (<FSET? .RM ,TOUCHBIT>
      //        <ROB .RM ,THIEF 75>
      //        <SET FLG <COND (<AND <FSET? .RM ,MAZEBIT> <FSET? ,HERE ,MAZEBIT>>
      //                        <ROB-MAZE .RM>)
      //                       (T <STEAL-JUNK .RM>)>>)>
      if (ctx.isRoomTouched(rmId)) {
        ctx.rob(rmId, 'THIEF', 75);
        if (ctx.isRoomMaze(rmId) && ctx.isRoomMaze(hereId)) {
          ctx.robMaze(rmId);
        } else {
          ctx.stealJunk(rmId);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Wander block — 1actions.zil:3915–3928
    // ONCE guard: only on the first pass (once=false) when NOT visible in HERE
    // -----------------------------------------------------------------------
    if (!once && !hereQ) {
      once = true;  // flip for any potential re-entry
      ctx.recoverStiletto();

      // Walk the ROOMS list from current position, wrap to start; accept first
      // room that is !SACREDBIT && RLANDBIT.
      const allRooms = ctx.getRooms();
      const startIdx = allRooms.indexOf(rmId);
      const len      = allRooms.length;
      let moved      = false;

      for (let i = 1; i <= len; i++) {
        const candidate = allRooms[(startIdx + i) % len]!;
        if (!ctx.isRoomSacred(candidate) && ctx.isRoomLand(candidate)) {
          ctx.moveThiefTo(candidate);
          ctx.clearThiefFightBit();
          ctx.setThiefInvisible();
          setThiefHere(false);
          moved = true;
          break;
        }
      }

      // ZIL <AGAIN>: if a move happened, loop back (pass 2 will skip the wander block)
      if (moved && pass < MAX_PASSES) {
        continue;  // re-enter loop from top
      }
    }

    // Structural exit after at most MAX_PASSES iterations
    break;

  } while (pass < MAX_PASSES);

  // Final: DROP-JUNK if not in TREASURE-ROOM — 1actions.zil:3929–3931
  const finalRm = ctx.getThiefRoomId();
  if (!ctx.isTreasureRoom(finalRm)) {
    ctx.dropJunk(finalRm);
  }

  return true;
}
