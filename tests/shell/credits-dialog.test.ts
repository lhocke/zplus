// @vitest-environment jsdom
//
// Credits dialog tests — verifies the About & Credits button, dialog open,
// content, and always-visible license line added in Task 3.

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  vi.stubGlobal('__BUILD_ID__', 'test-build');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('credits dialog', () => {
  it('sidebar contains an About & Credits button', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    // The sidebar renders the button; find it anywhere in the mounted DOM.
    const btns = Array.from(app.querySelectorAll('button'));
    const creditsBtn = btns.find(b => b.textContent?.includes('About & Credits'));
    expect(creditsBtn).not.toBeUndefined();
  });

  it('clicking the About & Credits button removes hidden from #credits-dialog', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    const dialog = app.querySelector('#credits-dialog') as HTMLElement;
    expect(dialog).not.toBeNull();
    // Dialog starts hidden.
    expect(dialog.classList.contains('hidden')).toBe(true);

    const btns = Array.from(app.querySelectorAll('button'));
    const creditsBtn = btns.find(b => b.textContent?.includes('About & Credits')) as HTMLButtonElement;
    creditsBtn.click();

    expect(dialog.classList.contains('hidden')).toBe(false);
  });

  it('dialog contains MIT License text, Microsoft copyright, and author names', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    const dialog = app.querySelector('#credits-dialog') as HTMLElement;
    expect(dialog).not.toBeNull();
    const text = dialog.textContent ?? '';
    expect(text).toContain('MIT License');
    expect(text).toContain('Copyright (c) 2025 Microsoft');
    expect(text).toContain('Marc Blank');

    const link = dialog.querySelector<HTMLAnchorElement>('a[href="https://github.com/historicalsource/zork1"]');
    expect(link).not.toBeNull();
  });

  it('always-visible license line is present in the sidebar', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const text = app.textContent ?? '';
    expect(text).toContain('open-sourced by Microsoft under the MIT License');
  });
});
