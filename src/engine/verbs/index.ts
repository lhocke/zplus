/**
 * Core verb implementations for the Zork engine.
 *
 * Each function handles one verb family. They are pure in the sense that they
 * take an explicit context and return a VerbResult — no globals, no DOM.
 * Side effects (containment changes, flag mutations) are applied to the
 * mutable domain objects inside the context.
 *
 * VerbContext is the primary dependency-injection point: the engine's turn
 * loop fills it out; tests wire it directly from fixture objects.
 */

import type { GameObject } from '../../domain/game-object.js';
import { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { fmt, pick, vAdvent, vFrobozz, vOpen, vClose, vRead, vExamine, vLookInside, vLookBehind, vLookOn, vLookUnder, vPut, vPutOn, preTake, preGive, yuks, hoHum, vInflate, vDeflate, vDig, vLaunch, vVerbose, vBrief, vSuperBrief, vVersion, vScript, goto, vTieUp, vTie, vUntie, vRing, preBurn, vBurn, vThrow, vGive, vWear, preMove, vMove, vTake, hackHack, tellNoPrsi, vLock, describeRoom as describeRoomMsgs, vLeap, jumploss, wheeeee, vShake, vWalkAround, vWalk, type PickRng } from '../game-messages.js';
import { lit } from '../parser/scope.js';
import { ROOM_GLOBAL_IDS } from '../parser/room-globals.js';
import { CURE_WAIT } from '../combat.js';

// All object IDs that appear in any room's LOCAL-GLOBALS list (zil/1dungeon.zil "(IN LOCAL-GLOBALS)").
// LOCAL-GLOBALS objects are not IN GLOBAL-OBJECTS per ZIL, so HACK-HACK must not fire
// "isn't here!" for them — they get the HO-HUM suffix instead.
const LOCAL_GLOBAL_IDS: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const ids of ROOM_GLOBAL_IDS.values()) {
    for (const id of ids) s.add(id);
  }
  return s;
})();

export interface VerbContext {
  readonly verb: string;
  /**
   * ZIL PRSA — parsed action id, e.g. 'V-ATTACK', 'V-LAMP-ON'.
   * Multiple verb words map to the same action (kill/stab/strike → V-ATTACK;
   * turn-ON/activate/light → V-LAMP-ON). Handlers must compare this, not `verb`.
   * Populated at every dispatch site; never absent when called from game.ts.
   */
  readonly action?: string;
  readonly dobj?: GameObject;
  /**
   * True when ZIL PRSO == ROOMS (bare climb/climb-down with no noun).
   * V-CLIMB-DOWN and V-CLIMB-FOO pass PRSO=ROOMS as OBJ so branch 1 fires;
   * V-CLIMB-UP direct has OBJ=<> (nil) so branch 1 is skipped.
   * gverbs.zil:300–302, gsyntax.zil:130–137 RMUNGBIT/GWIM.
   */
  readonly dobjIsRooms?: boolean;
  readonly iobj?: GameObject;
  readonly prep?: string;
  readonly player: GameObject;
  readonly here: Room;
  readonly world: World;
  /** Resolver for Exit.per routine names → destination room id. */
  readonly perResolver?: (routineName: string, here: Room) => string | undefined;
  /** Run M-LOOK on a room and return its output (for rooms without a static ldesc). */
  readonly mlookRunner?: (room: Room) => string;
  /** Seeded RNG for PICK-ONE operations (YUKS, DUMMY, etc.). Falls back to first table entry when absent. */
  readonly rng?: PickRng;
  /** Award the one-time VALUE of an object and zero it — ZIL SCORE-OBJ. */
  readonly scoreObj?: (obj: GameObject) => void;
  /** Current score (ZIL: SCORE global). */
  readonly score?: number;
  /** Current move count (ZIL: MOVES global). */
  readonly moves?: number;
  /** Return the rank title for the current score (ZIL: V-SCORE rank table). */
  readonly rank?: () => string;
  /** Number of times the player has died (ZIL: DEATHS global). */
  readonly deaths?: number;
  /**
   * Read a ZIL global boolean flag by name (e.g. 'WON-FLAG', 'MAGIC-FLAG').
   * Defaults to false when absent, matching ZIL `<GLOBAL X <>>`.
   */
  readonly getGlobal?: (name: string) => boolean;
  /** Write a ZIL global boolean flag by name. */
  readonly setGlobal?: (name: string, value?: boolean) => void;
  /**
   * Death handler — called by verbGo when the grue kills the player.
   * Grue gate is disabled when this is undefined (test contexts).
   */
  readonly jigsUp?: (deathMessage: string) => void;
  /** ALWAYS-LIT global (ghost immunity). Defaults to false when absent. */
  readonly alwaysLit?: boolean;
  /**
   * PROB(pct) — roll a random integer-percent, return true if ≤ pct.
   * When absent, verbGo uses `() => false` so grue never triggers.
   */
  readonly prob?: (pct: number) => boolean;
  /**
   * Clear the parser continuation queue (ZIL `<SETG P-CONT <>>`) — called
   * by verbGo's moved-into-dark path to stop chained commands.
   */
  readonly clearContinuation?: () => void;
  /**
   * Current carrying capacity available — ZIL LOAD-ALLOWED (gglobals.zil:94).
   * Starts at 100; reduced by combat wounds, restored by I-CURE.
   * verbTake gates pickups unless the item is inside a held container (grandparent==player).
   */
  readonly loadAllowed?: number;
  /**
   * Maximum carrying capacity — ZIL LOAD-MAX (gglobals.zil:92).
   * Used to detect whether the player is wounded (loadAllowed < loadMax)
   * and choose the "especially in light of your condition" suffix.
   */
  readonly loadMax?: number;
  /**
   * Player pStrength (ZIL P-STRENGTH analog, 1actions.zil:3993).
   * 0 = healthy; negative = wounded (magnitude = wound depth).
   * Read by verbDiagnose; defaults to 0 (healthy) when absent.
   */
  readonly playerPStrength?: number;
  /** Whether I-CURE is currently armed (ZIL C-ENABLED?, 1actions.zil:3995). */
  readonly iCureEnabled?: boolean;
  /** Remaining ticks on I-CURE (ZIL C-TICK, 1actions.zil:4012). */
  readonly iCureTick?: number;
  /**
   * HERO-BLOW entry point — wired at G1 (spec §12 G1, §6.3).
   * Called after all four V-ATTACK entry guards pass.
   * targetId: object id of the villain (PRSO); weaponId: object id of PRSI, or null.
   * Returns the VerbResult from the blow (a combat message, or a guard string on
   * pointless/staggered/unarmed paths inside heroBlow).
   */
  readonly heroBlow?: (targetId: string, weaponId: string | null) => VerbResult;
  /** DISABLE <INT id> — used by V-ODYSSEUS to stop the wrath timer. */
  readonly disableClock?: (id: string) => void;
  /** Render the end-of-game score block and set gameOver (V-QUIT / gverbs.zil:55–61 web form). */
  readonly finish?: () => void;
  /**
   * ZIL THIS-IS-IT — re-point the "it" pronoun referent to the given object.
   * verbOpen calls this when PRINT-CONTENTS reveals exactly one item
   * (gverbs.zil:1747: THIS-IS-IT at end of PRINT-CONTENTS loop).
   * Optional so test stubs that don't track pronouns can omit it.
   */
  readonly thisIsIt?: (obj: GameObject) => void;
  /**
   * Write the current game snapshot to the given slot via SavePort.
   * Slot is already canonicalized by the session layer (§4.5).
   * Throws on failure (quota/IO) so V-SAVE catches and emits Failed.
   * Absent when no SavePort is wired (test contexts without save infra).
   */
  readonly saveGame?: (slot: string) => void;
  /**
   * Read a snapshot from the given slot and restore game state.
   * Returns:
   *   - string: post-restore room description (success — emit Ok. then this)
   *   - { inVoice: string }: in-voice refusal message (corrupt/version — emit as-is)
   *   - undefined: slot was empty (emit "Failed.")
   * Absent when no SavePort is wired (emit "Failed.").
   */
  readonly restoreGame?: (slot: string) => string | { inVoice: string } | undefined;
  /**
   * Re-bootstrap the session — shell-level restart (§4.4, OQ-4).
   * Absent when no restart handler is wired.
   */
  readonly restart?: () => void;
  /**
   * Resolved save slot for V-SAVE / V-RESTORE (§4.5).
   * Pre-parsed by the session layer from the raw command ("save 2" → "2").
   * Verb bodies read this instead of hardcoding a slot; defaults to "1" when absent.
   */
  readonly saveSlot?: string;
}

export interface VerbResult {
  readonly output: string;
  readonly moved: boolean;
  /**
   * True when the verb caused a fatal outcome (e.g. grue kill via jigsUp).
   * game.ts checks this after executeVerb and skips M-END for the remaining chain.
   */
  readonly fatal?: boolean;
  /**
   * True when the player moved into a dark room (lit→dark or dark→dark without
   * grue kill). game.ts uses this to append M-ENTER after the dark-notice and
   * then run V-FIRST-LOOK (the pitch-black line) — matching ZIL GOTO order.
   */
  readonly movedIntoDark?: boolean;
}

function result(
  output: string,
  moved = false,
  fatal = false,
  movedIntoDark = false,
): VerbResult {
  return { output, moved, fatal, movedIntoDark };
}

// DESCRIBE-OBJECTS model (gverbs.zil:1681–1836): ZIL-faithful PRINT-CONT /
// DESCRIBE-OBJECT / FIRSTER algorithm. Functions emit via a `tell` callback
// rather than returning strings, matching the ZIL TELL model.

// SEE-INSIDE? (gverbs.zil:1837)
function seeInside(obj: GameObject): boolean {
  return obj.has(Flag.Transparent) || obj.has(Flag.Open);
}

// FIRSTER (gverbs.zil:1818) — print the header before the first pass-2 item.
// Rooms are skipped (no header at room level).
// WINNER (player) always prints "You are carrying:" regardless of ACTORBIT.
function firster(obj: GameObject, player: GameObject, level: number, tell: (s: string) => void): void {
  if (obj instanceof Room) return;

  const indent = level > 0 ? '  '.repeat(level) : '';

  // ZIL: EQUAL? .OBJ ,WINNER → "You are carrying:"
  if (obj === player) {
    tell(`${indent}You are carrying:`);
    return;
  }

  // ZIL: EQUAL? .OBJ ,TROPHY-CASE → "Your collection of treasures consists of:"
  if (obj.id === 'TROPHY-CASE') {
    tell(`${indent}Your collection of treasures consists of:`);
    return;
  }

  if (obj.has(Flag.Surface)) {
    tell(`${indent}On the ${obj.desc} is:`);
  } else if (obj.has(Flag.Actor)) {
    tell(`${indent}The ${obj.desc} is holding:`);
  } else {
    tell(`${indent}The ${obj.desc} contains:`);
  }
}

// DESCRIBE-OBJECT (gverbs.zil:1693)
function describeObject(
  obj: GameObject,
  player: GameObject,
  level: number,
  tell: (s: string) => void,
): void {
  if (level === 0) {
    if (obj.descFcn !== undefined) {
      // ZIL DESCFCN — replaces the generic description and returns before the
      // vehicle-suffix code (gverbs.zil:1707–1711), so descFcn objects get none.
      obj.descFcn(player, tell);
    } else {
      let line: string;
      if (!obj.has(Flag.Touched) && obj.fdesc !== undefined) {
        line = obj.fdesc;
      } else if (obj.ldesc !== undefined) {
        line = obj.ldesc;
      } else {
        // gverbs.zil:1730 — room-level "There is a X here. (providing light)"
        line = `There is a ${obj.desc} here`;
        if (obj.has(Flag.OnFire)) line += ' (providing light)';
        line += '.';
      }
      // gverbs.zil:1722–1725 — an object at room level while the player is in a
      // vehicle gets " (outside the <vehicle>)".
      const wloc = player.parent;
      if (wloc != null && wloc.has(Flag.Vehicle)) {
        line += ` (outside the ${wloc.desc})`;
      }
      tell(line);
    }
  } else {
    // gverbs.zil:1707–1715 — inventory/nested level: "  A X (providing light)"
    const indent = '  '.repeat(level);
    let line = `${indent}A ${obj.desc}`;
    if (obj.has(Flag.OnFire)) {
      line += ' (providing light)';
    } else if (obj.has(Flag.Wearable) && obj.parent === player) {
      line += ' (being worn)';
    }
    tell(line);
  }

  if (seeInside(obj) && obj.children.size > 0) {
    printCont(obj, player, level, tell);
  }
}

// PRINT-CONT (gverbs.zil:1750) — two-pass recursive container printer.
// Pass 1: untouched children with FDESC printed via their FDESC (no header).
// Pass 2: touched/no-FDESC children printed via DESCRIBE-OBJECT; first item
// triggers FIRSTER to emit the container header. NDESCBIT items are skipped
// in pass 2 but still recursed if SEE-INSIDE?.
//
// INV? (gverbs.zil:1757-1760): when container == player OR player == container's
// parent (i.e., we're listing inventory), all non-invisible items appear in pass
// 2 regardless of Touched/FDESC state.
function printCont(
  container: GameObject,
  player: GameObject,
  level: number,
  tell: (s: string) => void,
): void {
  // ZIL's children are a prepend-list (FIRST = last-defined in ZIL source).
  // JS Set is append-order, so we reverse to match ZIL iteration order.
  const children = Array.from(container.children).reverse();

  // ZIL PRINT-CONT :1753-1755 — AV = LOC(WINNER) if vehicle, else nil.
  // When player is in a vehicle and we're printing a room (the vehicle's
  // parent), the vehicle itself is skipped and its contents are shown at
  // the end via the PV? path (:1793-1795).
  const playerVehicle = (player.parent !== null &&
                         player.parent !== undefined &&
                         player.parent.has(Flag.Vehicle) &&
                         player.parent.parent === container)
    ? player.parent
    : null;
  let vehicleSeen = false;  // PV? — vehicle was encountered during iteration

  // INV? — printing the player's own inventory (or a container they're carrying).
  // ZIL: EQUAL? WINNER OBJ <LOC OBJ> — player === container OR player === container.parent.
  const inv = container === player || container.parent === player;

  // Pass 1: untouched items with an FDESC — skipped entirely in inventory context
  // (INV? overrides, making everything land in pass 2).
  if (!inv) {
    for (const child of children) {
      if (child === player) continue;
      if (child === playerVehicle) { vehicleSeen = true; continue; }
      if (child.has(Flag.Invisible)) continue;
      if (!child.has(Flag.Touched) && child.fdesc !== undefined) {
        if (!child.has(Flag.NonDescript)) {
          tell(child.fdesc);
        }
        if (seeInside(child) && child.children.size > 0) {
          printCont(child, player, level + 1, tell);
        }
      }
    }
  }

  // Pass 2: touched / no-FDESC objects (or ALL when INV?).
  let firsterFired = false;
  let currentLevel = level;

  for (const child of children) {
    if (child === player) continue;
    if (child === playerVehicle) continue;  // :1797 skip AV
    if (child.has(Flag.Invisible)) continue;
    // ZIL: <OR .INV? <FSET? .Y ,TOUCHBIT> <NOT <GETP .Y ,P?FDESC>>>
    if (!inv && !child.has(Flag.Touched) && child.fdesc !== undefined) continue;

    if (!child.has(Flag.NonDescript)) {
      // ZIL: NDESCBIT *surfaces* are "transparent" — their contents appear at the
      // parent level without a container header (e.g. kitchen table, altar, pedestal).
      // The trophy case is NonDescript+Transparent but NOT a Surface; it must keep
      // its "Your collection of treasures consists of:" FIRSTER header.
      // ZIL keys NDESCBIT on the CHILD (gverbs.zil:1802); here we key on the
      // CONTAINER being a Surface to restrict to the four true ndesc surfaces.
      const ndescContainer =
        container.has(Flag.NonDescript) &&
        container.has(Flag.Surface) &&
        !(container === player);
      if (!firsterFired && !ndescContainer) {
        firsterFired = true;
        currentLevel = level + 1;
        firster(container, player, level, tell);
      }
      // ndescContainer: items on a transparent surface appear at the room-contents
      // level (0), not at the surface's own level. level=-1 is the room pseudo-level
      // used by describeRoomObjects; level+1 gives the correct room-contents indent.
      describeObject(child, player, ndescContainer ? Math.max(0, level + 1) : currentLevel, tell);
    } else {
      if (seeInside(child) && child.children.size > 0) {
        printCont(child, player, level, tell);
      }
    }
  }

  // ZIL PRINT-CONT :1793-1795 — PV? path: after room items, show vehicle contents.
  if (vehicleSeen && playerVehicle !== null && playerVehicle.children.size > 0) {
    printCont(playerVehicle, player, level + 1, tell);
  }
}

// DESCRIBE-OBJECTS (gverbs.zil:1681) — calls PRINT-CONT on HERE at level −1.
// Exported so game.ts can call it from describeCurrentRoom().
export function describeRoomObjects(
  room: Room,
  player: GameObject,
  tell: (s: string) => void,
): void {
  if (Array.from(room.children).some(c => c !== player && !c.has(Flag.Invisible))) {
    printCont(room, player, -1, tell);
  }
}

// DESCRIBE-VEHICLE-OBJECTS — show the contents of a vehicle the player is
// riding in (gverbs.zil:1649-1679 V-LOOK vehicle path).
// Calls PRINT-CONT at level=0 so items inside the vehicle are indented
// as "  A <desc>" (level 1) with header "The <vehicle> contains:".
// Exported so game.ts can call it from describeCurrentRoom().
export function describeVehicleObjects(
  vehicle: GameObject,
  player: GameObject,
  tell: (s: string) => void,
): void {
  if (vehicle.children.size > 0) {
    printCont(vehicle, player, 0, tell);
  }
}

/**
 * DESCRIBE-ROOM faithful port — gverbs.zil:1635–1679 (Zork I branches).
 *
 * Shared by both the verb path (verbLook/verbGo) and the engine path
 * (describeCurrentRoom/runMLook in game.ts) so both stay byte-identical.
 *
 * lookFlag (LOOK? param): true for explicit LOOK and first-look semantics;
 * false for movement arrivals. V? = lookFlag OR VERBOSE-global.
 *
 * Side effects on room: sets Flag.Touched on first visit; maze rooms clear
 * it again so they always force-verbose (gverbs.zil:1653–1655).
 */
export function describeRoomShared(
  room: Room,
  player: GameObject,
  lookFlag: boolean,
  mlookRunner?: (r: Room) => string,
  world?: World,
  getGlobal?: (name: string) => boolean,
  alwaysLit?: boolean,
): string {
  // gverbs.zil:1636 — V? = LOOK? OR VERBOSE
  let vFlag = lookFlag || (getGlobal?.('VERBOSE') ?? false);

  // gverbs.zil:1637-1649 — darkness gate (RFALSE path)
  if (world !== undefined && !(alwaysLit ?? false) && !lit(room, player, world)) {
    const sprayed = getGlobal?.('SPRAYED?') ?? false;
    return sprayed ? describeRoomMsgs.darkSprayed : describeRoomMsgs.darkNoSpray;
  }

  // gverbs.zil:1650-1652 — TOUCHBIT: set on first visit, force V?=true
  if (!room.has(Flag.Touched)) {
    room.set(Flag.Touched);
    vFlag = true;
  }

  // gverbs.zil:1653-1655 — Zork I: maze rooms clear TOUCHBIT so every
  // arrival is forced-verbose (maze rooms have no stable ldesc).
  if (room.has(Flag.Maze)) {
    room.clear(Flag.Touched);
  }

  // gverbs.zil:1658-1663 — room title line (always printed, outside the V? gate).
  // When player is in a vehicle: "<room>, in the <vehicle>".
  const vehicle = (player.parent !== null && player.parent !== undefined &&
                   !(player.parent instanceof Room) &&
                   player.parent.has(Flag.Vehicle))
    ? player.parent
    : null;

  const lines: string[] = [
    vehicle !== null ? `${room.desc}, in the ${vehicle.desc}` : room.desc,
  ];

  // gverbs.zil:1664-1667 — SUPER-BRIEF body gate.
  // The M-LOOK/LDESC block only runs when LOOK? OR NOT SUPER-BRIEF.
  // V-FIRST-LOOK (gverbs.zil:1632) gates DESCRIBE-OBJECTS the same way:
  // objects are suppressed when NOT SUPER-BRIEF fails, so title-only here.
  const superBrief = getGlobal?.('SUPER-BRIEF') ?? false;
  if (!lookFlag && superBrief) {
    return lines.join('\n');
  }

  // gverbs.zil:1671-1676 — THE PRECEDENCE FLIP (handler-wins-with-ldesc-fallback).
  // ZIL Zork I: M-LOOK first; if it emits output, done. Otherwise ldesc; otherwise M-FLASH.
  if (vFlag) {
    if (mlookRunner !== undefined) {
      const handlerOut = mlookRunner(room);
      if (handlerOut.length > 0) {
        lines.push(handlerOut);
        // gverbs.zil:1677-1678 — vehicle M-LOOK (if player is in vehicle)
        describeRoomObjects(room, player, (s) => lines.push(s));
        return lines.join('\n');
      }
    }
    if (room.ldesc) {
      lines.push(room.ldesc);
    }
    // else M-FLASH — no-op in Zork I for most rooms
  }
  // V?=false (touched, brief, no explicit look): body skipped — title-only

  // gverbs.zil:1681-1684 — DESCRIBE-OBJECTS always runs after
  describeRoomObjects(room, player, (s) => lines.push(s));
  return lines.join('\n');
}

function describeRoom(
  room: Room,
  player: GameObject,
  lookFlag: boolean,
  mlookRunner?: (r: Room) => string,
  world?: World,
  getGlobal?: (name: string) => boolean,
  alwaysLit?: boolean,
): string {
  return describeRoomShared(room, player, lookFlag, mlookRunner, world, getGlobal, alwaysLit);
}

function verbLook(ctx: VerbContext): VerbResult {
  return result(describeRoom(ctx.here, ctx.player, /*lookFlag*/true, ctx.mlookRunner, ctx.world, ctx.getGlobal, ctx.alwaysLit));
}

// Map ZIL VTYPE prop string to the Flag it names.  Only NONLANDBIT is used in
// Zork I (the magic boat); RLANDBIT would name a land-vehicle (none in Zork I).
// gverbs.zil:2051 <SET AV <GETP .WLOC ,P?VTYPE>>
const VTYPE_FLAG: Record<string, Flag> = {
  NONLANDBIT: Flag.NonLand,
  RLANDBIT:   Flag.Land,
};

function verbGo(ctx: VerbContext): VerbResult {
  const dir = ctx.prep;
  if (!dir) return result("Go where?");

  const exit = ctx.here.exits.find(e => e.dir === dir);

  if (!exit) {
    // V-WALK no-exit fallthrough (gverbs.zil:1562–1580).
    // Before "You can't go that way.", ZIL checks dark + PROB 80 for grue death.
    const prob = ctx.prob ?? (() => false);
    const roomLit = (ctx.alwaysLit ?? false) || lit(ctx.here, ctx.player, ctx.world);
    if (!roomLit && !ctx.here.has(Flag.NonLand) && prob(80)) {
      if (ctx.getGlobal?.('SPRAYED?')) {
        return result(vWalk.grueSpray, /*moved*/false, /*fatal*/true);
      }
      ctx.jigsUp?.(vWalk.grueNoSpray);
      return result('', /*moved*/false, /*fatal*/true);
    }
    return result(vWalk.cantGoThatWay, /*moved*/false, /*fatal*/true);
  }

  const prob = ctx.prob ?? (() => false);  // used in enterDest (GOTO grue gate)

  // ZIL GOTO vehicle interlock (gverbs.zil:2045–2088).
  // WLOC = LOC(WINNER): the player's immediate container (vehicle or room).
  // AV = WLOC's VTYPE flag, or undefined when on foot.
  const wloc = ctx.player.parent;
  const inVehicle = wloc !== null && wloc !== undefined && wloc.has(Flag.Vehicle);
  const vtypeStr = inVehicle ? (wloc!.props.get('VTYPE') as string | undefined) : undefined;
  const av: Flag | undefined = vtypeStr !== undefined ? VTYPE_FLAG[vtypeStr] : undefined;

  // ZIL GOTO (gverbs.zil:2048-2120): capture OLIT before the move, recompute
  // LIT after. Grue gate fires only on dark→dark (both rooms unlit).
  //
  // When in a vehicle: move the vehicle to dest (gverbs.zil:2090 <MOVE .WLOC .RM>),
  // not the player.  The player stays inside the vehicle.
  const enterDest = (dest: Room): VerbResult => {
    const oldLit = (ctx.alwaysLit ?? false) || lit(ctx.here, ctx.player, ctx.world);
    const fromLand = ctx.here.has(Flag.Land);
    const toLand   = dest.has(Flag.Land);

    // Landing message: boat leaves water and comes to rest on shore.
    // gverbs.zil:2071–2077: LB && !HERE.RLANDBIT && !DEAD && WLOC.VEHBIT.
    let landingMsg = '';
    if (toLand && !fromLand && inVehicle) {
      landingMsg = `The ${wloc!.desc} comes to a rest on the shore.`;
    }

    if (inVehicle) {
      // Move vehicle (wloc) to destination; player remains inside it.
      wloc!.moveTo(dest);
    } else {
      ctx.player.moveTo(dest);
    }

    const newLit = (ctx.alwaysLit ?? false) || lit(dest, ctx.player, ctx.world);

    // Grue gate (gverbs.zil:2095-2116): dark→dark, non-NonLand room, PROB 80.
    if (!oldLit && !newLit && !dest.has(Flag.NonLand) && prob(80)) {
      if (ctx.getGlobal?.('SPRAYED?')) {
        return result(goto.sinisterDark, true);
      }
      ctx.jigsUp?.(goto.grueSlitherRoom);
      return result('', /*moved*/true, /*fatal*/true);
    }

    // Moved into dark (gverbs.zil:2117-2120): signals game.ts to append
    // M-ENTER after the notice then run V-FIRST-LOOK (pitch-black line).
    if (!newLit) {
      ctx.clearContinuation?.();
      return result(goto.darkPlaceEntered, true, false, /*movedIntoDark*/true);
    }

    // Movement arrival — lookFlag=false: brief mode when room already touched.
    const roomDesc = describeRoom(dest, ctx.player, /*lookFlag*/false, ctx.mlookRunner, ctx.world, ctx.getGlobal, ctx.alwaysLit);
    const parts = [landingMsg, roomDesc].filter(s => s.length > 0);
    return result(parts.join('\n'), true);
  };

  // -------------------------------------------------------------------------
  // Resolve destination first (for vehicle rejection checks we need to know
  // the dest's flags, which requires the destination object).
  // per exits are resolved below; for plain exits resolve here for the checks.
  // -------------------------------------------------------------------------

  // Helper: emit NO-GO-TELL (gverbs.zil:2038–2043).
  // With AV: "You can't go there in a <vehicle>."
  // Without: "You can't go there without a vehicle."
  const noGoTell = (): VerbResult => {
    const msg = inVehicle && wloc !== null && wloc !== undefined
      ? `You can't go there in a ${wloc.desc}.`
      : "You can't go there without a vehicle.";
    return result(msg, /*moved*/false, /*fatal*/true);
  };

  if (exit.per !== undefined) {
    const resolver = ctx.perResolver;
    if (resolver !== undefined) {
      const destId = resolver(exit.per, ctx.here);
      if (destId !== undefined) {
        const dest = ctx.world.get(destId);
        if (dest !== undefined) {
          return enterDest(dest as Room);
        }
        return result("You can't go that way.", /*moved*/false, /*fatal*/true);
      }
      // A resolver that declines the move has already said why (RFALSE in ZIL);
      // don't pile a generic refusal on top of its own message.
      return result('', /*moved*/false, /*fatal*/true);
    }
    if (exit.to === undefined) {
      return result(exit.elseMessage ?? "You can't go that way.", /*moved*/false, /*fatal*/true);
    }
  }

  // ifFlag: object-backed gate (OPENBIT) or ZIL global (FlagStore).
  // 1actions.zil ifFlag checks; gverbs.zil globals.
  if (exit.ifFlag !== undefined) {
    const gateObj = ctx.world.get(exit.ifFlag);
    const open = gateObj !== undefined
      ? gateObj.has(Flag.Open)
      : (ctx.getGlobal?.(exit.ifFlag) ?? false);
    if (!open) {
      return result(exit.elseMessage ?? "You can't go that way.", /*moved*/false, /*fatal*/true);
    }
  }

  if (exit.to === undefined) {
    return result(exit.elseMessage ?? "You can't go that way.", /*moved*/false, /*fatal*/true);
  }

  const dest = ctx.world.get(exit.to);
  if (dest === undefined) {
    return result("You can't go that way.", /*moved*/false, /*fatal*/true);
  }

  const destRoom = dest as Room;
  const lb = destRoom.has(Flag.Land);  // dest is RLANDBIT
  const destIsWater = destRoom.has(Flag.NonLand);  // dest is NONLANDBIT

  // GOTO vehicle rejection clauses (gverbs.zil:2052–2066).
  // In real Zork I every room has either RLANDBIT or NONLANDBIT; clause 1 is
  // equivalent to "dest is a water room AND on foot".  Test fixtures may omit
  // RLANDBIT on synthetic land rooms, so we key on NONLANDBIT directly — the
  // semantics are identical for any room that matches real-game data.
  // gverbs.zil:2052–2055: (<AND <NOT .LB> <NOT .AV>> ...)
  if (destIsWater && av === undefined) return noGoTell();

  // Clause 2: in vehicle, dest not land AND dest lacks the vehicle's terrain type.
  // gverbs.zil:2056–2058: (<AND <NOT .LB> <NOT <FSET? .RM .AV>>> ...)
  if (!lb && av !== undefined && !destRoom.has(av)) return noGoTell();

  // Clause 3: in water-vehicle on land, dest is land, dest lacks NONLANDBIT.
  // Prevents a beached water-vehicle from walking to another land room.
  // gverbs.zil:2060–2066: HERE.RLANDBIT && LB && AV && AV!=RLANDBIT && !FSET? RM .AV
  if (
    ctx.here.has(Flag.Land) && lb &&
    av !== undefined && av !== Flag.Land &&
    !destRoom.has(av)
  ) {
    return noGoTell();
  }

  return enterDest(destRoom);
}

// WEIGHT — gverbs.zil:1988: SIZE(obj) + recursive sum over all children.
// ZIL <PROPDEF SIZE 5> (zork1.zil:24) makes GETP P?SIZE return 5 when the
// property is absent — NOT 0.  Use 5 as the fallback to match ZIL semantics.
function weight(obj: GameObject): number {
  const size = (obj.props.get('SIZE') as number | undefined) ?? 5;
  let w = size;
  for (const child of obj.children) {
    w += weight(child);
  }
  return w;
}

function verbTake(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Take what?");

  // PRE-TAKE: PRSO IN? WINNER (gverbs.zil:1356, 1358)
  if (item.parent === ctx.player) {
    if (item.has(Flag.Wearable)) {
      return result(preTake.alreadyWearing);
    }
    return result(preTake.alreadyHaveIt);
  }

  // ITAKE: if not TAKEBIT, PICK-ONE from YUKS table (gverbs.zil:1913)
  if (!item.has(Flag.Takeable)) {
    const rng = ctx.rng;
    return result(rng !== undefined ? pick(yuks, rng) : yuks.entries[0]!);
  }

  // LOAD-ALLOWED capacity check — gverbs.zil:1931–1940.
  // ZIL: <NOT <IN? <LOC ,PRSO> ,WINNER>> — grandparent check.
  // Skips the gate when parent(parent(item)) == player (item inside a held container).
  const loadAllowed = ctx.loadAllowed;
  if (loadAllowed !== undefined && item.parent?.parent !== ctx.player) {
    const itemWeight   = weight(item);
    const playerWeight = weight(ctx.player);
    if (itemWeight + playerWeight > loadAllowed) {
      const loadMax = ctx.loadMax ?? loadAllowed;
      const suffix  = loadAllowed < loadMax
        ? ', especially in light of your condition.'
        : '.';
      return result(`Your load is too heavy${suffix}`, false, /*fatal*/ true);
    }
  }

  item.moveTo(ctx.player);
  // gverbs.zil:1949–1950 — retire the FDESC and mark as touched.
  item.clear(Flag.NonDescript);
  item.set(Flag.Touched);

  // SCORE-OBJ: award one-time pickup VALUE and zero it (gverbs.zil:1959–1963).
  if (ctx.scoreObj !== undefined) {
    ctx.scoreObj(item);
  }

  return result('Taken.');
}

function verbDrop(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Drop what?");

  if (item.parent !== ctx.player) {
    return result(`You're not carrying the ${item.desc}.`);
  }

  item.moveTo(ctx.here);
  return result('Dropped.');
}

function verbOpen(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Open what?");

  // Already open — gverbs.zil:970 "It is already open."
  if (item.has(Flag.Open)) {
    return result(vOpen.alreadyOpen);
  }

  // Not openable (neither CONTBIT nor DOORBIT) — gverbs.zil:993–994
  if (!item.has(Flag.Container) && !item.has(Flag.Door)) {
    return result(fmt(vOpen.notOpenable, item.desc));
  }

  item.set(Flag.Open);
  item.set(Flag.Touched); // gverbs.zil:973

  if (item.has(Flag.Door)) {
    return result(fmt(vOpen.opens, item.desc)); // gverbs.zil:980
  }

  // CONTBIT path (gverbs.zil:974-985)
  // ZIL children are a prepend-list (FIRST? = last-defined in source).
  // Reverse so the listing order matches dfrotz / ZIL iteration order.
  const contents = Array.from(item.children).reverse().filter(c => !c.has(Flag.Invisible));

  if (contents.length === 0 || item.has(Flag.Transparent)) {
    return result(vOpen.opened);
  }

  // Single untouched child with FDESC (gverbs.zil:976-981)
  if (contents.length === 1) {
    const child = contents[0]!;
    if (!child.has(Flag.Touched) && child.fdesc !== undefined) {
      return result(`${fmt(vOpen.opens, item.desc)}\n${child.fdesc}`);
    }
  }

  const articled = contents.map(c => `a ${c.desc}`);
  let contentStr: string;
  if (articled.length === 1) {
    contentStr = articled[0]!;
    // PRINT-CONTENTS (gverbs.zil:1747): single-item reveal binds IT to that item.
    ctx.thisIsIt?.(contents[0]!);
  } else {
    const last = articled[articled.length - 1];
    const rest = articled.slice(0, -1);
    contentStr = rest.join(', ') + ', and ' + last;
    // ZIL TWO? clears IT? when 2+ items — no rebind.
  }
  return result(fmt(vOpen.opensRevealing, item.desc, contentStr));
}

function verbClose(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Close what?");

  // Not closeable (neither CONTBIT nor DOORBIT) — gverbs.zil:357
  if (!item.has(Flag.Container) && !item.has(Flag.Door)) {
    return result(fmt(vClose.notOpenable, item.desc));
  }

  // Already closed — gverbs.zil:349, 355 "It is already closed."
  if (!item.has(Flag.Open)) {
    return result(vClose.alreadyClosed);
  }

  item.clear(Flag.Open);

  if (item.has(Flag.Door)) {
    return result(fmt(vClose.doorClosed, item.desc)); // gverbs.zil:353
  }

  return result(vClose.closed); // gverbs.zil:344
}

function verbRead(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Read what?");

  // Not READBIT — gverbs.zil:1145 "How does one read a [PRSO]?"
  if (!item.has(Flag.Readable)) {
    return result(fmt(vRead.notReadable, item.desc));
  }

  // Extractor stores 'TEXT' (upper-case per ZIL convention); also accept
  // lowercase so test fixtures without a full extractor pass work.
  const text = item.props.get('TEXT') ?? item.props.get('text');
  if (typeof text === 'string') return result(text);
  if (item.ldesc) return result(item.ldesc);
  return result(fmt(vRead.notReadable, item.desc));
}

function verbInventory(ctx: VerbContext): VerbResult {
  // ZIL V-INVENTORY (gverbs.zil:29-31): <FIRST? ,WINNER> → PRINT-CONT, else empty-handed.
  const visibleItems = Array.from(ctx.player.children).filter(c => !c.has(Flag.Invisible));
  if (visibleItems.length === 0) {
    return result("You are empty-handed.");
  }

  const lines: string[] = [];
  printCont(ctx.player, ctx.player, 0, (s) => lines.push(s));
  return result(lines.join('\n'));
}

// V-LOOK-INSIDE core — gverbs.zil:865-890.
// Shared by verbExamine (container/door branch), verbLookOn (SURFACEBIT),
// and verbLookInsideAction (V-LOOK-INSIDE dispatch).
function verbLookInsideImpl(item: GameObject, ctx: VerbContext): VerbResult {
  if (item.has(Flag.Door)) {
    return item.has(Flag.Open)
      ? result(fmt(vLookInside.doorOpen, item.desc))
      : result(fmt(vLookInside.doorClosed, item.desc));
  }
  if (item.has(Flag.Actor)) return result(vLookInside.nothingSpecialInside);
  if (seeInside(item)) {
    const lines: string[] = [];
    // Surfaces sit at room depth → level -1 matches DESCRIBE-OBJECTS indentation.
    const level = item.has(Flag.Surface) ? -1 : 0;
    printCont(item, ctx.player, level, (s) => lines.push(s));
    if (lines.length === 0) return result(fmt(vLookInside.containerEmpty, item.desc));
    return result(lines.join('\n'));
  }
  return result(fmt(vLookInside.containerClosed, item.desc));
}

function verbExamine(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Examine what?");

  // V-EXAMINE priority (gverbs.zil:623–630): TEXT prop, then ldesc, then container/door state, then fallback.
  const text = item.props.get('TEXT') ?? item.props.get('text');
  if (typeof text === 'string') return result(text);
  if (item.ldesc !== undefined) return result(item.ldesc);

  if (item.has(Flag.Container) || item.has(Flag.Door)) {
    return verbLookInsideImpl(item, ctx);
  }

  return result(fmt(vExamine.nothingSpecial, item.desc));
}

// V-ADVENT — xyzzy / plugh easter egg (gverbs.zil:153–154)
function verbAdvent(_ctx: VerbContext): VerbResult {
  return result(vAdvent.response);
}

// V-FROBOZZ — frobozz easter egg (gverbs.zil:704–706)
function verbFrobozz(_ctx: VerbContext): VerbResult {
  return result(vFrobozz.response);
}

// V-LOOK-INSIDE — gverbs.zil:865-890.
// Full dispatch: door / container / else "You can't look inside a <x>."
// Called when no object action handler intercepts the V-LOOK-INSIDE action.
function verbLookInsideAction(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Look inside what?");
  if (item.has(Flag.Door) || item.has(Flag.Container)) {
    return verbLookInsideImpl(item, ctx);
  }
  return result(fmt(vLookInside.cantLookInside, item.desc));
}

// V-LOOK-UNDER — gverbs.zil:899-900. Unconditional "dust" response.
function verbLookUnder(_ctx: VerbContext): VerbResult {
  return result(vLookUnder.response);
}

// V-LOOK-BEHIND — gverbs.zil:862-863. Names the direct object.
function verbLookBehind(ctx: VerbContext): VerbResult {
  const desc = ctx.dobj?.desc ?? 'that';
  return result(fmt(vLookBehind.response, desc));
}

// V-LOOK-ON — gverbs.zil:892-897.
// SURFACEBIT → delegate to look-inside; else "Look on a <desc>???".
function verbLookOn(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item !== undefined && item.has(Flag.Surface)) {
    return verbLookInsideImpl(item, ctx);
  }
  const desc = item?.desc ?? 'that';
  return result(fmt(vLookOn.notASurface, desc));
}

function verbPut(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  const container = ctx.iobj;

  if (item === undefined) return result("Put what?");
  if (container === undefined) return result("Put it where?");

  // Gate: NOT (OPENBIT OR OPENABLE? OR VEHBIT) → "You can't do that." (gverbs.zil:1088–1091)
  // OPENABLE? = has CONTBIT or DOORBIT.
  const canReceive = container.has(Flag.Open) ||
                     container.has(Flag.Container) ||
                     container.has(Flag.Door) ||
                     container.has(Flag.Vehicle);
  if (!canReceive) {
    return result(vPut.cantDoThat);
  }

  // Openable/vehicle but not yet open → "The X isn't open." (gverbs.zil:1092–1094)
  if (!container.has(Flag.Open)) {
    ctx.thisIsIt?.(container);
    return result(fmt(vPut.notOpen, container.desc));
  }

  // Self-containment (gverbs.zil:1096)
  if (item === container) {
    return result(vPut.how);
  }

  // Already inside (gverbs.zil:1098)
  if (item.parent === container) {
    return result(fmt(vPut.alreadyIn, item.desc, container.desc));
  }

  // Capacity: (WEIGHT(PRSI) + WEIGHT(PRSO) - SIZE(PRSI)) > CAPACITY(PRSI) (gverbs.zil:1099–1102)
  const capacity = (container.props.get('CAPACITY') as number | undefined) ?? 0;
  const containerSize = (container.props.get('SIZE') as number | undefined) ?? 5;
  if (weight(container) + weight(item) - containerSize > capacity) {
    return result(vPut.noRoom);
  }

  // Not HELD? (gverbs.zil:1105–1110) — simplified: reject if not in player's hands
  if (item.parent !== ctx.player) {
    return result(fmt(preGive.notHoldingIt, item.desc));
  }

  item.moveTo(container);
  item.set(Flag.Touched);          // FSET TOUCHBIT (gverbs.zil:1112)
  ctx.scoreObj?.(item);            // SCORE-OBJ (gverbs.zil:1113)
  return result(vPut.done);
}

// V-PUT-ON (gverbs.zil:1120–1128) — "put X on Y".
// Requires PRSI to have SURFACEBIT; otherwise "There's no good surface on the <obj>."
function verbPutOn(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  const surface = ctx.iobj;

  if (item === undefined) return result("Put what?");
  if (surface === undefined) return result("Put it where?");

  if (item.parent !== ctx.player) {
    return result(fmt(preGive.notHoldingIt, item.desc));
  }

  if (!surface.has(Flag.Surface)) {
    return result(fmt(vPutOn.noSurface, surface.desc));
  }

  if (!surface.has(Flag.Open)) {
    return result(fmt(vPut.notOpen, surface.desc));
  }

  item.moveTo(surface);
  return result(vPut.done);
}

// V-VERBOSE (gverbs.zil:13–16) — SETG VERBOSE T, SETG SUPER-BRIEF <>, print the string.
function verbVerbose(ctx: VerbContext): VerbResult {
  ctx.setGlobal?.('VERBOSE', true);
  ctx.setGlobal?.('SUPER-BRIEF', false);
  return result(vVerbose.response);
}

// V-BRIEF (gverbs.zil:18–21) — SETG VERBOSE <>, SETG SUPER-BRIEF <>, print the string.
function verbBrief(ctx: VerbContext): VerbResult {
  ctx.setGlobal?.('VERBOSE', false);
  ctx.setGlobal?.('SUPER-BRIEF', false);
  return result(vBrief.response);
}

// V-SUPER-BRIEF (gverbs.zil:23–25) — SETG SUPER-BRIEF T, print the string.
function verbSuperBrief(ctx: VerbContext): VerbResult {
  ctx.setGlobal?.('SUPER-BRIEF', true);
  return result(vSuperBrief.response);
}

// V-VERSION (gverbs.zil:99–121) — the full Zork I banner.
// Release/Serial pinned to 88/840726 (OQ-5) — dfrotz emits R119 but the
// golden encodes the pinned divergence, so we hardcode rather than read
// the Z-machine header.
function verbVersion(_ctx: VerbContext): VerbResult {
  return result(vVersion.banner);
}

// V-SCRIPT (gverbs.zil:86–90) — prints the transcript header + version banner.
// The DIROUT/PUT-0-8 bit is a Z-machine output-stream op with no web equivalent;
// dropped here. RTRUE.
function verbScript(_ctx: VerbContext): VerbResult {
  return result(`${vScript.header}\n${vVersion.banner}`);
}

// V-QUIT (gverbs.zil:55–61) — web form: render score + set gameOver.
// No Y/N prompt (RESTART/RESTORE deferred per spec §1).
function verbQuit(ctx: VerbContext): VerbResult {
  ctx.finish?.();
  return result('');
}

// V-SAVE (gverbs.zil:78–82) — write snapshot to SavePort.
// Text is byte-exact: Ok. on success, Failed. on any write failure (§4.2, FD-2).
// Slot is pre-resolved by the session layer (§4.5); defaults to "1" when absent.
function verbSave(ctx: VerbContext): VerbResult {
  if (!ctx.saveGame) return result('Failed.');
  const slot = ctx.saveSlot ?? '1';
  try {
    ctx.saveGame(slot);
    return result('Ok.');
  } catch {
    return result('Failed.');
  }
}

// V-RESTORE (gverbs.zil:71–76) — read snapshot from SavePort, restore, re-describe.
// Ok. + room re-describe on success; Failed. when slot is empty (§4.3, FD-2, OQ-3);
// in-voice message for corrupt/version (§5.3, OQ-3) — never "Failed." for those.
// Slot is pre-resolved by the session layer (§4.5); defaults to "1" when absent.
function verbRestore(ctx: VerbContext): VerbResult {
  if (!ctx.restoreGame) return result('Failed.');
  const slot = ctx.saveSlot ?? '1';
  const r = ctx.restoreGame(slot);
  if (r === undefined) return result('Failed.');
  if (typeof r === 'object') return result(r.inVoice);
  // string: success — Ok. then V-FIRST-LOOK room description
  return result(`Ok.\n${r}`);
}

// V-RESTART (gverbs.zil:63–69, web-adapted) — delegate to shell-level restart (§4.4, OQ-4).
// No synchronous Y/N prompt; shell drives confirmation. Prints nothing here — the
// session restart replaces the output entirely.
function verbRestart(ctx: VerbContext): VerbResult {
  ctx.restart?.();
  return result('');
}

// V-SCORE (1actions.zil:4026–4044)
// Plural rule (1actions.zil:4032): MOVES==1 → "move", else "moves".
function verbScore(ctx: VerbContext): VerbResult {
  const score  = ctx.score  ?? 0;
  const moves  = ctx.moves  ?? 0;
  const rank   = ctx.rank  !== undefined ? ctx.rank() : 'Beginner';

  const movePart = moves === 1 ? '1 move.' : `${moves} moves.`;
  const line1 = `Your score is ${score} (total of 350 points), in ${movePart}`;
  const line2 = `This gives you the rank of ${rank}.`;

  return result(`${line1}\n${line2}`);
}

// V-DIAGNOSE (1actions.zil:3993–4025)
//
// CB6 audit result — all lines match ZIL except one documented divergence:
//   ZIL survival COND: <0? .RS> → "expect death soon"
//   We use: rs <= 0 → "expect death soon"
//   ZIL gap: RS < 0 has no COND branch → would emit "You can ." (blank desc).
//   Intent-faithful fix: treat RS <= 0 as "expect death soon". Not reverted.
//
// FIGHT-STRENGTH base = 2 + floor(SCORE/70) (1actions.zil:3375–3381).
// WD / RS follow the ZIL exactly:
//   MS = FIGHT-STRENGTH(false) — base only
//   WD = player pStrength  (raw, still negative at this point)
//   RS = MS + WD           (so wounds lower RS — ZIL: <+ .MS .WD>)
//   if !C-ENABLED?: WD = 0   else: WD = -WD  (negate to positive wound depth)
// Cured-after: CURE_WAIT*(WD-1) + C-TICK  (1actions.zil:4008–4010)
function verbDiagnose(ctx: VerbContext): VerbResult {
  const deaths = ctx.deaths          ?? 0;
  const score  = ctx.score           ?? 0;
  const rawPs  = ctx.playerPStrength ?? 0;
  const cureOn = ctx.iCureEnabled    ?? false;
  const cureTick = ctx.iCureTick     ?? 0;

  const ms = 2 + Math.floor(score / 70);
  const rs = ms + rawPs;                      // RS = MS + pStrength (1actions.zil:3994)

  // WD: 0 when I-CURE is disabled; positive wound depth when armed.
  const wd = cureOn ? -rawPs : 0;             // 1actions.zil:3996–3997

  const lines: string[] = [];

  if (wd === 0) {
    lines.push('You are in perfect health.');
  } else {
    const woundDesc =
      wd === 1 ? 'a light wound,' :
      wd === 2 ? 'a serious wound,' :
      wd === 3 ? 'several wounds,' :
      /* wd>3 */ 'serious wounds,';
    const curedAfter = CURE_WAIT * (wd - 1) + cureTick;  // 1actions.zil:4008–4010
    lines.push(`You have ${woundDesc} which will be cured after ${curedAfter} moves.`);
  }

  // ZIL: <0? .RS> → "expect death soon"; RS<0 has no branch (gap — emits "You can .").
  // We guard rs<=0 to cover the RS<0 case faithfully (see CB6 audit note above).
  const survDesc =
    rs <= 0 ? 'expect death soon' :
    rs === 1 ? 'be killed by one more light wound' :
    rs === 2 ? 'be killed by a serious wound' :
    rs === 3 ? 'survive one serious wound' :
    /* rs>3 */ 'survive several wounds';
  lines.push(`You can ${survDesc}.`);

  if (deaths > 0) {
    const timesStr = deaths === 1 ? 'once' : 'twice';
    lines.push(`You have been killed ${timesStr}.`);
  }

  return result(lines.join('\n'));
}

// V-PRAY — gverbs.zil:1046–1054.
// Outside ghost mode: at SOUTH-TEMPLE → GOTO FOREST-1; elsewhere → "If you pray enough".
// Ghost-mode PRAY is handled by ghostDispatch in game.ts before this is reached.
function verbPray(ctx: VerbContext): VerbResult {
  if (ctx.here.id === 'SOUTH-TEMPLE') {
    const forest1 = ctx.world.get('FOREST-1');
    if (forest1 !== undefined) ctx.player.moveTo(forest1);
    return { output: '', moved: true };
  }
  return result('If you pray enough, your prayers may be answered.');
}

// V-ATTACK entry guards — gverbs.zil:176–193.
//
// Guard order (ZIL COND):
//   1. !ACTORBIT(PRSO)          → not a creature
//   2. !PRSI || PRSI==HANDS     → bare hands
//   3. !IN?(PRSI, WINNER)       → not holding the weapon
//   4. !WEAPONBIT(PRSI)         → not a weapon
//   5. T                        → heroBlow (ctx.heroBlow callback)
//
// Exported so CB7 tests can call it directly.  Registered as 'V-ATTACK'.
export function verbAttack(ctx: VerbContext): VerbResult {
  const target = ctx.dobj;
  const weapon = ctx.iobj;

  if (target === undefined) return result("Attack what?");

  // Guard 1 — target must be an actor (gverbs.zil:177–179)
  if (!target.has(Flag.Actor)) {
    return result(`I've known strange people, but fighting a ${target.desc}?`);
  }

  // Guard 2 — must have a non-HANDS weapon (gverbs.zil:180–183)
  const hands = ctx.world.get('HANDS');
  if (weapon === undefined || weapon === hands) {
    return result(`Trying to attack a ${target.desc} with your bare hands is suicidal.`);
  }

  // Guard 3 — must be holding the weapon (gverbs.zil:184–185)
  if (weapon.parent !== ctx.player) {
    return result(`You aren't even holding the ${weapon.desc}.`);
  }

  // Guard 4 — weapon must have WEAPONBIT (gverbs.zil:186–188)
  if (!weapon.has(Flag.Weapon)) {
    return result(`Trying to attack the ${target.desc} with a ${weapon.desc} is suicidal.`);
  }

  // Guard 5 — all guards passed; delegate to heroBlow (gverbs.zil:189–193)
  if (ctx.heroBlow !== undefined) {
    return ctx.heroBlow(target.id, weapon.id);
  }
  return result("You can't.");
}

// ---------------------------------------------------------------------------
// Phase-3 dam/river verb shells
//
// ZIL default verb routines (V-INFLATE, V-DEFLATE, V-DIG, etc.) are mostly
// fall-throughs — real behavior lives in the object ACTION handlers (IBOAT-FUNCTION,
// RBOAT-FUNCTION, SAND-FUNCTION, etc.) invoked earlier in the PERFORM chain.
// These stubs ensure the verbs are routed rather than hitting the unknown-verb
// fallback; the object handlers in later tasks short-circuit before these fire.
// ---------------------------------------------------------------------------

// V-INFLATE (gverbs.zil:757-758) — fall-through when no object handler claims inflate.
function verbInflate(_ctx: VerbContext): VerbResult {
  return result(vInflate.response);
}

// V-DEFLATE (gverbs.zil:402-403) — fall-through.
function verbDeflate(_ctx: VerbContext): VerbResult {
  return result(vDeflate.response);
}

// V-BOARD (gverbs.zil:224–228) — board a vehicle.
// PRE-BOARD (already run) has verified PRSO is a vehicle in the room and
// the player is not already in one.  V-BOARD moves the player inside.
// RBOAT-FUNCTION's BOARD branch intercepts first and returns T to abort
// V-BOARD (sharp-object puncture); returning false here lets V-BOARD run.
function verbBoard(ctx: VerbContext): VerbResult {
  const vehicle = ctx.dobj;
  if (vehicle === undefined || !vehicle.has(Flag.Vehicle)) {
    return result("You can't board that.");
  }
  // :225 <TELL "You are now in the " D ,PRSO "." CR>
  // :226 <MOVE ,WINNER ,PRSO>
  ctx.player.moveTo(vehicle);
  return result(`You are now in the ${vehicle.desc}.`, /*moved*/true);
}

// V-DISEMBARK (gverbs.zil:418–432) — exit a vehicle.
// :422 — no vehicle: "You're not in anything you can disembark from."
// :424 — over water (room lacks RLANDBIT): "Getting out here would be fatal."
// :430 — on land: move player to room, "You are on your own feet again."
function verbDisembark(ctx: VerbContext): VerbResult {
  const wloc = ctx.player.parent;
  if (wloc === null || wloc === undefined || !wloc.has(Flag.Vehicle)) {
    return result("You're not in anything you can disembark from.");
  }
  if (!ctx.here.has(Flag.Land)) {
    return result("Getting out here would be fatal.");
  }
  ctx.player.moveTo(ctx.here);
  return result("You are on your own feet again.", /*moved*/true);
}

// V-LAUNCH (gverbs.zil:804-808) — fall-through when no boat handler claims launch.
// Vehicle: "You can't launch that by saying \"launch\"!"  Non-vehicle: "That's pretty weird."
function verbLaunch(ctx: VerbContext): VerbResult {
  if (ctx.dobj?.has(Flag.Vehicle)) return result(vLaunch.vehicle);
  return result(vLaunch.nonVehicle);
}

// V-LAND — the boat lands automatically via GOTO into an RLANDBIT room;
// this stub handles bare "land" with no applicable object.
function verbLand(_ctx: VerbContext): VerbResult {
  return result("You're not in anything that can land.");
}

// V-DIG (gverbs.zil:405-416) — fall-through when not in SANDY-BEACH context.
// No iobj → ZIL defaults to HANDS (TOOLBIT, desc "pair of hands").
function verbDig(ctx: VerbContext): VerbResult {
  const inst = ctx.iobj;
  if (inst?.id === 'SHOVEL') return result(vDig.shovel);
  if (inst?.has(Flag.Tool) ?? true) {
    // ZIL HANDS has TOOLBIT; engine no-iobj → same branch.
    const name = inst?.desc ?? 'pair of hands';
    return result(fmt(vDig.withTool, name));
  }
  return result(fmt(vDig.withNonTool, inst!.desc));
}

// V-RING (gverbs.zil:1162–1163) — default when no object FCN claims it.
function verbRing(_ctx: VerbContext): VerbResult {
  return result(vRing.response);
}

// V-TIE (gverbs.zil:1465–1469) — PRSI=WINNER → "to yourself"; else "to that".
function verbTie(ctx: VerbContext): VerbResult {
  if (ctx.iobj === ctx.player) return result(vTie.toSelf);
  return result(fmt(vTie.toOther, ctx.dobj?.desc ?? ''));
}

// V-UNTIE (gverbs.zil:1511–1512) — one-liner fallback.
function verbUntie(_ctx: VerbContext): VerbResult {
  return result(vUntie.response);
}

// V-SHAKE (gverbs.zil:1213–1240).
// ACTORBIT → no effect; NOT TAKEBIT → can't shake it; CONTBIT:
//   open + contents → SHAKE-LOOP + spill; open + empty → "Shaken.";
//   closed + contents → sounds like something inside; closed + empty → sounds empty.
// Non-container → "Shaken."
function verbShake(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result('Shake what?');
  if (dobj.has(Flag.Actor)) return result(vShake.actor);
  if (!dobj.has(Flag.Takeable)) return result(vShake.cantTakeIt);
  if (dobj.has(Flag.Container)) {
    if (dobj.has(Flag.Open)) {
      // Shake open container — move contents to floor or pseudo-object.
      const contents = [...dobj.children];
      if (contents.length > 0) {
        const land = ctx.here.has(Flag.Land);
        for (const item of contents) {
          item.set(Flag.Touched);
          item.moveTo(land ? ctx.here : null);
        }
        if (land) {
          return result(fmt(vShake.openContainerSpills, dobj.desc));
        }
        return result(`The contents of the ${dobj.desc} spill out and disappears.`);
      }
      return result(vShake.shaken);
    }
    // Closed container — rattle check.
    if ([...dobj.children].length > 0) {
      return result(fmt(vShake.soundsLikeSomethingInside, dobj.desc));
    }
    return result(fmt(vShake.soundsEmpty, dobj.desc));
  }
  return result(vShake.shaken);
}

// PRE-BURN (gverbs.zil:243–249) — flame-source guard.
// No PRSI → TELL-NO-PRSI; PRSI not FLAMING? → "With a X??!?"; FLAMING → pass (RFALSE).
function verbPreBurn(ctx: VerbContext): VerbResult {
  const inst = ctx.iobj;
  if (inst === undefined) return result(tellNoPrsi.response);
  // FLAMING? = OnFire AND Light (preactions.ts:25–27 — the engine's FLAMING? port)
  if (inst.has(Flag.OnFire) && inst.has(Flag.Light)) return result('');
  return result(fmt(preBurn.notAFlame, inst.desc));
}

// IDROP (gverbs.zil:1966–1977) — drop PRSO to LOC(WINNER), return success/failure.
// Returns true and moves the item to the room on success; false if not-carried or closed.
function idrop(item: GameObject, player: GameObject, room: Room): boolean {
  const loc = item.parent;
  const inPlayer = loc === player;
  const inHeldContainer = loc !== null && loc !== undefined && (loc as GameObject).parent === player;
  if (!inPlayer && !inHeldContainer) return false;
  if (!inPlayer && !(loc as GameObject).has(Flag.Open)) return false;
  item.moveTo(room);
  return true;
}

// V-BURN (gverbs.zil:251–274, Zork-1 branch).
// BURNBIT + held-or-inside → REMOVE-CAREFULLY + partial msg + JIGS-UP.
// BURNBIT + not held → consumed msg.
// No BURNBIT → "You can't burn a X."
function verbBurn(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result("Burn what?");
  if (!dobj.has(Flag.Flammable)) return result(fmt(vBurn.cantBurn, dobj.desc));

  const playerHoldsIt = dobj.parent === ctx.player;
  const playerInsideIt = ctx.player.parent === dobj;
  if (playerHoldsIt || playerInsideIt) {
    // REMOVE-CAREFULLY: move obj out of world (player drops it; it burns)
    dobj.moveTo(null);
    const suffix = playerInsideIt
      ? fmt(vBurn.burningHeldIn, dobj.desc)
      : fmt(vBurn.burningHeldHolding, dobj.desc);
    // jigsUp prints the message; verb returns empty output (mirrors grue pattern).
    ctx.jigsUp?.(suffix);
    return result('', false, true);
  }
  // Not held — consume in place
  dobj.moveTo(null);
  return result(fmt(vBurn.consumed, dobj.desc));
}

// V-THROW (gverbs.zil:1445–1460).
// IDROP first; on success: PRSI=ME → death; PRSI actor → "ducks"; else "Thrown."
function verbThrow(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result('Huh?');
  // idrop: drop to LOC(WINNER)
  if (!idrop(dobj, ctx.player, ctx.here)) return result(vThrow.notCarrying);
  // PRSI=ME (throw at self) — full death message via jigsUp; empty output (grue pattern).
  if (ctx.iobj === ctx.player) {
    ctx.jigsUp?.(fmt(vThrow.thrownAtSelf, dobj.desc));
    return result('', false, true);
  }
  if (ctx.iobj !== undefined && ctx.iobj.has(Flag.Actor)) {
    return result(fmt(vThrow.actorDucks, ctx.iobj.desc, dobj.desc));
  }
  return result(vThrow.thrown);
}

// PRE-GIVE (gverbs.zil:708–711) — HELD? check.
function verbPreGive(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result('');
  if (dobj.parent !== ctx.player) return result(fmt(preGive.notHoldingIt, dobj.desc));
  return result('');
}

// V-GIVE (gverbs.zil:713–717).
function verbGive(ctx: VerbContext): VerbResult {
  const iobj = ctx.iobj;
  if (iobj === undefined || !iobj.has(Flag.Actor)) {
    return result(fmt(vGive.prsiNotActor, ctx.dobj?.desc ?? '', iobj?.desc ?? ''));
  }
  return result(fmt(vGive.refusesPolitely, iobj.desc));
}

// V-WEAR (gverbs.zil:1597–1602) — WEARBIT check; on pass, PERFORM V-TAKE.
// V-TAKE with WEARBIT prints "You are now wearing the X." (gverbs.zil:1384–1385).
function verbWear(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result('Wear what?');
  if (!dobj.has(Flag.Wearable)) return result(fmt(vWear.cantWear, dobj.desc));
  // PERFORM V-TAKE: move to player + apply TOUCHBIT + scoring side-effects.
  // V-TAKE with WEARBIT prints the wearing message (gverbs.zil:1384–1385).
  const takeResult = verbTake(ctx);
  if (takeResult.output === 'Taken.') {
    return { ...takeResult, output: fmt(vTake.takenWearing, dobj.desc) };
  }
  return takeResult;
}

// PRE-MOVE (gverbs.zil:910–912) — block if PRSO is held.
function verbPreMove(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj !== undefined && dobj.parent === ctx.player) return result(preMove.holdingIt);
  return result('');
}

// V-MOVE (gverbs.zil:914–918) — TAKEBIT → "reveals nothing"; else "can't move".
function verbMove(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result("Move what?");
  if (dobj.has(Flag.Takeable)) return result(fmt(vMove.nothingRevealed, dobj.desc));
  return result(fmt(vMove.notMoveable, dobj.desc));
}

// HACK-HACK (gverbs.zil:2024–2029) — shared helper for RAISE/LOWER/WAVE/RUB/etc.
// ZIL gates "isn't here!" on <AND <IN? PRSO GLOBAL-OBJECTS> <VERB? WAVE RAISE LOWER>>.
// Only WAVE/RAISE/LOWER trigger that branch; KICK/PUSH/RUB fall through to HO-HUM even
// for global objects. LOCAL-GLOBALS (WHITE-HOUSE etc.) are not IN GLOBAL-OBJECTS in ZIL,
// so they also get HO-HUM regardless.
function hackHackVerb(prefix: string, ctx: VerbContext, waveRaiseLower: boolean): VerbResult {
  const dobj = ctx.dobj;
  const name = dobj?.desc ?? '';
  // GLOBAL-OBJECTS: parentless non-room AND not a LOCAL-GLOBALS object.
  const isGlobalObj = dobj !== undefined
    && dobj.parent === null
    && !('exits' in dobj)
    && !LOCAL_GLOBAL_IDS.has(dobj.id);
  if (isGlobalObj && waveRaiseLower) return result(fmt(hackHack.notHere, name));
  const suffix = ctx.rng !== undefined ? pick(hoHum, ctx.rng) : hoHum.entries[0]!;
  return result(`${prefix}${name}${suffix}`);
}

// V-LOWER (gverbs.zil:902) — HACK-HACK "Playing in this way with the ".
function verbLower(ctx: VerbContext): VerbResult {
  return hackHackVerb('Playing in this way with the ', ctx, true);
}

// V-WAVE (gverbs.zil:1594-1595) — HACK-HACK "Waving the ".
// WAVE is in <VERB? WAVE RAISE LOWER> → global-objects gets "isn't here!".
function verbWave(ctx: VerbContext): VerbResult {
  return hackHackVerb('Waving the ', ctx, true);
}

// V-KICK (gverbs.zil:760) — HACK-HACK "Kicking the ".
// KICK not in <VERB? WAVE RAISE LOWER> → global-objects falls to HO-HUM.
function verbKick(ctx: VerbContext): VerbResult {
  return hackHackVerb('Kicking the ', ctx, false);
}

// V-PUSH (gverbs.zil:1070) — HACK-HACK "Pushing the ".
// PUSH not in <VERB? WAVE RAISE LOWER> → global-objects falls to HO-HUM.
function verbPush(ctx: VerbContext): VerbResult {
  return hackHackVerb('Pushing the ', ctx, false);
}

// V-RUB (gverbs.zil:1165) — HACK-HACK "Fiddling with the ".
// RUB not in <VERB? WAVE RAISE LOWER> → global-objects falls to HO-HUM.
function verbRub(ctx: VerbContext): VerbResult {
  return hackHackVerb('Fiddling with the ', ctx, false);
}

// V-ECHO (gverbs.zil:526) — the "echo echo ..." fallback.
// In the LOUD-ROOM captive mode, non-whitelist input routes here.
// Outside loud mode it fires from normal PERFORM dispatch on the ECHO verb.
function verbEcho(_ctx: VerbContext): VerbResult {
  return result('echo echo ...');
}

// V-CROSS (gverbs.zil:371–372) — fall-through when RAINBOW-FCN doesn't handle it.
function verbCross(_ctx: VerbContext): VerbResult {
  return result("You can't cross that!");
}

// V-SKIP (gverbs.zil:1269–1270) — safe jump, PICK-ONE from WHEEEEE.
function verbSkip(ctx: VerbContext): VerbResult {
  const msg = ctx.rng !== undefined ? pick(wheeeee, ctx.rng) : wheeeee.entries[0]!;
  return result(msg);
}

// V-LEAP (gverbs.zil:813–842) — JUMP / LEAP / DIVE.
//
// With PRSO (jumping over/in/across/off something):
//   object in HERE + ACTORBIT → "too big to jump over"
//   object in HERE, not actor  → V-SKIP
//   object not in HERE          → "That would be a good trick."
//
// Without PRSO (bare jump):
//   No DOWN property (downExit absent) → GETPT=0 → (T <V-SKIP>) — SAFE
//   NEXIT (elseMessage-only, no to/per/ifFlag) → death
//   CEXIT flag-false (ifFlag, flag not set) → death
//   Zork-1 UP-A-TREE special: text + DO-WALK DOWN
//   otherwise (passable, not UP-A-TREE) → V-SKIP
//
// Fatal jump ZIL order (gverbs.zil:828–830): TELL unsafeJump FIRST, then JIGS-UP.
// Engine: pass unsafeJump as prefix of the deathMessage so jigsUp emits it first.
//
// Dome death/skip emerge from exit structure — no dome-specific code here.
// (ZIL's DOME-ROOM-FCN M-ENTER VERB?LEAP branch is unreachable in this engine
// because M-ENTER always fires with action='V-WALK'.)
function verbLeap(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;

  if (dobj !== undefined) {
    // Object present in scope but not in HERE → good trick message.
    const inHere = dobj.parent === ctx.here || dobj.parent === ctx.player;
    if (!inHere) return result(vLeap.goodTrick);
    // Object is in HERE — actor vs non-actor.
    if (dobj.has(Flag.Actor)) return result(fmt(vLeap.actorTooBig, dobj.desc));
    return verbSkip(ctx);
  }

  // No PRSO — inspect the DOWN exit.
  const downExit = ctx.here.exits.find(e => e.dir === 'down');

  // No DOWN property (GETPT returns 0): falls to (T <V-SKIP>) in ZIL — safe jump.
  // gverbs.zil:823: <SET TX <GETPT ,HERE ,P?DOWN>> — TX=0 when no property.
  // The PTSIZE(0) check (S==2 NEXIT or S==4 CEXIT) fails, so V-SKIP runs.
  if (downExit === undefined) return verbSkip(ctx);

  // NEXIT: a down entry that only carries an elseMessage (PTSIZE==2 in ZIL).
  // gverbs.zil:825: <EQUAL? .S 2>
  const isNexit = downExit.to === undefined && downExit.per === undefined && downExit.ifFlag === undefined;
  if (isNexit) {
    const jlPick = pick(jumploss, ctx.rng ?? { next: () => 0 });
    ctx.jigsUp?.(vLeap.unsafeJump + '\n' + jlPick);
    return result('', false, /*fatal*/true);
  }

  // CEXIT with false flag — blocked conditional exit (PTSIZE==4, flag false).
  // gverbs.zil:826–827: <AND <EQUAL? .S 4> <NOT <VALUE <GETB .TX 1>>>>
  if (downExit.ifFlag !== undefined) {
    const gateObj = ctx.world.get(downExit.ifFlag);
    const open = gateObj !== undefined
      ? gateObj.has(Flag.Open)
      : (ctx.getGlobal?.(downExit.ifFlag) ?? false);
    if (!open) {
      const jlPick = pick(jumploss, ctx.rng ?? { next: () => 0 });
      ctx.jigsUp?.(vLeap.unsafeJump + '\n' + jlPick);
      return result('', false, /*fatal*/true);
    }
  }

  // Zork-1 special: at UP-A-TREE, the passable exit leads safely down.
  // gverbs.zil:831–837 — "unaccustomed daring" text + DO-WALK DOWN.
  if (ctx.here.id === 'UP-A-TREE') {
    const walkResult = doWalk('down', ctx);
    return result(vLeap.upATreeDaring + (walkResult.output ? '\n' + walkResult.output : ''), walkResult.moved);
  }

  // Passable exit, not UP-A-TREE → V-SKIP.
  return verbSkip(ctx);
}

// V-RAISE (gverbs.zil:1131–1132) — V-LOWER (same HACK-HACK route).
function verbRaise(ctx: VerbContext): VerbResult {
  return verbLower(ctx);
}


// V-BREATHE — BLOW IN OBJECT (gsyntax.zil:108).
// ZIL: <PERFORM V?INFLATE PRSO LUNGS> (gverbs.zil:231, 1actions.zil:2817–2818).
// Re-performs inflate on dobj with LUNGS as implicit iobj, bypassing syntax TOOLBIT check.
function verbBreathe(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  if (dobj === undefined) return result("You can't see any boat here!");
  const inflatable = ctx.world.get('INFLATABLE-BOAT');
  const inflated   = ctx.world.get('INFLATED-BOAT');
  const punctured  = ctx.world.get('PUNCTURED-BOAT');
  // Inflatable pile of plastic: IBOAT-FUNCTION lungs branch (1actions.zil:2835)
  if (dobj === inflatable) {
    if (dobj.parent !== ctx.here) return result('The boat must be on the ground to be inflated.');
    return result("You don't have enough lung power to inflate it.");
  }
  // Already-inflated boat: RBOAT-FUNCTION inflate fall-through (1actions.zil:2801)
  if (dobj === inflated) return result('Inflating it further would probably burst it.');
  // Punctured boat: DBOAT-FUNCTION inflate rejection (1actions.zil:2656)
  if (dobj === punctured) return result('No chance. Some moron punctured it.');
  // Non-boat: V-INFLATE default (gverbs.zil:757–758)
  return result(vInflate.response);
}

// V-LOCK (gverbs.zil:855–856) — default when no object handler claims it.
// Object FCNs (grate, dam) override at PERFORM step 6; this is the step-7 fallback.
function verbLock(_ctx: VerbContext): VerbResult {
  return result(vLock.response);
}

// V-UNLOCK (gverbs.zil:1508–1509) — calls V-LOCK.
const verbUnlock = verbLock;

// DO-WALK helper: run verbGo with a synthesized direction prep.
// V-ENTER and V-CLIMB-* delegate here rather than re-implementing movement.
function doWalk(dir: string, ctx: VerbContext): VerbResult {
  return verbGo({ ...ctx, prep: dir });
}

// V-ENTER (gverbs.zil:620–621) — DO-WALK P?IN.
function verbEnter(ctx: VerbContext): VerbResult {
  return doWalk('in', ctx);
}

// V-EXIT (gverbs.zil:632–641) — vehicle → V-DISEMBARK; else DO-WALK P?OUT.
// ZIL: PRSO=<>/ROOMS and WINNER in vehicle → PERFORM V?DISEMBARK; else DO-WALK P?OUT.
function verbExit(ctx: VerbContext): VerbResult {
  const wloc = ctx.player.parent;
  if (wloc !== null && wloc !== undefined && wloc.has(Flag.Vehicle)) {
    return verbDisembark(ctx);
  }
  return doWalk('out', ctx);
}

// V-CLIMB-ON (gverbs.zil:290–298) — VEHBIT → V?BOARD; else "You can't climb onto the X."
function verbClimbOn(ctx: VerbContext): VerbResult {
  if (ctx.dobj?.has(Flag.Vehicle)) {
    return verbBoard(ctx);
  }
  return result(`You can't climb onto the ${ctx.dobj?.desc ?? 'that'}.`);
}

// GLOBAL-IN? port (gverbs.zil:305–316): is obj a LOCAL-GLOBAL in destRoomId?
// ZIL checks this for CEXIT/DEXIT/UEXIT exits — if the object the player names
// is not a global in the destination room, it "doesn't lead that way."
// Falls back to the room's GLOBAL prop (unit-test rooms not in ROOM_GLOBAL_IDS).
function globalInDest(objId: string, destRoomId: string, world: World): boolean {
  const tableIds = ROOM_GLOBAL_IDS.get(destRoomId);
  if (tableIds !== undefined) return tableIds.includes(objId);
  // Fallback for test rooms not in the compile-time table.
  const destRoom = world.get(destRoomId);
  if (destRoom !== undefined) {
    const gProp = destRoom.props.get('GLOBAL');
    if (typeof gProp === 'string') return gProp === objId;
    if (Array.isArray(gProp)) return (gProp as string[]).includes(objId);
  }
  return false;
}

// V-CLIMB-UP (gverbs.zil:300–334) — core climb logic.
// DIR defaults to P?UP ('up'); V-CLIMB-DOWN passes 'down'.
// objIsRooms: true when the caller was V-CLIMB-DOWN or V-CLIMB-FOO with no noun
//   (ZIL: OBJ=ROOMS because V-CLIMB-DOWN passes ,PRSO=ROOMS explicitly).
//   V-CLIMB-UP direct has OBJ=<> (nil) even when PRSO=ROOMS — gverbs.zil:300–302.
//
// ZIL branch order (gverbs.zil:300–334):
//   1. OBJ set AND exit in DIR:
//        NEXIT ({elseMessage}-only, no to/per) OR
//        (exit has to/per AND NOT GLOBAL-IN? OBJ dest)
//        → "The <OBJ> does/don't lead up/downward."
//   2. OBJ nil AND exit in DIR → DO-WALK (verbGo handles all exit types)
//   3. No exit + OBJ has W?WALL → "Climbing the walls is to no avail."
//   4. No exit + Zork-1: HERE!=PATH, OBJ nil-or-TREE, TREE global in HERE
//      → "There are no climbable trees here."
//   5. OBJ nil or ROOMS → "You can't go that way."
//   6. else → "You can't do that!"
function verbClimbUp(dir: string, ctx: VerbContext, objIsRooms: boolean): VerbResult {
  const dobj = ctx.dobj;
  // OBJ is set when: (a) named noun (dobj !== undefined), or (b) ROOMS sentinel
  // (objIsRooms=true). ROOMS has empty desc → produces "The  doesn't lead Xward."
  const objSet = dobj !== undefined || objIsRooms;
  const objDesc = dobj?.desc ?? '';
  const objId   = dobj?.id;

  const exit = ctx.here.exits.find(e => e.dir === dir);
  const dir2 = dir === 'up' ? 'up' : 'down';

  if (exit !== undefined) {
    if (objSet) {
      // NEXIT: elseMessage-only (no to, no per) — always refuse when OBJ set.
      // gverbs.zil:305–306: PTSIZE==NEXIT → refuse.
      const isNexit = exit.to === undefined && exit.per === undefined;
      if (isNexit) {
        const doesnt = objId === 'STAIRS' ? "don't" : "doesn't";
        return result(`The ${objDesc} ${doesnt} lead ${dir2}ward.`);
      }
      // CEXIT/DEXIT/UEXIT (exit has to or per): GLOBAL-IN? OBJ dest.
      // gverbs.zil:307–316: NOT GLOBAL-IN? → refuse.
      // For per exits the dest isn't known statically; use per's first-pass dest
      // (fallback: HERE) — in practice all per exits at climbable rooms go to
      // known dests and PRSO is nil/ROOMS when per fires, so this branch is moot.
      const destId = exit.to ?? ctx.here.id;
      if (!globalInDest(objId ?? '__ROOMS__', destId, ctx.world)) {
        const doesnt = objId === 'STAIRS' ? "don't" : "doesn't";
        return result(`The ${objDesc} ${doesnt} lead ${dir2}ward.`);
      }
    }
    // OBJ nil, or OBJ is global in dest — proceed with DO-WALK.
    // verbGo handles all exit types (elseMessage, ifFlag, per, to).
    return doWalk(dir, ctx);
  }

  // No exit in that direction.
  // gverbs.zil:320–323: OBJ set AND OBJ has W?WALL synonym.
  if (objSet && dobj !== undefined && dobj.synonyms.includes('WALL')) {
    return result('Climbing the walls is to no avail.');
  }

  // Zork-1 tree branch (gverbs.zil:324–330): HERE!=PATH, OBJ nil-or-TREE,
  // TREE is a LOCAL-GLOBAL of HERE.
  const treeGlobal = globalInDest('TREE', ctx.here.id, ctx.world);
  const objIsNilOrTree = !objSet || objId === 'TREE';
  if (treeGlobal && objIsNilOrTree && ctx.here.id !== 'PATH') {
    return result('There are no climbable trees here.');
  }

  // gverbs.zil:331: OBJ nil or ROOMS → "You can't go that way."
  if (!objSet || objIsRooms) {
    return result("You can't go that way.");
  }

  return result("You can't do that!");
}

// V-CLIMB-FOO (gverbs.zil:281–288) — bare CLIMB: V-CLIMB-UP P?UP PRSO.
// When no noun given, PRSO=ROOMS → objIsRooms=true.
function verbClimbFoo(ctx: VerbContext): VerbResult {
  return verbClimbUp('up', ctx, ctx.dobjIsRooms ?? false);
}

// V-CLIMB-DOWN (gverbs.zil:279–280) — V-CLIMB-UP P?DOWN PRSO.
// When no noun given, PRSO=ROOMS → objIsRooms=true.
function verbClimbDown(ctx: VerbContext): VerbResult {
  return verbClimbUp('down', ctx, ctx.dobjIsRooms ?? false);
}

// V-CLIMB-UP entry (gverbs.zil:300) — upward direction.
// Direct climb up: OBJ=<> (nil) regardless of PRSO — gverbs.zil:300–302.
// ZIL's V-CLIMB-UP routine takes OBJ as an OPTIONAL parameter defaulting to <>
// (nil); it only sets OBJ from PRSO when the caller explicitly passes it (as
// V-CLIMB-DOWN/V-CLIMB-FOO do). When dispatched as the top-level action, OBJ
// is ALWAYS nil — so we pass a ctx with dobj=undefined and objIsRooms=false,
// ignoring whatever PRSO the parser resolved (e.g. CLIMBABLE-CLIFF for
// "climb up cliff").  gverbs.zil:300–302, gsyntax.zil:130.
function verbClimbUpAction(ctx: VerbContext): VerbResult {
  const nilCtx: VerbContext = { ...ctx, dobj: undefined, dobjIsRooms: false };
  return verbClimbUp('up', nilCtx, false);
}

type VerbHandler = (ctx: VerbContext) => VerbResult;

// V-ODYSSEUS — gverbs.zil:945–961.
//
// "odysseus" / "ulysses" (gsyntax.zil:334–335): if in CYCLOPS-ROOM with an
// awake cyclops, the name of his father's nemesis drives him through the east
// wall.  Anywhere else: "Wasn't he a sailor?"
//
// REMOVE-CAREFULLY (gverbs.zil:610–618): removes the object, recomputes LIT,
// prints "You are left in the dark..." if the room just went dark.  Here the
// cyclops isn't a light source so the dark-check is a no-op; we just remove.
function verbOdysseus(ctx: VerbContext): VerbResult {
  const here = ctx.here;
  const cyclops = ctx.world.get('CYCLOPS');
  const cyclopsFlag = ctx.getGlobal?.('CYCLOPS-FLAG') ?? false;

  if (
    here.id === 'CYCLOPS-ROOM' &&
    cyclops !== undefined &&
    cyclops.parent !== null &&
    cyclops.parent === here &&
    !cyclopsFlag
  ) {
    ctx.disableClock?.('I-CYCLOPS');
    ctx.setGlobal?.('CYCLOPS-FLAG', true);
    const out =
      "The cyclops, hearing the name of his father's deadly nemesis, flees the room\n" +
      'by knocking down the wall on the east of the room.';
    ctx.setGlobal?.('MAGIC-FLAG', true);
    cyclops.clear(Flag.Fight);
    cyclops.moveTo(null);   // REMOVE-CAREFULLY — no light-source side-effects
    return result(out);
  }

  return result("Wasn't he a sailor?");
}

// V-POUR-ON (gverbs.zil:1024–1044) — pour water onto a target.
// Fires when dobj=WATER and iobj=target ("pour water on X").
// FLAMING? — gmacros.zil:145: FSET? FLAMEBIT (Flag.OnFire) AND FSET? ONBIT (Flag.Light).
function verbPourOn(ctx: VerbContext): VerbResult {
  const dobj = ctx.dobj;
  const iobj = ctx.iobj;

  // Not water → "You can't pour that." — gverbs.zil:1043–1044.
  if (dobj === undefined || (dobj.id !== 'WATER' && dobj.id !== 'GLOBAL-WATER')) {
    return result("You can't pour that.");
  }

  // Consume water — gverbs.zil:1026 REMOVE-CAREFULLY.
  if (dobj.id !== 'GLOBAL-WATER') dobj.moveTo(null);

  if (iobj !== undefined && iobj.has(Flag.OnFire) && iobj.has(Flag.Light)) {
    // FLAMING? — extinguish — gverbs.zil:1027–1034.
    iobj.clear(Flag.OnFire);
    iobj.clear(Flag.Light);
    if (iobj.id === 'CANDLES') ctx.disableClock?.('I-CANDLES');
    return result(`The ${iobj.desc} is extinguished.`);
  }

  // Non-flaming — evaporates — gverbs.zil:1035–1037.
  const target = iobj !== undefined ? `the ${iobj.desc}` : 'the floor';
  return result(`The water spills over ${target}, to the floor, and evaporates.`);
}

// Primary dispatch on V-* action id (ZIL PERFORM dispatches on PRSA, gmain.zil:283–284).
const ACTION_HANDLERS: Record<string, VerbHandler> = {
  'V-LOOK':      verbLook,
  'V-WALK':      verbGo,
  'V-TAKE':      verbTake,
  'V-DROP':      verbDrop,
  'V-OPEN':      verbOpen,
  'V-CLOSE':     verbClose,
  'V-READ':      verbRead,
  'V-INVENTORY': verbInventory,
  'V-EXAMINE':   verbExamine,
  'V-PUT':       verbPut,
  'V-PUT-ON':    verbPutOn,
  'V-SCORE':     verbScore,
  'V-DIAGNOSE':  verbDiagnose,
  'V-PRAY':      verbPray,
  'V-ADVENT':    verbAdvent,  // PLUGH / XYZZY — gverbs.zil:153
  'V-FROBOZZ':   verbFrobozz, // FROBOZZ — gverbs.zil:704
  'V-ATTACK':    verbAttack,
  // V-WAIT — gverbs.zil:1514–1519. "Time passes..." then clock runs; the turn()
  // loop's clock.advance() handles the countdown — no extra repeat needed here.
  'V-WAIT':      () => result('Time passes...'),
  'V-LOOK-INSIDE': verbLookInsideAction, // gverbs.zil:865-890
  'V-LOOK-UNDER':  verbLookUnder,        // gverbs.zil:899-900
  'V-LOOK-BEHIND': verbLookBehind,       // gverbs.zil:862-863
  'V-LOOK-ON':     verbLookOn,           // gverbs.zil:892-897
  // gverbs.zil:1471 — default when no object handler claims V-TIE-UP.
  'V-TIE-UP': () => result(vTieUp.response),
  // gverbs.zil:1583–1584 — V-WALK-AROUND default when no room/object handler moved the player.
  'V-WALK-AROUND': () => result(vWalkAround.response),
  // gverbs.zil:945–961 — ODYSSEUS / ULYSSES (gsyntax.zil:334–335).
  'V-ODYSSEUS': verbOdysseus,

  // Meta-verb bodies — gverbs.zil:13-25, 55-121.
  'V-VERBOSE':       verbVerbose,
  'V-BRIEF':         verbBrief,
  'V-SUPER-BRIEF':   verbSuperBrief,
  'V-VERSION':       verbVersion,
  'V-SCRIPT':        verbScript,
  'V-QUIT':          verbQuit,
  'V-SAVE':          verbSave,
  'V-RESTORE':       verbRestore,
  'V-RESTART':       verbRestart,

  // Phase-3 dam/river verbs — thin shells; object handlers (IBOAT-FUNCTION etc.)
  // short-circuit before these in the PERFORM chain.
  'V-BREATHE':   verbBreathe, // BLOW IN OBJECT → PERFORM V?INFLATE PRSO LUNGS
  'V-INFLATE':   verbInflate,
  'V-DEFLATE':   verbDeflate,
  'V-BOARD':     verbBoard,
  'V-DISEMBARK': verbDisembark,
  'V-LAUNCH':    verbLaunch,
  'V-LAND':      verbLand,
  'V-DIG':       verbDig,
  'V-WAVE':       verbWave,
  'V-KICK':       verbKick,
  'V-PUSH':       verbPush,
  'V-RUB':        verbRub,
  'V-ECHO':       verbEcho,
  'V-CROSS':      verbCross,
  'V-RAISE':      verbRaise,
  'V-LEAP':       verbLeap,    // gverbs.zil:813–842

  // CB1 — gverbs.zil:855–856, 1508–1509, 620–621, 632–641, 279–335
  'V-LOCK':       verbLock,
  'V-UNLOCK':     verbUnlock,
  'V-ENTER':      verbEnter,
  'V-EXIT':       verbExit,
  'V-CLIMB-UP':   verbClimbUpAction,
  'V-CLIMB-DOWN': verbClimbDown,
  'V-CLIMB-FOO':  verbClimbFoo,
  'V-CLIMB-ON':   verbClimbOn,

  // CB2 — gverbs.zil:1162, 1465–1469, 1511–1512, 1213–1240, 243–274, 1445–1460,
  //        708–717, 1597–1602, 910–918, 902, 1131–1132
  'V-RING':     verbRing,
  'V-TIE':      verbTie,
  'V-UNTIE':    verbUntie,
  'V-SHAKE':    verbShake,
  'PRE-BURN':   verbPreBurn,
  'V-BURN':     verbBurn,
  'V-THROW':    verbThrow,
  'PRE-GIVE':   verbPreGive,
  'V-GIVE':     verbGive,
  'V-WEAR':     verbWear,
  'PRE-MOVE':   verbPreMove,
  'V-MOVE':     verbMove,
  'V-LOWER':    verbLower,

  // CC7 — gverbs.zil:1024–1044
  'V-POUR-ON':  verbPourOn,
};

// Fallback keyed on verb word — for callers that pass only a verb word.
const HANDLERS: Record<string, VerbHandler> = {
  look:      verbLook,
  walk:      verbGo,
  take:      verbTake,
  drop:      verbDrop,
  open:      verbOpen,
  close:     verbClose,
  read:      verbRead,
  inventory: verbInventory,
  examine:   verbExamine,
  put:       verbPut,
  score:     verbScore,
  diagnose:  verbDiagnose,
  plugh:     verbAdvent,
  xyzzy:     verbAdvent,
  frobozz:   verbFrobozz,
};

// META_ACTIONS — verbs that do NOT advance time (gmain.zil:171-172 CLOCKER guard).
export const META_ACTIONS: ReadonlySet<string> = new Set([
  'V-TELL',
  'V-BRIEF',
  'V-SUPER-BRIEF',
  'V-VERBOSE',
  'V-SAVE',
  'V-VERSION',
  'V-QUIT',
  'V-RESTART',
  'V-SCORE',
  'V-SCRIPT',
  'V-UNSCRIPT',
  'V-RESTORE',
]);

export function executeVerb(ctx: VerbContext, action?: string): VerbResult {
  if (action !== undefined) {
    const actionHandler = ACTION_HANDLERS[action];
    if (actionHandler !== undefined) return actionHandler(ctx);
  }
  const handler = HANDLERS[ctx.verb];
  if (handler === undefined) return result(`I don't know how to "${ctx.verb}".`);
  return handler(ctx);
}
