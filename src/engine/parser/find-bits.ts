/**
 * ZIL FINDBIT name → Flag mapping.
 *
 * RMUNGBIT is absent — it's a GWIM sentinel (gparser.zil:901-903), not a flag.
 * All other findBit names map 1:1 to a domain Flag.
 */

import { Flag } from '../../domain/flags.js';

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
