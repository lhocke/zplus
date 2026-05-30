/**
 * comparator.ts
 *
 * Diffs two arrays of normalized turns (dfrotz vs engine) turn-by-turn and
 * produces a structured comparison report.
 */

import type { NormalizedTurn } from './normalizer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurnComparison {
  index: number;
  command: string;
  match: boolean;
  dfrotzText: string;
  engineText: string;
}

export interface ComparisonReport {
  /** Per-command comparison results */
  turns: TurnComparison[];
  /** Index of the first diverging turn, or -1 if all match */
  firstDivergenceIndex: number;
  /** Total number of turns compared (min of both lengths) */
  totalCompared: number;
  /** Number of turns that matched exactly */
  exactMatches: number;
  /** Number of turns that diverged */
  divergences: number;
  /** Turns present in dfrotz but not in engine (length mismatch) */
  dfrotzExtra: number;
  /** Turns present in engine but not in dfrotz (length mismatch) */
  engineExtra: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare two arrays of normalized turns and return a full report.
 *
 * Comparison is exact string equality after trimming leading/trailing
 * whitespace from each turn's text.
 */
export function compareTurns(
  dfrotz: readonly NormalizedTurn[],
  engine: readonly NormalizedTurn[],
): ComparisonReport {
  const len = Math.min(dfrotz.length, engine.length);
  const turns: TurnComparison[] = [];
  let firstDivergenceIndex = -1;
  let exactMatches = 0;

  for (let i = 0; i < len; i++) {
    const dt = dfrotz[i]!;
    const et = engine[i]!;
    const dfrotzText = dt.text.trim();
    const engineText = et.text.trim();
    const match = dfrotzText === engineText;

    if (match) {
      exactMatches++;
    } else if (firstDivergenceIndex === -1) {
      firstDivergenceIndex = i;
    }

    turns.push({
      index: i,
      command: dt.command || et.command,
      match,
      dfrotzText,
      engineText,
    });
  }

  const divergences = len - exactMatches;
  const dfrotzExtra = dfrotz.length > len ? dfrotz.length - len : 0;
  const engineExtra = engine.length > len ? engine.length - len : 0;

  return {
    turns,
    firstDivergenceIndex,
    totalCompared: len,
    exactMatches,
    divergences,
    dfrotzExtra,
    engineExtra,
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
  lines.push(
    `Summary: ${report.exactMatches}/${report.totalCompared} turns matched exactly` +
      (report.divergences > 0 ? `, ${report.divergences} diverged` : '') +
      (report.dfrotzExtra > 0 ? `, ${report.dfrotzExtra} extra dfrotz turns` : '') +
      (report.engineExtra > 0 ? `, ${report.engineExtra} extra engine turns` : ''),
  );

  if (report.firstDivergenceIndex !== -1) {
    lines.push(`First divergence: turn ${report.firstDivergenceIndex} (command: "${report.turns[report.firstDivergenceIndex]?.command ?? ''}")`);
  }

  lines.push('');
  lines.push('--- Per-turn results ---');

  for (const t of report.turns) {
    const status = t.match ? '✓' : '✗';
    const label = t.command.length > 0 ? `"${t.command}"` : '(initial)';
    lines.push(`  [${t.index}] ${status} ${label}`);

    if (!t.match) {
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
