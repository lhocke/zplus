import type { SNode, SList, SAtom, SString } from './parse-sexpr.js';

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

/**
 * One entry in a room's PSEUDO declaration.
 *
 * ZIL form: (PSEUDO "word1" routine1 "word2" routine2 ...)
 * Extracted as: [{ word: "word1", action: "routine1" }, { word: "word2", action: "routine2" }, ...]
 *
 * PSEUDO objects are scenery words the parser recognises inside a specific room;
 * when matched, the action routine is dispatched instead of a normal object lookup.
 */
export interface PseudoEntry {
  /** Noun word (UPPERCASE) that matches this pseudo-object. */
  word: string;
  /** Port-native action id to invoke when this word is matched. */
  action: string;
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
  /** Per-room pseudo-objects: scenery words that forward to action routines. */
  pseudo?: PseudoEntry[];
}

// ZIL uses upper-case direction atoms
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

// ZIL *BIT atoms → Flag enum string names; unknown atoms pass through as-is
const FLAG_MAP: Record<string, string> = {
  LIGHTBIT: 'Light',
  ONBIT: 'On',           // ONBIT on rooms = always-lit (outdoor); on objects = currently on (Flag.OnFire handles the object case at runtime)
  TAKEBIT: 'Takeable',
  CONTBIT: 'Container',
  OPENBIT: 'Open',
  DOORBIT: 'Door',
  TRANSBIT: 'Transparent',
  FLAMEBIT: 'OnFire',
  BURNBIT: 'Flammable',
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
  NONLANDBIT: 'NonLand',  // water/non-land rooms (RESERVOIR, RIVER-*); distinct from NDESCBIT
  SEARCHBIT: 'Searchable',
  SURFACEBIT: 'Surface',
  // Flags that don't map 1-to-1 to the enum — kept as raw names
  ACTORBIT: 'Actor',   // NPC/actor flag — used by GWIM (FIND ACTORBIT)
  TOOLBIT: 'Tool',     // tool/instrument flag — used by GWIM (FIND TOOLBIT)
  TRYTAKEBIT: 'TryTake', // parser auto-takes before action (TAKE-CHECK)
};

function mapFlag(zilBit: string): string {
  return FLAG_MAP[zilBit] ?? zilBit;
}

const NUMERIC_PROPS = new Set([
  'SIZE', 'CAPACITY', 'VALUE', 'TVALUE', 'STRENGTH',
  'SCORE', 'STREN', 'STAGSTR',
]);

function isAtom(n: SNode): n is SAtom {
  return n.type === 'atom';
}

function isString(n: SNode): n is SString {
  return n.type === 'string';
}

function isList(n: SNode): n is SList {
  return n.type === 'list';
}

function head(list: SList): string | undefined {
  const first = list.items[0];
  return first && isAtom(first) ? first.value : undefined;
}

function second(list: SList): string | undefined {
  const item = list.items[1];
  return item && isAtom(item) ? item.value : undefined;
}

function secondString(list: SList): string | undefined {
  const item = list.items[1];
  return item && isString(item) ? item.value : undefined;
}

// '|' is ZIL's explicit line-break; bare source newlines inside strings are
// word separators (not breaks) — collapse them to spaces within each segment.
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

// ZIL exit forms: (NORTH TO DEST), (DOWN PER ROUTINE), (EAST "blocked msg"),
//   (EAST TO DEST IF FLAG ELSE "msg")
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

// ZIL has no explicit kind — infer from flags and whether the form is ROOM vs OBJECT
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
  let pseudo: PseudoEntry[] | undefined;

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

      case 'PSEUDO': {
        // ZIL form: (PSEUDO "word1" routine1 "word2" routine2 ...)
        // Alternating string (noun word) and atom (action routine name).
        // Parse all pairs and emit as a pseudo: PseudoEntry[] array on the room.
        // The old extractor stored only props.PSEUDO = first word; this replaces it.
        const pairs: PseudoEntry[] = [];
        let j = 1;
        while (j + 1 < item.items.length) {
          const wordNode = item.items[j];
          const routineNode = item.items[j + 1];
          if (isString(wordNode) && isAtom(routineNode)) {
            pairs.push({
              word: (wordNode as SString).value.toUpperCase(),
              action: (routineNode as SAtom).value,
            });
          }
          j += 2;
        }
        if (pairs.length > 0) pseudo = pairs;
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
  if (pseudo !== undefined) record.pseudo = pseudo;

  return record;
}

export function extractObjects(nodes: SNode[]): ObjectData[] {
  const results: ObjectData[] = [];
  for (const node of nodes) {
    if (!isList(node)) continue;
    const record = extractOne(node);
    if (record) results.push(record);
  }
  return results;
}

export interface ObjectSlot {
  /** ZIL flag atom that must be set on the object (e.g. "TAKEBIT"). */
  readonly find?: string;
  /** Scope / access constraints (e.g. ["ON-GROUND", "IN-ROOM", "MANY"]). */
  readonly where: string[];
}

// Raw parsed SYNTAX declaration; normalized to SyntaxEntryOut by syntax-normalize.ts.
// Example: <SYNTAX TAKE OBJECT (FIND TAKEBIT) (ON-GROUND IN-ROOM MANY) = V-TAKE PRE-TAKE>
export interface SyntaxEntryRaw {
  readonly verb: string;
  readonly preposition?: string;
  readonly directObject?: ObjectSlot;
  readonly preposition2?: string;
  readonly indirectObject?: ObjectSlot;
  readonly action: string;
  readonly preAction?: string;
}

export type { SyntaxEntryOut as SyntaxEntry } from './syntax-normalize.js';

export interface VocabularyData {
  readonly verbSynonyms: Record<string, string[]>;
  readonly directionSynonyms: Record<string, string[]>;
  readonly prepSynonyms: Record<string, string[]>;
  readonly buzzwords: string[];
}

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

// Direction canonicals from gglobals.zil:5; prep canonicals from gsyntax.zil:20-23
const DIRECTION_CANONICALS = new Set([
  'NORTH', 'SOUTH', 'EAST', 'WEST',
  'NE', 'NW', 'SE', 'SW',
  'UP', 'DOWN', 'IN', 'OUT', 'LAND',
]);

const PREP_CANONICALS = new Set(['WITH', 'IN', 'ON', 'UNDER']);

export function extractVocabulary(nodes: SNode[]): VocabularyData {
  const verbSynonyms: Record<string, string[]> = {};
  const directionSynonyms: Record<string, string[]> = {};
  const prepSynonyms: Record<string, string[]> = {};
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

      // Collect aliases
      const aliases: string[] = [];
      for (let j = 2; j < form.items.length; j++) {
        const n = form.items[j];
        if (isAtom(n)) aliases.push((n as SAtom).value);
      }

      // Classify into the appropriate typed table.
      // Preposition check comes before direction check because IN is both;
      // when IN has synonym aliases (gsyntax.zil:21) it is a prep, not a direction.
      if (PREP_CANONICALS.has(key)) {
        if (!prepSynonyms[key]) prepSynonyms[key] = [];
        for (const a of aliases) {
          if (!prepSynonyms[key].includes(a)) prepSynonyms[key].push(a);
        }
      } else if (DIRECTION_CANONICALS.has(key)) {
        if (!directionSynonyms[key]) directionSynonyms[key] = [];
        for (const a of aliases) {
          if (!directionSynonyms[key].includes(a)) directionSynonyms[key].push(a);
        }
      } else {
        if (!verbSynonyms[key]) verbSynonyms[key] = [];
        for (const a of aliases) {
          if (!verbSynonyms[key].includes(a)) verbSynonyms[key].push(a);
        }
      }
    } else if (tag === 'BUZZ') {
      for (let j = 1; j < form.items.length; j++) {
        const n = form.items[j];
        if (isAtom(n)) buzzSet.add((n as SAtom).value);
      }
    }
  }

  return { verbSynonyms, directionSynonyms, prepSynonyms, buzzwords: Array.from(buzzSet) };
}

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
    const vocab: {
      verbSynonyms: Record<string, string[]>;
      directionSynonyms: Record<string, string[]>;
      prepSynonyms: Record<string, string[]>;
      buzzwords: string[];
    } = {
      verbSynonyms: {},
      directionSynonyms: {},
      prepSynonyms: {},
      buzzwords: [],
    };

    function mergeTable(
      target: Record<string, string[]>,
      source: Record<string, string[]>,
    ): void {
      for (const [k, aliases] of Object.entries(source)) {
        if (!target[k]) target[k] = [];
        for (const a of aliases) {
          if (!target[k].includes(a)) target[k].push(a);
        }
      }
    }

    for (const nodes of [dungeonNodes, actionsNodes, syntaxNodes, gverbsNodes]) {
      const v = extractVocabulary(nodes);
      mergeTable(vocab.verbSynonyms, v.verbSynonyms);
      mergeTable(vocab.directionSynonyms, v.directionSynonyms);
      mergeTable(vocab.prepSynonyms, v.prepSynonyms);
      for (const w of v.buzzwords) {
        if (!vocab.buzzwords.includes(w)) vocab.buzzwords.push(w);
      }
    }

    // GIVE→HAND: gsyntax.zil:234-235 wraps <SYNONYM GIVE HAND> in a
    // <COND (<N==? ,ZORK-NUMBER 3> ...)> block.  The extractor only processes
    // top-level SYNONYM forms, so this alias is never seen.  The condition
    // N==? ZORK-NUMBER 3 means "if ZORK-NUMBER is not 3", which is always
    // true for Zork I (ZORK-NUMBER = 1).  Add it explicitly here.
    if (!vocab.verbSynonyms['GIVE']) vocab.verbSynonyms['GIVE'] = [];
    if (!vocab.verbSynonyms['GIVE'].includes('HAND')) {
      vocab.verbSynonyms['GIVE'].push('HAND');
    }

    const verbCount = Object.keys(vocab.verbSynonyms).length;
    const dirCount = Object.keys(vocab.directionSynonyms).length;
    const prepCount = Object.keys(vocab.prepSynonyms).length;
    console.log(
      `  vocabulary: ${verbCount} verb groups, ${dirCount} direction groups, ` +
      `${prepCount} prep groups, ${vocab.buzzwords.length} buzzwords`
    );

    emitData(objects, syntax, vocab, { dataDir, domainDir });
    console.log(`Wrote to ${dataDir} and ${domainDir}`);
  })();
}
