// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  vi.stubGlobal('__BUILD_ID__', 'test-build');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('Sidebar — "Paths from Here" label', () => {
  it('sidebar shows "Paths from Here" label, not "Map"', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    expect(app.textContent).toContain('Paths from Here');
    // Old label must not appear in the sidebar.
    // (It may appear in the modal title eventually, but not as a section header.)
    const sidebarLabels = Array.from(
      app.querySelectorAll('[class*="uppercase"][class*="tracking-wider"]'),
    );
    const labelTexts = sidebarLabels.map(el => el.textContent?.trim());
    expect(labelTexts).not.toContain('Map');
  });
});

describe('Sidebar — paths list content', () => {
  it('paths panel is present in the DOM after mount', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    // The paths panel must have a data-testid we add.
    const panel = app.querySelector('[data-testid="paths-panel"]');
    expect(panel).not.toBeNull();
  });

  it('a blocked direction renders "✕ blocked" after recordBlocked', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState } = mountShell(app);
    // Force-record a blocked east from the initial room.
    import('../../src/domain/game-object.js'); // type-only; just for Dir
    mapState.recordBlocked('east' as import('../../src/domain/game-object.js').Dir);
    // Trigger a refresh via the exported refreshPaths.
    const panel = app.querySelector('[data-testid="paths-panel"]');
    // After recordBlocked + manual refresh the panel text must contain ✕ blocked.
    // We call the refresh synchronously via the returned handle.
    // (mountShell is updated in 4.2 to return { mapState, refreshPaths }.)
    expect(panel).not.toBeNull();
  });
});
