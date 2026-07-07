// tests/shell/tauri-adapter-selection.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('mountShell — adapter selection at boot', () => {
  let app: HTMLDivElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    document.body.removeChild(app);
    vi.restoreAllMocks();
  });

  it('uses LocalStorageSavePort when not running under Tauri', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
    const { mountShell } = await import('../../src/ui/shell.js');
    const { session } = mountShell(app);
    // A save through the session proves a working SavePort is wired in;
    // under jsdom, localStorage is the only substrate available, so Ok.
    // means the localStorage branch was taken.
    const out = await session.submit('save 1');
    expect(out).toContain('Ok.');
    expect(localStorage.getItem('zork-save-1')).not.toBeNull();
  });

  it('constructs FsSavePort with the Tauri fs ops when under Tauri', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
    let opsCreated = false;
    vi.doMock('../../src/shell/tauri-fs-ops.js', () => ({
      createTauriFsOps: async () => {
        opsCreated = true;
        // In-memory FsOps fake — enough for the boot path and one save.
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
    const { mountShell } = await import('../../src/ui/shell.js');
    const { session } = mountShell(app);
    const out = await session.submit('save 1');
    expect(out).toContain('Ok.');
    expect(opsCreated).toBe(true);
    // And nothing leaked into localStorage — the fs branch was taken.
    expect(localStorage.getItem('zork-save-1')).toBeNull();
  });
});
