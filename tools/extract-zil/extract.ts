/**
 * ZIL → ObjectData extractor.
 *
 * Turns parsed ROOM and OBJECT s-expression forms into ObjectData records
 * suitable for writing to src/data/objects.json.
 *
 * Handles:
 *   - ROOM forms: exits (TO fixed destination or PER routine), flags, DESC/LDESC/FDESC
 *   - OBJECT forms: synonyms, adjectives, parent (from IN clause), flags, props, ACTION
 *   - Flag name mapping: ZIL *BIT atoms → Flag enum string names
 *   - kind inference: room vs thing vs container vs actor (from flags/properties)
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
        desc = secondString(item) ?? second(item) ?? '';
        break;
      }

      case 'LDESC': {
        ldesc = secondString(item);
        break;
      }

      case 'FDESC': {
        fdesc = secondString(item);
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
        // String value
        const strVal = secondString(item);
        if (strVal !== undefined) {
          props[tag] = strVal;
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
// Public API
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
