import type { ObjectId } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import type { GameObject } from '../../domain/game-object.js';
import type { ParsedCommand, ParseResult } from './types.js';
import { Flag } from '../../domain/flags.js';
import { tokenize } from './tokenizer.js';
import {
  lookupVerb,
  DIRECTIONS,
  normalizeDir,
  isPreposition,
  normalizePrep,
} from './vocabulary.js';

// --------------------------------------------------------------------------
// Scope: what objects are reachable from the current room
// --------------------------------------------------------------------------

/**
 * Collect objects visible and reachable from a given room.
 * Includes:
 *  - Direct children of the room
 *  - Children of open containers in the room
 *  - Objects carried by the player (parent === null means inventory)
 *
 * The player argument is the actor object; if null we treat inventory as
 * the set of objects with no parent (only relevant for tests).
 */
function collectScope(room: Room, player: GameObject | null, world: World): GameObject[] {
  const scope: GameObject[] = [];
  const seen = new Set<ObjectId>();

  function addTree(obj: GameObject, depth: number): void {
    if (seen.has(obj.id)) return;
    seen.add(obj.id);
    // Always add the object itself (except the room — it's the container, not
    // a target).
    if (depth > 0) scope.push(obj);
    // Recurse into open containers (or transparent ones).
    const openable = obj.has(Flag.Container) && (obj.has(Flag.Open) || obj.has(Flag.Transparent));
    const alwaysOpen = !obj.has(Flag.Container); // non-containers have traversable children (e.g. rooms)
    if (depth === 0 || openable || alwaysOpen) {
      for (const child of obj.children) {
        addTree(child, depth + 1);
      }
    }
  }

  // Objects in the room.
  addTree(room, 0);

  // Player's inventory (objects whose parent is the player, or null-parent
  // when there is no explicit player object in the world, as in simple tests).
  if (player !== null) {
    for (const item of player.children) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        scope.push(item);
      }
    }
  } else {
    // Test shortcut: add all world objects with null parent that aren't rooms.
    for (const obj of world.all()) {
      if (obj.parent === null && !seen.has(obj.id)) {
        // Skip the room itself.
        if (obj !== room) {
          seen.add(obj.id);
          scope.push(obj);
        }
      }
    }
  }

  return scope;
}

// --------------------------------------------------------------------------
// Noun resolution
// --------------------------------------------------------------------------

/**
 * Given a noun token (and optional adjective tokens), find matching objects
 * within the provided scope list.
 *
 * An object matches if:
 *  - The noun appears in its synonyms list (case-insensitive), AND
 *  - Every adjective token also appears in its adjectives list (or synonyms).
 */
function matchNoun(
  noun: string,
  adjectives: string[],
  scope: GameObject[],
): GameObject[] {
  const nounLc = noun.toLowerCase();
  return scope.filter(obj => {
    const synMatch = obj.synonyms.some(s => s.toLowerCase() === nounLc);
    if (!synMatch) return false;
    if (adjectives.length === 0) return true;
    return adjectives.every(adj => {
      const adjLc = adj.toLowerCase();
      return (
        obj.adjectives.some(a => a.toLowerCase() === adjLc) ||
        obj.synonyms.some(s => s.toLowerCase() === adjLc)
      );
    });
  });
}

// --------------------------------------------------------------------------
// Token-stream helpers
// --------------------------------------------------------------------------

/**
 * Given the tokens after the verb, split on the first preposition token,
 * returning [dobjTokens, prep|undefined, iobjTokens].
 */
function splitOnPrep(
  tokens: string[],
): { dobjTokens: string[]; prep?: string; iobjTokens: string[] } {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isPreposition(t)) {
      return {
        dobjTokens: tokens.slice(0, i),
        prep: normalizePrep(t),
        iobjTokens: tokens.slice(i + 1),
      };
    }
  }
  return { dobjTokens: tokens, prep: undefined, iobjTokens: [] };
}

/**
 * Separate adjective tokens from the final noun token in a noun phrase.
 * The last token is assumed to be the noun; everything before it is
 * treated as adjectives.
 */
function splitNounPhrase(tokens: string[]): { noun: string; adjectives: string[] } | null {
  if (tokens.length === 0) return null;
  const noun = tokens[tokens.length - 1]!;
  const adjectives = tokens.slice(0, -1);
  return { noun, adjectives };
}

// --------------------------------------------------------------------------
// Resolve a noun-phrase against scope; return a ParseResult fragment.
// A resolved pronoun id can be supplied to short-circuit normal lookup.
// --------------------------------------------------------------------------

type ResolveResult =
  | { ok: true; id: ObjectId }
  | { ok: false; result: ParseResult };

function resolveNounPhrase(
  tokens: string[],
  scope: GameObject[],
  pronounRef?: ObjectId,
): ResolveResult {
  const phrase = splitNounPhrase(tokens);
  if (phrase === null) return { ok: true, id: undefined as unknown as ObjectId };

  const { noun, adjectives } = phrase;

  // Pronoun short-circuit: "it" or "them" with no adjectives resolves to the
  // caller-supplied referent (or fails if none was bound).
  const isPronoun = (noun === 'it' || noun === 'them') && adjectives.length === 0;
  if (isPronoun) {
    if (pronounRef !== undefined) {
      return { ok: true, id: pronounRef };
    }
    return {
      ok: false,
      result: {
        kind: 'unknown-word',
        word: noun,
        message: `You haven't mentioned any ${noun === 'it' ? 'thing' : 'things'} recently.`,
      },
    };
  }

  const matches = matchNoun(noun, adjectives, scope);

  if (matches.length === 0) {
    return {
      ok: false,
      result: {
        kind: 'unknown-word',
        word: noun,
        message: `I don't know the word "${noun}".`,
      },
    };
  }

  if (matches.length === 1) {
    return { ok: true, id: matches[0]!.id };
  }

  // Multiple matches — ambiguous.
  return {
    ok: false,
    result: {
      kind: 'ambiguous',
      noun,
      candidates: matches.map(m => m.id),
      message: `Which ${noun} do you mean, ${matches.map(m => m.desc).join(' or ')}?`,
    },
  };
}

// --------------------------------------------------------------------------
// Parser class — stateful: holds pronoun bindings across turns.
// --------------------------------------------------------------------------

/**
 * A stateful parser instance.  Call `parse()` to resolve a command string
 * against the current scope, then call `bindPronouns()` with the resulting
 * ParsedCommand to update the pronoun state for the next turn.
 *
 * The canonical pronouns are "it" (last DO) and "them" (same binding — Zork
 * treats them identically for single-object commands).
 */
export class Parser {
  /** Last resolved direct-object id — bound to "it" / "them". */
  private itRef: ObjectId | undefined = undefined;

  /**
   * Parse a single command string against the current room context.
   *
   * @param input   Raw player input (one command segment — no chaining).
   * @param room    The room the player is currently in (defines scope).
   * @param player  The player actor for inventory scope; null in tests.
   * @param world   The full world, used for scope collection.
   */
  parse(
    input: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult {
    const tokens = tokenize(input);
    if (tokens.length === 0) return { kind: 'empty' };

    const scope = collectScope(room, player, world);

    // Compass shorthand: bare direction token → walk <dir>
    if (tokens.length === 1 && DIRECTIONS.has(tokens[0]!)) {
      return {
        kind: 'ok',
        command: {
          verb: 'walk',
          dobjId: undefined,
          iobjId: undefined,
          prep: normalizeDir(tokens[0]!),
          raw: tokens,
        } satisfies ParsedCommand,
      };
    }

    const rawVerb = tokens[0]!;
    const canonical = lookupVerb(rawVerb);
    if (canonical === undefined) {
      return {
        kind: 'unknown-word',
        word: rawVerb,
        message: `I don't know the word "${rawVerb}".`,
      };
    }

    const rest = tokens.slice(1);
    if (rest.length === 0) {
      return {
        kind: 'ok',
        command: { verb: canonical, raw: tokens },
      };
    }

    const { dobjTokens, prep, iobjTokens } = splitOnPrep(rest);

    let dobjId: ObjectId | undefined;
    let iobjId: ObjectId | undefined;

    // Resolve direct object if any tokens remain.
    if (dobjTokens.length > 0) {
      const r = resolveNounPhrase(dobjTokens, scope, this.itRef);
      if (!r.ok) return r.result;
      dobjId = r.id;
    }

    // Resolve indirect object if a preposition and tokens follow.
    if (prep !== undefined && iobjTokens.length > 0) {
      const r = resolveNounPhrase(iobjTokens, scope, this.itRef);
      if (!r.ok) return r.result;
      iobjId = r.id;
    }

    return {
      kind: 'ok',
      command: { verb: canonical, dobjId, iobjId, prep, raw: tokens },
    };
  }

  /**
   * Update pronoun state from a successfully executed command.
   * The direct object becomes the new "it" / "them" referent.
   * Call this after the engine confirms the command was accepted (not on
   * parser errors or disambig prompts).
   */
  bindPronouns(cmd: ParsedCommand): void {
    if (cmd.dobjId !== undefined) {
      this.itRef = cmd.dobjId;
    }
    // If there is no dobj but there is an iobj, the DO is what gets referenced
    // in most Zork interactions (the acted-upon thing). We leave itRef as-is
    // when no dobj was present so the previous referent persists.
  }
}

// --------------------------------------------------------------------------
// Module-level parse function — kept for backward compat with Task 2.2 tests.
// Creates a one-shot parser with no pronoun state.
// --------------------------------------------------------------------------

/**
 * Parse a single command string against the current room context.
 * This is a convenience wrapper around `new Parser().parse(...)` for
 * callers that do not need pronoun state across turns.
 */
export function parse(
  input: string,
  room: Room,
  player: GameObject | null,
  world: World,
): ParseResult {
  return new Parser().parse(input, room, player, world);
}

export type { ParsedCommand, ParseResult };
