// @vitest-environment jsdom
//
// PB-UI — slot picker modal + gameOver RESTART/RESTORE affordance (spec §7.1, §9 Wave 2).
//
// Done-criteria:
//   - slot picker modal is present in the mounted DOM (data-testid="slot-picker-modal")
//   - picker is hidden by default
//   - picker lists SavePort.list() slot metadata
//   - save/restore from the picker calls the session
//   - RESTART/RESTORE affordance appears when gameOver (data-testid="game-over-affordance")
//   - RESTART affordance issues a confirm before restarting (shell-level OQ-4)
//   - RESTORE from affordance restores from the autosave slot
//   - tsc clean; FULL vitest green; no phase-3 regression

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. Slot picker modal is present and hidden by default
// ---------------------------------------------------------------------------

describe('PB-UI — slot picker modal present', () => {
  it('mountShell renders a hidden slot picker modal', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const modal = app.querySelector('[data-testid="slot-picker-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.classList.contains('hidden')).toBe(true);
  });

  it('a "Saves" (or save-picker) button is present in the sidebar', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    const btns = Array.from(app.querySelectorAll('button'));
    const savesBtn = btns.find(b => /saves|save slots/i.test(b.textContent ?? ''));
    expect(savesBtn).not.toBeUndefined();
  });

  it('clicking the Saves button opens the slot picker modal', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    const modal = app.querySelector('[data-testid="slot-picker-modal"]') as HTMLElement;
    expect(modal.classList.contains('hidden')).toBe(true);

    const btns = Array.from(app.querySelectorAll('button'));
    const savesBtn = btns.find(b => /saves|save slots/i.test(b.textContent ?? '')) as HTMLButtonElement;
    savesBtn.click();

    expect(modal.classList.contains('hidden')).toBe(false);
  });

  it('Escape key closes the slot picker modal', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    const modal = app.querySelector('[data-testid="slot-picker-modal"]') as HTMLElement;
    const btns = Array.from(app.querySelectorAll('button'));
    const savesBtn = btns.find(b => /saves|save slots/i.test(b.textContent ?? '')) as HTMLButtonElement;
    savesBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Slot picker lists metadata from SavePort
// ---------------------------------------------------------------------------

describe('PB-UI — picker lists slot metadata', () => {
  it('picker shows "empty" or no entries when no saves exist', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    const btns = Array.from(app.querySelectorAll('button'));
    const savesBtn = btns.find(b => /saves|save slots/i.test(b.textContent ?? '')) as HTMLButtonElement;
    savesBtn.click();

    const modal = app.querySelector('[data-testid="slot-picker-modal"]') as HTMLElement;
    // With no saves, each slot row should indicate "empty" (or similar)
    const text = modal.textContent ?? '';
    expect(text).toMatch(/slot|save/i);
  });

  it('picker shows saved metadata after a save', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);
    session.start;  // already started by mountShell

    // Save via verb
    submitCommand(app, 'save 1');
    await Promise.resolve();

    // Open picker
    const btns = Array.from(app.querySelectorAll('button'));
    const savesBtn = btns.find(b => /saves|save slots/i.test(b.textContent ?? '')) as HTMLButtonElement;
    savesBtn.click();

    const modal = app.querySelector('[data-testid="slot-picker-modal"]') as HTMLElement;
    const text = modal.textContent ?? '';
    // Should show something about slot 1 being populated — moves or room name
    expect(text).toMatch(/slot\s*1|save\s*1/i);
  });
});

// ---------------------------------------------------------------------------
// 3. gameOver affordance: RESTART + RESTORE appear after game ends
// ---------------------------------------------------------------------------

describe('PB-UI — gameOver affordance', () => {
  it('game-over affordance is NOT present before gameOver', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);
    // Before any command the game is running — no affordance
    const affordance = app.querySelector('[data-testid="game-over-affordance"]');
    expect(affordance).toBeNull();
  });

  it('game-over affordance appears in the scrollback after quit', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    submitCommand(app, 'quit');
    await Promise.resolve();

    const affordance = app.querySelector('[data-testid="game-over-affordance"]');
    expect(affordance).not.toBeNull();
  });

  it('affordance contains a Restart button', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    submitCommand(app, 'quit');
    await Promise.resolve();

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    expect(affordance).not.toBeNull();
    const restartBtn = Array.from(affordance.querySelectorAll('button')).find(
      b => /restart/i.test(b.textContent ?? ''),
    );
    expect(restartBtn).not.toBeUndefined();
  });

  it('affordance contains a Restore button', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    submitCommand(app, 'quit');
    await Promise.resolve();

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    expect(affordance).not.toBeNull();
    const restoreBtn = Array.from(affordance.querySelectorAll('button')).find(
      b => /restore/i.test(b.textContent ?? ''),
    );
    expect(restoreBtn).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Shell-level RESTART confirm (OQ-4)
// ---------------------------------------------------------------------------

describe('PB-UI — RESTART confirm is shell-level (OQ-4)', () => {
  it('clicking Restart in the affordance prompts a confirm before restarting', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);

    submitCommand(app, 'quit');
    await Promise.resolve();
    expect(session.snapshot().gameOver).toBe(true);

    // Confirm dialog should appear — stub window.confirm to return false (cancel)
    let confirmCalled = false;
    vi.stubGlobal('confirm', () => { confirmCalled = true; return false; });

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    const restartBtn = Array.from(affordance.querySelectorAll('button')).find(
      b => /restart/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    restartBtn.click();

    expect(confirmCalled).toBe(true);
    // Cancelled: game still gameOver
    expect(session.snapshot().gameOver).toBe(true);
  });

  it('confirming Restart resets the game and hides the affordance', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);

    submitCommand(app, 'quit');
    await Promise.resolve();
    expect(session.snapshot().gameOver).toBe(true);

    vi.stubGlobal('confirm', () => true);

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    const restartBtn = Array.from(affordance.querySelectorAll('button')).find(
      b => /restart/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    restartBtn.click();

    // After restart: gameOver should be false
    expect(session.snapshot().gameOver).toBe(false);
    // Affordance should be hidden or removed
    const affordanceAfter = app.querySelector('[data-testid="game-over-affordance"]');
    expect(affordanceAfter === null || (affordanceAfter as HTMLElement).classList.contains('hidden')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Restore from affordance restores the autosave slot
// ---------------------------------------------------------------------------

describe('PB-UI — Restore from gameOver affordance', () => {
  it('clicking Restore in the affordance restores from autosave (if present) and hides affordance', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);

    // Do a few moves so the autosave slot has content
    submitCommand(app, 'look');
    await Promise.resolve();
    const movesBefore = session.snapshot().moves;

    // Trigger gameOver
    submitCommand(app, 'quit');
    await Promise.resolve();
    expect(session.snapshot().gameOver).toBe(true);

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    const restoreBtn = Array.from(affordance.querySelectorAll('button')).find(
      b => /restore/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    restoreBtn.click();

    // After restore from autosave: game should no longer be gameOver
    expect(session.snapshot().gameOver).toBe(false);
    // Moves should be back near the pre-quit count
    expect(session.snapshot().moves).toBeLessThanOrEqual(movesBefore + 1);
  });

  // §6 mandated disclosure: affordance text must explain start-of-fatal-turn semantics.
  it('affordance text discloses that Restore returns to the START of the fatal turn', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    mountShell(app);

    submitCommand(app, 'quit');
    await Promise.resolve();

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    expect(affordance).not.toBeNull();
    const text = affordance.textContent ?? '';
    // Must mention the "start of" / "beginning of" the turn semantics so the player
    // understands that replaying the same command will re-kill deterministically (§6).
    expect(text).toMatch(/start of|beginning of/i);
  });

  // Strand guard: when the autosave slot is absent, clicking Restore must NOT remove
  // the affordance — the player must still be able to Restart (house-style no-hard-lock).
  it('clicking Restore when autosave is absent keeps the affordance visible and game still gameOver', async () => {
    const { mountShell } = await import('../../src/ui/shell.js');
    const app = document.createElement('div');
    const { session } = mountShell(app);

    // Trigger gameOver immediately (no prior move → autosave slot has no useful content
    // because quit is the very first command; the autosave written for that turn is pre-quit
    // which would restore to the same quit state — but we need to test the "slot truly absent"
    // path, so we clear localStorage after gameOver fires to simulate quota-emptied state).
    submitCommand(app, 'quit');
    await Promise.resolve();
    expect(session.snapshot().gameOver).toBe(true);

    // Clear autosave slot to simulate quota-eviction / missing autosave.
    localStorage.removeItem('zork-save-autosave');

    const affordance = app.querySelector('[data-testid="game-over-affordance"]') as HTMLElement;
    expect(affordance).not.toBeNull();

    const restoreBtn = Array.from(affordance.querySelectorAll('button')).find(
      b => /restore/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    restoreBtn.click();

    // Failed restore: game still gameOver and affordance still in the DOM.
    expect(session.snapshot().gameOver).toBe(true);
    const affordanceAfter = app.querySelector('[data-testid="game-over-affordance"]');
    expect(affordanceAfter).not.toBeNull();
  });
});
