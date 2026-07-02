// @vitest-environment jsdom
//
// Mobile drawer regression (#20). The drawer is a cloneNode(true) of the sidebar,
// which copies markup but NOT event listeners — so every interactive control the
// drawer reuses must be re-bound by its data attribute. #20.2: Feedback opened
// nothing in the drawer because only the theme + credits buttons were re-wired.
// #20.1: the open-sidebar toggle stayed on top of the panel's close button while
// the drawer was open.

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  vi.stubGlobal('__BUILD_ID__', 'test-build');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('mobile drawer — cloned sidebar buttons open their modals (#20.2)', () => {
  it('drawer Send Feedback button opens the feedback dialog', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const drawer = app.querySelector('[aria-label="Sidebar"]');
    const btn = drawer!.querySelector<HTMLElement>('[data-open-feedback]');
    expect(btn, 'drawer must contain a Feedback button').not.toBeNull();
    const dialog = app.querySelector('#feedback-dialog');
    expect(dialog!.classList.contains('hidden'), 'dialog starts hidden').toBe(true);
    btn!.click();
    expect(dialog!.classList.contains('hidden'), 'dialog opens after drawer click').toBe(false);
  });
});

describe('mobile drawer — toggle hides while the drawer is open (#20.1)', () => {
  it('opening the drawer adds the hidden class to the open-sidebar toggle', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const toggle = app.querySelector<HTMLElement>('[aria-label="Open sidebar"]');
    expect(toggle, 'toggle must exist').not.toBeNull();
    expect(toggle!.classList.contains('hidden'), 'toggle visible before open').toBe(false);
    toggle!.click();
    expect(toggle!.classList.contains('hidden'), 'toggle hidden while drawer open').toBe(true);
  });
});
