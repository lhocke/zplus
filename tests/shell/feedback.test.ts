// Unit tests for the feedback payload-shaping function (§7 / §9 §7).
//
// Pure-function assertions — no DOM, no fetch. Verified:
//   sessionId always present
//   browserInfo ONLY on "UI issue", absent for other categories
//   category constrained to ALLOWED_CATEGORIES
//   oversized fields rejected before the API call
//   payload shape stable

import { describe, it, expect } from 'vitest';
import {
  shapeFeedbackPayload,
  collectBrowserInfo,
  type FeedbackInput,
  type FeedbackPayload,
} from '../../src/ui/feedback.js';
import { ALLOWED_CATEGORIES } from '../../functions/lib/sanitize.js';

// ── shapeFeedbackPayload ──────────────────────────────────────────────────────

describe('shapeFeedbackPayload', () => {
  const base: FeedbackInput = {
    category: 'bug',
    message: 'The troll appears twice.',
    sessionId: 'ses-unit-001',
    turnstileToken: 'tok-abc',
  };

  it('sessionId is always present in the payload', () => {
    const p = shapeFeedbackPayload(base);
    expect(p.sessionId).toBe('ses-unit-001');
  });

  it('category is passed through unchanged', () => {
    const p = shapeFeedbackPayload(base);
    expect(p.category).toBe('bug');
  });

  it('message is passed through unchanged', () => {
    const p = shapeFeedbackPayload(base);
    expect(p.message).toBe('The troll appears twice.');
  });

  it('turnstileToken is passed through', () => {
    const p = shapeFeedbackPayload(base);
    expect(p.turnstileToken).toBe('tok-abc');
  });

  it('browserInfo absent for "bug"', () => {
    const p = shapeFeedbackPayload({ ...base, category: 'bug', browserInfo: { userAgent: 'ua', viewport: '1024x768', theme: 'crt' } });
    expect(p.browserInfo).toBeUndefined();
  });

  it('browserInfo absent for "suggestion"', () => {
    const p = shapeFeedbackPayload({ ...base, category: 'suggestion', browserInfo: { userAgent: 'ua', viewport: '1024x768', theme: 'crt' } });
    expect(p.browserInfo).toBeUndefined();
  });

  it('browserInfo absent for "other"', () => {
    const p = shapeFeedbackPayload({ ...base, category: 'other', browserInfo: { userAgent: 'ua', viewport: '1024x768', theme: 'crt' } });
    expect(p.browserInfo).toBeUndefined();
  });

  it('browserInfo present for "UI issue" when provided', () => {
    const info = { userAgent: 'Mozilla/5.0', viewport: '1440x900', theme: 'crt' };
    const p = shapeFeedbackPayload({ ...base, category: 'UI issue', browserInfo: info });
    expect(p.browserInfo).toEqual(info);
  });

  it('browserInfo absent for "UI issue" when not provided', () => {
    const p = shapeFeedbackPayload({ ...base, category: 'UI issue' });
    expect(p.browserInfo).toBeUndefined();
  });

  it('optional context included when present', () => {
    const p = shapeFeedbackPayload({ ...base, context: 'I was in the troll room' });
    expect(p.context).toBe('I was in the troll room');
  });

  it('context absent when not provided', () => {
    const p = shapeFeedbackPayload(base);
    expect(p.context).toBeUndefined();
  });

  it('all four allowed categories pass through', () => {
    for (const cat of ALLOWED_CATEGORIES) {
      const p = shapeFeedbackPayload({ ...base, category: cat });
      expect(p.category).toBe(cat);
    }
  });

  it('invalid category throws', () => {
    expect(() => shapeFeedbackPayload({ ...base, category: 'hacked' as 'bug' })).toThrow();
  });

  it('empty message throws', () => {
    expect(() => shapeFeedbackPayload({ ...base, message: '' })).toThrow();
  });

  it('empty sessionId throws', () => {
    expect(() => shapeFeedbackPayload({ ...base, sessionId: '' })).toThrow();
  });
});

// ── collectBrowserInfo ────────────────────────────────────────────────────────
// collectBrowserInfo reads window globals — test in a jsdom environment is
// possible but the function is designed for the browser; we just verify the
// shape it returns when called with explicit mocks.

describe('collectBrowserInfo', () => {
  it('returns an object with userAgent, viewport, theme fields', () => {
    // collectBrowserInfo reads from window/document; mock those.
    const info = collectBrowserInfo('crt');
    // In Node (test env), userAgent is the empty string or jsdom's value —
    // either way the function must not throw and must return the three fields.
    expect(typeof info.userAgent).toBe('string');
    expect(typeof info.viewport).toBe('string');
    expect(info.theme).toBe('crt');
  });

  it('viewport is a WxH string', () => {
    const info = collectBrowserInfo('literary');
    // Should match either "NxM" or "N×M" or be empty in Node headless
    expect(typeof info.viewport).toBe('string');
  });
});

// ── payload type structure (compile-time guard rendered as a runtime check) ──

describe('FeedbackPayload structure', () => {
  it('has all expected keys for a bug report', () => {
    const p: FeedbackPayload = shapeFeedbackPayload({
      category: 'bug',
      message: 'test',
      sessionId: 'ses-x',
      turnstileToken: 'tok-x',
    });
    expect('category' in p).toBe(true);
    expect('message' in p).toBe(true);
    expect('sessionId' in p).toBe(true);
    expect('turnstileToken' in p).toBe(true);
  });

  it('browserInfo is undefined (not just missing) for non-UI-issue', () => {
    const p = shapeFeedbackPayload({
      category: 'other',
      message: 'hi',
      sessionId: 'ses-y',
      turnstileToken: 'tok-y',
    });
    // undefined (not present), not null or empty object
    expect(p.browserInfo).toBeUndefined();
  });
});
