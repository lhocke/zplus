/**
 * Tokenizer: produces a Token[] from raw player input.
 *
 * SIBREAK characters (`.`, `,`, `"`) are emitted as standalone tokens so the
 * scan loop can detect segment boundaries and quoted strings. Nothing is
 * filtered here — articles, buzzwords, AND/ALL/BUT/THEN all pass through.
 */

/** A single lexical token. Text is lowercased; SIBREAKS are bare chars. */
export type Token = string;

/**
 * Period (sentence end), comma (object-list separator), and double-quote
 * (quoted-speech marker) — each emitted as its own standalone token.
 */
export const SIBREAK_CHARS = new Set(['.', ',', '"']);

/** Tokenize raw player input into a flat Token[]. */
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
