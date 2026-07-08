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

describe('export/import — happy-path round trip (the audit gap: no test proved the feature WORKS)', () => {
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

  it('exports a slot to a file and imports it back into another slot', async () => {
    // Two independent stores, mirroring production:
    //  - slotStore: the app-data slot files (savePort → FsOps → plugin-fs w/ baseDir)
    //  - extStore:  the dialog-picked file the user exports to / imports from
    const slotStore = new Map<string, string>();
    const slotDirs = new Set<string>();
    const extStore = new Map<string, string>();
    // Arbitrary dialog-picked location, outside the app-data fs scope.
    const EXPORT_PATH = '/tmp/zplus-export/save-1.json';

    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
    vi.doMock('../../src/shell/tauri-fs-ops.js', () => ({
      createTauriFsOps: async () => ({
        exists: async (p: string) => slotStore.has(p) || slotDirs.has(p),
        mkdir: async (p: string) => { slotDirs.add(p); },
        readDir: async (p: string) =>
          [...slotStore.keys()]
            .filter((k) => k.startsWith(`${p}/`))
            .map((k) => ({ name: k.slice(p.length + 1), isDirectory: false })),
        readTextFile: async (p: string) => {
          const v = slotStore.get(p);
          if (v === undefined) throw new Error('ENOENT');
          return v;
        },
        writeTextFile: async (p: string, c: string) => { slotStore.set(p, c); },
        remove: async (p: string) => { slotStore.delete(p); },
      }),
    }));
    // The dialog plugin returns the same absolute path for save + open, so an
    // export round-trips into the following import.
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      save: async () => EXPORT_PATH,
      open: async () => EXPORT_PATH,
    }));
    // plugin-fs direct calls (export write / import read) accept the arbitrary
    // absolute dialog path. This is FAITHFUL, not accidentally permissive:
    // Tauri v2's dialog plugin adds a picked path to the fs scope at runtime
    // (v2.tauri.app dialog docs: "The selected paths are added to the
    // filesystem ... scopes"), so the real writeTextFile/readTextFile succeed
    // on it — confirmed by the 2026-07-07 smoke walkthrough. A fake that
    // rejected the path would be LESS faithful than production (rule 27).
    vi.doMock('@tauri-apps/plugin-fs', () => ({
      writeTextFile: async (p: string, c: string) => { extStore.set(p, c); },
      readTextFile: async (p: string) => {
        const v = extStore.get(p);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      },
      exists: async () => false,
      mkdir: async () => {},
      readDir: async () => [],
      remove: async () => {},
      BaseDirectory: { AppData: 'AppData' },
    }));

    const { validateSaveState, VALIDATION_OK } = await import('../../src/shell/save-port.js');
    const { SAVE_FORMAT_VERSION } = await import('../../src/engine/save-state.js');
    const { mountShell } = await import('../../src/ui/shell.js');
    const { session } = mountShell(app);

    // Populate slot 1 with a real serialized save.
    await session.submit('save 1');

    const openSaves = async () => {
      const saves = [...app.querySelectorAll('button')].find((b) => b.textContent === 'Saves');
      saves?.click();
      await new Promise((r) => setTimeout(r, 0));   // renderSlots is async
    };

    // Export slot 1 (first export button) to the dialog path.
    await openSaves();
    const exportBtns = app.querySelectorAll<HTMLButtonElement>('[data-testid="slot-export-btn"]');
    exportBtns[0].click();
    await new Promise((r) => setTimeout(r, 0));

    // The exported file exists and is a structurally valid save — not empty,
    // not a stub. (Export half of the round trip.)
    const exported = extStore.get(EXPORT_PATH);
    expect(exported, 'export wrote nothing to the picked path').toBeDefined();
    const parsed = JSON.parse(exported!);
    expect(validateSaveState(parsed)).toBe(VALIDATION_OK);
    expect(parsed.formatVersion).toBe(SAVE_FORMAT_VERSION);

    // Import that file into slot 3 (third import button).
    await openSaves();
    const importBtns = app.querySelectorAll<HTMLButtonElement>('[data-testid="slot-import-btn"]');
    importBtns[2].click();
    await new Promise((r) => setTimeout(r, 0));

    // Slot 3 now holds the imported save: restoring it emits the faithful
    // success text. (Import half — proves import accepts what export wrote;
    // the positive "Ok." assertion keeps this from passing vacuously if the
    // restore output shape ever changes.)
    const restoreOut = await session.submit('restore 3');
    expect(restoreOut).toContain('Ok.');
    expect(restoreOut).not.toContain('damaged');
  });

  it('a cancelled dialog is a silent no-op for both export and import', async () => {
    const extStore = new Map<string, string>();
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
    // Real plugin-dialog returns null on cancel (v2 docs) — the branch the
    // audit flagged as defended-but-untested.
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      save: async () => null,
      open: async () => null,
    }));
    vi.doMock('@tauri-apps/plugin-fs', () => ({
      writeTextFile: async (p: string, c: string) => { extStore.set(p, c); },
      readTextFile: async () => { throw new Error('should never be read on cancel'); },
      exists: async () => false,
      mkdir: async () => {},
      readDir: async () => [],
      remove: async () => {},
      BaseDirectory: { AppData: 'AppData' },
    }));

    const { mountShell } = await import('../../src/ui/shell.js');
    const { session } = mountShell(app);
    await session.submit('save 1');

    const saves = [...app.querySelectorAll('button')].find((b) => b.textContent === 'Saves');
    saves?.click();
    await new Promise((r) => setTimeout(r, 0));
    const before = app.textContent;

    app.querySelector<HTMLButtonElement>('[data-testid="slot-export-btn"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    app.querySelector<HTMLButtonElement>('[data-testid="slot-import-btn"]')?.click();
    await new Promise((r) => setTimeout(r, 0));

    // Nothing written, nothing read, no error text appended.
    expect(extStore.size).toBe(0);
    expect(app.textContent).toBe(before);
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
