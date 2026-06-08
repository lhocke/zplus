// Feedback payload shaping (§7) — pure, DOM-free.
//
// Keeps the "what data goes to /api/feedback" logic separate from the form
// component, so it can be unit-tested without a browser environment.

import { ALLOWED_CATEGORIES } from '../../functions/lib/sanitize.js';

export type FeedbackCategory = (typeof ALLOWED_CATEGORIES)[number];

export interface BrowserInfo {
  userAgent: string;
  viewport: string;
  theme: string;
}

export interface FeedbackInput {
  category: FeedbackCategory | string; // validated by shapeFeedbackPayload
  message: string;
  sessionId: string;
  turnstileToken: string;
  context?: string;
  // Caller provides this; only included in the payload for "UI issue".
  browserInfo?: BrowserInfo;
  hp?: string; // honeypot — never set by real users
}

export interface FeedbackPayload {
  category: FeedbackCategory;
  message: string;
  sessionId: string;
  turnstileToken: string;
  context?: string;
  browserInfo?: BrowserInfo;
  hp?: string;
}

/**
 * Shape the feedback payload for POST /api/feedback.
 *
 * Rules:
 *   - sessionId is always included.
 *   - browserInfo is included ONLY when category is "UI issue" AND caller
 *     provides it. Stripped for all other categories.
 *   - category must be one of the four ALLOWED_CATEGORIES; throws otherwise.
 *   - message and sessionId must be non-empty; throws otherwise.
 */
export function shapeFeedbackPayload(input: FeedbackInput): FeedbackPayload {
  if (!ALLOWED_CATEGORIES.includes(input.category as FeedbackCategory)) {
    throw new RangeError(`Invalid category: ${input.category}`);
  }
  if (!input.message) {
    throw new RangeError('message is required');
  }
  if (!input.sessionId) {
    throw new RangeError('sessionId is required');
  }

  const payload: FeedbackPayload = {
    category: input.category as FeedbackCategory,
    message: input.message,
    sessionId: input.sessionId,
    turnstileToken: input.turnstileToken,
  };

  if (input.context !== undefined) {
    payload.context = input.context;
  }

  // UI-issue only — the §4 scoped exception.
  if (input.category === 'UI issue' && input.browserInfo !== undefined) {
    payload.browserInfo = input.browserInfo;
  }

  if (input.hp !== undefined) {
    payload.hp = input.hp;
  }

  return payload;
}

/**
 * Collect browser context for a UI-issue report.
 * Called only when the user picks "UI issue" and clicks submit.
 */
export function collectBrowserInfo(activeTheme: string): BrowserInfo {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const viewport =
    typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : '';
  return { userAgent, viewport, theme: activeTheme };
}
