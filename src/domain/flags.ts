export enum Flag {
  Light,
  Takeable,
  Container,
  Open,
  Door,
  Transparent,
  Flammable,
  OnFire,
  Weapon,
  Food,
  Drink,
  Readable,
  Turnable,
  Climbable,
  Sacred,
  Invisible,
  Touched,
  Vehicle,
  Burned,
  Maze,
  Land,
  NonDescript,
  Searchable,
  Surface,
  /** ACTORBIT — object is an NPC/actor; used by GWIM (FIND ACTORBIT) for attack/give. */
  Actor,
  /** TOOLBIT — object is a tool/instrument; used by GWIM (FIND TOOLBIT) for with-clauses. */
  Tool,
  /** TRYTAKEBIT — parser auto-takes the object before the action if not already held. */
  TryTake,
  /**
   * WEARBIT — object can be worn (and may currently be worn by the player).
   * PRE-TAKE checks this: if the item is in the player's inventory AND has WEARBIT,
   * it prints "You are already wearing it." instead of "You already have that!".
   */
  Wearable,
  /**
   * NONLANDBIT — room is a non-land (water) area; drowning/boat logic checks this.
   * Distinct from NDESCBIT (NonDescript); NONLANDBIT marks water rooms such as
   * RESERVOIR, IN-STREAM, and RIVER-1..5.
   */
  NonLand,
  /**
   * ONBIT on rooms — room is always lit (outdoor rooms, open sky areas).
   * Distinct from Flag.Light (LIGHTBIT = "has the capability to emit light")
   * and Flag.OnFire (ONBIT on objects = "currently emitting light").
   * lit() checks Flag.On on the room object to implement the ZIL LIT? room-ONBIT path.
   */
  On,
}

// Capability predicates — thin wrappers so call sites read as intent, not
// as flag arithmetic.  Each predicate takes anything with a has() method.

interface FlagHost {
  has(f: Flag): boolean;
}

export const isLightSource  = (o: FlagHost): boolean => o.has(Flag.Light);
export const isTakeable     = (o: FlagHost): boolean => o.has(Flag.Takeable);
export const isContainer    = (o: FlagHost): boolean => o.has(Flag.Container);
export const isOpen         = (o: FlagHost): boolean => o.has(Flag.Open);
export const isDoor         = (o: FlagHost): boolean => o.has(Flag.Door);
export const isTransparent  = (o: FlagHost): boolean => o.has(Flag.Transparent);
export const isFlammable    = (o: FlagHost): boolean => o.has(Flag.Flammable);
export const isOnFire       = (o: FlagHost): boolean => o.has(Flag.OnFire);
export const isWeapon       = (o: FlagHost): boolean => o.has(Flag.Weapon);
export const isFood         = (o: FlagHost): boolean => o.has(Flag.Food);
export const isDrink        = (o: FlagHost): boolean => o.has(Flag.Drink);
export const isReadable     = (o: FlagHost): boolean => o.has(Flag.Readable);
export const isTurnable     = (o: FlagHost): boolean => o.has(Flag.Turnable);
export const isClimbable    = (o: FlagHost): boolean => o.has(Flag.Climbable);
export const isSacred       = (o: FlagHost): boolean => o.has(Flag.Sacred);
export const isInvisible    = (o: FlagHost): boolean => o.has(Flag.Invisible);
export const isTouched      = (o: FlagHost): boolean => o.has(Flag.Touched);
export const isVehicle      = (o: FlagHost): boolean => o.has(Flag.Vehicle);
export const isBurned       = (o: FlagHost): boolean => o.has(Flag.Burned);
export const isMaze         = (o: FlagHost): boolean => o.has(Flag.Maze);
export const isLand         = (o: FlagHost): boolean => o.has(Flag.Land);
export const isNonDescript  = (o: FlagHost): boolean => o.has(Flag.NonDescript);
export const isSearchable   = (o: FlagHost): boolean => o.has(Flag.Searchable);
export const isSurface      = (o: FlagHost): boolean => o.has(Flag.Surface);
export const isActor        = (o: FlagHost): boolean => o.has(Flag.Actor);
export const isTool         = (o: FlagHost): boolean => o.has(Flag.Tool);
export const isTryTake      = (o: FlagHost): boolean => o.has(Flag.TryTake);
export const isWearable     = (o: FlagHost): boolean => o.has(Flag.Wearable);
export const isNonLand      = (o: FlagHost): boolean => o.has(Flag.NonLand);
export const isOn           = (o: FlagHost): boolean => o.has(Flag.On);
