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
