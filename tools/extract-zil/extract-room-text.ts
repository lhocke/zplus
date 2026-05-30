/**
 * extract-room-text.ts
 *
 * Extracts the EXACT, verbatim description text for every ROOM defined in
 * zil/1dungeon.zil and produces src/data/room-text.json.
 *
 * Two text sources exist in the ZIL source:
 *
 *   1. Static LDESC — a string literal in the ROOM form itself.
 *      These are trivially extracted by the s-expr reader.
 *
 *   2. Action-driven LDESC — rooms whose description is printed by a
 *      <ROUTINE …-FCN (RARG) <COND (<EQUAL? .RARG ,M-LOOK> <TELL "…"> …)>>
 *      pattern in 1actions.zil (or, rarely, 1dungeon.zil).
 *      The extractor finds the ROUTINE form whose name matches the room's
 *      actionRoutine, then gathers every TELL string literal that appears
 *      inside an <EQUAL? .RARG ,M-LOOK> branch.  When a branch is cleanly
 *      isolatable (no non-literal interpolations), mlook carries the joined
 *      text; otherwise the room is flagged for human review and mlook
 *      carries all TELL strings in the routine as candidates.
 *
 * Output shape (one entry per room id):
 *
 *   {
 *     id: string,                // ROOM id atom
 *     name: string,              // DESC string (normalized)
 *     source: { file: string, line: number },
 *     ldesc?: string,            // static LDESC, normalized
 *     mlook?: string[],          // M-LOOK TELL strings, normalized
 *     mlookSource?: { file: string, line: number },
 *     needsReview?: true,        // set when M-LOOK text could not be cleanly isolated
 *     reviewReason?: string,
 *   }
 *
 * The ZIL string normalizer from extract.ts is reused verbatim so that
 * pipe-separated lines (|) become real newlines and source-level newlines
 * within segments collapse to spaces — exactly as the game would render them.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSexpr } from './parse-sexpr.js';
import { normalizeZilString } from './extract.js';
import type { SNode, SList, SAtom, SString } from './parse-sexpr.js';

// ---------------------------------------------------------------------------
// Source location tracking
//
// The s-expr reader does not emit line numbers; we compute them by counting
// the newlines that precede a given character offset in the raw source.
// ---------------------------------------------------------------------------

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Node type guards
// ---------------------------------------------------------------------------

function isAtom(n: SNode): n is SAtom { return n.type === 'atom'; }
function isString(n: SNode): n is SString { return n.type === 'string'; }
function isList(n: SNode): n is SList { return n.type === 'list'; }

function head(list: SList): string | undefined {
  const first = list.items[0];
  return first && isAtom(first) ? (first as SAtom).value : undefined;
}

function second(list: SList): string | undefined {
  const item = list.items[1];
  return item && isAtom(item) ? (item as SAtom).value : undefined;
}

function secondString(list: SList): string | undefined {
  const item = list.items[1];
  return item && isString(item) ? (item as SString).value : undefined;
}

// ---------------------------------------------------------------------------
// Source-position-aware node scan
//
// We parse the raw source with a simple regex to map ROOM and ROUTINE
// identifiers to approximate line numbers; the s-expr reader itself is
// stateless with respect to position, so we do a secondary scan.
// ---------------------------------------------------------------------------

function buildLineIndex(src: string): Map<string, number> {
  const index = new Map<string, number>();
  // Match <ROOM ID and <ROUTINE ID patterns
  const re = /<(?:ROOM|ROUTINE)\s+([A-Z0-9\-?!]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const id = m[1];
    if (!index.has(id)) {
      index.set(id, lineAt(src, m.index));
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Collect TELL string literals from a TELL form or nested forms
//
// In ZIL a TELL looks like:
//   <TELL "string1" CR "string2" CR>
// or spans multiple nested <COND …> branches.
//
// collectTells gathers every string literal that is a direct argument to
// a TELL form; it does NOT recurse into conditionals by default.  The
// caller decides how deep to recurse.
// ---------------------------------------------------------------------------

function collectDirectTells(form: SList): string[] {
  const result: string[] = [];
  for (const item of form.items) {
    if (isString(item)) {
      result.push((item as SString).value);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// hasOnlyStringTells — true when every argument to a TELL form is a
// string literal or a named atom (CR / CRLF); i.e. there are no dynamic
// expressions like D ,PRSO that would change the rendered text at runtime.
// ---------------------------------------------------------------------------

function hasOnlyStringTells(form: SList): boolean {
  for (const item of form.items.slice(1)) { // skip 'TELL' head
    if (isString(item)) continue;
    if (isAtom(item)) {
      const v = (item as SAtom).value;
      // CR and CRLF are newline macros, not dynamic output
      if (v === 'CR' || v === 'CRLF') continue;
      // Any other atom is a dynamic reference — not purely static
      return false;
    }
    // A sub-list (e.g. D ,PRSO or ,SOMETHING) is dynamic
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Extract M-LOOK TELL strings from a ROUTINE form body
//
// Strategy:
//   Walk the items of the COND form in the routine body.
//   When we find an <EQUAL? .RARG ,M-LOOK> branch, collect every <TELL …>
//   form reachable from it (both direct and nested in further CONDs).
//   If all TELLs in that branch are purely static, the text is clean.
//   Otherwise the room is flagged for review.
//
// Returns:
//   { tells: string[], clean: boolean }
// ---------------------------------------------------------------------------

interface TellResult {
  tells: string[];
  clean: boolean;
}

function gatherTellsFromNode(node: SNode, result: string[], dirtyRef: { dirty: boolean }): void {
  if (!isList(node)) return;
  const list = node as SList;
  const h = head(list);

  if (h === 'TELL') {
    if (!hasOnlyStringTells(list)) {
      dirtyRef.dirty = true;
    }
    const strs = collectDirectTells(list);
    for (const s of strs) result.push(s);
    return;
  }

  // Recurse into COND / AND / OR / other list forms
  for (const item of list.items) {
    gatherTellsFromNode(item, result, dirtyRef);
  }
}

function extractMLookTells(routineBody: SNode[]): TellResult {
  // Find the top-level COND form in the routine body
  for (const node of routineBody) {
    if (!isList(node)) continue;
    const topList = node as SList;
    if (head(topList) !== 'COND') continue;

    // Each item after 'COND' is a (condition body…) clause
    for (let i = 1; i < topList.items.length; i++) {
      const clause = topList.items[i];
      if (!isList(clause)) continue;
      const clauseList = clause as SList;
      // The first item is the condition
      const cond = clauseList.items[0];
      if (!cond || !isList(cond)) continue;

      // Detect <EQUAL? .RARG ,M-LOOK>
      const condList = cond as SList;
      if (head(condList) !== 'EQUAL?') continue;

      // Check that both .RARG and ,M-LOOK are present as atoms
      const hasRarg = condList.items.some(
        n => isAtom(n) && (n as SAtom).value === '.RARG',
      );
      const hasMlook = condList.items.some(
        n => isAtom(n) && (n as SAtom).value === ',M-LOOK',
      );
      if (!hasRarg || !hasMlook) continue;

      // Found the M-LOOK branch — gather all TELL strings from its body
      const tells: string[] = [];
      const dirtyRef = { dirty: false };

      for (const bodyItem of clauseList.items.slice(1)) {
        gatherTellsFromNode(bodyItem, tells, dirtyRef);
      }

      return { tells, clean: !dirtyRef.dirty };
    }
  }

  return { tells: [], clean: true };
}

// ---------------------------------------------------------------------------
// Room-text record type (written to room-text.json)
// ---------------------------------------------------------------------------

export interface SourceLoc {
  file: string;
  line: number;
}

export interface RoomTextEntry {
  id: string;
  name: string;
  source: SourceLoc;
  ldesc?: string;
  mlook?: string[];
  mlookSource?: SourceLoc;
  needsReview?: true;
  reviewReason?: string;
}

// ---------------------------------------------------------------------------
// Main extraction logic
// ---------------------------------------------------------------------------

function extractRoomText(
  dungeonSrc: string,
  actionsSrc: string,
  dungeonFile: string,
  actionsFile: string,
): RoomTextEntry[] {
  const dungeonNodes = parseSexpr(dungeonSrc);
  const actionsNodes = parseSexpr(actionsSrc);

  // Build line indices for source location reporting
  const dungeonLines = buildLineIndex(dungeonSrc);
  const actionsLines = buildLineIndex(actionsSrc);

  // Index ROUTINE forms by name from both files
  interface RoutineInfo {
    body: SNode[];          // items after (RARG …) — the actual statements
    file: string;
    line: number;
  }

  function indexRoutines(nodes: SNode[], file: string, lineIndex: Map<string, number>): Map<string, RoutineInfo> {
    const map = new Map<string, RoutineInfo>();
    for (const node of nodes) {
      if (!isList(node)) continue;
      const form = node as SList;
      if (form.open !== '<') continue;
      if (head(form) !== 'ROUTINE') continue;
      const name = second(form);
      if (!name) continue;
      // The routine body is everything after the parameter list (items[2] onward)
      const body = form.items.slice(2);
      const line = lineIndex.get(name) ?? 0;
      map.set(name, { body, file, line });
    }
    return map;
  }

  const dungeonRoutines = indexRoutines(dungeonNodes, dungeonFile, dungeonLines);
  const actionsRoutines = indexRoutines(actionsNodes, actionsFile, actionsLines);

  // Merged routine lookup: dungeon takes precedence (CANYON-VIEW-F lives there)
  function lookupRoutine(name: string): RoutineInfo | undefined {
    return dungeonRoutines.get(name) ?? actionsRoutines.get(name);
  }

  // Walk dungeon nodes and extract every ROOM form
  const entries: RoomTextEntry[] = [];

  for (const node of dungeonNodes) {
    if (!isList(node)) continue;
    const form = node as SList;
    if (head(form) !== 'ROOM') continue;

    const idNode = form.items[1];
    if (!idNode || !isAtom(idNode)) continue;
    const id = (idNode as SAtom).value;

    let desc = '';
    let ldesc: string | undefined;
    let actionRoutine: string | undefined;

    for (let i = 2; i < form.items.length; i++) {
      const item = form.items[i];
      if (!isList(item)) continue;
      const tag = head(item as SList);
      if (!tag) continue;

      if (tag === 'DESC') {
        const raw = secondString(item as SList) ?? second(item as SList) ?? '';
        desc = normalizeZilString(raw);
      } else if (tag === 'LDESC') {
        const raw = secondString(item as SList);
        if (raw !== undefined) ldesc = normalizeZilString(raw);
      } else if (tag === 'ACTION') {
        actionRoutine = second(item as SList);
      } else if (tag === 'DESCFCN') {
        if (!actionRoutine) actionRoutine = second(item as SList);
      }
    }

    const sourceLine = dungeonLines.get(id) ?? 0;
    const entry: RoomTextEntry = {
      id,
      name: desc,
      source: { file: dungeonFile, line: sourceLine },
    };

    if (ldesc !== undefined) {
      entry.ldesc = ldesc;
    }

    // If the room has an action routine, try to extract M-LOOK text from it
    if (actionRoutine) {
      const routineInfo = lookupRoutine(actionRoutine);
      if (routineInfo) {
        const result = extractMLookTells(routineInfo.body);
        if (result.tells.length > 0) {
          entry.mlook = result.tells.map(normalizeZilString);
          entry.mlookSource = { file: routineInfo.file, line: routineInfo.line };
          if (!result.clean) {
            entry.needsReview = true;
            entry.reviewReason =
              'M-LOOK branch contains dynamic TELL arguments (e.g. D ,OBJ); ' +
              'mlook contains candidate strings only';
          }
        } else if (ldesc === undefined) {
          // Has action routine but no M-LOOK branch and no static LDESC
          entry.needsReview = true;
          entry.reviewReason =
            `Action routine ${actionRoutine} has no isolatable M-LOOK branch`;
        }
      } else if (ldesc === undefined) {
        // Referenced routine not found in either file
        entry.needsReview = true;
        entry.reviewReason =
          `Action routine ${actionRoutine} not found in dungeon or actions source`;
      }
    }

    entries.push(entry);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Main entry point — runs when invoked directly via tsx
// ---------------------------------------------------------------------------

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (
    process.argv[1].endsWith('/tools/extract-zil/extract-room-text.ts') ||
    process.argv[1].endsWith('/tools/extract-zil/extract-room-text.js')
  );

if (isMain) {
  const root = resolve(process.argv[1], '../../..');
  const zilDir = join(root, 'zil');
  const dataDir = join(root, 'src', 'data');
  const docsDir = join(root, 'docs', 'status');

  function readZil(name: string): string {
    return readFileSync(join(zilDir, name), 'utf8');
  }

  const dungeonSrc = readZil('1dungeon.zil');
  const actionsSrc = readZil('1actions.zil');

  const entries = extractRoomText(
    dungeonSrc,
    actionsSrc,
    'zil/1dungeon.zil',
    'zil/1actions.zil',
  );

  // Write room-text.json
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, 'room-text.json');
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${entries.length} room entries to ${outPath}`);

  // Compute coverage counts
  let staticLdesc = 0;
  let actionDriven = 0;
  let noneOrUnknown = 0;
  const needsReview: RoomTextEntry[] = [];

  for (const e of entries) {
    if (e.needsReview) needsReview.push(e);
    if (e.ldesc !== undefined) staticLdesc++;
    else if (e.mlook !== undefined && e.mlook.length > 0) actionDriven++;
    else noneOrUnknown++;
  }

  const total = entries.length;
  console.log(`  Total rooms:        ${total}`);
  console.log(`  Static LDESC:       ${staticLdesc}`);
  console.log(`  Action-driven desc: ${actionDriven}`);
  console.log(`  No description:     ${noneOrUnknown}`);
  console.log(`  Needs review:       ${needsReview.length}`);

  // Write coverage report
  mkdirSync(docsDir, { recursive: true });
  const coveragePath = join(docsDir, 'room-text-coverage.md');

  const reviewList =
    needsReview.length === 0
      ? '_None — all rooms cleanly extracted._\n'
      : needsReview
          .map(e => `- **${e.id}**: ${e.reviewReason ?? 'flagged'}`)
          .join('\n') + '\n';

  const report = [
    '# Room Text Coverage Report',
    '',
    `Generated from \`zil/1dungeon.zil\` + \`zil/1actions.zil\`.`,
    '',
    '## Counts',
    '',
    `| Category | Count |`,
    `|---|---|`,
    `| Total rooms | ${total} |`,
    `| Static LDESC (from ROOM form) | ${staticLdesc} |`,
    `| Action-driven description (M-LOOK branch) | ${actionDriven} |`,
    `| No description text found | ${noneOrUnknown} |`,
    `| Rooms flagged needs-review | ${needsReview.length} |`,
    '',
    '## Rooms Flagged needs-review',
    '',
    reviewList,
  ].join('\n');

  writeFileSync(coveragePath, report, 'utf8');
  console.log(`Wrote coverage report to ${coveragePath}`);
}

// Re-export for use in tests
export { extractRoomText };
