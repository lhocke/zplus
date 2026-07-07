// @vitest-environment jsdom
/**
 * maze-region-message — unmapped regions render the exact in-voice string,
 * no grid, via both the sidebar (buildMap) and the map modal (spec §7).
 * Drives MapState directly (synthetic room ids) and refreshes via the
 * refreshMap handle mountShell exposes — no engine walkthrough needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const MAZE_MESSAGE = 'You are hopelessly lost in a maze of twisting little passages. No map will help you here.';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  vi.stubGlobal('__BUILD_ID__', 'test-build');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

function submitCommand(app: HTMLElement, cmd: string) {
  const input = app.querySelector<HTMLInputElement>('input')!;
  input.value = cmd;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('maze rooms — sidebar quick-view', () => {
  it('renders the exact lost-in-a-maze message, no room boxes, when current room is in the thief-maze', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState, refreshMap } = mountShell(app);
    mapState.update({ here: 'WEST-OF-HOUSE', exits: [] }, null);
    mapState.update({ here: 'MAZE-1', exits: [] }, 'west');
    await refreshMap();
    expect(app.textContent).toContain(MAZE_MESSAGE);
    expect(app.textContent).not.toContain('┌');
  });
});

describe('maze rooms — map modal', () => {
  it('typing "map" while lost in the thief-maze shows the exact message and no room boxes', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState } = mountShell(app);
    mapState.update({ here: 'WEST-OF-HOUSE', exits: [] }, null);
    mapState.update({ here: 'MAZE-1', exits: [] }, 'west');
    submitCommand(app, 'map');
    const modal = app.querySelector('[data-testid="map-modal"]')!;
    await vi.waitFor(() => expect(modal.textContent).toContain(MAZE_MESSAGE));
    expect(modal.textContent).not.toContain('┌');
  });

  it('typing "map" while lost in the coal-mine maze shows the exact message', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState } = mountShell(app);
    mapState.update({ here: 'WEST-OF-HOUSE', exits: [] }, null);
    mapState.update({ here: 'MINE-1', exits: [] }, 'east');
    submitCommand(app, 'map');
    const modal = app.querySelector('[data-testid="map-modal"]')!;
    await vi.waitFor(() => expect(modal.textContent).toContain(MAZE_MESSAGE));
  });
});
