const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Lowercase and split input into tokens, dropping articles (a/an/the).
 * Adjectives and all other words are preserved — disambiguation happens
 * later in the parser.
 */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0 && !ARTICLES.has(t));
}

/**
 * Split a raw input line on "." and "then" (chained-command separators),
 * then tokenize each resulting segment. Empty segments are discarded.
 *
 * Examples:
 *   "n. e. take lamp"          → [['n'], ['e'], ['take','lamp']]
 *   "open mailbox then read it" → [['open','mailbox'], ['read','it']]
 */
export function splitChained(input: string): string[][] {
  // Split on literal "." or the word "then" (surrounded by word boundaries).
  // We split the raw string first, then tokenize each piece so that article-
  // dropping happens per-segment rather than across the whole line.
  const raw = input
    .toLowerCase()
    .split(/\.\s*|\bthen\b/)
    .map(s => s.trim());

  const segments: string[][] = [];
  for (const chunk of raw) {
    const tokens = tokenize(chunk);
    if (tokens.length > 0) {
      segments.push(tokens);
    }
  }
  return segments;
}
