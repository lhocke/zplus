// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('export/import — desktop-only affordance', () => {
  let app: HTMLDivElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
    vi.resetModules();
  });

  afterEach(() => {
    document.body.removeChild(app);
    vi.restoreAllMocks();
  });

  it('does not render export/import buttons on the web (non-Tauri) build', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
    const { mountShell } = await import('../../src/ui/shell.js');
    mountShell(app);
    const allButtons = [...app.querySelectorAll('button')];
    const saves = allButtons.find((b) => b.textContent === 'Saves');
    saves?.click();
    await new Promise((r) => setTimeout(r, 0));   // renderSlots is async
    expect(document.querySelector('[data-testid="slot-export-btn"]')).toBeNull();
    expect(document.querySelector('[data-testid="slot-import-btn"]')).toBeNull();
  });
});
