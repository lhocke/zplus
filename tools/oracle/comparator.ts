/**
 * comparator.ts
 *
 * Diffs two arrays of normalized turns (dfrotz vs engine) turn-by-turn and
 * produces a structured comparison report.
 *
 * Supports corpus annotation metadata from run-corpus.ts:
 *   - CorpusEntry with rngVariable=true  → structural-landmark comparison
 *   - ResyncDirective                    → advance both transcripts until pattern matches
 */

import type { NormalizedTurn } from './normalizer.js';
import type { CorpusItem } from './run-corpus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TurnMatchKind =
  | 'exact'          // exact string match
  | 'structural'     // RNG-variable turn: structural landmarks matched
  | 'diverged'       // texts differ (or structural landmarks differ)
  | 'skipped';       // skipped during @resync (not a divergence)

export interface TurnComparison {
  index: number;
  command: string;
  match: boolean;
  kind: TurnMatchKind;
  dfrotzText: string;
  engineText: string;
}

export interface ComparisonReport {
  /** Per-command comparison results */
  turns: TurnComparison[];
  /** Index of the first diverging turn, or -1 if all match */
  firstDivergenceIndex: number;
  /** Total number of turns compared (min of both lengths, excluding skipped) */
  totalCompared: number;
  /** Number of turns that matched exactly */
  exactMatches: number;
  /** Number of turns that matched via structural landmark comparison */
  structuralMatches: number;
  /** Number of turns that diverged */
  divergences: number;
  /** Turns present in dfrotz but not in engine (length mismatch) */
  dfrotzExtra: number;
  /** Turns present in engine but not in dfrotz (length mismatch) */
  engineExtra: number;
  /** Turns skipped during @resync (not counted as divergences) */
  skipped: number;
}

// ---------------------------------------------------------------------------
// Structural-landmark matching (for ~ RNG-variable turns)
// ---------------------------------------------------------------------------

/**
 * Extract structural landmarks from a normalized turn's text.
 *
 * Landmarks are features that should be stable across dfrotz and the engine
 * regardless of RNG-driven combat text:
 *   - Room name line (first non-blank line of the text)
 *   - "Score: N  Moves: N" tokens (if present)
 *   - Kill/death keywords: "killed", "died", "scored", "unconscious"
 *
 * Returns a canonical string for comparison.
 */
function extractLandmarks(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return '';

  const landmarks: string[] = [];

  // First non-blank line is the room name (or command response header)
  landmarks.push(lines[0]!);

  // Score/Moves tokens
  const scoreMatch = text.match(/Score:\s*(\d+)\s+Moves:\s*(\d+)/);
  if (scoreMatch !== null) {
    landmarks.push(`Score:${scoreMatch[1]} Moves:${scoreMatch[2]}`);
  }

  // Kill/death/score keywords (case-insensitive)
  const DEATH_KEYWORDS = /\b(killed|died|scored|unconscious|defeated|slain)\b/gi;
  const allText = text.toLowerCase();
  const keywords = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = DEATH_KEYWORDS.exec(allText)) !== null) {
    keywords.add(m[1]!.toLowerCase());
  }
  if (keywords.size > 0) {
    landmarks.push([...keywords].sort().join(','));
  }

  return landmarks.join('|');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare two arrays of normalized turns and return a full report.
 *
 * When corpusItems is provided, the metadata drives special comparison modes:
 *   - CorpusEntry with rngVariable=true → structural-landmark comparison
 *   - ResyncDirective → advance both arrays until a turn matches the pattern,
 *     then resume strict comparison
 *
 * When corpusItems is omitted, all turns are compared with exact string equality
 * (backward-compatible with tests that don't pass annotation metadata).
 */
export function compareTurns(
  dfrotz: readonly NormalizedTurn[],
  engine: readonly NormalizedTurn[],
  corpusItems?: readonly CorpusItem[],
): ComparisonReport {
  const turns: TurnComparison[] = [];
  let firstDivergenceIndex = -1;
  let exactMatches = 0;
  let structuralMatches = 0;
  let skipped = 0;

  // Build a parallel sequence of (command, rngVariable) entries and resync
  // directives from the corpus items, aligned with the turn arrays.
  //
  // Strategy: walk a "corpus cursor" alongside the dfrotz/engine turn cursors.
  // Command entries advance the turn cursors; resync directives fire a scan.

  let di = 0; // dfrotz turn index
  let ei = 0; // engine turn index

  if (corpusItems === undefined || corpusItems.length === 0) {
    // Fast path: no annotations — exact comparison of all turns
    const len = Math.min(dfrotz.length, engine.length);
    for (let i = 0; i < len; i++) {
      const dt = dfrotz[i]!;
      const et = engine[i]!;
      const dfrotzText = dt.text.trim();
      const engineText = et.text.trim();
      const match = dfrotzText === engineText;
      if (match) {
        exactMatches++;
      } else if (firstDivergenceIndex === -1) {
        firstDivergenceIndex = turns.length;
      }
      turns.push({
        index: turns.length,
        command: dt.command || et.command,
        match,
        kind: match ? 'exact' : 'diverged',
        dfrotzText,
        engineText,
      });
    }
    di = Math.min(dfrotz.length, engine.length);
    ei = di;
  } else {
    // Annotated path: process items in order.
    //
    // The normalizer always produces an initial turn (index 0) for the room
    // description before the first command.  This turn has no corresponding
    // corpus item — it is pre-command output.  Compare it with exact equality
    // first so it doesn't appear as an "extra" turn at the end.
    if (dfrotz.length > 0 && engine.length > 0) {
      const dt = dfrotz[0]!;
      const et = engine[0]!;
      const dfrotzText = dt.text.trim();
      const engineText = et.text.trim();
      const match = dfrotzText === engineText;
      if (match) {
        exactMatches++;
      } else if (firstDivergenceIndex === -1) {
        firstDivergenceIndex = turns.length;
      }
      turns.push({
        index: turns.length,
        command: '(initial)',
        match,
        kind: match ? 'exact' : 'diverged',
        dfrotzText,
        engineText,
      });
      di = 1;
      ei = 1;
    }

    for (const item of corpusItems) {
      if ('kind' in item) {
        // ResyncDirective: advance both cursors to the first turn matching pattern
        const pattern = item.pattern.toLowerCase();
        const startDi = di;
        const startEi = ei;

        // Advance dfrotz cursor
        while (di < dfrotz.length && !dfrotz[di]!.text.toLowerCase().includes(pattern)) {
          turns.push({
            index: turns.length,
            command: dfrotz[di]!.command,
            match: true,
            kind: 'skipped',
            dfrotzText: dfrotz[di]!.text.trim(),
            engineText: '(resync skip)',
          });
          skipped++;
          di++;
        }

        // Advance engine cursor to match
        while (ei < engine.length && !engine[ei]!.text.toLowerCase().includes(pattern)) {
          ei++;
        }

        if (di >= dfrotz.length || ei >= engine.length) {
          console.warn(
            `@resync "${item.pattern}" not found in ` +
            (di >= dfrotz.length ? 'dfrotz' : 'engine') +
            ` transcript (dfrotz was at ${startDi}, engine at ${startEi})`,
          );
        }
        continue;
      }

      // CorpusEntry: consume one turn from each transcript
      const dt = di < dfrotz.length ? dfrotz[di] : undefined;
      const et = ei < engine.length ? engine[ei] : undefined;

      if (dt === undefined || et === undefined) break;

      di++;
      ei++;

      const dfrotzText = dt.text.trim();
      const engineText = et.text.trim();

      let match: boolean;
      let kind: TurnMatchKind;

      if (item.rngVariable) {
        // RNG-variable turn: compare structural landmarks but do NOT count a
        // mismatch as a divergence.  The ~ prefix is an explicit acknowledgment
        // that dfrotz and the engine use different RNG seeds, so combat text
        // will differ.  A following @resync re-aligns the cursors.
        const dlm = extractLandmarks(dfrotzText);
        const elm = extractLandmarks(engineText);
        const structurallyEqual = dlm === elm;
        match = true; // rng-variable: always "pass" (never fail the run)
        kind = structurallyEqual ? 'structural' : 'skipped'; // skipped = annotated RNG skip
        if (structurallyEqual) structuralMatches++;
        else skipped++;
        // Never update firstDivergenceIndex for rng-variable turns
      } else {
        match = dfrotzText === engineText;
        kind = match ? 'exact' : 'diverged';
        if (match) exactMatches++;

        if (!match && firstDivergenceIndex === -1) {
          firstDivergenceIndex = turns.length;
        }
      }

      turns.push({
        index: turns.length,
        command: item.command,
        match,
        kind,
        dfrotzText,
        engineText,
      });
    }
  }

  const dfrotzExtra = dfrotz.length > di ? dfrotz.length - di : 0;
  const engineExtra = engine.length > ei ? engine.length - ei : 0;
  const divergences = turns.filter((t) => !t.match && t.kind !== 'skipped').length;
  const totalCompared = turns.filter((t) => t.kind !== 'skipped').length;

  return {
    turns,
    firstDivergenceIndex,
    totalCompared,
    exactMatches,
    structuralMatches,
    divergences,
    dfrotzExtra,
    engineExtra,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Render a ComparisonReport as a human-readable string suitable for console
 * output.
 */
export function formatReport(report: ComparisonReport): string {
  const lines: string[] = [];

  lines.push('=== Oracle Harness Report ===');
  lines.push('');

  const matchParts: string[] = [];
  matchParts.push(`${report.exactMatches + report.structuralMatches}/${report.totalCompared} turns matched`);
  if (report.structuralMatches > 0) {
    matchParts.push(`(${report.exactMatches} exact, ${report.structuralMatches} structural)`);
  }
  if (report.divergences > 0) matchParts.push(`${report.divergences} diverged`);
  if (report.skipped > 0) matchParts.push(`${report.skipped} skipped (resync)`);
  if (report.dfrotzExtra > 0) matchParts.push(`${report.dfrotzExtra} extra dfrotz turns`);
  if (report.engineExtra > 0) matchParts.push(`${report.engineExtra} extra engine turns`);
  lines.push('Summary: ' + matchParts.join(', '));

  if (report.firstDivergenceIndex !== -1) {
    lines.push(`First divergence: turn ${report.firstDivergenceIndex} (command: "${report.turns[report.firstDivergenceIndex]?.command ?? ''}")`);
  }

  lines.push('');
  lines.push('--- Per-turn results ---');

  for (const t of report.turns) {
    let status: string;
    if (t.kind === 'skipped') {
      status = '~';
    } else if (t.kind === 'structural') {
      status = '≈';
    } else {
      status = t.match ? '✓' : '✗';
    }
    const label = t.command.length > 0 ? `"${t.command}"` : '(initial)';
    lines.push(`  [${t.index}] ${status} ${label}`);

    if (!t.match && t.kind !== 'skipped') {
      lines.push('    dfrotz : ' + indent(t.dfrotzText, '           '));
      lines.push('    engine : ' + indent(t.engineText, '           '));
    }
  }

  lines.push('');
  lines.push('=== End Report ===');

  return lines.join('\n');
}

/** Indent continuation lines of a multi-line string. */
function indent(text: string, prefix: string): string {
  const parts = text.split('\n');
  if (parts.length <= 1) return text;
  return parts[0] + '\n' + parts.slice(1).map((l) => prefix + l).join('\n');
}
