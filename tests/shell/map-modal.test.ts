// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(true) });
  vi.stubGlobal('__BUILD_ID__', 'test-build');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.resetModules();
});

function submitCommand(app: HTMLElement, cmd: string) {
  const input = app.querySelector<HTMLInputElement>('input')!;
  input.value = cmd;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('map command — shell intercept', () => {
  it('"map" does not advance view().moves', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);
    const movesBefore = session.snapshot().moves;
    submitCommand(app, 'map');
    await Promise.resolve();
    expect(session.snapshot().moves).toBe(movesBefore);
  });

  it('"MAP" (uppercase) also does not advance moves', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);
    const movesBefore = session.snapshot().moves;
    submitCommand(app, 'MAP');
    await Promise.resolve();
    expect(session.snapshot().moves).toBe(movesBefore);
  });
});

describe('map command — modal lifecycle', () => {
  it('typing "map" opens the map modal', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const modalBefore = app.querySelector('[data-testid="map-modal"]');
    expect(modalBefore?.classList.contains('hidden') ?? true).toBe(true);
    submitCommand(app, 'map');
    await Promise.resolve();
    const modal = app.querySelector('[data-testid="map-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.classList.contains('hidden')).toBe(false);
  });

  it('pressing Escape closes the map modal', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    submitCommand(app, 'map');
    await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const modal = app.querySelector('[data-testid="map-modal"]');
    expect(modal!.classList.contains('hidden')).toBe(true);
  });
});

describe('map modal — paging (spec §8.3)', () => {
  it('paging cycle only exposes discovered mapped regions', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState } = mountShell(app);
    mapState.update({ here: 'WEST-OF-HOUSE', exits: [] }, null);
    mapState.update({ here: 'CELLAR', exits: [] }, 'down');
    submitCommand(app, 'map');
    const modal = app.querySelector('[data-testid="map-modal"]')!;
    const nextBtn = modal.querySelector<HTMLButtonElement>('[data-testid="map-modal-next"]')!;
    await vi.waitFor(() => expect(nextBtn.disabled).toBe(false));
    // Cycling through exactly 2 discovered regions must never reveal a third.
    nextBtn.click();
    await vi.waitFor(() => expect(modal.textContent).toContain('Surface'));
    nextBtn.click();
    await vi.waitFor(() => expect(modal.textContent).toContain('Cellar & Central Passages'));
    expect(modal.textContent).not.toContain('Dam & Reservoir');
    expect(modal.textContent).not.toContain('Coal Mine');
  });

  it('prev/next are disabled when only one region is discovered', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    submitCommand(app, 'map');
    const modal = app.querySelector('[data-testid="map-modal"]')!;
    const prevBtn = modal.querySelector<HTMLButtonElement>('[data-testid="map-modal-prev"]')!;
    const nextBtn = modal.querySelector<HTMLButtonElement>('[data-testid="map-modal-next"]')!;
    // Wait on the actual async-derived state (disabled), not the
    // synchronously-true hidden-class removal — the latter resolves
    // vi.waitFor immediately and races the lazy layout import that drives
    // the disabled computation.
    await vi.waitFor(() => expect(prevBtn.disabled).toBe(true));
    expect(nextBtn.disabled).toBe(true);
  });

  it('reopening the modal resets pageRegion to the three-way rule, not the prior paged-to region', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState } = mountShell(app);
    mapState.update({ here: 'WEST-OF-HOUSE', exits: [] }, null);
    mapState.update({ here: 'CELLAR', exits: [] }, 'down');
    submitCommand(app, 'map');
    const modal = app.querySelector('[data-testid="map-modal"]')!;
    const nextBtn = modal.querySelector<HTMLButtonElement>('[data-testid="map-modal-next"]')!;
    await vi.waitFor(() => expect(nextBtn.disabled).toBe(false));
    nextBtn.click();
    await vi.waitFor(() => expect(modal.textContent).toContain('Surface'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    submitCommand(app, 'map');
    // currentRegion is cellar-core (mapped) — rule (1) applies, not whatever
    // the player had paged to before closing.
    await vi.waitFor(() => expect(modal.textContent).toContain('Cellar & Central Passages'));
  });

  it('lastMappedRegion fallback: opening the modal while lost in a maze pages to the most recent mapped region, not surface', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { mapState, noteRegion } = mountShell(app);
    mapState.update({ here: 'WEST-OF-HOUSE', exits: [] }, null);
    noteRegion('WEST-OF-HOUSE');
    mapState.update({ here: 'CELLAR', exits: [] }, 'down');
    noteRegion('CELLAR');
    mapState.update({ here: 'MAZE-1', exits: [] }, 'west');
    noteRegion('MAZE-1');
    submitCommand(app, 'map');
    const modal = app.querySelector('[data-testid="map-modal"]')!;
    // Auto-follow view shows the maze message (current room is unmapped)...
    await vi.waitFor(() => expect(modal.textContent).toContain('hopelessly lost'));
    // ...but paging away must land on cellar-core (lastMappedRegion), not surface.
    const nextBtn = modal.querySelector<HTMLButtonElement>('[data-testid="map-modal-next"]')!;
    nextBtn.click();
    await vi.waitFor(() => expect(modal.textContent).toContain('Cellar & Central Passages'));
  });
});
