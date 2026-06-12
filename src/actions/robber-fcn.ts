// robber-fcn.ts — ROBBER-FUNCTION: F-code callbacks + verb dispatch.
//
// Transcription of 1actions.zil:1947–2084.
//
// Two entry modes:
//   makeRobberFcn(ctx)(fcode)         — F-code path (from DO-FIGHT / VILLAIN-RESULT)
//   makeRobberFcn(ctx)(undefined, vd) — verb-dispatch path (object action handler)
//
// This module owns the F-code callbacks and the give/throw/examine/take verb
// branches, including the THIEF-ENGROSSED set-on-give hook (TS-I).

import { Flag } from '../domain/flags.js';
import { F_BUSY, F_DEAD, F_FIRST, F_UNCONSCIOUS, F_CONSCIOUS } from '../engine/combat.js';
import {
  thiefHere,
  thiefEngrossed as _thiefEngrossed,
  setThiefEngrossed,
  thiefLdesc,
  setThiefLdesc,
  ROBBER_C_DESC,
  ROBBER_U_DESC,
} from './thief-state.js';

/** Minimal handle for an in-world object that ROBBER-FUNCTION touches. */
export interface RobberObj {
  readonly id: string;
  readonly parentId: string | null;
  readonly tvalue: number;
  readonly desc: string;
  hasFlag(f: Flag): boolean;
  setFlag(f: Flag): void;
  clearFlag(f: Flag): void;
  moveTo(destId: string): void;
  setLdesc(s: string): void;
}

/** Verb dispatch payload — mirrors the action context fields ROBBER-FUNCTION reads. */
export interface VerbDispatch {
  /**
   * ZIL PRSA action id, e.g. 'V-TELL', 'V-GIVE', 'V-THROW', 'V-EXAMINE'.
   * Populated at every call site from ActionContext.action; handlers must
   * compare this, not the canonical verb word.
   */
  action?: string;
  /** Canonical verb word (UPPERCASE). Kept for the THROW-KNIFE prsoId check. */
  verb: string;
  /** Preposition from the parsed command (UPPERCASE — matches syntax.json). */
  prep?: string;
  /** ZIL PRSO id — direct object, if any. */
  prsoId?: string;
  /** ZIL PRSI id — indirect object (the thief for give/throw). */
  prsiId?: string;
  /** Whether the thief currently has FIGHTBIT (for the THROW-KNIFE check). */
  fighting?: boolean;
}

/** Everything ROBBER-FUNCTION needs from the world at runtime. */
export interface RobberFcnCtx {
  /** ZIL HERE. */
  readonly hereId: string;

  getObj(id: string): RobberObj | undefined;
  childrenOf(containerId: string): string[];

  /** Thief pStrength (mutable). */
  getThiefPStrength(): number;
  setThiefPStrength(v: number): void;

  enableIThief(): void;
  disableIThief(): void;

  isThiefInvisible(): boolean;
  setThiefInvisible(): void;

  isTreasureRoom(roomId: string): boolean;

  /** RECOVER-STILETTO helper (wired from T1). */
  recoverStiletto(): void;

  /**
   * DEPOSIT-BOOTY helper (wired from T1).
   * Moves all TVALUE>0 thief children to rm; returns true if anything moved.
   */
  depositBooty(rmId: string): boolean;

  /** MOVE-ALL helper (wired from T1). */
  moveAll(fromId: string, toId: string): void;

  rng: { prob(base: number): boolean };

  tell(s: string): void;
  clearContinuation(): void;
}

// ---------------------------------------------------------------------------
// makeRobberFcn — returns the ROBBER-FUNCTION callback closed over ctx.
//
// Signature: (fcode?: number, vd?: VerbDispatch) => boolean
//   fcode present  → F-code path
//   fcode absent   → verb-dispatch path
// ---------------------------------------------------------------------------

export function makeRobberFcn(
  ctx: RobberFcnCtx,
): (fcode?: number, vd?: VerbDispatch) => boolean {
  return function robberFunction(fcode?: number, vd?: VerbDispatch): boolean {
    // -----------------------------------------------------------------------
    // F-code path
    // -----------------------------------------------------------------------
    if (fcode !== undefined) {
      return handleFcode(fcode, ctx);
    }

    // -----------------------------------------------------------------------
    // Verb-dispatch path (MODE absent in ZIL — 1actions.zil:1951–2024)
    // -----------------------------------------------------------------------
    const action = vd?.action ?? '';

    // TELL — 1actions.zil:1948–1950
    if (action === 'V-TELL') {
      ctx.tell('The thief is a strong, silent type.');
      ctx.clearContinuation();
      return true;
    }

    // HELLO while unconscious — 1actions.zil:1952–1956
    if (action === 'V-HELLO' && thiefLdesc() === ROBBER_U_DESC) {
      ctx.tell(
        'The thief, being temporarily incapacitated, is unable to acknowledge\n' +
        'your greeting with his usual graciousness.',
      );
      return true;
    }

    // THROW KNIFE while not fighting — 1actions.zil:1957–1985
    if (action === 'V-THROW' && vd?.prsoId === 'KNIFE' && !vd.fighting) {
      const knife = ctx.getObj('KNIFE');
      if (knife !== undefined) knife.moveTo(ctx.hereId);

      if (ctx.rng.prob(10)) {
        // Flee branch — 1actions.zil:1961–1979.
        // ZIL builds the whole line from successive TELLs with no CR; emit as
        // one ctx.tell() so game.ts's newline-join can't insert a spurious "\n"
        // before the suffix.
        const bag = ctx.getObj('LARGE-BAG');
        bag?.moveTo('__void__');

        let hadStiletto = false;
        const stiletto = ctx.getObj('STILETTO');
        if (stiletto !== undefined && stiletto.parentId === 'THIEF') {
          stiletto.moveTo('__void__');
          hadStiletto = true;
        }

        const hasContents = ctx.childrenOf('THIEF').length > 0;
        const suffix = hasContents
          ? ', but the contents of his bag fall on the floor.'
          : '.';
        if (hasContents) ctx.moveAll('THIEF', ctx.hereId);

        ctx.tell(
          "You evidently frightened the robber, though you didn't hit him. He\nflees" + suffix,
        );

        bag?.moveTo('THIEF');
        if (hadStiletto) stiletto?.moveTo('THIEF');

        ctx.setThiefInvisible();
      } else {
        // Angered — 1actions.zil:1980–1985
        ctx.tell(
          "You missed. The thief makes no attempt to take the knife, though it\n" +
          "would be a fine addition to the collection in his bag. He does seem\n" +
          "angered by your attempt.",
        );
        const thief = ctx.getObj('THIEF');
        thief?.setFlag(Flag.Fight);
      }
      return true;
    }

    // GIVE or THROW <X> to THIEF — 1actions.zil:1986–2012
    if (
      (action === 'V-THROW' || action === 'V-GIVE' || action === 'V-SGIVE') &&
      vd?.prsoId !== undefined &&
      vd.prsoId !== 'THIEF' &&
      vd.prsiId === 'THIEF'
    ) {
      // If thief is unconscious (pStrength < 0) — revive first
      const ps = ctx.getThiefPStrength();
      if (ps < 0) {
        ctx.setThiefPStrength(-ps);
        ctx.enableIThief();
        ctx.recoverStiletto();
        setThiefLdesc(ROBBER_C_DESC);
        ctx.tell('Your proposed victim suddenly recovers consciousness.');
      }

      const prso = ctx.getObj(vd.prsoId);
      if (prso !== undefined) prso.moveTo('THIEF');

      // Branch: stiletto, treasure, or junk
      // Note: STILETTO branch is commented-out in ZIL (`;(<EQUAL? ,PRSO ,STILETTO>...`)
      // so the only active branches are TVALUE>0 → engrossed, else → bag.
      const tval = prso?.tvalue ?? 0;
      if (tval > 0) {
        // THIEF-ENGROSSED set — TS-I (1actions.zil:2005)
        setThiefEngrossed(true);
        ctx.tell(
          'The thief is taken aback by your unexpected generosity, but accepts\n' +
          'the ' + (prso?.desc ?? 'item') + ' and stops to admire its beauty.',
        );
      } else {
        ctx.tell(
          'The thief places the ' + (prso?.desc ?? 'item') + ' in his bag and thanks\n' +
          'you politely.',
        );
      }
      return true;
    }

    // TAKE — 1actions.zil:2013–2015
    if (action === 'V-TAKE') {
      ctx.tell('Once you got him, what would you do with him?');
      return true;
    }

    // EXAMINE / LOOK-INSIDE — 1actions.zil:2016–2021
    // ZIL VERB? EXAMINE LOOK-INSIDE — only those two actions, not look-under/behind/on.
    if (action === 'V-EXAMINE' || action === 'V-LOOK-INSIDE') {
      ctx.tell(
        'The thief is a slippery character with beady eyes that flit back\n' +
        'and forth. He carries, along with an unmistakable arrogance, a large bag\n' +
        'over his shoulder and a vicious stiletto, whose blade is aimed\n' +
        'menacingly in your direction. I\'d watch out if I were you.',
      );
      return true;
    }

    // LISTEN — 1actions.zil:2022–2024
    if (action === 'V-LISTEN') {
      ctx.tell('The thief says nothing, as you have not been formally introduced.');
      return true;
    }

    return false;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// formatContents — PRINT-CONTENTS for the F_DEAD treasure reveal.
// 1actions.zil:2054–2057 (ZIL PRINT-CONTENTS, gverbs.zil:1730–1748).
// Formats direct children of containerId as "a X, a Y, and a Z".
function formatContents(childIds: string[], ctx: RobberFcnCtx): string {
  const parts: string[] = [];
  for (const id of childIds) {
    const obj = ctx.getObj(id);
    if (obj !== undefined) parts.push('a ' + obj.desc);
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  // "a X, a Y, and a Z" (Oxford comma style per ZIL PRINT-CONTENTS: ", " + "and " before last)
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]!;
}

// ---------------------------------------------------------------------------
// F-code handlers
// ---------------------------------------------------------------------------

function handleFcode(fcode: number, ctx: RobberFcnCtx): boolean {
  // F_BUSY — 1actions.zil:2025–2034
  if (fcode === F_BUSY) {
    const stiletto = ctx.getObj('STILETTO');
    if (stiletto === undefined) return false;

    // Stiletto already with THIEF → false (short-circuit, skip the blow)
    if (stiletto.parentId === 'THIEF') return false;

    // Stiletto in LOC(THIEF) → retrieve it
    const thief = ctx.getObj('THIEF');
    if (thief !== undefined && stiletto.parentId === thief.parentId) {
      stiletto.moveTo('THIEF');
      stiletto.setFlag(Flag.NonDescript);
      if (thief.parentId === ctx.hereId) {
        ctx.tell(
          'The robber, somewhat surprised at this turn of events, nimbly\n' +
          'retrieves his stiletto.',
        );
      }
      return true;
    }

    // Stiletto elsewhere → false (can't retrieve, don't skip blow)
    return false;
  }

  // F_DEAD — 1actions.zil:2035–2062
  if (fcode === F_DEAD) {
    const stiletto = ctx.getObj('STILETTO');
    if (stiletto !== undefined) {
      stiletto.moveTo(ctx.hereId);
      stiletto.clearFlag(Flag.NonDescript);
    }

    const deposited = ctx.depositBooty(ctx.hereId);

    if (ctx.isTreasureRoom(ctx.hereId)) {
      // Walk TREASURE-ROOM children, reveal each non-CHALICE/THIEF/ADVENTURER child.
      // 1actions.zil:2040–2059: SET X = FIRST?(HERE), loop via NEXT?
      let announced = false;
      for (const childId of ctx.childrenOf(ctx.hereId)) {
        // ZIL excludes CHALICE/THIEF/ADVENTURER (1actions.zil:2046); add PLAYER
        // because bootstrap.ts:58 places the player as a room child with id 'PLAYER'.
        if (childId === 'CHALICE' || childId === 'THIEF' || childId === 'ADVENTURER' || childId === 'PLAYER') continue;
        const child = ctx.getObj(childId);
        if (child === undefined) continue;
        child.clearFlag(Flag.Invisible);
        if (!announced) {
          announced = true;
          ctx.tell(
            'As the thief dies, the power of his magic decreases, and his\n' +
            'treasures reappear:',
          );
        }
        // 1actions.zil:2053–2057: TELL "  A " D .X; then if <AND <FIRST? .X> <SEE-INSIDE? .X>>
        // tell ", with " + PRINT-CONTENTS .X.
        // SEE-INSIDE?: !INVISIBLE(X) && (OPENBIT || TRANSBIT) — checked AFTER FCLEAR INVISIBLE.
        let line = '  A ' + child.desc;
        const contents = ctx.childrenOf(childId);
        if (
          contents.length > 0 &&
          (child.hasFlag(Flag.Open) || child.hasFlag(Flag.Transparent))
        ) {
          line += ', with ' + formatContents(contents, ctx);
        }
        ctx.tell(line);
      }
      ctx.tell('The chalice is now safe to take.');
    } else if (deposited) {
      ctx.tell('His booty remains.');
    }

    ctx.disableIThief();
    return true;
  }

  // F_FIRST — 1actions.zil:2063–2069
  if (fcode === F_FIRST) {
    if (thiefHere() && !ctx.isThiefInvisible() && ctx.rng.prob(20)) {
      const thief = ctx.getObj('THIEF');
      thief?.setFlag(Flag.Fight);
      ctx.clearContinuation();
      return true;
    }
    return false;
  }

  // F_UNCONSCIOUS — 1actions.zil:2070–2075
  if (fcode === F_UNCONSCIOUS) {
    ctx.disableIThief();
    const thief = ctx.getObj('THIEF');
    thief?.clearFlag(Flag.Fight);
    const stiletto = ctx.getObj('STILETTO');
    if (stiletto !== undefined) {
      stiletto.moveTo(ctx.hereId);
      stiletto.clearFlag(Flag.NonDescript);
    }
    setThiefLdesc(ROBBER_U_DESC);
    return true;
  }

  // F_CONSCIOUS — 1actions.zil:2076–2084
  if (fcode === F_CONSCIOUS) {
    const thief = ctx.getObj('THIEF');
    if (thief !== undefined && thief.parentId === ctx.hereId) {
      thief.setFlag(Flag.Fight);
      ctx.tell(
        'The robber revives, briefly feigning continued unconsciousness, and,\n' +
        'when he sees his moment, scrambles away from you.',
      );
    }
    ctx.enableIThief();
    setThiefLdesc(ROBBER_C_DESC);
    ctx.recoverStiletto();
    return true;
  }

  return false;
}
