/**
 * Shared dispatch constants — the `rarg` values ZIL passes to a room's ACTION
 * routine, mirrored verbatim from gmain.zil (~lines 19–25).
 *
 * A room handler branches on its `rarg`:
 *   M-BEG   — first intercept of the player's verb, before object handlers.
 *   M-ENTER — fired once on room entry (GOTO), before the description.
 *   M-LOOK  — fired to produce an action-driven room description; rooms with a
 *             static ldesc never see this (the engine just prints ldesc).
 *
 * Object handlers receive `rarg === undefined`; they branch on `ctx.verb`.
 */
export const M_BEG = 1;
export const M_ENTER = 2;
export const M_LOOK = 3;
export const M_FLASH = 4;
export const M_OBJDESC = 5;
export const M_END = 6;
