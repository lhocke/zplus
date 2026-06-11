// thief.ts — Booty/steal helpers for the thief actor.
//
// Transcription of the ZIL routines from 1actions.zil that implement the
// thief's wander/steal/deposit state machine.  Phase-3 T1 task.
//
// All two-arg PROB calls (zprob) route through ctx.rng.zprob(base, denom)
// where denom = getLucky() ? 100 : 300.  One-arg PROB calls use prob(base).
//
// ZIL citations:
//   ROB              1actions.zil:3976–3989
//   ROB-MAZE         1actions.zil:1917–1933
//   STEAL-JUNK       1actions.zil:3954–3974
//   DROP-JUNK        1actions.zil:3933–3947
//   DEPOSIT-BOOTY    1actions.zil:1897–1909
//   HACK-TREASURES   1actions.zil:1888–1895
//   RECOVER-STILETTO 1actions.zil:3949–3952
//   MOVE-ALL         1actions.zil:2114–2121
//   STOLE-LIGHT?     1actions.zil:1875–1880
//   WINNING?         1actions.zil:3584–3591

import { Flag } from '../domain/flags.js';
import { setEggSolve } from './thief-state.js';

// Minimal object handle ThiefCtx needs to manipulate an in-world object.
export interface ThiefObjHandle {
  readonly id: string;
  readonly parentId: string | null;
  readonly tvalue: number;
  hasFlag(f: Flag): boolean;
  setFlag(f: Flag): void;
  clearFlag(f: Flag): void;
  moveTo(destId: string): void;
}

// Everything the booty/steal helpers need from the game context.
export interface ThiefCtx {
  /** Current room id (ZIL HERE). */
  readonly hereId: string;
  /** RNG supporting prob(base) and zprob(base, denom). */
  rng: {
    prob(base: number): boolean;
    zprob(base: number, denom: number): boolean;
  };
  /** Whether LUCKY is true — governs zprob denom (100 vs 300). */
  getLucky(): boolean;
  /** Look up an object by id; returns undefined when absent. */
  getObj(id: string): ThiefObjHandle | undefined;
  /** Ordered list of direct children ids of a container. */
  childrenOf(containerId: string): string[];
  /** Whether the current room is lit right now (after the thief may have stolen a light). */
  isRoomLit(): boolean;
  /** Whether the room was lit at the START of this tick (before any steal). */
  getPrevLit(): boolean;
  /** Emit text to the player. */
  tell(s: string): void;
  /** Villain pStrength for the thief — used by WINNING?. */
  getThiefStrength(): number;
  /** Current player score — for fightStrength. */
  getScore(): number;
  /** Adjusted player fight-strength — ZIL FIGHT-STRENGTH(adjust=true). */
  fightStrength(): number;
  // Optional: clear DOME-FLAG when ROPE is stolen (setGlobal already wired elsewhere)
  clearDomeFlag?(): void;
}

export type { ThiefObjHandle as ThiefObj };

// ---------------------------------------------------------------------------
// ROB — 1actions.zil:3976–3989
//
// For each direct child of `what`:
//   if !INVISIBLE && !SACRED && TVALUE>0 && (!prob || prob(prob)):
//     MOVE to `where`; FSET TOUCHBIT; if where==THIEF FSET INVISIBLE
// Returns true if anything was robbed.
// ---------------------------------------------------------------------------

export function rob(
  ctx: ThiefCtx,
  whatId: string,
  whereId: string,
  prob?: number,
): boolean {
  let robbed = false;
  for (const childId of ctx.childrenOf(whatId)) {
    const child = ctx.getObj(childId);
    if (child === undefined) continue;
    if (child.hasFlag(Flag.Invisible)) continue;
    if (child.hasFlag(Flag.Sacred)) continue;
    if (child.tvalue <= 0) continue;
    if (prob !== undefined && !ctx.rng.prob(prob)) continue;

    child.moveTo(whereId);
    child.setFlag(Flag.Touched);
    if (whereId === 'THIEF') child.setFlag(Flag.Invisible);
    robbed = true;
  }
  return robbed;
}

// ---------------------------------------------------------------------------
// ROB-MAZE — 1actions.zil:1917–1933
//
// Finds the first TAKEBIT !INVISIBLE child of `rm` at PROB(40); announces
// it; then at ZPROB(60,80) moves it into the thief (TOUCHBIT + INVISIBLE).
// Returns false when no eligible item found (or the room is empty).
// ---------------------------------------------------------------------------

export function robMaze(ctx: ThiefCtx, rmId: string): boolean {
  for (const childId of ctx.childrenOf(rmId)) {
    const child = ctx.getObj(childId);
    if (child === undefined) continue;
    if (!child.hasFlag(Flag.Takeable)) continue;
    if (child.hasFlag(Flag.Invisible)) continue;

    if (!ctx.rng.prob(40)) continue;

    ctx.tell(
      `You hear, off in the distance, someone saying "My, I wonder what\nthis fine ${child.id.toLowerCase()} is doing here."`,
    );

    const denom = ctx.getLucky() ? 80 : 300;
    if (ctx.rng.zprob(60, denom)) {
      child.moveTo('THIEF');
      child.setFlag(Flag.Touched);
      child.setFlag(Flag.Invisible);
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// STEAL-JUNK — 1actions.zil:3954–3974
//
// Finds first TVALUE==0 TAKEBIT !SACRED !INVISIBLE child of `rm` where
// (child == STILETTO || zprob(10, T)).  Moves it into the thief, setting
// TOUCHBIT + INVISIBLE.  If child == ROPE, clears DOME-FLAG.
// Announces disappearance when rm == HERE.
// Returns true when the item was in HERE (notified player), false otherwise.
// ---------------------------------------------------------------------------

export function stealJunk(ctx: ThiefCtx, rmId: string): boolean {
  const denom = ctx.getLucky() ? 100 : 300;
  for (const childId of ctx.childrenOf(rmId)) {
    const child = ctx.getObj(childId);
    if (child === undefined) continue;
    if (child.tvalue !== 0) continue;
    if (!child.hasFlag(Flag.Takeable)) continue;
    if (child.hasFlag(Flag.Sacred)) continue;
    if (child.hasFlag(Flag.Invisible)) continue;

    // STILETTO is always stolen (no prob gate); others at zprob(10)
    if (childId !== 'STILETTO' && !ctx.rng.zprob(10, denom)) continue;

    child.moveTo('THIEF');
    child.setFlag(Flag.Touched);
    child.setFlag(Flag.Invisible);

    if (childId === 'ROPE') {
      ctx.clearDomeFlag?.();
    }

    if (rmId === ctx.hereId) {
      ctx.tell(`You suddenly notice that the ${child.id.toLowerCase()} vanished.`);
      return true;
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// DROP-JUNK — 1actions.zil:3933–3947
//
// For each thief child (skip STILETTO / LARGE-BAG):
//   if TVALUE==0 && zprob(30,T): FCLEAR INVISIBLE, MOVE to rm
//   if first drop into HERE: announce "rummaging"
// ---------------------------------------------------------------------------

export function dropJunk(ctx: ThiefCtx, rmId: string): void {
  const denom = ctx.getLucky() ? 100 : 300;
  let announced = false;

  for (const childId of ctx.childrenOf('THIEF')) {
    if (childId === 'STILETTO' || childId === 'LARGE-BAG') continue;
    const child = ctx.getObj(childId);
    if (child === undefined) continue;
    if (child.tvalue !== 0) continue;
    if (!ctx.rng.zprob(30, denom)) continue;

    child.clearFlag(Flag.Invisible);
    child.moveTo(rmId);

    if (!announced && rmId === ctx.hereId) {
      ctx.tell(
        'The robber, rummaging through his bag, dropped a few items he found\nvalueless.',
      );
      announced = true;
    }
  }
}

// ---------------------------------------------------------------------------
// DEPOSIT-BOOTY — 1actions.zil:1897–1909
//
// For each thief child (skip STILETTO / LARGE-BAG):
//   if TVALUE>0: MOVE to rm; if child==EGG: EGG-SOLVE=true + FSET EGG OPENBIT
// Returns true if anything was deposited.
// ---------------------------------------------------------------------------

export function depositBooty(ctx: ThiefCtx, rmId: string): boolean {
  let deposited = false;

  for (const childId of ctx.childrenOf('THIEF')) {
    if (childId === 'STILETTO' || childId === 'LARGE-BAG') continue;
    const child = ctx.getObj(childId);
    if (child === undefined) continue;
    if (child.tvalue <= 0) continue;

    child.moveTo(rmId);
    deposited = true;

    // EGG-SOLVE hook — 1actions.zil:1906–1908
    if (childId === 'EGG') {
      setEggSolve(true);
      child.setFlag(Flag.Open);  // FSET EGG OPENBIT
    }
  }

  return deposited;
}

// ---------------------------------------------------------------------------
// HACK-TREASURES — 1actions.zil:1888–1895
//
// recoverStiletto(); FSET THIEF INVISIBLE;
// FCLEAR INVISIBLE on every TREASURE-ROOM child.
// ---------------------------------------------------------------------------

export function hackTreasures(
  ctx: ThiefCtx,
  thiefId: string,
  treasureRoomId: string,
): void {
  recoverStiletto(ctx, thiefId);

  const thief = ctx.getObj(thiefId);
  thief?.setFlag(Flag.Invisible);

  for (const childId of ctx.childrenOf(treasureRoomId)) {
    const child = ctx.getObj(childId);
    child?.clearFlag(Flag.Invisible);
  }
}

// ---------------------------------------------------------------------------
// RECOVER-STILETTO — 1actions.zil:3949–3952
//
// if STILETTO in LOC(THIEF): FSET NDESCBIT; MOVE to THIEF.
// ---------------------------------------------------------------------------

export function recoverStiletto(ctx: ThiefCtx, thiefId: string): void {
  const thief = ctx.getObj(thiefId);
  if (thief === undefined) return;

  const thiefLoc = thief.parentId;
  if (thiefLoc === null) return;

  const stiletto = ctx.getObj('STILETTO');
  if (stiletto === undefined) return;

  if (stiletto.parentId === thiefLoc) {
    stiletto.setFlag(Flag.NonDescript);
    stiletto.moveTo(thiefId);
  }
}

// ---------------------------------------------------------------------------
// MOVE-ALL — 1actions.zil:2114–2121
//
// FCLEAR INVISIBLE + MOVE every child of `from` to `to`.
// ---------------------------------------------------------------------------

export function moveAll(ctx: ThiefCtx, fromId: string, toId: string): void {
  for (const childId of ctx.childrenOf(fromId)) {
    const child = ctx.getObj(childId);
    if (child === undefined) continue;
    child.clearFlag(Flag.Invisible);
    child.moveTo(toId);
  }
}

// ---------------------------------------------------------------------------
// STOLE-LIGHT? — 1actions.zil:1875–1880
//
// Recomputes LIT; if the room just went dark, tells the player.
// Always returns true.
// ---------------------------------------------------------------------------

export function stoleLight(ctx: ThiefCtx): boolean {
  const wasLit = ctx.getPrevLit();
  const nowLit = ctx.isRoomLit();
  if (!nowLit && wasLit) {
    ctx.tell('The thief seems to have left you in the dark.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// WINNING? — 1actions.zil:3584–3591
//
// Returns true when the thief should flee (i.e. the player is "winning").
// VS = villain pStrength; PS = VS - fightStrength() (adjusted player strength).
//
// Probability rungs (one-arg PROB — not ZPROB, LUCKY-insensitive):
//   PS>3  → prob(90)
//   PS>0  → prob(75)
//   PS==0 → prob(50)
//   VS>1  → prob(25)
//   else  → prob(10)
// ---------------------------------------------------------------------------

export function winning(ctx: ThiefCtx, villainStrength: number): boolean {
  const vs = villainStrength;
  const ps = vs - ctx.fightStrength();

  if (ps > 3) return ctx.rng.prob(90);
  if (ps > 0) return ctx.rng.prob(75);
  if (ps === 0) return ctx.rng.prob(50);
  if (vs > 1) return ctx.rng.prob(25);
  return ctx.rng.prob(10);
}
