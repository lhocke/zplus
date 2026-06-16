// troll-fcn.ts — TROLL-FCN F-code callbacks. 1actions.zil:640–764.
//
// TROLL-FLAG double-duty: dead/unconscious → trollFlag=true (opens exits);
// F_BUSY axe-recovery short-circuit (spec §10.2, D3).
//
// Also houses TROLL-ROOM-F (1actions.zil:4175–4178): the smallest room FCN
// in the game — on M-ENTER with troll present, THIS-IS-IT binds "it" to the
// troll so "attack it" works on arrival.

import type { ActionHandler } from '../domain/game-object.js';
import { Flag } from '../domain/flags.js';
import { F_BUSY, F_DEAD, F_UNCONSCIOUS, F_CONSCIOUS, F_FIRST } from '../engine/combat.js';
import { M_ENTER } from '../engine/messages.js';

/** Minimal handle for a world object that TROLL-FCN needs to touch. */
export interface TrollObjHandle {
  parentId: string | null;
  hasFlag(f: Flag): boolean;
  setFlag(f: Flag): void;
  clearFlag(f: Flag): void;
  moveTo(destId: string): void;
  setLdesc(s: string): void;
}

/**
 * Everything TROLL-FCN reads or writes at runtime.
 *
 * hereId: the current room id (ZIL HERE).
 * getObj: look up TROLL, AXE, etc. by id — returns undefined when absent.
 */
export interface TrollFcnContext {
  hereId: string;
  getObj(id: string): TrollObjHandle | undefined;
  getTrollFlag(): boolean;
  setTrollFlag(v: boolean): void;
  getLucky(): boolean;
  rng: { prob(base: number): boolean; zprob(base: number, denom: number): boolean };
  tell(s: string): void;
  clearContinuation(): void;
}

// objects.json:2257 canonical value — no embedded newline.
const LDESC_BRANDISHING =
  'A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the room.';
const LDESC_UNCONSCIOUS =
  'An unconscious troll is sprawled on the floor. All passages out of the room are open.';
const LDESC_BARE = 'A troll is here.';
const LDESC_COWERING = 'A pathetically babbling troll is here.';

// Drop the axe to HERE, clearing NDESCBIT and setting WEAPONBIT.
// Mirrors 1actions.zil:666–669 (F_DEAD) and :673–676 (F_UNCONSCIOUS).
function dropAxe(axe: TrollObjHandle, hereId: string): void {
  axe.moveTo(hereId);
  axe.clearFlag(Flag.NonDescript);
  axe.setFlag(Flag.Weapon);
}

/**
 * makeTrollFcn — returns the TROLL-FCN action callback closed over ctx.
 *
 * The returned function is stored as VillainEntry.action for TROLL and
 * called by DO-FIGHT, I-FIGHT, and VILLAIN-RESULT with F-code selectors.
 */
export function makeTrollFcn(ctx: TrollFcnContext): (fcode: number) => boolean {
  return function trollFcn(fcode: number): boolean {
    const troll = ctx.getObj('TROLL');
    const axe   = ctx.getObj('AXE');

    if (fcode === F_BUSY) {
      // 1actions.zil:644–664
      if (axe === undefined) return false;

      // AXE already with TROLL — short-circuit, return false.
      if (axe.parentId === 'TROLL') return false;

      if (axe.parentId === ctx.hereId) {
        // AXE is on the floor in HERE — zprob(75) to pick it up.
        const denom = ctx.getLucky() ? 100 : 300;
        if (ctx.rng.zprob(75, denom)) {
          // Pick it up: FSET NDESCBIT, FCLEAR WEAPONBIT, move to TROLL, update LDESC.
          axe.setFlag(Flag.NonDescript);
          axe.clearFlag(Flag.Weapon);
          axe.moveTo('TROLL');
          troll?.setLdesc(LDESC_BRANDISHING);
          if (troll !== undefined && troll.parentId === ctx.hereId) {
            ctx.tell(
              'The troll, angered and humiliated, recovers his weapon. He appears to have an axe to grind with you.',
            );
          }
          return true;
        }
        // Prob failed — troll cowers.
      }

      // AXE unavailable (not in troll, not in HERE) OR prob failed — cowering.
      if (troll !== undefined && troll.parentId === ctx.hereId) {
        troll.setLdesc(LDESC_COWERING);
        ctx.tell(
          'The troll, disarmed, cowers in terror, pleading for his life in the guttural tongue of the trolls.',
        );
      }
      return true;
    }

    if (fcode === F_DEAD) {
      // 1actions.zil:665–670
      if (axe !== undefined && axe.parentId === 'TROLL') {
        dropAxe(axe, ctx.hereId);
      }
      ctx.setTrollFlag(true);
      return true;
    }

    if (fcode === F_UNCONSCIOUS) {
      // 1actions.zil:671–680
      if (troll !== undefined) {
        troll.clearFlag(Flag.Fight);
        troll.setLdesc(LDESC_UNCONSCIOUS);
      }
      if (axe !== undefined && axe.parentId === 'TROLL') {
        dropAxe(axe, ctx.hereId);
      }
      ctx.setTrollFlag(true);
      return true;
    }

    if (fcode === F_CONSCIOUS) {
      // 1actions.zil:681–700
      if (troll !== undefined && troll.parentId === ctx.hereId) {
        troll.setFlag(Flag.Fight);
        ctx.tell('The troll stirs, quickly resuming a fighting stance.');
      }
      // Axe recovery / LDESC update.
      if (axe !== undefined) {
        if (axe.parentId === 'TROLL') {
          troll?.setLdesc(LDESC_BRANDISHING);
        } else if (axe.parentId === 'TROLL-ROOM') {
          // Pick it up.
          axe.setFlag(Flag.NonDescript);
          axe.clearFlag(Flag.Weapon);
          axe.moveTo('TROLL');
          troll?.setLdesc(LDESC_BRANDISHING);
        } else {
          troll?.setLdesc(LDESC_BARE);
        }
      } else {
        troll?.setLdesc(LDESC_BARE);
      }
      ctx.setTrollFlag(false);
      return true;
    }

    if (fcode === F_FIRST) {
      // 1actions.zil:701–705 — prob(33) one-arg (not ZPROB).
      if (ctx.rng.prob(33)) {
        troll?.setFlag(Flag.Fight);
        ctx.clearContinuation();
        return true;
      }
      return false;
    }

    return false;
  };
}

// TROLL-ROOM-F — 1actions.zil:4175–4178.
// On M-ENTER with the troll present, bind "it" to the troll so "attack it"
// targets the troll on arrival without the player having to name it first.
export const trollRoomFcn: ActionHandler = (ctx) => {
  if (ctx.rarg !== M_ENTER) return false;
  const troll = ctx.world.get('TROLL');
  if (troll === undefined || troll.parent !== ctx.here) return false;
  ctx.thisIsIt?.(troll);
  return false;
};
