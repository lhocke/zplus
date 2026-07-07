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

describe('import — untrusted input goes through validateSaveState (phase-4 §5.1)', () => {
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

  it('rejects a tampered save file without writing it to the slot, in-voice', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
    vi.doMock('../../src/shell/tauri-fs-ops.js', () => ({
      createTauriFsOps: async () => {
        const files = new Map<string, string>();
        const dirs = new Set<string>();
        return {
          exists: async (p: string) => files.has(p) || dirs.has(p),
          mkdir: async (p: string) => { dirs.add(p); },
          readDir: async () => [],
          readTextFile: async (p: string) => {
            const v = files.get(p);
            if (v === undefined) throw new Error('ENOENT');
            return v;
          },
          writeTextFile: async (p: string, c: string) => { files.set(p, c); },
          remove: async (p: string) => { files.delete(p); },
        };
      },
    }));
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      save: async () => null,
      open: async () => '/fake/path/tampered.json',
    }));
    vi.doMock('@tauri-apps/plugin-fs', () => ({
      // Tampered: formatVersion is a string, not a number — fails validateSaveState.
      readTextFile: async () => JSON.stringify({ formatVersion: 'not-a-number' }),
      writeTextFile: async () => {},
      exists: async () => true,
      mkdir: async () => {},
      readDir: async () => [],
      remove: async () => {},
      BaseDirectory: { AppData: 'AppData' },
    }));

    const { mountShell } = await import('../../src/ui/shell.js');
    const { session } = mountShell(app);

    const allButtons = [...app.querySelectorAll('button')];
    const saves = allButtons.find((b) => b.textContent === 'Saves');
    saves?.click();
    await new Promise((r) => setTimeout(r, 0));   // renderSlots is async
    const importBtn = document.querySelector<HTMLButtonElement>('[data-testid="slot-import-btn"]');
    expect(importBtn).not.toBeNull();
    importBtn!.click();
    // Let the async import handler's promise chain settle.
    await new Promise((r) => setTimeout(r, 0));

    // The tampered file must never have reached the slot — restoring slot 1
    // still reports the faithful "no save here" behavior (Failed.), not a
    // successful restore of garbage state.
    const restoreOut = await session.submit('restore 1');
    expect(restoreOut).toContain('Failed.');
  });
});

describe('update notice — desktop-only, gated on update availability', () => {
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

  it('does not appear on the web (non-Tauri) build', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
    const { mountShell } = await import('../../src/ui/shell.js');
    mountShell(app);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('[data-testid="update-notice"]')).toBeNull();
  });

  it('appears when checkForUpdate reports an available update under Tauri', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.0.0' }));
    vi.doMock('@tauri-apps/plugin-http', () => ({
      fetch: async () => ({
        ok: true,
        json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://example.test/releases/v9.9.9' }),
      }),
    }));
    vi.doMock('../../src/shell/tauri-fs-ops.js', () => ({
      createTauriFsOps: async () => ({
        exists: async () => false, mkdir: async () => {}, readDir: async () => [],
        readTextFile: async () => { throw new Error('unused'); },
        writeTextFile: async () => {}, remove: async () => {},
      }),
    }));

    const { mountShell } = await import('../../src/ui/shell.js');
    mountShell(app);
    // The update-check IIFE awaits two dynamic imports + a fetch — give the
    // microtask queue a few turns.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const notice = document.querySelector('[data-testid="update-notice"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('v9.9.9');
  });
});
