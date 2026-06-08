/**
 * Sanitization utilities for /api/feedback (§7 — load-bearing security).
 *
 * All user values that end up in a GitHub issue body must be inside a fenced
 * code block. The fence-selection algorithm is the critical piece: a fixed
 * ``` fence is unsafe if the content contains a matching run.
 *
 * GitHub PAT requirement (documented here per spec §5):
 *   GITHUB_TOKEN must be a fine-grained PAT scoped ONLY to lhocke/zork-feedback
 *   with Issues: write permission. A classic PAT or a broadly-scoped token
 *   would reach the code repo — not acceptable.
 */

// Field size caps.
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_CONTEXT_BYTES = 2048;
export const MAX_SESSION_ID_BYTES = 128;

export const ALLOWED_CATEGORIES = ['bug', 'suggestion', 'UI issue', 'other'] as const;
export type FeedbackCategory = (typeof ALLOWED_CATEGORIES)[number];

/**
 * Choose a backtick fence that is strictly longer than the longest backtick
 * run in `content`, with a minimum length of 3 (GitHub's minimum).
 *
 * This is the GitHub-specified algorithm for safe nesting: "the opening code
 * fence may use more backticks than are present in the code."
 */
export function chooseFence(content: string): string {
  const runs = [...content.matchAll(/`+/g)].map(m => m[0].length);
  const longest = runs.length > 0 ? Math.max(...runs) : 0;
  // fence must be > longest run, and at least 3
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Strip GitHub tilde fences (~~~) from user content by replacing any run of
 * 3+ tildes with exactly 2 tildes — breaking the fence syntax regardless of
 * run length.
 */
export function escapeTildes(content: string): string {
  // Collapse any run of 3+ tildes down to 2, which can never open a tilde fence.
  return content.replace(/~{3,}/g, '~~');
}

/**
 * Wrap user content in a safe fenced code block.
 * 1. Strip tilde fences (escapeTildes).
 * 2. Choose a backtick fence long enough to contain the remaining backtick runs.
 * 3. Wrap.
 *
 * The result is safe to embed in GitHub-flavored markdown: no @mentions, no
 * #refs, no HTML, no markdown — GitHub doesn't autolink inside code fences.
 */
export function fenceContent(content: string): string {
  const safe = escapeTildes(content);
  const fence = chooseFence(safe);
  return `${fence}\n${safe}\n${fence}`;
}

/**
 * Validate a single field against a byte cap. Throws on overage.
 * Used before any other processing so oversized fields fail fast.
 */
export function sanitizeField(value: string, maxBytes: number): string {
  // Length in bytes (UTF-8 aware via TextEncoder when available, otherwise
  // use string length as an upper bound — safe because .length ≥ byte length).
  const byteLen =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(value).length
      : value.length;
  if (byteLen > maxBytes) {
    throw new RangeError(`Field exceeds ${maxBytes}-byte cap (got ${byteLen})`);
  }
  return value;
}
