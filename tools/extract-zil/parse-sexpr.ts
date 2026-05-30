/**
 * ZIL/MDL s-expression reader.
 *
 * Handles the subset of MDL syntax used by the Zork I ZIL source:
 *   - Angle-bracket forms:  <HEAD item item ...>
 *   - Round-bracket lists:  (HEAD item item ...)
 *   - Quoted strings:       "text with \"escapes\""
 *   - Atoms:                identifiers, numbers, symbols (NORTH-OF-HOUSE, 350, …)
 *   - MDL comments:         ;expr  (the ';' prefix discards the next expression)
 *
 * The output is a flat array of top-level SNode values; comments are silently
 * discarded. Each SList records whether it was opened with '<' or '(' so
 * callers can distinguish angle forms from plain lists.
 */

// ---------------------------------------------------------------------------
// Public node types
// ---------------------------------------------------------------------------

export interface SAtom {
  type: 'atom';
  value: string;
}

export interface SString {
  type: 'string';
  value: string;
}

export interface SList {
  type: 'list';
  open: '(' | '<';
  items: SNode[];
}

export type SNode = SAtom | SString | SList;

// ---------------------------------------------------------------------------
// Character classification helpers — no regex to avoid per-call overhead
// ---------------------------------------------------------------------------

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isAtomTerminator(ch: string): boolean {
  return (
    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' ||
    ch === '(' || ch === ')' || ch === '<' || ch === '>' ||
    ch === ';' || ch === '"'
  );
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Reader {
  private pos = 0;

  constructor(private readonly src: string) {}

  /** Entry point — parse all top-level forms and return them. */
  readAll(): SNode[] {
    const results: SNode[] = [];
    this.skipWhitespace();
    while (this.pos < this.src.length) {
      const before = this.pos;
      const node = this.readOne();
      if (node !== null) results.push(node);
      // Safety: if readOne returned without advancing, skip one char.
      if (this.pos === before) this.pos++;
      this.skipWhitespace();
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Core dispatch — returns a node or null (for discarded comments)
  // ---------------------------------------------------------------------------

  private readOne(): SNode | null {
    this.skipWhitespace();
    if (this.pos >= this.src.length) return null;

    const ch = this.src[this.pos];

    // MDL comment: ;expr — the ';' prefix discards the next expression.
    // This covers both ;"string" and ;ATOM forms.
    if (ch === ';') {
      this.pos++; // consume ';'
      // Read and discard the next expression (could be a string, list, or atom)
      this.skipWhitespace();
      if (this.pos < this.src.length) this.readOneRaw();
      return null;
    }

    if (ch === '"') return this.readString();
    if (ch === '(') return this.readList('(', ')');
    if (ch === '<') return this.readList('<', '>');

    // Closing delimiters signal the parent readList to stop.
    if (ch === ')' || ch === '>') return null;

    return this.readAtom();
  }

  /**
   * Read the next token and discard its value — used by the comment handler
   * to skip over whatever expression follows ';'.
   */
  private readOneRaw(): void {
    if (this.pos >= this.src.length) return;
    const ch = this.src[this.pos];
    if (ch === '"') { this.readString(); return; }
    if (ch === '(') { this.readList('(', ')'); return; }
    if (ch === '<') { this.readList('<', '>'); return; }
    if (ch === ')' || ch === '>') return; // mismatched — leave for parent
    this.readAtom();
  }

  // ---------------------------------------------------------------------------
  // Quoted string
  // ---------------------------------------------------------------------------

  private readString(): SString {
    this.pos++; // consume opening '"'
    const chars: string[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '\\') {
        this.pos++;
        if (this.pos < this.src.length) {
          chars.push(this.src[this.pos]);
          this.pos++;
        }
        continue;
      }
      if (ch === '"') {
        this.pos++; // consume closing '"'
        break;
      }
      chars.push(ch);
      this.pos++;
    }
    return { type: 'string', value: chars.join('') };
  }

  // ---------------------------------------------------------------------------
  // List (round or angle bracket)
  // ---------------------------------------------------------------------------

  private readList(open: '(' | '<', close: ')' | '>'): SList {
    this.pos++; // consume opening delimiter
    const items: SNode[] = [];

    while (this.pos < this.src.length) {
      this.skipWhitespace();
      if (this.pos >= this.src.length) break;

      const ch = this.src[this.pos];

      // Our expected closing delimiter
      if (ch === close) {
        this.pos++;
        break;
      }

      // Mismatched closing delimiter — stop and let the parent handle it.
      if (ch === ')' || ch === '>') break;

      const before = this.pos;
      const node = this.readOne();
      if (node !== null) items.push(node);

      // Guard: if readOne neither returned a node nor advanced pos, skip one
      // char to prevent spinning in place on unexpected input.
      if (this.pos === before) this.pos++;
    }

    return { type: 'list', open, items };
  }

  // ---------------------------------------------------------------------------
  // Atom — everything that is not a delimiter, string, or comment leader.
  //
  // MDL uses '\' as an escape: '\.' '\,' '\"' etc. are single-character atoms.
  // We consume the backslash and the following character together so that '\"'
  // is never misread as the start of a string.
  // ---------------------------------------------------------------------------

  private readAtom(): SAtom {
    const chars: string[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '\\') {
        // Backslash escapes the next character — consume both.
        this.pos++;
        if (this.pos < this.src.length) {
          chars.push(this.src[this.pos]);
          this.pos++;
        }
        continue;
      }
      if (isAtomTerminator(ch)) break;
      chars.push(ch);
      this.pos++;
    }
    return { type: 'atom', value: chars.join('') };
  }

  // ---------------------------------------------------------------------------
  // Whitespace skip
  // ---------------------------------------------------------------------------

  private skipWhitespace(): void {
    while (this.pos < this.src.length && isWhitespace(this.src[this.pos])) {
      this.pos++;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a ZIL/MDL source string into a flat array of top-level SNode values.
 *
 * @param src  Raw ZIL source text (may contain multiple top-level forms).
 * @returns    Array of parsed nodes; ';' comments are silently discarded.
 */
export function parseSexpr(src: string): SNode[] {
  return new Reader(src).readAll();
}
