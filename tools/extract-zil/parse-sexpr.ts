/**
 * ZIL/MDL s-expression reader.
 *
 * Handles the subset of MDL syntax used by the Zork I ZIL source:
 *   - Angle-bracket forms:  <HEAD item item ...>
 *   - Round-bracket lists:  (HEAD item item ...)
 *   - Quoted strings:       "text with \"escapes\""
 *   - Atoms:                identifiers, numbers, symbols (NORTH-OF-HOUSE, 350, …)
 *   - Inline comments:      ;"string"  (MDL comment syntax — discarded)
 *
 * The output is a flat array of top-level SNode values; each SList records
 * whether it was opened with '<' or '(' so callers can distinguish angle
 * forms from plain lists.
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
      const node = this.readOne();
      if (node !== null) results.push(node);
      this.skipWhitespace();
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Core dispatch
  // ---------------------------------------------------------------------------

  private readOne(): SNode | null {
    this.skipWhitespace();
    if (this.pos >= this.src.length) return null;

    const ch = this.src[this.pos];

    // MDL comment: ;"string" — skip the comment and read the next token
    if (ch === ';' && this.src[this.pos + 1] === '"') {
      this.pos++; // consume ';'
      this.readString(); // consume and discard the comment string
      return null;
    }

    if (ch === '"') return this.readString();
    if (ch === '(' ) return this.readList('(', ')');
    if (ch === '<' ) return this.readList('<', '>');

    // Closing delimiters are handled by readList — if we reach one here
    // the caller will stop naturally.
    if (ch === ')' || ch === '>') return null;

    return this.readAtom();
  }

  // ---------------------------------------------------------------------------
  // Quoted string
  // ---------------------------------------------------------------------------

  private readString(): SString {
    this.pos++; // consume opening '"'
    let value = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '\\') {
        this.pos++; // skip backslash
        value += this.src[this.pos] ?? '';
        this.pos++;
        continue;
      }
      if (ch === '"') {
        this.pos++; // consume closing '"'
        break;
      }
      value += ch;
      this.pos++;
    }
    return { type: 'string', value };
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
      if (ch === close) {
        this.pos++; // consume closing delimiter
        break;
      }

      const node = this.readOne();
      if (node !== null) items.push(node);
    }

    return { type: 'list', open, items };
  }

  // ---------------------------------------------------------------------------
  // Atom — everything that is not a delimiter or string
  // ---------------------------------------------------------------------------

  private readAtom(): SAtom {
    let value = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      // Stop at whitespace or any delimiter / comment leader
      if (/[\s()><;"]/.test(ch)) break;
      value += ch;
      this.pos++;
    }
    return { type: 'atom', value };
  }

  // ---------------------------------------------------------------------------
  // Whitespace (including newlines and tabs)
  // ---------------------------------------------------------------------------

  private skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) {
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
 * @returns    Array of parsed nodes; ;"..." comments are silently discarded.
 */
export function parseSexpr(src: string): SNode[] {
  return new Reader(src).readAll();
}
