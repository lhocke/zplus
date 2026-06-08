// @vitest-environment jsdom
//
// mount-path smoke tests — verifies mountShell() completes without throwing
// and that the DOM it builds satisfies the §3 invariants.
//
// These are the four assertions the verifier reproduced as crashing with the
// TDZ ReferenceError: Cannot access 'switcherContainer' before initialization.
// They must all pass once the TDZ is fixed.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub globals mountShell reads before importing the module.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  vi.stubGlobal('__BUILD_ID__', 'test-build');
  // Clean localStorage so theme init starts from default.
  localStorage.clear();
  // Reset document between tests.
  document.documentElement.removeAttribute('data-theme');
});

describe('mountShell — boot crash regression (TDZ fix)', () => {
  it('mountShell() does not throw on first call', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    expect(() => mountShell(app)).not.toThrow();
  });

  it('start banner is rendered into the scrollback on load', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    // The engine start() banner contains "ZORK" — verify it appears verbatim.
    const scrollback = app.querySelector('[role="log"]');
    expect(scrollback).not.toBeNull();
    expect(scrollback!.textContent).toContain('ZORK');
  });

  it('on-page notice is present in the mounted DOM', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const text = app.textContent ?? '';
    expect(text).toContain('Gameplay in this playtest may be recorded');
    expect(text).toContain('Sessions are anonymous');
  });

  it('empty submit does not POST and does not crash', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const fetchBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const input = app.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    // Simulate pressing Enter with empty input.
    input!.value = '';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    const fetchAfter = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    // An empty submit should not add new POSTs.
    expect(fetchAfter).toBe(fetchBefore);
  });
});
