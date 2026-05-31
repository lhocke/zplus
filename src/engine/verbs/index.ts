/**
 * Core verb implementations for the Zork engine.
 *
 * Each exported function handles one verb family.  They are pure in the sense
 * that they take an explicit context and return a VerbResult — no globals,
 * no DOM.  Side effects (containment changes, flag mutations) are applied to
 * the mutable domain objects inside the context.
 *
 * VerbContext is the primary dependency-injection point: the engine's turn
 * loop fills it out; tests wire it directly from fixture objects.
 */

import type { GameObject } from '../../domain/game-object.js';
import { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';
import { fmt, pick, vOpen, vClose, vRead, vExamine, vPut, preTake, preGive, yuks, type PickRng } from '../game-messages.js';

// --------------------------------------------------------------------------
// Public API types
// --------------------------------------------------------------------------

/**
 * Everything a verb handler needs to operate: the actor, the current room,
 * the world, and the resolved objects for this command.
 *
 * `perResolver` is an optional hook for `Exit.per` routines.  The engine
 * supplies it when per-routine handlers are registered (Phase 3); tests that
 * only care about core verbs may leave it undefined.
 */
export interface VerbContext {
  readonly verb: string;
  readonly dobj?: GameObject;
  readonly iobj?: GameObject;
  readonly prep?: string;
  readonly player: GameObject;
  readonly here: Room;
  readonly world: World;
  /** Optional resolver for Exit.per routine names → destination room id. */
  readonly perResolver?: (routineName: string, here: Room) => string | undefined;
  /**
   * Optional: run the M-LOOK action on a room and return its output.  When
   * supplied by the game engine, the "look" verb uses it to produce a
   * handler-driven description for rooms that lack a static ldesc.
   */
  readonly mlookRunner?: (room: Room) => string;
  /**
   * Seeded RNG for PICK-ONE operations (YUKS, DUMMY, etc.).
   * Required for verbTake (YUKS) and other random-pick paths.
   * Tests may omit it; a fallback to the first table entry is used.
   * Accepts any object with a `next()` method (duck-typed).
   */
  readonly rng?: PickRng;
}

export interface VerbResult {
  /** Text to display to the player this turn. */
  readonly output: string;
  /** True when the player's location changed as a result of this verb. */
  readonly moved: boolean;
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function result(output: string, moved = false): VerbResult {
  return { output, moved };
}

// --------------------------------------------------------------------------
// DESCRIBE-OBJECTS model (gverbs.zil:1681–1836)
//
// Replaces the non-authentic "You can see: X, Y." listing with the ZIL-
// faithful PRINT-CONT / DESCRIBE-OBJECT / FIRSTER algorithm.
//
// The three functions below emit via a `tell` callback rather than returning
// strings — matching the ZIL TELL model — so output ordering is preserved
// when containers are recursed.
// --------------------------------------------------------------------------

/**
 * SEE-INSIDE? (gverbs.zil:1837) — a container's contents are visible only
 * when the container is OPEN (OPENBIT) or TRANSPARENT (TRANSBIT).
 */
function seeInside(obj: GameObject): boolean {
  return obj.has(Flag.Transparent) || obj.has(Flag.Open);
}

/**
 * FIRSTER (gverbs.zil:1818) — print the header line before the first
 * DESCRIBE-OBJECT item in a container's pass-2 listing.
 *
 * At room level (OBJ is a Room), FIRSTER is effectively a no-op — rooms
 * do not get a "X contains:" header.  Only non-room containers get headers.
 * The player inventory case ("You are carrying:") is handled by V-INVENTORY
 * (verbInventory) directly; FIRSTER here covers the room-object case only.
 */
function firster(obj: GameObject, level: number, tell: (s: string) => void): void {
  // Player carrying case is handled by verbInventory, not here.
  // Room case: no header (rooms are not printed as containers).
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

/**
 * DESCRIBE-OBJECT (gverbs.zil:1693) — emit one object's description.
 *
 * At level 0 (direct room child): use FDESC if untouched, else LDESC, else
 * the "There is a <desc> here." fallback.
 *
 * At level > 0 (nested inside a container): print the INDENTS[level] prefix
 * followed by "A <desc>" (ZIL: INDENTS[1] = "  ", INDENTS[2] = "    ", …).
 *
 * After printing, if SEE-INSIDE?(obj) and obj has children, recurse via
 * printCont.
 */
function describeObject(
  obj: GameObject,
  player: GameObject,
  level: number,
  tell: (s: string) => void,
): void {
  if (level === 0) {
    // Try FDESC if not yet touched.
    if (!obj.has(Flag.Touched) && obj.fdesc !== undefined) {
      tell(obj.fdesc);
    } else if (obj.ldesc !== undefined) {
      tell(obj.ldesc);
    } else {
      tell(`There is a ${obj.desc} here.`);
    }
  } else {
    // Nested inside a container: "  A <desc>" (INDENTS[level] + "A " + D OBJ).
    const indent = '  '.repeat(level);
    tell(`${indent}A ${obj.desc}`);
  }

  // Recurse into open/transparent containers.
  if (seeInside(obj) && obj.children.size > 0) {
    printCont(obj, player, level, tell);
  }
}

/**
 * PRINT-CONT (gverbs.zil:1750) — two-pass recursive container printer.
 *
 * Pass 1 (FDESC objects): children that are not TOUCHBIT and have an FDESC
 * are printed via their FDESC.  This runs at the current level (−1 for
 * the room container itself); the items' descriptions are emitted at the
 * level they live in (no FIRSTER for pass-1 items).
 *
 * Pass 2 (TOUCHBIT/no-FDESC objects): children that are TOUCHBIT OR have
 * no FDESC are printed via DESCRIBE-OBJECT at the incremented level.
 * The first such item triggers FIRSTER(container) to print the header.
 * NDESCBIT items are skipped in pass 2 for their own line, but if they are
 * SEE-INSIDE? they are still recursed into.
 *
 * @param container   The object whose children we iterate (room or container).
 * @param player      Excluded from all listings.
 * @param level       Current nesting level (−1 for the room, 0 for first-level
 *                    children, 1 for items inside containers on the floor, …).
 * @param tell        Output callback.
 */
function printCont(
  container: GameObject,
  player: GameObject,
  level: number,
  tell: (s: string) => void,
): void {
  // ZIL's object children are stored as a singly-linked list with MOVE
  // prepending each new child (FIRST child = last-defined object in ZIL
  // source).  Our JS Set preserves insertion order (append), so to match
  // ZIL's iteration order we traverse the children array in reverse.
  const children = Array.from(container.children).reverse();

  // ---- Pass 1: FDESC (untouched items with an FDESC) ----------------------
  for (const child of children) {
    if (child === player) continue;
    if (child.has(Flag.Invisible)) continue;
    // Pass 1 condition: not TOUCHBIT AND has FDESC.
    if (!child.has(Flag.Touched) && child.fdesc !== undefined) {
      if (!child.has(Flag.NonDescript)) {
        tell(child.fdesc);
      }
      // Recurse into open/transparent containers even if NDESCBIT.
      // Use level+1 so nested items get the correct indent depth:
      // a room-level fdesc container's contents appear at level 1.
      if (seeInside(child) && child.children.size > 0) {
        printCont(child, player, level + 1, tell);
      }
    }
  }

  // ---- Pass 2: TOUCHBIT / no-FDESC objects --------------------------------
  let firsterFired = false;
  let currentLevel = level;

  for (const child of children) {
    if (child === player) continue;
    if (child.has(Flag.Invisible)) continue;
    // Pass 2 condition: TOUCHBIT OR no FDESC.
    if (!child.has(Flag.Touched) && child.fdesc !== undefined) continue;

    if (!child.has(Flag.NonDescript)) {
      // First item: fire FIRSTER (prints the container header).
      if (!firsterFired) {
        firsterFired = true;
        currentLevel = level + 1;
        firster(container, level, tell);
      }
      describeObject(child, player, currentLevel, tell);
    } else {
      // NDESCBIT: skip printing this item, but still recurse if SEE-INSIDE?.
      if (seeInside(child) && child.children.size > 0) {
        printCont(child, player, level, tell);
      }
    }
  }
}

/**
 * DESCRIBE-OBJECTS (gverbs.zil:1681) — called after DESCRIBE-ROOM when the
 * room is LIT.  Calls PRINT-CONT on HERE at level −1.
 *
 * Emits output through `tell` rather than returning a string, to match ZIL's
 * TELL model and keep ordering consistent with room-handler output.
 *
 * Exported as `describeRoomObjects` so game.ts can call it from
 * `describeCurrentRoom()` without routing through the full verb machinery.
 */
export function describeRoomObjects(
  room: Room,
  player: GameObject,
  tell: (s: string) => void,
): void {
  if (Array.from(room.children).some(c => c !== player && !c.has(Flag.Invisible))) {
    printCont(room, player, -1, tell);
  }
}

/**
 * Produce the room description string: name, ldesc/M-LOOK, and the authentic
 * DESCRIBE-OBJECTS object listing (PRINT-CONT model from gverbs.zil:1681).
 *
 * `player` is excluded from the listing.  When `mlookRunner` is provided and
 * the room has no static ldesc but has a handler, the runner is called to
 * produce a dynamic description via the M-LOOK action — matching the ZIL
 * `<DESCRIBE-ROOM>` / `GOTO` path.
 */
function describeRoom(
  room: Room,
  player: GameObject,
  mlookRunner?: (r: Room) => string,
): string {
  const lines: string[] = [];
  lines.push(room.desc);

  if (room.ldesc) {
    lines.push(room.ldesc);
  } else if (mlookRunner !== undefined) {
    const dynamic = mlookRunner(room);
    if (dynamic.length > 0) lines.push(dynamic);
  }

  // DESCRIBE-OBJECTS: authentic PRINT-CONT model replacing "You can see: X."
  describeRoomObjects(room, player, (s) => lines.push(s));

  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Verb handlers
// --------------------------------------------------------------------------

function verbLook(ctx: VerbContext): VerbResult {
  return result(describeRoom(ctx.here, ctx.player, ctx.mlookRunner));
}

function verbGo(ctx: VerbContext): VerbResult {
  const dir = ctx.prep;
  if (!dir) return result("Go where?");

  const exit = ctx.here.exits.find(e => e.dir === dir);

  if (!exit) {
    return result("You can't go that way.");
  }

  // Exit with a `per` routine — try the resolver first.
  if (exit.per !== undefined) {
    const resolver = ctx.perResolver;
    if (resolver !== undefined) {
      const destId = resolver(exit.per, ctx.here);
      if (destId !== undefined) {
        const dest = ctx.world.get(destId);
        if (dest !== undefined) {
          ctx.player.moveTo(dest);
          return result(describeRoom(dest as Room, ctx.player, ctx.mlookRunner), true);
        }
      }
      // Resolver returned undefined: the routine decided movement is blocked.
      return result("You can't go that way.");
    }
    // No resolver available and exit has no static destination.
    if (exit.to === undefined) {
      return result(exit.elseMessage ?? "You can't go that way.");
    }
  }

  // ifFlag exits: the named object must have Flag.Open set, otherwise the
  // exit is blocked (ZIL COND checks the object's OPENBIT).
  if (exit.ifFlag !== undefined) {
    const gateObj = ctx.world.get(exit.ifFlag);
    if (gateObj === undefined || !gateObj.has(Flag.Open)) {
      return result(exit.elseMessage ?? "You can't go that way.");
    }
  }

  // Plain blocked exit (no destination, static message).
  if (exit.to === undefined) {
    return result(exit.elseMessage ?? "You can't go that way.");
  }

  const dest = ctx.world.get(exit.to);
  if (dest === undefined) {
    return result("You can't go that way.");
  }

  ctx.player.moveTo(dest);
  return result(describeRoom(dest as Room, ctx.player, ctx.mlookRunner), true);
}

function verbTake(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Take what?");

  // PRE-TAKE guard 1 & 2: PRSO IN? WINNER
  // (gverbs.zil:1356, 1358 — PRE-TAKE)
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

  item.moveTo(ctx.player);
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

  // DOORBIT path — gverbs.zil:980 "The [PRSO] opens."
  if (item.has(Flag.Door)) {
    return result(fmt(vOpen.opens, item.desc));
  }

  // CONTBIT path: check contents (gverbs.zil:983–985)
  const contents = Array.from(item.children).filter(c => !c.has(Flag.Invisible));
  if (contents.length > 0) {
    // Build "a X, a Y, and a Z" list (Oxford comma)
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

  // Empty container — gverbs.zil:975 "Opened."
  return result(vOpen.opened);
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

  // DOORBIT path — gverbs.zil:353 "The [PRSO] is now closed."
  if (item.has(Flag.Door)) {
    return result(fmt(vClose.doorClosed, item.desc));
  }

  // CONTBIT path — gverbs.zil:344 "Closed."
  return result(vClose.closed);
}

function verbRead(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Read what?");

  // Not READBIT — gverbs.zil:1145 "How does one read a [PRSO]?"
  if (!item.has(Flag.Readable)) {
    return result(fmt(vRead.notReadable, item.desc));
  }

  // READBIT is set — ZIL guarantees a TEXT property exists.
  // The extractor stores the key as 'TEXT' (upper-case, matching ZIL
  // convention); accept both casings so synthetic test fixtures using
  // lowercase 'text' continue to work.
  const text = item.props.get('TEXT') ?? item.props.get('text');
  if (typeof text === 'string') return result(text);
  // Fallback: ldesc if no text prop (should not occur in authentic data
  // but handles test fixtures that set Readable without a TEXT prop).
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

  // V-EXAMINE priority (gverbs.zil:623–630):
  //   1. TEXT property (P?TEXT) — same as V-READ but also fires for EXAMINE
  //   2. CONTBIT or DOORBIT → V-LOOK-INSIDE (show contents/state)
  //   3. Fallback: "There's nothing special about the [PRSO]."

  // Priority 1: explicit text prop
  const text = item.props.get('TEXT') ?? item.props.get('text');
  if (typeof text === 'string') return result(text);

  // Priority 2: ldesc (we map this to "has a meaningful description")
  // The ZIL V-LOOK-INSIDE is complex; for containers/doors, return ldesc if present.
  if (item.ldesc !== undefined) return result(item.ldesc);

  // Priority 3: fallback — "There's nothing special about the [PRSO]."
  return result(fmt(vExamine.nothingSpecial, item.desc));
}

function verbPut(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  const container = ctx.iobj;

  if (item === undefined) return result("Put what?");
  if (container === undefined) return result("Put it where?");

  // PRE-PUT/PRE-GIVE: not HELD? — gverbs.zil:710–711
  // "That's easy for you to say since you don't even have the [PRSO]."
  if (item.parent !== ctx.player) {
    return result(fmt(preGive.notHoldingIt, item.desc));
  }

  // V-PUT: PRSI not open and not openable — gverbs.zil:1090 "You can't do that."
  if (!container.has(Flag.Container) && !container.has(Flag.Surface)) {
    return result(vPut.cantDoThat);
  }

  // V-PUT: PRSI not OPENBIT — gverbs.zil:1093 "The [PRSI] isn't open."
  if (!container.has(Flag.Open)) {
    return result(fmt(vPut.notOpen, container.desc));
  }

  item.moveTo(container);
  return result(vPut.done);
}

// --------------------------------------------------------------------------
// Dispatch table
// --------------------------------------------------------------------------

type VerbHandler = (ctx: VerbContext) => VerbResult;

/**
 * Legacy verb-word keyed table — used as fallback when action is unknown or
 * when a handler was registered under the verb word rather than V-* action id.
 * Kept so existing callers that pass only a verb word continue to work.
 */
const HANDLERS: Record<string, VerbHandler> = {
  look:      verbLook,
  walk:      verbGo,      // parser normalizes "go/run/proceed" → "walk"
  take:      verbTake,
  drop:      verbDrop,
  open:      verbOpen,
  close:     verbClose,
  read:      verbRead,
  inventory: verbInventory,
  examine:   verbExamine,
  put:       verbPut,
};

/**
 * Primary dispatch table keyed on the resolved V-* action id (ParsedCommand.action).
 *
 * ZIL PERFORM dispatches on PRSA (the action number), not on the verb word
 * (gmain.zil:283–284).  This table is the port equivalent: the parser resolves
 * the syntax form → V-* action id, and executeVerb selects the handler here.
 *
 * Multi-action verbs (LOOK→{V-LOOK,V-EXAMINE,V-READ,…}, WALK→{V-WALK,…}, etc.)
 * are the motivating case: "look at mailbox" resolves to V-EXAMINE and must run
 * verbExamine, not verbLook.
 */
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
};

/**
 * Execute a verb given a fully-populated VerbContext.
 *
 * Dispatches on `action` (the V-* action id from ParsedCommand.action) when
 * provided, falling back to `ctx.verb` (the verb word) for backward compat.
 * Unknown verbs get a generic "I don't understand" response — the turn loop
 * can pass those to object handlers before giving up.
 */
export function executeVerb(ctx: VerbContext, action?: string): VerbResult {
  // Primary: dispatch on resolved action id (ZIL PERFORM on PRSA).
  if (action !== undefined) {
    const actionHandler = ACTION_HANDLERS[action];
    if (actionHandler !== undefined) {
      return actionHandler(ctx);
    }
  }
  // Fallback: dispatch on verb word (for callers that pre-date P2 fix,
  // and for actions not yet in ACTION_HANDLERS).
  const handler = HANDLERS[ctx.verb];
  if (handler === undefined) {
    return result(`I don't know how to "${ctx.verb}".`);
  }
  return handler(ctx);
}
