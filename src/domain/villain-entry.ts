import type { ObjectId } from './game-object.js';

// F-code selectors — 1actions.zil:3236–3238.
export const F_BUSY        = 1;
export const F_DEAD        = 2;
export const F_UNCONSCIOUS = 3;
export const F_CONSCIOUS   = 4;
export const F_FIRST       = 5;

/**
 * Per-villain metadata, mirroring the ZIL VILLAINS LTABLE entries
 * (1actions.zil:3793–3804).  Keyed by villain object id in the combat
 * engine's villain table — NOT stored on Actor (§14 OQ-1, D1).
 *
 * vMsgs is the villain's MELEE message table (e.g. TROLL-MELEE), stored
 * here as the resolved array; combat's remark() indexes into it.
 */
export interface VillainEntry {
  /** Best weapon (V-BEST) — null if no best weapon (Cyclops). */
  vBest: ObjectId | null;
  /** Strength advantage conferred by best weapon (V-BEST-ADV). */
  vBestAdv: number;
  /** Wake probability when unconscious (V-PROB); 0 = starts at 0 and ramps. */
  vProb: number;
  /** MELEE message table for this villain (V-MSGS). */
  vMsgs: readonly unknown[];
  /** F-code callback (villain ACTION routine). Returns truthy on handled. */
  action: (fcode: number) => boolean;
}
