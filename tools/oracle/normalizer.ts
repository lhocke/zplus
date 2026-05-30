/**
 * normalizer.ts
 *
 * Normalizes transcripts from both dfrotz and our engine before comparison,
 * removing sources of false diffs.
 *
 * dfrotz -p output structure (observed from R119):
 *   - Loading noise: "Using normal formatting." / "Loading ..."
 *   - Initial status bar: " West of House   Score: 0   Moves: 0"  (no leading ">")
 *   - Intro/copyright block
 *   - First room description (blank-line terminated)
 *   - For each command: a ">" + status bar line, blank line, then the game text
 *   - Final score summary lines before "> " quit prompt
 *
 * Our engine transcript structure (from engine-runner.ts):
 *   - Intro banner lines
 *   - First room description
 *   - For each command: "> <cmd>" line, then the turn output
 *
 * Normalization applied to both:
 *  1. Strip loading noise and status-bar lines
 *  2. Strip intro/copyright banners
 *  3. Strip score-summary / quit-prompt lines
 *  4. Split into turn blocks on the prompt boundaries
 *  5. Trim trailing whitespace per line
 *  6. Rejoin hard-wrapped lines (dfrotz wraps at 80 cols; engine does not)
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// dfrotz status-bar line: "[ >] <room name> ... Score: N ... Moves: N"
// May start with " " (initial) or "> " (after each command).
const STATUS_BAR_RE = /^>?\s*.{5,}\bScore:\s*\d+\s+Moves:\s*\d+\s*$/;

// dfrotz loading noise (plain-output mode)
const LOADING_NOISE_RE =
  /^(?:Using normal formatting\.|Loading .+\.z\d+\.)$/;

// Intro/copyright block lines from dfrotz R119 binary.
// Matches as a prefix (no trailing $) so the 80-col hard-wrap of the copyright
// line ("...All rights" / "reserved.") doesn't cause a suffix mismatch.
// "reserved." is the wrapped tail of the copyright line — exact match only.
const DFROTZ_INTRO_RE =
  /^(?:ZORK I: The Great Underground Empire|Infocom interactive fiction|Copyright \(c\)|ZORK is a registered trademark|Release \d+ \/ Serial number \d+|reserved\.$)/;

// Our engine's intro banner lines (prefix match)
const ENGINE_INTRO_RE =
  /^(?:ZORK I: The Great Underground Empire|Copyright \(c\) 1981|ZORK is a registered trademark|Revision \d+ \/ Serial number \d+)/;

// Final score/rank lines and quit prompt from dfrotz.
// Note: dfrotz prints ">Your score..." (no space after ">") — the ">" here is
// the prompt character glued directly to the text, not a turn-separator.
const SCORE_SUMMARY_RE =
  /^>?(?:Your score is \d+|This gives you the rank of|Do you wish to leave)/;

// The quit prompt bare "> " or ">" at end of output
const QUIT_PROMPT_RE = /^>\s*$/;

// dfrotz turn boundary: ">" (possibly followed by status bar which we've stripped)
// In raw output: "> West of House   Score: 0   Moves: 1"
// After stripping the status bar portion we want to detect these as separators.
// Strategy: detect the RAW pattern BEFORE stripping so we can use it to split.
const DFROTZ_TURN_SEP_RE = /^>\s*.{5,}\bScore:\s*\d+\s+Moves:\s*\d+/;

// Our engine prompt: "> <command text>"
const ENGINE_PROMPT_RE = /^>\s+(\S.*)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A single parsed turn: the command that produced it (or '' for the initial
 * turn) and the normalized game text.
 */
export interface NormalizedTurn {
  command: string;
  text: string;
}

/**
 * Normalize a raw dfrotz transcript into an array of turns.
 */
export function normalizeDfrotz(raw: string): NormalizedTurn[] {
  const lines = raw.split('\n');
  return parseDfrotzTurns(lines);
}

/**
 * Normalize a raw engine transcript into an array of turns.
 */
export function normalizeEngine(raw: string): NormalizedTurn[] {
  const lines = raw.split('\n');
  return parseEngineTurns(lines);
}

// ---------------------------------------------------------------------------
// dfrotz parser
// ---------------------------------------------------------------------------

/**
 * Parse dfrotz -p output into turns.
 *
 * dfrotz turn boundaries are the "> Room   Score: N  Moves: N" lines.
 * The command is NOT echoed by dfrotz; we track commands by index against
 * the input sequence (not needed for comparison — command is informational).
 * Since we can't recover the command text from dfrotz output, we leave it ''.
 */
function parseDfrotzTurns(rawLines: string[]): NormalizedTurn[] {
  const turns: NormalizedTurn[] = [];
  let blockLines: string[] = [];

  function flush(): void {
    const filtered = blockLines
      .map((l) => l.trimEnd())
      .filter((l) => !LOADING_NOISE_RE.test(l))
      .filter((l) => !DFROTZ_INTRO_RE.test(l))
      .filter((l) => !STATUS_BAR_RE.test(l))
      .filter((l) => !SCORE_SUMMARY_RE.test(l))
      .filter((l) => !QUIT_PROMPT_RE.test(l));

    const text = rejoinWrapped(filtered).trim();
    if (text.length > 0) {
      turns.push({ command: '', text });
    }
    blockLines = [];
  }

  for (const line of rawLines) {
    if (DFROTZ_TURN_SEP_RE.test(line)) {
      // This line is a turn separator (prompt + status bar).
      // Flush the accumulated block as the previous turn.
      flush();
      // The separator line itself is discarded (it's just the status bar).
    } else {
      blockLines.push(line);
    }
  }
  flush();

  return turns;
}

// ---------------------------------------------------------------------------
// Engine parser
// ---------------------------------------------------------------------------

/**
 * Parse our engine's transcript into turns.
 *
 * Engine turn boundaries are "> <command>" prompt lines.
 * The initial block (before first prompt) is the intro + first room.
 */
function parseEngineTurns(rawLines: string[]): NormalizedTurn[] {
  const turns: NormalizedTurn[] = [];
  let currentCommand = '';
  let blockLines: string[] = [];

  function flush(): void {
    const filtered = blockLines
      .map((l) => l.trimEnd())
      .filter((l) => !ENGINE_INTRO_RE.test(l))
      .filter((l) => !SCORE_SUMMARY_RE.test(l));

    const text = rejoinWrapped(filtered).trim();
    if (text.length > 0) {
      turns.push({ command: currentCommand, text });
    }
    blockLines = [];
  }

  for (const line of rawLines) {
    const promptMatch = ENGINE_PROMPT_RE.exec(line);
    if (promptMatch !== null) {
      flush();
      currentCommand = promptMatch[1]!;
    } else {
      blockLines.push(line);
    }
  }
  flush();

  return turns;
}

// ---------------------------------------------------------------------------
// Hard-wrap rejoining
// ---------------------------------------------------------------------------

/**
 * Rejoin lines that were hard-wrapped at a column boundary.
 *
 * Strategy: two consecutive non-blank lines are considered wrapped if the
 * first line does NOT end with terminal punctuation or a closing delimiter.
 * In that case they are joined with a space.  Blank lines (paragraph
 * separators) are preserved as a '\n' boundary between paragraphs.
 */
function rejoinWrapped(lines: string[]): string {
  if (lines.length === 0) return '';

  const paragraphs: string[] = [];
  let current = '';

  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current.trimEnd());
        current = '';
      }
    } else if (current.length === 0) {
      current = line;
    } else if (looksLikeWrapped(current)) {
      current = current.trimEnd() + ' ' + line.trimStart();
    } else {
      paragraphs.push(current.trimEnd());
      current = line;
    }
  }

  if (current.length > 0) {
    paragraphs.push(current.trimEnd());
  }

  return paragraphs.join('\n');
}

/**
 * Returns true if the line was likely cut mid-sentence by a hard wrap.
 * Lines ending with terminal punctuation or closing delimiters are assumed
 * to end a logical unit; others are treated as wrapped.
 */
function looksLikeWrapped(line: string): boolean {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1];
  const sentenceEnders = new Set(['.', '!', '?', '"', ')', '-', ':', ';', "'", '”']);
  return !sentenceEnders.has(last);
}
