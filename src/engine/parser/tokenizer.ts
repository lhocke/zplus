/**
 * Tokenizer — Wave C1 REPLACE
 *
 * Produces a `Token[]` from raw player input.  SIBREAKS characters
 * (period `.`, comma `,`, double-quote `"`) are emitted as STANDALONE tokens
 * so the scan loop can detect segment boundaries (THEN / period) and quoted
 * strings without any pre-processing.  Nothing is dropped here — articles,
 * buzzwords, AND/ALL/BUT/THEN are all preserved as plain tokens; the scan
 * loop (parser.ts, Wave C) handles their structural roles.
 *
 * The `splitChained` eager-segmentation helper that existed in earlier waves
 * is REMOVED.  Lazy per-segment drive is owned by Game.turn (Wave C9) and
 * the parser's continuation mechanism.
 *
 * Compatibility: `tokenizeWords` is a Wave-B-era helper used by the existing
 * parser.ts scan paths that still expect a filtered string[] (articles
 * stripped, SIBREAK tokens split out).  It is intentionally NOT exported from
 * this module — it lives in parser.ts as a private adapter so that Wave C can
 * rip it out without touching the tokenizer API.
 */

/** A single lexical token.  Text is lowercased; SIBREAKS are bare chars. */
export type Token = string;

/**
 * The three characters that the ZIL parser uses as sentence-internal break
 * points: period (sentence end / THEN synonym), comma (object-list separator
 * in clauses such as "n,e"), and double-quote (quoted-speech marker).
 *
 * Each of these is emitted as its own standalone token rather than being
 * attached to the surrounding word or silently dropped.
 */
export const SIBREAK_CHARS = new Set(['.', ',', '"']);

/**
 * Tokenize raw player input into a flat `Token[]`.
 *
 * Rules:
 *  1. Lowercase the entire input.
 *  2. Walk character by character; accumulate word characters into the
 *     current word buffer.  On whitespace, flush the buffer.
 *  3. A SIBREAK char flushes the current word (if any) then is emitted as
 *     its own standalone token.
 *  4. Nothing is filtered — articles, buzzwords, structural words (AND/ALL/
 *     BUT/THEN/PERIOD) all appear verbatim for the scan loop to handle.
 *
 * Examples:
 *   "open the mailbox"  → ['open', 'the', 'mailbox']
 *   "n,e"               → ['n', ',', 'e']
 *   "n. e"              → ['n', '.', 'e']
 *   'say "hello"'       → ['say', '"', 'hello', '"']
 *   "take all"          → ['take', 'all']
 *   "open mailbox then read it" → ['open', 'mailbox', 'then', 'read', 'it']
 *   "open mailbox. read it"     → ['open', 'mailbox', '.', 'read', 'it']
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const lc = input.toLowerCase();
  let word = '';

  for (const ch of lc) {
    if (SIBREAK_CHARS.has(ch)) {
      // Flush the in-progress word, then emit the SIBREAK as a standalone.
      if (word.length > 0) {
        tokens.push(word);
        word = '';
      }
      tokens.push(ch);
    } else if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      // Whitespace — flush the word.
      if (word.length > 0) {
        tokens.push(word);
        word = '';
      }
    } else {
      word += ch;
    }
  }

  // Flush any trailing word.
  if (word.length > 0) {
    tokens.push(word);
  }

  return tokens;
}
