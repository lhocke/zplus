/**
 * find-bits.ts — ZIL FINDBIT name → Flag mapping.
 *
 * Maps the raw ZIL FINDBIT names observed in syntax.json dobjFindBit /
 * iobjFindBit fields to the corresponding Flag enum values from flags.ts.
 *
 * RMUNGBIT is deliberately NOT in the map. It is a GWIM "go up a level"
 * sentinel (gparser.zil:901-903) and is handled earlier in the pipeline,
 * not as a regular flag filter. The GWIM routine checks for RMUNGBIT
 * explicitly and returns ROOMS as the container to walk.
 *
 * All other known findBit names map 1:1 to a domain Flag.
 */

import { Flag } from '../../domain/flags.js';

/**
 * Maps ZIL FINDBIT raw names to domain Flag enum values.
 * RMUNGBIT is intentionally absent (it is a GWIM sentinel, not a real flag).
 */
export const FINDBIT_TO_FLAG: Record<string, Flag | undefined> = {
  ACTORBIT:  Flag.Actor,
  BURNBIT:   Flag.Flammable,
  CLIMBBIT:  Flag.Climbable,
  CONTBIT:   Flag.Container,
  DOORBIT:   Flag.Door,
  DRINKBIT:  Flag.Drink,
  FLAMEBIT:  Flag.OnFire,
  FOODBIT:   Flag.Food,
  LIGHTBIT:  Flag.Light,
  ONBIT:     Flag.Light,    // ONBIT doubles as "is lit" (light source active)
  READBIT:   Flag.Readable,
  TAKEBIT:   Flag.Takeable,
  TOOLBIT:   Flag.Tool,
  TURNBIT:   Flag.Turnable,
  VEHBIT:    Flag.Vehicle,
  WEAPONBIT: Flag.Weapon,
};
