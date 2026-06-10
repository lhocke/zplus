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
import { fmt, pick, vAdvent, vFrobozz, vOpen, vClose, vRead, vExamine, vLookInside, vPut, preTake, preGive, yuks, goto, describeRoom as describeRoomMsgs, type PickRng } from '../game-messages.js';
import { lit } from '../parser/scope.js';

export interface VerbContext {
  readonly verb: string;
  readonly dobj?: GameObject;
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
   * verbTake gates pickups against WEIGHT(item)+WEIGHT(player) > loadAllowed.
   */
  readonly loadAllowed?: number;
  /**
   * Maximum carrying capacity — ZIL LOAD-MAX (gglobals.zil:92).
   * Used to detect whether the player is wounded (loadAllowed < loadMax)
   * and choose the "especially in light of your condition" suffix.
   */
  readonly loadMax?: number;
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
// Rooms are skipped (no "X contains:" header at room level).
function firster(obj: GameObject, level: number, tell: (s: string) => void): void {
  if (obj instanceof Room) return;

  // Non-room containers: indent if level > 0, then print container header.
  const indent = level > 0 ? '  '.repeat(level) : '';

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
    if (!obj.has(Flag.Touched) && obj.fdesc !== undefined) {
      tell(obj.fdesc);
    } else if (obj.ldesc !== undefined) {
      tell(obj.ldesc);
    } else {
      tell(`There is a ${obj.desc} here.`);
    }
  } else {
    const indent = '  '.repeat(level);
    tell(`${indent}A ${obj.desc}`);
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
function printCont(
  container: GameObject,
  player: GameObject,
  level: number,
  tell: (s: string) => void,
): void {
  // ZIL's children are a prepend-list (FIRST = last-defined in ZIL source).
  // JS Set is append-order, so we reverse to match ZIL iteration order.
  const children = Array.from(container.children).reverse();

  // Pass 1: untouched items with an FDESC
  for (const child of children) {
    if (child === player) continue;
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

  // Pass 2: touched / no-FDESC objects
  let firsterFired = false;
  let currentLevel = level;

  for (const child of children) {
    if (child === player) continue;
    if (child.has(Flag.Invisible)) continue;
    if (!child.has(Flag.Touched) && child.fdesc !== undefined) continue;

    if (!child.has(Flag.NonDescript)) {
      if (!firsterFired) {
        firsterFired = true;
        currentLevel = level + 1;
        firster(container, level, tell);
      }
      describeObject(child, player, currentLevel, tell);
    } else {
      if (seeInside(child) && child.children.size > 0) {
        printCont(child, player, level, tell);
      }
    }
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

// Produce the room description: name, ldesc/M-LOOK, and DESCRIBE-OBJECTS listing.
// When dark (gverbs.zil:1637-1649), returns the pitch-black message and skips the rest.
function describeRoom(
  room: Room,
  player: GameObject,
  mlookRunner?: (r: Room) => string,
  world?: World,
  getGlobal?: (name: string) => boolean,
): string {
  if (world !== undefined && !lit(room, player, world)) {
    const sprayed = getGlobal?.('SPRAYED?') ?? false;
    return sprayed ? describeRoomMsgs.darkSprayed : describeRoomMsgs.darkNoSpray;
  }

  const lines: string[] = [];
  lines.push(room.desc);

  if (room.ldesc) {
    lines.push(room.ldesc);
  } else if (mlookRunner !== undefined) {
    const dynamic = mlookRunner(room);
    if (dynamic.length > 0) lines.push(dynamic);
  }

  describeRoomObjects(room, player, (s) => lines.push(s));

  return lines.join('\n');
}

function verbLook(ctx: VerbContext): VerbResult {
  return result(describeRoom(ctx.here, ctx.player, ctx.mlookRunner, ctx.world, ctx.getGlobal));
}

function verbGo(ctx: VerbContext): VerbResult {
  const dir = ctx.prep;
  if (!dir) return result("Go where?");

  const exit = ctx.here.exits.find(e => e.dir === dir);

  if (!exit) {
    // No exit in this direction: RFATAL (ZIL V-WALK NEXIT/no-exit path).
    // M-FATAL clears the continuation queue and skips M-END.
    return result("You can't go that way.", /*moved*/false, /*fatal*/true);
  }

  const prob = ctx.prob ?? (() => false);

  // ZIL GOTO (gverbs.zil:2048-2120): capture OLIT before the move, recompute
  // LIT after. Grue gate fires only on dark→dark (both rooms unlit).
  const enterDest = (dest: Room): VerbResult => {
    const oldLit = (ctx.alwaysLit ?? false) || lit(ctx.here, ctx.player, ctx.world);
    ctx.player.moveTo(dest);
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

    return result(describeRoom(dest, ctx.player, ctx.mlookRunner, ctx.world, ctx.getGlobal), true);
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

  return enterDest(dest as Room);
}

// WEIGHT — gverbs.zil:1988: SIZE(obj) + recursive sum over all children.
// ZIL GETP returns 0 when the property is absent, so objects with no SIZE
// contribute 0 to the total (the player object has no SIZE, for example).
function weight(obj: GameObject): number {
  const size = (obj.props.get('SIZE') as number | undefined) ?? 0;
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

  // LOAD-ALLOWED capacity check — gverbs.zil:1932–1940.
  // Only fires when the engine provides loadAllowed (test contexts may omit it).
  const loadAllowed = ctx.loadAllowed;
  if (loadAllowed !== undefined && item.parent !== ctx.player) {
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
  const contents = Array.from(item.children).filter(c => !c.has(Flag.Invisible));

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
  } else {
    const last = articled[articled.length - 1];
    const rest = articled.slice(0, -1);
    contentStr = rest.join(', ') + ', and ' + last;
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
  const carried = Array.from(ctx.player.children).filter(c => !c.has(Flag.Invisible));

  if (carried.length === 0) {
    return result("You are empty-handed.");
  }

  const list = carried.map(c => `  ${c.desc}`).join('\n');
  return result(`You are carrying:\n${list}`);
}

function verbExamine(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Examine what?");

  // V-EXAMINE priority (gverbs.zil:623–630): TEXT prop, then ldesc, then container/door state, then fallback.
  const text = item.props.get('TEXT') ?? item.props.get('text');
  if (typeof text === 'string') return result(text);
  if (item.ldesc !== undefined) return result(item.ldesc);

  // Containers and doors report open/closed state (gverbs.zil:626-628, 865-890).
  if (item.has(Flag.Container) || item.has(Flag.Door)) {
    if (item.has(Flag.Door)) {
      return item.has(Flag.Open)
        ? result(fmt(vLookInside.doorOpen, item.desc))
        : result(fmt(vLookInside.doorClosed, item.desc));
    }
    if (item.has(Flag.Actor)) return result(vLookInside.nothingSpecialInside);
    if (seeInside(item)) {
      const lines: string[] = [];
      // Surfaces (SURFACEBIT) sit at room depth, so their contents are listed
      // at level -1 — identical to DESCRIBE-OBJECTS — keeping the same indentation
      // as the room look. Regular containers use level 0 (gverbs.zil:876-886).
      const level = item.has(Flag.Surface) ? -1 : 0;
      printCont(item, ctx.player, level, (s) => lines.push(s));
      if (lines.length === 0) return result(fmt(vLookInside.containerEmpty, item.desc));
      return result(lines.join('\n'));
    }
    return result(fmt(vLookInside.containerClosed, item.desc));
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

function verbPut(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  const container = ctx.iobj;

  if (item === undefined) return result("Put what?");
  if (container === undefined) return result("Put it where?");

  // Not HELD? (gverbs.zil:710–711)
  if (item.parent !== ctx.player) {
    return result(fmt(preGive.notHoldingIt, item.desc));
  }

  // PRSI not a container/surface (gverbs.zil:1090)
  if (!container.has(Flag.Container) && !container.has(Flag.Surface)) {
    return result(vPut.cantDoThat);
  }

  // PRSI not open (gverbs.zil:1093)
  if (!container.has(Flag.Open)) {
    return result(fmt(vPut.notOpen, container.desc));
  }

  item.moveTo(container);
  return result(vPut.done);
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

// V-DIAGNOSE (1actions.zil:3993–4024)
// FIGHT-STRENGTH = 2 + floor(SCORE/70) (1actions.zil:3322–3381).
// Without combat, WD=0 always; RS = fightStrength unadjusted.
function verbDiagnose(ctx: VerbContext): VerbResult {
  const deaths = ctx.deaths ?? 0;
  const score  = ctx.score  ?? 0;

  const wd = 0; // wound depth; always 0 until combat is built
  const ms = 2 + Math.floor(score / 70);

  const rs = ms;

  const lines: string[] = [];

  if (wd === 0) {
    lines.push('You are in perfect health.');
  } else {
    const woundDesc =
      wd === 1 ? 'a light wound,' :
      wd === 2 ? 'a serious wound,' :
      wd === 3 ? 'several wounds,' :
      /* wd>3 */ 'serious wounds,';
    lines.push(`You have ${woundDesc} which will be cured after ${wd} moves.`);
  }

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

// PHASE-1 TEMPORARY — replaced by real combat in Phase 2.
// Intercepts V-ATTACK so attack/kill never errors in the pre-troll playtest region.
// Troll target → the in-world sign (signals content boundary, not a bug).
// Any other target → brief in-spirit deflection (no villains exist pre-troll).
// Does NOT set TROLL-FLAG; the exit wall stays up.

// Sign text exported so the pre-parse troll-attack guard in game.ts can reuse it
// without duplicating the copy (both code paths are PHASE-1 TEMPORARY).
export const TROLL_SIGN_TEXT =
  'The troll, bored, produces a hand-lettered sign and holds it up:\n' +
  '"THANK YOU FOR PLAYING. FURTHER ADVENTURES ARE UNDER DEVELOPMENT."\n' +
  'He seems disinclined to fight today.';

// Detects bare attack/kill-troll input before the parser sees it.
// game.ts calls this (with trollInRoom=true) to intercept the case where GWIM
// (needing a weapon iobj) would otherwise orphan-prompt or fail the held-check.
// When the troll is NOT in the current room the intercept is skipped, letting the
// engine produce its faithful "can't see that" response.
// Named-weapon forms ("attack troll with sword") bypass this and reach verbAttackPhase1
// through the normal V-ATTACK parser path.
// PHASE-1 TEMPORARY -- removed when real combat replaces verbAttackPhase1.
const BARE_TROLL_ATTACK = /^\s*(attack|kill|fight)\s+(the\s+)?troll\s*$/i;
export function isBareAttackTroll(input: string, trollInRoom: boolean): boolean {
  return trollInRoom && BARE_TROLL_ATTACK.test(input);
}

function verbAttackPhase1(ctx: VerbContext): VerbResult {
  // Only show the sign when the troll is actually here; if the parser somehow
  // resolved TROLL as dobj from a different room, fall through gracefully.
  if (ctx.dobj?.id === 'TROLL' && ctx.dobj.parent === ctx.here) {
    return result(TROLL_SIGN_TEXT);
  }
  return result("Violence isn't the answer to this one.");
}

type VerbHandler = (ctx: VerbContext) => VerbResult;

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
  'V-SCORE':     verbScore,
  'V-DIAGNOSE':  verbDiagnose,
  'V-ADVENT':    verbAdvent,  // PLUGH / XYZZY — gverbs.zil:153
  'V-FROBOZZ':   verbFrobozz, // FROBOZZ — gverbs.zil:704
  // PHASE-1 TEMPORARY — replaced by real combat in Phase 2.
  'V-ATTACK':    verbAttackPhase1,
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
