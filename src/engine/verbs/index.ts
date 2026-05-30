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
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import { Flag } from '../../domain/flags.js';

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

/**
 * Produce the room description string: name, ldesc, and a list of visible
 * items on the floor (non-player, non-invisible direct children of the room).
 */
function describeRoom(room: Room): string {
  const lines: string[] = [];
  lines.push(room.desc);
  if (room.ldesc) lines.push(room.ldesc);

  const loose: string[] = [];
  for (const child of room.children) {
    if (child.has(Flag.Invisible)) continue;
    // Skip the player actor itself.
    if (child.has(Flag.Invisible)) continue;
    loose.push(child.desc);
  }
  if (loose.length > 0) {
    lines.push('You can see: ' + loose.join(', ') + '.');
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Verb handlers
// --------------------------------------------------------------------------

function verbLook(ctx: VerbContext): VerbResult {
  return result(describeRoom(ctx.here));
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
          return result(describeRoom(dest as Room), true);
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

  // Plain blocked exit (no destination, static message).
  if (exit.to === undefined) {
    return result(exit.elseMessage ?? "You can't go that way.");
  }

  const dest = ctx.world.get(exit.to);
  if (dest === undefined) {
    return result("You can't go that way.");
  }

  ctx.player.moveTo(dest);
  return result(describeRoom(dest as Room), true);
}

function verbTake(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Take what?");

  if (item.parent === ctx.player) {
    return result(`You're already carrying the ${item.desc}.`);
  }

  if (!item.has(Flag.Takeable)) {
    return result(`You can't take the ${item.desc}.`);
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

  if (item.has(Flag.Open)) {
    return result(`The ${item.desc} is already open.`);
  }

  if (!item.has(Flag.Container) && !item.has(Flag.Door)) {
    return result(`You can't open the ${item.desc}.`);
  }

  item.set(Flag.Open);

  // If the container has contents, list them.
  const contents = Array.from(item.children).filter(c => !c.has(Flag.Invisible));
  if (contents.length > 0) {
    const names = contents.map(c => c.desc).join(', ');
    return result(`Opened. Inside you see: ${names}.`);
  }

  return result(`The ${item.desc} is now open.`);
}

function verbClose(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Close what?");

  if (!item.has(Flag.Open)) {
    return result(`The ${item.desc} is already closed.`);
  }

  item.clear(Flag.Open);
  return result(`The ${item.desc} is now closed.`);
}

function verbRead(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  if (item === undefined) return result("Read what?");

  if (!item.has(Flag.Readable)) {
    return result(`There's nothing to read on the ${item.desc}.`);
  }

  // Prefer an explicit text prop; fall back to ldesc, then desc.
  const text = item.props.get('text');
  if (typeof text === 'string') return result(text);
  if (item.ldesc) return result(item.ldesc);
  return result(`The ${item.desc} has nothing written on it.`);
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

  return result(item.ldesc ?? item.desc);
}

function verbPut(ctx: VerbContext): VerbResult {
  const item = ctx.dobj;
  const container = ctx.iobj;

  if (item === undefined) return result("Put what?");
  if (container === undefined) return result("Put it where?");

  if (item.parent !== ctx.player) {
    return result(`You're not carrying the ${item.desc}.`);
  }

  if (!container.has(Flag.Container)) {
    return result(`You can't put things in the ${container.desc}.`);
  }

  if (!container.has(Flag.Open)) {
    return result(`The ${container.desc} is closed.`);
  }

  item.moveTo(container);
  return result(`Done.`);
}

// --------------------------------------------------------------------------
// Dispatch table
// --------------------------------------------------------------------------

type VerbHandler = (ctx: VerbContext) => VerbResult;

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
 * Execute a verb given a fully-populated VerbContext.
 *
 * Returns a VerbResult with the output text and a moved flag.  Unknown verbs
 * get a generic "I don't understand" response rather than throwing — the turn
 * loop can pass those to object handlers before giving up.
 */
export function executeVerb(ctx: VerbContext): VerbResult {
  const handler = HANDLERS[ctx.verb];
  if (handler === undefined) {
    return result(`I don't know how to "${ctx.verb}".`);
  }
  return handler(ctx);
}
