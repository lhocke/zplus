/**
 * ZIL → ObjectData / SyntaxEntry / VocabularyData extractor.
 *
 * Turns parsed ROOM and OBJECT s-expression forms into ObjectData records
 * suitable for writing to src/data/objects.json.
 *
 * Also extracts SYNTAX and SYNONYM/BUZZ forms into SyntaxEntry[] and
 * VocabularyData, suitable for src/data/syntax.json and vocabulary.json.
 *
 * Handles:
 *   - ROOM forms: exits (TO fixed destination or PER routine), flags, DESC/LDESC/FDESC
 *   - OBJECT forms: synonyms, adjectives, parent (from IN clause), flags, props, ACTION
 *   - Flag name mapping: ZIL *BIT atoms → Flag enum string names
 *   - kind inference: room vs thing vs container vs actor (from flags/properties)
 *   - SYNTAX forms: verb + optional particle, DO slot, prep2, IO slot → action handler
 *   - SYNONYM forms: canonical word → alias list
 *   - BUZZ forms: filler words the parser should discard
 */

import type { SNode, SList, SAtom, SString } from './parse-sexpr.js';

// ---------------------------------------------------------------------------
// Re-exported types (frozen contracts from the implementation plan)
// ---------------------------------------------------------------------------

export type ObjectId = string;

export type Dir = 'north' | 'south' | 'east' | 'west' | 'ne' | 'nw' | 'se' | 'sw'
                | 'up' | 'down' | 'in' | 'out';

export interface Exit {
  readonly dir: Dir;
  readonly to?: ObjectId;
  readonly per?: string;
  readonly ifFlag?: ObjectId;
  readonly elseMessage?: string;
}

export interface ObjectData {
  id: ObjectId;
  kind: 'room' | 'thing' | 'container' | 'actor';
  desc: string;
  ldesc?: string;
  fdesc?: string;
  flags: string[];
  props: Record<string, number | string>;
  parent?: ObjectId;
  synonyms: string[];
  adjectives: string[];
  exits?: Exit[];
  actionRoutine?: string;
}

// ---------------------------------------------------------------------------
// Direction name normalisation — ZIL uses upper-case atoms
// ---------------------------------------------------------------------------

const DIR_MAP: Record<string, Dir> = {
  NORTH: 'north',
  SOUTH: 'south',
  EAST: 'east',
  WEST: 'west',
  NE: 'ne',
  NW: 'nw',
  SE: 'se',
  SW: 'sw',
  UP: 'up',
  DOWN: 'down',
  IN: 'in',
  OUT: 'out',
  LAND: 'out', // ZIL LAND direction — used for entering the dungeon
};

// ---------------------------------------------------------------------------
// Flag name mapping — ZIL *BIT atoms → Flag enum string names
//
// Unrecognised atoms are passed through as-is; this keeps the extractor
// forward-compatible with any flags added to the enum later.
// ---------------------------------------------------------------------------

const FLAG_MAP: Record<string, string> = {
  LIGHTBIT: 'Light',
  ONBIT: 'Light',        // ONBIT = lamp/room is currently lit
  TAKEBIT: 'Takeable',
  TRYTAKEBIT: 'Takeable',
  CONTBIT: 'Container',
  OPENBIT: 'Open',
  DOORBIT: 'Door',
  TRANSBIT: 'Transparent',
  FLAMEBIT: 'OnFire',
  BURNBIT: 'Burned',
  WEAPONBIT: 'Weapon',
  FOODBIT: 'Food',
  DRINKBIT: 'Drink',
  READBIT: 'Readable',
  TURNBIT: 'Turnable',
  CLIMBBIT: 'Climbable',
  SACREDBIT: 'Sacred',
  INVISIBLE: 'Invisible',
  TOUCHBIT: 'Touched',
  VEHBIT: 'Vehicle',
  MAZEBIT: 'Maze',
  RLANDBIT: 'Land',
  NDESCBIT: 'NonDescript',
  NONLANDBIT: 'NonDescript',
  SEARCHBIT: 'Searchable',
  SURFACEBIT: 'Surface',
  // Flags that don't map 1-to-1 to the enum — kept as raw names
  ACTORBIT: 'Takeable',  // actors are not takeable; will be refined by kind
  TOOLBIT: 'Takeable',
};

/** Map a ZIL flag atom to a Flag enum name. Unknown atoms pass through. */
function mapFlag(zilBit: string): string {
  return FLAG_MAP[zilBit] ?? zilBit;
}

// ---------------------------------------------------------------------------
// Numeric property names — ZIL slots that carry integer values
// ---------------------------------------------------------------------------

const NUMERIC_PROPS = new Set([
  'SIZE', 'CAPACITY', 'VALUE', 'TVALUE', 'STRENGTH',
  'SCORE', 'STREN', 'STAGSTR',
]);

// ---------------------------------------------------------------------------
// Helpers for navigating the s-expression tree
// ---------------------------------------------------------------------------

function isAtom(n: SNode): n is SAtom {
  return n.type === 'atom';
}

function isString(n: SNode): n is SString {
  return n.type === 'string';
}

function isList(n: SNode): n is SList {
  return n.type === 'list';
}

/** Return the head atom value of a list, or undefined. */
function head(list: SList): string | undefined {
  const first = list.items[0];
  return first && isAtom(first) ? first.value : undefined;
}

/** Return the second item of a list as an atom value, or undefined. */
function second(list: SList): string | undefined {
  const item = list.items[1];
  return item && isAtom(item) ? item.value : undefined;
}

/** Return the second item of a list as a string value, or undefined. */
function secondString(list: SList): string | undefined {
  const item = list.items[1];
  return item && isString(item) ? item.value : undefined;
}

// ---------------------------------------------------------------------------
// ZIL string normalization
// ---------------------------------------------------------------------------

/**
 * Normalize ZIL string semantics:
 *   - Replace each '|' with '\n' ('|' is ZIL's explicit line-break character).
 *   - Collapse runs of (optional-spaces newline optional-spaces) that appear
 *     in the raw source text into a single space.  In ZIL, a bare newline
 *     inside a string literal is a word separator, not a line break.
 *
 * Applied in order:
 *   1. Replace '|' with '\n' (explicit ZIL newlines become real newlines).
 *   2. Collapse source newlines to spaces — but only within the segments
 *      between the original '|' separators (so the '\n' replacements for
 *      '|' are preserved).  This is achieved by splitting on '|' first,
 *      normalising source newlines within each segment, then joining with '\n'.
 */
export function normalizeZilString(s: string): string {
  // Split on '|'; each segment between pipes has its source-level newlines
  // collapsed.  Leading/trailing whitespace (which comes from source indentation
  // or line continuation around the '|' separator) is trimmed from each segment
  // so that adjacent '|' pairs produce clean '\n\n' blank-line breaks.
  const segments = s.split('|');
  const normalised = segments.map(seg => {
    // Collapse optional whitespace + newline + optional whitespace to one space.
    const collapsed = seg.replace(/[ \t]*\n[ \t]*/g, ' ');
    // Trim leading/trailing spaces that result from source indentation around '|'.
    return collapsed.trim();
  });
  // Re-join with '\n' — these are the explicit ZIL line breaks.
  return normalised.join('\n');
}

// ---------------------------------------------------------------------------
// Exit extraction from a direction sub-list
//
// ZIL exit forms:
//   (NORTH TO DEST-ROOM)            — fixed destination
//   (DOWN PER MAZE-DIODES)          — routine-based
//   (EAST "Sorry, the door is locked.")  — blocked with message
//   (EAST TO DEST IF FLAG ELSE "msg")   — conditional (rare)
// ---------------------------------------------------------------------------

function parseExit(list: SList): Exit | null {
  const dirAtom = head(list);
  if (!dirAtom) return null;

  const dir = DIR_MAP[dirAtom];
  if (!dir) return null; // not a direction clause

  const items = list.items;

  // (DIR "blocked message") — string in second position means blocked exit
  if (items.length === 2 && isString(items[1])) {
    return { dir, elseMessage: (items[1] as SString).value };
  }

  // (DIR TO DEST)
  // (DIR PER ROUTINE)
  if (items.length >= 3 && isAtom(items[1])) {
    const keyword = (items[1] as SAtom).value;
    const target = items[2];

    if (keyword === 'TO' && target && isAtom(target)) {
      const exit: Exit = { dir, to: (target as SAtom).value };

      // Optional conditional: (DIR TO DEST IF FLAG ELSE "msg")
      //   items[3] = IF, items[4] = FLAG-ID, items[5] = ELSE, items[6] = "msg"
      if (items[3] && isAtom(items[3]) && (items[3] as SAtom).value === 'IF') {
        const flagNode = items[4];
        const flag = flagNode && isAtom(flagNode) ? (flagNode as SAtom).value : undefined;
        const elseMsg = items[6] && isString(items[6]) ? (items[6] as SString).value : undefined;
        return {
          ...exit,
          ...(flag ? { ifFlag: flag } : {}),
          ...(elseMsg ? { elseMessage: elseMsg } : {}),
        };
      }

      return exit;
    }

    if (keyword === 'PER' && target && isAtom(target)) {
      return { dir, per: (target as SAtom).value };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Kind inference
//
// ZIL doesn't have a separate 'kind' field — we infer it from flags and
// whether the top-level form is ROOM vs OBJECT.
// ---------------------------------------------------------------------------

function inferKind(
  isRoom: boolean,
  rawFlags: string[],
): ObjectData['kind'] {
  if (isRoom) return 'room';
  const flagSet = new Set(rawFlags);
  if (flagSet.has('ACTORBIT')) return 'actor';
  if (flagSet.has('CONTBIT')) return 'container';
  return 'thing';
}

// ---------------------------------------------------------------------------
// Single form extraction
// ---------------------------------------------------------------------------

function extractOne(form: SList): ObjectData | null {
  const formHead = head(form);
  if (formHead !== 'ROOM' && formHead !== 'OBJECT') return null;

  const isRoom = formHead === 'ROOM';

  // Second item is the object id
  const idNode = form.items[1];
  if (!idNode || !isAtom(idNode)) return null;
  const id = (idNode as SAtom).value;

  let desc = '';
  let ldesc: string | undefined;
  let fdesc: string | undefined;
  const rawFlags: string[] = [];
  const mappedFlags: string[] = [];
  const props: Record<string, number | string> = {};
  let parent: ObjectId | undefined;
  const synonyms: string[] = [];
  const adjectives: string[] = [];
  const exits: Exit[] = [];
  let actionRoutine: string | undefined;

  // Walk property sub-lists (items 2..n)
  for (let i = 2; i < form.items.length; i++) {
    const item = form.items[i];
    if (!isList(item)) continue;

    const tag = head(item);
    if (!tag) continue;

    switch (tag) {
      case 'DESC': {
        const rawDesc = secondString(item) ?? second(item) ?? '';
        desc = normalizeZilString(rawDesc);
        break;
      }

      case 'LDESC': {
        const rawLdesc = secondString(item);
        ldesc = rawLdesc !== undefined ? normalizeZilString(rawLdesc) : undefined;
        break;
      }

      case 'FDESC': {
        const rawFdesc = secondString(item);
        fdesc = rawFdesc !== undefined ? normalizeZilString(rawFdesc) : undefined;
        break;
      }

      case 'IN': {
        // (IN PARENT-ID) — for objects, this is the containment parent
        // Room containers like ROOMS, GLOBAL-OBJECTS, LOCAL-GLOBALS are
        // not real game-object parents; we skip them.
        const parentId = second(item);
        if (
          parentId &&
          parentId !== 'ROOMS' &&
          parentId !== 'GLOBAL-OBJECTS' &&
          parentId !== 'LOCAL-GLOBALS' &&
          parentId !== 'PLAYERS' &&
          parentId !== 'MOUNTAINS'
        ) {
          parent = parentId;
        }
        break;
      }

      case 'FLAGS': {
        // Remaining items after 'FLAGS' are the flag atoms
        for (let j = 1; j < item.items.length; j++) {
          const fn = item.items[j];
          if (isAtom(fn)) {
            const raw = (fn as SAtom).value;
            rawFlags.push(raw);
            const mapped = mapFlag(raw);
            if (!mappedFlags.includes(mapped)) {
              mappedFlags.push(mapped);
            }
          }
        }
        break;
      }

      case 'SYNONYM': {
        for (let j = 1; j < item.items.length; j++) {
          const n = item.items[j];
          if (isAtom(n)) synonyms.push((n as SAtom).value);
        }
        break;
      }

      case 'ADJECTIVE': {
        for (let j = 1; j < item.items.length; j++) {
          const n = item.items[j];
          if (isAtom(n)) adjectives.push((n as SAtom).value);
        }
        break;
      }

      case 'ACTION': {
        actionRoutine = second(item);
        break;
      }

      case 'DESCFCN': {
        // Description function — treated as action routine when no ACTION present
        if (!actionRoutine) actionRoutine = second(item);
        break;
      }

      default: {
        // Direction clauses are handled here for ROOM forms
        if (isRoom && DIR_MAP[tag] !== undefined) {
          const exit = parseExit(item);
          if (exit) exits.push(exit);
          break;
        }

        // Numeric properties (SIZE, VALUE, CAPACITY, etc.)
        if (NUMERIC_PROPS.has(tag)) {
          const val = second(item);
          if (val !== undefined) {
            props[tag] = Number(val);
          }
          break;
        }

        // Everything else is stored as a generic prop
        // String value — normalize ZIL '|' and source newlines.
        const strVal = secondString(item);
        if (strVal !== undefined) {
          props[tag] = normalizeZilString(strVal);
          break;
        }
        // Atom value
        const atomVal = second(item);
        if (atomVal !== undefined) {
          props[tag] = atomVal;
        }
        break;
      }
    }
  }

  const kind = inferKind(isRoom, rawFlags);

  const record: ObjectData = {
    id,
    kind,
    desc,
    flags: mappedFlags,
    props,
    synonyms,
    adjectives,
  };

  if (ldesc !== undefined) record.ldesc = ldesc;
  if (fdesc !== undefined) record.fdesc = fdesc;
  if (parent !== undefined) record.parent = parent;
  if (actionRoutine !== undefined) record.actionRoutine = actionRoutine;
  if (isRoom && exits.length > 0) record.exits = exits;

  return record;
}

// ---------------------------------------------------------------------------
// Public API — object extraction
// ---------------------------------------------------------------------------

/**
 * Walk an array of top-level SNodes (output of parseSexpr) and extract every
 * ROOM and OBJECT form into an ObjectData record.
 *
 * Non-ROOM/OBJECT forms (GLOBAL, DIRECTIONS, strings, etc.) are silently
 * skipped — this mirrors the ZIL source, which mixes declarations freely.
 */
export function extractObjects(nodes: SNode[]): ObjectData[] {
  const results: ObjectData[] = [];
  for (const node of nodes) {
    if (!isList(node)) continue;
    const record = extractOne(node);
    if (record) results.push(record);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Syntax types
// ---------------------------------------------------------------------------

/** One object slot in a SYNTAX declaration: (FIND FLAG?) (scope…). */
export interface ObjectSlot {
  /** ZIL flag atom that must be set on the object (e.g. "TAKEBIT"). */
  readonly find?: string;
  /** Scope / access constraints (e.g. ["ON-GROUND", "IN-ROOM", "MANY"]). */
  readonly where: string[];
}

/**
 * Raw parsed SYNTAX declaration from gsyntax.zil — the extractor's intermediate format.
 *
 * Example ZIL:  <SYNTAX TAKE OBJECT (FIND TAKEBIT) (ON-GROUND IN-ROOM MANY)
 *                              = V-TAKE PRE-TAKE>
 * Result: { verb: 'TAKE', directObject: {find:'TAKEBIT', where:[...]},
 *           action: 'V-TAKE', preAction: 'PRE-TAKE' }
 *
 * This raw type is normalized to SyntaxEntryOut (the port-native schema) by
 * normalizeSyntaxEntry() in syntax-normalize.ts before being written to
 * src/data/syntax.json.
 */
export interface SyntaxEntryRaw {
  /** Main verb word, upper-case (e.g. "TAKE"). */
  readonly verb: string;
  /** Preposition / particle before the direct-object slot, if any (e.g. "IN", "UP"). */
  readonly preposition?: string;
  /** Direct-object slot, if present. */
  readonly directObject?: ObjectSlot;
  /** Preposition between direct and indirect object slots, if any (e.g. "FROM", "WITH"). */
  readonly preposition2?: string;
  /** Indirect-object slot, if present. */
  readonly indirectObject?: ObjectSlot;
  /** Handler routine name (e.g. "V-TAKE"). */
  readonly action: string;
  /** Optional pre-action routine name (e.g. "PRE-TAKE"). */
  readonly preAction?: string;
}

/**
 * Port-native SyntaxEntry — re-exported from syntax-normalize for callers that
 * import from this module. This is the schema written to src/data/syntax.json
 * and consumed by the data-driven parser.
 */
export type { SyntaxEntryOut as SyntaxEntry } from './syntax-normalize.js';

/**
 * Aggregated vocabulary data for the parser.
 *
 * synonyms maps each canonical word to its aliases
 * (e.g. "TAKE" → ["GET", "HOLD", "CARRY", "REMOVE", "GRAB", "CATCH"]).
 *
 * buzzwords are filler words the parser silently drops
 * (e.g. "A", "AN", "THE", "IS").
 */
export interface VocabularyData {
  readonly synonyms: Record<string, string[]>;
  readonly buzzwords: string[];
}

// ---------------------------------------------------------------------------
// Syntax extraction helpers
// ---------------------------------------------------------------------------

/**
 * Parse one object slot from the items that follow the OBJECT keyword.
 *
 * An object slot is represented by zero, one, or two parenthesised lists:
 *   (FIND FLAGBIT)       — optional find constraint
 *   (scope1 scope2 …)   — access-scope list
 *
 * The two lists are optional and can appear in either order; the presence of
 * a FIND atom in the first position distinguishes them.
 *
 * Returns the slot and advances `pos` past both optional lists.
 * `pos` must point to the item immediately after the OBJECT atom.
 */
function parseObjectSlot(items: SNode[], pos: number): { slot: ObjectSlot; next: number } {
  let find: string | undefined;
  const where: string[] = [];
  let i = pos;

  // Consume up to two optional parenthesised lists after OBJECT
  while (i < items.length) {
    const item = items[i];
    if (!isList(item)) break;
    const h = head(item as SList);
    if (h === 'FIND') {
      const flagAtom = (item as SList).items[1];
      if (flagAtom && isAtom(flagAtom)) {
        find = (flagAtom as SAtom).value;
      }
      i++;
    } else {
      // Scope list — all items are atoms giving access constraints
      for (const n of (item as SList).items) {
        if (isAtom(n)) where.push((n as SAtom).value);
      }
      i++;
      // A FIND list may follow the scope list too; peek ahead
      if (i < items.length && isList(items[i])) {
        const nextH = head(items[i] as SList);
        if (nextH === 'FIND') {
          const flagAtom = (items[i] as SList).items[1];
          if (flagAtom && isAtom(flagAtom)) {
            find = (flagAtom as SAtom).value;
          }
          i++;
        }
      }
      break;
    }
  }

  return { slot: find !== undefined ? { find, where } : { where }, next: i };
}

/**
 * Parse a single <SYNTAX …> form into a SyntaxEntry.
 *
 * Grammar (simplified):
 *   <SYNTAX verb
 *     [particle]
 *     [OBJECT (FIND flag)? (scope…)]
 *     [prep2 [OBJECT (FIND flag)? (scope…)]]
 *     = ACTION [PRE-ACTION]>
 */
function parseSyntaxForm(form: SList): SyntaxEntryRaw | null {
  // Must start with SYNTAX
  if (head(form) !== 'SYNTAX') return null;
  // Second item is the verb atom
  const verbNode = form.items[1];
  if (!verbNode || !isAtom(verbNode)) return null;
  const verb = (verbNode as SAtom).value;

  let preposition: string | undefined;
  let directObject: ObjectSlot | undefined;
  let preposition2: string | undefined;
  let indirectObject: ObjectSlot | undefined;
  let action = '';
  let preAction: string | undefined;

  const items = form.items;
  let i = 2; // start after verb

  // Collect everything up to the '=' separator
  // The '=' sign is an atom with value '='
  while (i < items.length) {
    const cur = items[i];

    if (!isAtom(cur)) { i++; continue; }
    const val = (cur as SAtom).value;

    if (val === '=') {
      // Action (and optional pre-action) follow the '='
      const actionNode = items[i + 1];
      if (actionNode && isAtom(actionNode)) {
        action = (actionNode as SAtom).value;
      }
      const preNode = items[i + 2];
      if (preNode && isAtom(preNode)) {
        preAction = (preNode as SAtom).value;
      }
      break;
    }

    if (val === 'OBJECT') {
      if (directObject === undefined) {
        // First OBJECT → direct-object slot
        const parsed = parseObjectSlot(items, i + 1);
        directObject = parsed.slot;
        i = parsed.next;
      } else {
        // Second OBJECT → indirect-object slot
        const parsed = parseObjectSlot(items, i + 1);
        indirectObject = parsed.slot;
        i = parsed.next;
      }
      continue;
    }

    // Any other atom before a direct-object slot is a particle/preposition.
    // Any atom between DO and IO is prep2.
    if (directObject === undefined) {
      preposition = val;
    } else {
      preposition2 = val;
    }
    i++;
  }

  if (!action) return null;

  const entry: Record<string, unknown> = { verb, action };
  if (preposition !== undefined) entry['preposition'] = preposition;
  if (directObject !== undefined) entry['directObject'] = directObject;
  if (preposition2 !== undefined) entry['preposition2'] = preposition2;
  if (indirectObject !== undefined) entry['indirectObject'] = indirectObject;
  if (preAction !== undefined) entry['preAction'] = preAction;
  return entry as unknown as SyntaxEntryRaw;
}

// ---------------------------------------------------------------------------
// Public API — syntax + vocabulary extraction
// ---------------------------------------------------------------------------

/**
 * Walk an array of top-level SNodes and extract every <SYNTAX …> form into a
 * SyntaxEntryRaw.  All other forms are silently skipped.
 */
export function extractSyntax(nodes: SNode[]): SyntaxEntryRaw[] {
  const results: SyntaxEntryRaw[] = [];
  for (const node of nodes) {
    if (!isList(node)) continue;
    const form = node as SList;
    if (form.open !== '<') continue;
    if (head(form) !== 'SYNTAX') continue;
    const entry = parseSyntaxForm(form);
    if (entry) results.push(entry);
  }
  return results;
}

/**
 * Walk an array of top-level SNodes and aggregate all <SYNONYM …> and
 * <BUZZ …> forms into a VocabularyData record.
 *
 * <SYNONYM TAKE GET HOLD …>  → synonyms['TAKE'] = ['GET', 'HOLD', …]
 * <BUZZ A AN THE IS …>       → buzzwords = ['A', 'AN', 'THE', 'IS', …]
 */
export function extractVocabulary(nodes: SNode[]): VocabularyData {
  const synonyms: Record<string, string[]> = {};
  const buzzSet = new Set<string>();

  for (const node of nodes) {
    if (!isList(node)) continue;
    const form = node as SList;
    if (form.open !== '<') continue;

    const tag = head(form);

    if (tag === 'SYNONYM') {
      // First item after the tag is the canonical word; rest are aliases
      const canonical = form.items[1];
      if (!canonical || !isAtom(canonical)) continue;
      const key = (canonical as SAtom).value;
      if (!synonyms[key]) synonyms[key] = [];
      for (let j = 2; j < form.items.length; j++) {
        const n = form.items[j];
        if (isAtom(n)) synonyms[key].push((n as SAtom).value);
      }
    } else if (tag === 'BUZZ') {
      for (let j = 1; j < form.items.length; j++) {
        const n = form.items[j];
        if (isAtom(n)) buzzSet.add((n as SAtom).value);
      }
    }
  }

  return { synonyms, buzzwords: Array.from(buzzSet) };
}

// ---------------------------------------------------------------------------
// Main entry — runs when the file is executed directly via `npm run extract`
// ---------------------------------------------------------------------------

// In ESM with tsx, detect direct execution via import.meta.url vs argv
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (
    process.argv[1].endsWith('/tools/extract-zil/extract.ts') ||
    process.argv[1].endsWith('/tools/extract-zil/extract.js')
  );

if (isMain) {
  (async () => {
    const { readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const { parseSexpr } = await import('./parse-sexpr.js');
    const { emitData } = await import('./emit.js');

    const root = resolve(process.argv[1], '../../..');
    const zilDir = join(root, 'zil');
    const dataDir = join(root, 'src', 'data');
    const domainDir = join(root, 'src', 'domain');

    function read(file: string): string {
      return readFileSync(join(zilDir, file), 'utf8');
    }

    console.log('Extracting from ZIL sources...');

    // Objects + rooms come from 1dungeon.zil
    const dungeonNodes = parseSexpr(read('1dungeon.zil'));
    const objects = extractObjects(dungeonNodes);
    console.log(`  1dungeon.zil: ${objects.length} objects/rooms`);

    // Syntax definitions come from gsyntax.zil (and a small number from gverbs.zil)
    const syntaxNodes = parseSexpr(read('gsyntax.zil'));
    const gverbsNodes = parseSexpr(read('gverbs.zil'));
    const syntax = [
      ...extractSyntax(syntaxNodes),
      ...extractSyntax(gverbsNodes),
    ];
    console.log(`  gsyntax.zil + gverbs.zil: ${syntax.length} syntax entries`);

    // Vocabulary (synonyms + buzzwords) across all four files
    const actionsNodes = parseSexpr(read('1actions.zil'));
    const vocab = {
      synonyms: {} as Record<string, string[]>,
      buzzwords: [] as string[],
    };
    for (const nodes of [dungeonNodes, actionsNodes, syntaxNodes, gverbsNodes]) {
      const v = extractVocabulary(nodes);
      for (const [k, aliases] of Object.entries(v.synonyms)) {
        if (!vocab.synonyms[k]) vocab.synonyms[k] = [];
        for (const a of aliases) {
          if (!vocab.synonyms[k].includes(a)) vocab.synonyms[k].push(a);
        }
      }
      for (const w of v.buzzwords) {
        if (!vocab.buzzwords.includes(w)) vocab.buzzwords.push(w);
      }
    }
    console.log(
      `  vocabulary: ${Object.keys(vocab.synonyms).length} synonym groups, ` +
      `${vocab.buzzwords.length} buzzwords`
    );

    emitData(objects, syntax, vocab, { dataDir, domainDir });
    console.log(`Wrote to ${dataDir} and ${domainDir}`);
  })();
}
