// tests/shell/update-check.test.ts
import { describe, it, expect } from 'vitest';
import { compareSemver, checkForUpdate } from '../../src/shell/update-check.js';

describe('compareSemver', () => {
  it('returns -1 when a < b', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('1.2.3', '1.3.0')).toBe(-1);
    expect(compareSemver('1.2.3', '2.0.0')).toBe(-1);
  });
  it('returns 1 when a > b', () => {
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });
  it('returns 0 when equal', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });
  it('tolerates a leading "v" on either side', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.4', 'v1.2.3')).toBe(1);
  });
});

// Append to tests/shell/update-check.test.ts
import { isDismissed, dismiss } from '../../src/shell/update-check.js';

class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(n: number): string | null { return [...this.store.keys()][n] ?? null; }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

function fakeFetch(impl: (url: string) => Promise<Response> | Response): typeof fetch {
  return ((url: string) => Promise.resolve(impl(url))) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok, status,
    json: async () => body,
  } as unknown as Response;
}

describe('checkForUpdate — throttle', () => {
  it('checks when no prior check has run', async () => {
    const store = new MapStorage();
    const fetchImpl = fakeFetch(() => jsonResponse({ tag_name: 'v9.9.9', html_url: 'https://example.test/releases/v9.9.9' }));
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store });
    expect(result.checked).toBe(true);
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('v9.9.9');
  });

  it('skips checking when the last check was under 24h ago', async () => {
    const store = new MapStorage();
    const now = () => 1_000_000_000_000;
    store.setItem('zork-update-check-last', String(now() - 60_000)); // 1 minute ago
    let called = false;
    const fetchImpl = fakeFetch(() => { called = true; return jsonResponse({}); });
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store, now });
    expect(result.checked).toBe(false);
    expect(called).toBe(false);
  });

  it('checks again once 24h have passed', async () => {
    const store = new MapStorage();
    const now = () => 1_000_000_000_000;
    store.setItem('zork-update-check-last', String(now() - 25 * 60 * 60 * 1000));
    const fetchImpl = fakeFetch(() => jsonResponse({ tag_name: 'v1.0.0', html_url: 'x' }));
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store, now });
    expect(result.checked).toBe(true);
  });
});

describe('checkForUpdate — silent failures', () => {
  it('a network error resolves silently, never throws', async () => {
    const store = new MapStorage();
    const fetchImpl = fakeFetch(() => { throw new Error('offline'); });
    await expect(checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store })).resolves.toEqual({
      checked: true, updateAvailable: false,
    });
  });

  it('a non-ok response (e.g. 403 rate-limit) resolves silently', async () => {
    const store = new MapStorage();
    const fetchImpl = fakeFetch(() => jsonResponse({}, false, 403));
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store });
    expect(result.updateAvailable).toBe(false);
    expect(result.checked).toBe(true);
  });

  it('a malformed response body resolves silently', async () => {
    const store = new MapStorage();
    const fetchImpl = fakeFetch(() => jsonResponse({ unexpected: 'shape' }));
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store });
    expect(result.updateAvailable).toBe(false);
  });

  it('a same-or-older latest version reports no update available', async () => {
    const store = new MapStorage();
    const fetchImpl = fakeFetch(() => jsonResponse({ tag_name: 'v1.0.0', html_url: 'x' }));
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl, store });
    expect(result.updateAvailable).toBe(false);
  });
});

describe('update notice dismissal', () => {
  it('is not dismissed by default, then is after dismiss()', () => {
    const store = new MapStorage();
    expect(isDismissed(store, 'v2.0.0')).toBe(false);
    dismiss(store, 'v2.0.0');
    expect(isDismissed(store, 'v2.0.0')).toBe(true);
  });

  it('dismissal is per-version — a newer release re-shows the notice', () => {
    const store = new MapStorage();
    dismiss(store, 'v2.0.0');
    expect(isDismissed(store, 'v2.1.0')).toBe(false);
  });
});
