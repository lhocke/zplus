import type { ObjectId } from '../../domain/game-object.js';
import type { Room } from '../../domain/room.js';
import type { World } from '../../domain/world.js';
import type { GameObject } from '../../domain/game-object.js';
import type { ParsedCommand, ParseResult } from './types.js';
import { Flag } from '../../domain/flags.js';
import { tokenize, splitChained } from './tokenizer.js';
import {
  lookupVerb,
  DIRECTIONS,
  normalizeDir,
  isPreposition,
  normalizePrep,
} from './vocabulary.js';

// ---------------------------------------------------------------------------
// PRE-action lookup — Wave B4
//
// Resolves the ZIL PRE-* routine name (from syntax.json `preAction` fields)
// for a given parsed command.  Used at PERFORM step 3 to dispatch the
// pre-action guard before the default V-* verb at step 7.
//
// The lookup distinguishes one-object (no PRSI) and two-object (PRSI present)
// forms, because many verbs have different preActions for each:
//   BURN  1-obj → no preAction (match handler claims it via step 6)
//   BURN  2-obj → PRE-BURN (with-instrument form)
//   DROP  1-obj → PRE-DROP
//   DROP  2-obj → PRE-PUT  (drop X in Y)
//   MOVE  1-obj → PRE-MOVE
//   MOVE  2-obj → PRE-TURN (move X with tool)
//
// Wave C will replace this with full SyntaxEntry form matching from syntax.json
// (prep-sensitive, dobjLocBit-sensitive).  For Wave B, verb + hasIobj is the
// minimal discriminant that produces correct behavior for the reachable test corpus.
//
// Derived from: python3 analysis of src/data/syntax.json preAction fields.
// ---------------------------------------------------------------------------

/**
 * preAction for 1-object forms (no PRSI / hasIobj = false).
 * Only verbs whose syntax.json 1-object form carries a preAction are listed.
 */
const VERB_PRE_1OBJ: Readonly<Record<string, string>> = {
  board:  'PRE-BOARD',
  climb:  'PRE-BOARD',  // "climb in X" form
  drop:   'PRE-DROP',
  fill:   'PRE-FILL',
  leave:  'PRE-DROP',
  move:   'PRE-MOVE',
  pick:   'PRE-TAKE',   // "pick up X" form
  pour:   'PRE-DROP',
  pull:   'PRE-MOVE',
  read:   'PRE-READ',
  roll:   'PRE-MOVE',
  take:   'PRE-TAKE',
};

/**
 * preAction for 2-object forms (PRSI present / hasIobj = true).
 * Only verbs whose syntax.json 2-object form carries a preAction are listed.
 */
const VERB_PRE_2OBJ: Readonly<Record<string, string>> = {
  apply:    'PRE-PUT',
  burn:     'PRE-BURN',
  destroy:  'PRE-MUNG',
  drop:     'PRE-PUT',   // "drop X in Y" → PRE-PUT
  fill:     'PRE-FILL',
  give:     'PRE-GIVE',
  light:    'PRE-BURN',
  look:     'PRE-READ',  // "look at X with Y" → PRE-READ
  move:     'PRE-TURN',  // "move X with tool" → PRE-TURN
  pick:     'PRE-TAKE',  // "pick up X" with iobj (rare)
  poke:     'PRE-MUNG',
  pour:     'PRE-DROP',
  puncture: 'PRE-MUNG',
  push:     'PRE-TURN',
  put:      'PRE-PUT',
  read:     'PRE-READ',
  squeeze:  'PRE-PUT',
  take:     'PRE-TAKE',
  throw:    'PRE-PUT',
  turn:     'PRE-TURN',
};

/**
 * Look up the PRE-* preaction for a canonical verb + iobj-presence combination.
 *
 * Returns the ZIL PRE-* routine name (e.g. "PRE-TAKE"), or undefined when the
 * matched syntax form has no preAction.
 *
 * Wave B: uses static maps derived from syntax.json analysis.
 * Wave C will replace this with full SyntaxEntry matching.
 */
function lookupPreActionForVerb(
  canonicalVerb: string,
  hasIobj: boolean,
): string | undefined {
  return hasIobj
    ? VERB_PRE_2OBJ[canonicalVerb]
    : VERB_PRE_1OBJ[canonicalVerb];
}

// --------------------------------------------------------------------------
// Scope: what objects are reachable from the current room
// --------------------------------------------------------------------------

/**
 * Collect objects visible and reachable from a given room.
 * Includes:
 *  - Direct children of the room
 *  - Children of open containers in the room
 *  - GLOBAL objects referenced by the room's GLOBAL prop (ZIL globals)
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

  // ZIL GLOBAL objects: the room's GLOBAL prop holds the id of an object that
  // is always accessible from this room regardless of containment.  Add it
  // (and its visible contents) to scope.
  const globalId = room.props.get('GLOBAL');
  if (typeof globalId === 'string') {
    const globalObj = world.get(globalId);
    if (globalObj !== undefined && !seen.has(globalObj.id)) {
      seen.add(globalObj.id);
      scope.push(globalObj);
      // Also add visible children of the global (e.g. objects on a table).
      for (const child of globalObj.children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          scope.push(child);
        }
      }
    }
  }

  // Exit gate objects: any object referenced by an exit's ifFlag is accessible
  // from this room (the player can interact with it to open the route).
  for (const exit of room.exits) {
    if (exit.ifFlag !== undefined) {
      const gateObj = world.get(exit.ifFlag);
      if (gateObj !== undefined && !seen.has(gateObj.id)) {
        seen.add(gateObj.id);
        scope.push(gateObj);
      }
    }
  }

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
        kind: 'fail',
        message: `You haven't mentioned any ${noun === 'it' ? 'thing' : 'things'} recently.`,
      },
    };
  }

  const matches = matchNoun(noun, adjectives, scope);

  if (matches.length === 0) {
    return {
      ok: false,
      result: {
        kind: 'fail',
        message: `I don't know the word "${noun}".`,
      },
    };
  }

  if (matches.length === 1) {
    return { ok: true, id: matches[0]!.id };
  }

  // Multiple matches — ambiguous; emit a disambiguation prompt.
  return {
    ok: false,
    result: {
      kind: 'disambig',
      message: `Which ${noun} do you mean, ${matches.map(m => m.desc).join(' or ')}?`,
    },
  };
}

// --------------------------------------------------------------------------
// Parser class — stateful: holds pronoun bindings across turns.
// --------------------------------------------------------------------------

/**
 * A stateful parser instance.  Call `parse()` to resolve a command string
 * against the current scope.  The parser reads `itRef` (the IT pronoun
 * referent) during noun resolution; the Game writes it by calling
 * `bindPronouns()` from the PERFORM prologue (gmain.zil:202–203) after each
 * non-WALK command with a direct object.
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
    if (tokens.length === 0) {
      return { kind: 'fail', message: 'I beg your pardon?' };
    }

    const scope = collectScope(room, player, world);

    // Compass shorthand: bare direction token → walk <dir>
    if (tokens.length === 1 && DIRECTIONS.has(tokens[0]!)) {
      return {
        kind: 'ok',
        command: {
          verb: 'walk',
          action: 'V-WALK',
          dobjIds: undefined,
          iobjIds: undefined,
          prep: normalizeDir(tokens[0]!),
          raw: tokens,
        } satisfies ParsedCommand,
      };
    }

    const rawVerb = tokens[0]!;
    const canonical = lookupVerb(rawVerb);
    if (canonical === undefined) {
      return {
        kind: 'fail',
        message: `I don't know the word "${rawVerb}".`,
      };
    }

    const rest = tokens.slice(1);
    if (rest.length === 0) {
      return {
        kind: 'ok',
        command: {
          verb: canonical,
          action: 'V-' + canonical.toUpperCase(),
          preAction: lookupPreActionForVerb(canonical, false),
          raw: tokens,
        },
      };
    }

    const { dobjTokens, prep, iobjTokens } = splitOnPrep(rest);

    let dobjIds: ObjectId[] | undefined;
    let iobjIds: ObjectId[] | undefined;

    // Resolve direct object if any tokens remain.
    if (dobjTokens.length > 0) {
      const r = resolveNounPhrase(dobjTokens, scope, this.itRef);
      if (!r.ok) return r.result;
      if (r.id !== (undefined as unknown as ObjectId)) {
        dobjIds = [r.id];
      }
    }

    // Resolve indirect object if a preposition and tokens follow.
    if (prep !== undefined && iobjTokens.length > 0) {
      const r = resolveNounPhrase(iobjTokens, scope, this.itRef);
      if (!r.ok) return r.result;
      if (r.id !== (undefined as unknown as ObjectId)) {
        iobjIds = [r.id];
      }
    }

    // Look up the PRE-* preaction for this verb form (Wave B4).
    // Wave B uses a static lookup from VERB_PRE_ACTION; Wave C will replace
    // this with full SyntaxEntry matching from syntax.json.
    const preAction = lookupPreActionForVerb(canonical, iobjIds !== undefined);

    return {
      kind: 'ok',
      command: {
        verb: canonical,
        action: 'V-' + canonical.toUpperCase(),
        dobjIds,
        iobjIds,
        prep,
        preAction,
        raw: tokens,
      },
    };
  }

  /**
   * Parse a chained input string — one with segments separated by "." or
   * "then" — returning one ParseResult per segment.  Processing stops at the
   * first error: the error result is appended and the remainder is discarded.
   *
   * IT pronoun binding is NOT propagated within this call — that is the
   * PERFORM prologue's job (Game.turn(), gmain.zil:202–203).  The parser only
   * READS itRef (which the game set on a prior turn).  Within-chain "take lamp
   * then examine it" requires Wave C's interleaved parse-and-dispatch model;
   * for now, cross-turn IT binding is the supported path (B3).
   *
   * "take all" / "drop all" and "take all except <noun>" are expanded here:
   * each takeable (or inventory item for drop) in scope becomes its own
   * ParseResult in the output list.
   */
  parseChained(
    input: string,
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult[] {
    const segments = splitChained(input);
    if (segments.length === 0) return [{ kind: 'fail', message: 'I beg your pardon?' }];

    const results: ParseResult[] = [];

    for (const tokens of segments) {
      // Detect "all" / "all except" patterns for multi-item expansion.
      const expanded = this.tryExpandAll(tokens, room, player, world);
      if (expanded !== null) {
        results.push(...expanded);
        // "take all" is a terminal segment — don't chain further.
        break;
      }

      // Normal single parse.
      const segment = tokens.join(' ');
      const result = this.parse(segment, room, player, world);
      results.push(result);

      if (result.kind !== 'ok') {
        // Stop chaining at first error.
        break;
      }
      // Note: IT-binding (bindPronouns) is NOT called here.  Per B3, the
      // authoritative binding site is the PERFORM prologue in Game.turn()
      // (gmain.zil:202–203), not inside the parser.  The parser only READS
      // itRef; the game writes it.  Within-chain IT propagation for same-line
      // segments (e.g. "take lamp then examine it" in one input) is a Wave C
      // concern — Wave C will interleave parsing and dispatch so the prologue
      // binding precedes each subsequent segment's parse.
    }

    return results;
  }

  /**
   * Try to interpret a token array as an "all" or "all except <noun>" form
   * for take/drop/get.  Returns an array of ParseResults (one per matching
   * object) when the pattern is recognised, or null when it isn't.
   *
   * Recognised forms:
   *   take all
   *   get all
   *   take all except <noun>
   *   drop all
   */
  private tryExpandAll(
    tokens: string[],
    room: Room,
    player: GameObject | null,
    world: World,
  ): ParseResult[] | null {
    if (tokens.length < 2) return null;

    const rawVerb = tokens[0]!;
    const canonical = lookupVerb(rawVerb);
    if (canonical === undefined) return null;

    // Only "take" (and synonym "get") and "drop" support "all" expansion.
    if (canonical !== 'take' && canonical !== 'drop') return null;

    // Must contain the word "all".
    const allIdx = tokens.indexOf('all');
    if (allIdx === -1) return null;

    // Determine excluded object id (for "all except <noun>").
    let excludeId: ObjectId | undefined;
    const exceptIdx = tokens.indexOf('except');
    if (exceptIdx !== -1 && exceptIdx > allIdx) {
      const exceptTokens = tokens.slice(exceptIdx + 1);
      if (exceptTokens.length > 0) {
        const scope = collectScope(room, player, world);
        const phrase = splitNounPhrase(exceptTokens);
        if (phrase !== null) {
          const matches = matchNoun(phrase.noun, phrase.adjectives, scope);
          if (matches.length === 1) excludeId = matches[0]!.id;
          // If ambiguous or not found, we simply don't exclude anything —
          // the engine will handle it when executing.
        }
      }
    }

    const scope = collectScope(room, player, world);

    // For "take all": pick every takeable object in scope.
    // For "drop all": pick every takeable object without a parent (inventory
    //   shortcut) or carried by the player.
    const candidates: GameObject[] =
      canonical === 'take'
        ? scope.filter(o => o.has(Flag.Takeable))
        : scope.filter(o => o.has(Flag.Takeable) && (o.parent === null || o.parent === player));

    const matches = candidates.filter(o => o.id !== excludeId);

    if (matches.length === 0) return [];

    return matches.map(obj => ({
      kind: 'ok' as const,
      command: {
        verb: canonical,
        action: 'V-' + canonical.toUpperCase(),
        dobjIds: [obj.id],
        iobjIds: undefined,
        prep: undefined,
        preAction: lookupPreActionForVerb(canonical, false),
        raw: tokens,
      },
    }));
  }

  /**
   * Update pronoun state from a successfully resolved command.
   * The direct object becomes the new "it" / "them" referent.
   *
   * Called from the PERFORM prologue in Game.turn() (gmain.zil:202–203) for
   * non-WALK commands that have a direct object — NOT from inside the parser
   * itself.  The parser only READS itRef during noun resolution; the game
   * writes it (B3 seam: parser reads, PERFORM prologue writes).
   *
   * Also called directly by tests to simulate the game binding a referent.
   */
  bindPronouns(cmd: ParsedCommand): void {
    const dobjId = cmd.dobjIds?.[0];
    if (dobjId !== undefined) {
      this.itRef = dobjId;
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
