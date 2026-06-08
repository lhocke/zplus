// Web shell — wires GameSession, terminal, status bar, and HttpSink.
// Called from src/main.ts after the theme is applied.
//
// Layout (§3):
//   Desktop (≥lg): two columns — terminal left, sidebar right.
//   Mobile (<lg): terminal full-width; sidebar behind drawer toggle.
//   Plain Tailwind throughout. Swap seams are marked // TAILWIND-PLUS SWAP SEAM.

import { createSession } from '../shell/session.js';
import { HttpSink } from '../shell/http-sink.js';
import { MapState } from './map-state.js';
import { isThemeName, DEFAULT_THEME, type ThemeName } from './themes.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// ── Theme switcher ────────────────────────────────────────────────────────────

// TAILWIND-PLUS SWAP SEAM — theme switcher (segmented-control)
// This plain-Tailwind radio group swaps to a Tailwind Plus SegmentedControl
// once vendor/tailwind-plus/ lands. Component boundary: buildThemeSwitcher().
function buildThemeSwitcher(onSwitch: (t: ThemeName) => void): HTMLElement {
  const wrap = el('div', 'flex gap-1');
  const names: ThemeName[] = ['crt', 'literary', 'parchment'];
  const labels: Record<ThemeName, string> = { crt: 'CRT', literary: 'Literary', parchment: 'Parchment' };

  for (const name of names) {
    const btn = el('button', [
      'theme-btn px-2 py-1 text-xs rounded border',
      'border-[var(--zork-accent)] text-[var(--zork-fg)]',
      'hover:bg-[var(--zork-accent)] hover:text-[var(--zork-bg)]',
      'data-[active=true]:bg-[var(--zork-accent)] data-[active=true]:text-[var(--zork-bg)]',
    ].join(' '), { 'data-theme-target': name });
    btn.textContent = labels[name];
    btn.addEventListener('click', () => onSwitch(name));
    wrap.appendChild(btn);
  }

  return wrap;
}

function syncThemeBtns(container: HTMLElement, active: ThemeName) {
  for (const btn of container.querySelectorAll<HTMLElement>('[data-theme-target]')) {
    btn.setAttribute('data-active', btn.getAttribute('data-theme-target') === active ? 'true' : 'false');
  }
}

// ── Drawer (mobile sidebar) ───────────────────────────────────────────────────

// TAILWIND-PLUS SWAP SEAM — slide-over drawer (mobile)
// This builds a minimal drawer that slides in from the right. Swaps to a
// Tailwind Plus SlideOver component as a localized drop-in.
function buildDrawer(content: HTMLElement): { overlay: HTMLElement; toggle: HTMLElement } {
  const overlay = el('div', [
    'fixed inset-0 z-40 flex justify-end',
    'pointer-events-none',
  ].join(' '));
  overlay.setAttribute('aria-hidden', 'true');

  const panel = el('div', [
    'w-72 h-full bg-[var(--zork-bg)] border-l border-[var(--zork-accent)]',
    'translate-x-full transition-transform duration-300 ease-in-out',
    'overflow-y-auto p-4 pointer-events-auto',
  ].join(' '));
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Sidebar');
  panel.appendChild(content);
  overlay.appendChild(panel);

  // Close button inside the drawer.
  const closeBtn = el('button', [
    'mb-4 text-xs text-[var(--zork-accent)] underline',
  ].join(' '));
  closeBtn.textContent = '✕ close';
  closeBtn.addEventListener('click', () => closeDrawer());
  panel.insertBefore(closeBtn, panel.firstChild);

  // Backdrop click closes.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDrawer();
  });

  function openDrawer() {
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('pointer-events-none');
    panel.classList.remove('translate-x-full');
  }
  function closeDrawer() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.add('pointer-events-none');
    panel.classList.add('translate-x-full');
  }

  const toggle = el('button', [
    'lg:hidden fixed top-3 right-3 z-50',
    'px-2 py-1 text-xs rounded border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] bg-[var(--zork-bg)]',
  ].join(' '), { 'aria-label': 'Open sidebar' });
  toggle.textContent = '☰';
  toggle.addEventListener('click', openDrawer);

  return { overlay, toggle };
}

// ── Terminal ──────────────────────────────────────────────────────────────────

function buildTerminal(onSubmit: (cmd: string) => void): {
  container: HTMLElement;
  appendOutput: (text: string) => void;
  appendCommand: (cmd: string) => void;
} {
  const container = el('div', 'flex flex-col h-full');

  // Scrollback region.
  const scrollback = el('div', [
    'flex-1 overflow-y-auto px-4 py-3 font-mono text-sm',
    'whitespace-pre-wrap break-words',
    'text-[var(--zork-fg)] bg-[var(--zork-bg)]',
    'cursor-text',
  ].join(' '), { 'role': 'log', 'aria-live': 'polite', 'aria-label': 'Game output' });

  // Click anywhere in the terminal to focus the input.
  container.addEventListener('click', () => input.focus());

  // Input row.
  const inputRow = el('div', 'flex items-center border-t border-[var(--zork-accent)] px-4 py-2');
  const prompt = el('span', 'text-[var(--zork-accent)] mr-2 font-mono text-sm select-none');
  prompt.textContent = '>';
  const input = el('input', [
    'flex-1 bg-transparent outline-none font-mono text-sm',
    'text-[var(--zork-fg)] caret-[var(--zork-accent)]',
  ].join(' '), { type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off' });

  inputRow.appendChild(prompt);
  inputRow.appendChild(input);
  container.appendChild(scrollback);
  container.appendChild(inputRow);

  // Command history (in-memory, current session only).
  const history: string[] = [];
  let histIdx = -1;
  let savedDraft = '';

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value;
      input.value = '';
      histIdx = -1;
      savedDraft = '';
      if (cmd.trim()) {
        history.push(cmd);
      }
      onSubmit(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIdx === -1) savedDraft = input.value;
      const next = histIdx + 1;
      if (next < history.length) {
        histIdx = next;
        input.value = history[history.length - 1 - histIdx]!;
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = histIdx - 1;
      if (next < 0) {
        histIdx = -1;
        input.value = savedDraft;
      } else {
        histIdx = next;
        input.value = history[history.length - 1 - histIdx]!;
      }
    }
  });

  function autoScroll() {
    scrollback.scrollTop = scrollback.scrollHeight;
  }

  function appendOutput(text: string) {
    const pre = el('pre', 'whitespace-pre-wrap break-words m-0 p-0 font-mono text-sm');
    pre.textContent = text;
    scrollback.appendChild(pre);
    autoScroll();
  }

  function appendCommand(cmd: string) {
    const div = el('div', 'mt-2 text-[var(--zork-accent)] font-mono text-sm');
    div.textContent = `> ${cmd}`;
    scrollback.appendChild(div);
    autoScroll();
  }

  return { container, appendOutput, appendCommand };
}

// ── Status bar ────────────────────────────────────────────────────────────────

function buildStatusBar(): { element: HTMLElement; update: (hereName: string, score: number, maxScore: number, moves: number) => void } {
  const element = el('div', [
    'px-4 py-2 text-xs font-mono border-b border-[var(--zork-accent)]',
    'text-[var(--zork-fg)]',
  ].join(' '), { 'aria-live': 'polite', 'aria-label': 'Game status' });

  function update(hereName: string, score: number, maxScore: number, moves: number) {
    element.textContent = `${hereName} · ${score}/${maxScore} · moves: ${moves}`;
  }

  update('Loading…', 0, 350, 0);
  return { element, update };
}

// ── Map (rough fog-of-war) ────────────────────────────────────────────────────

function buildMap(mapState: MapState): { element: HTMLElement; refresh: () => void } {
  const element = el('div', 'text-xs font-mono text-[var(--zork-fg)] py-2');

  // Lazy-load map layout so the module can be tested without a bundler.
  let _layoutPromise: Promise<typeof import('./map-layout.js')> | null = null;
  function getLayout() {
    if (!_layoutPromise) {
      _layoutPromise = import('./map-layout.js');
    }
    return _layoutPromise;
  }

  async function refresh() {
    const layout = await getLayout();
    const visited = mapState.visitedRooms();
    const current = mapState.currentRoom();

    if (visited.size === 0) {
      element.textContent = '';
      return;
    }

    // Simple text-based map: list visited rooms, highlight current.
    const lines: string[] = ['── MAP ──'];
    for (const [id, room] of layout.ROOM_BY_ID) {
      if (visited.has(id)) {
        const marker = id === current ? '▶' : ' ';
        lines.push(`${marker} ${room.label}`);
      }
    }
    element.textContent = lines.join('\n');
  }

  return { element, refresh };
}


// ── Known-issues dialog ───────────────────────────────────────────────────────

// TAILWIND-PLUS SWAP SEAM — modal dialog
// This plain-Tailwind dialog swaps to a Tailwind Plus Dialog component.
function buildKnownIssuesDialog(): { open: () => void; element: HTMLElement } {
  const backdrop = el('div', [
    'fixed inset-0 z-50 flex items-center justify-center',
    'bg-black/70 hidden',
  ].join(' '), { 'aria-modal': 'true', 'role': 'dialog', 'aria-label': 'Known Issues' });

  const panel = el('div', [
    'w-full max-w-md mx-4 p-6 rounded',
    'bg-[var(--zork-bg)] border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] font-mono text-sm overflow-y-auto max-h-[80vh]',
  ].join(' '));

  const title = el('h2', 'text-base font-bold mb-4 text-[var(--zork-accent)]');
  title.textContent = 'Known Issues & Limitations';

  const issues = [
    'Content ends at the troll. Combat arrives in a later phase.',
    'No saving. Each page load is a fresh game.',
    'The map is rough and only covers the pre-troll area.',
    'No thief, no cyclops, no combat (deferred mechanics).',
    'RANDOMIZE-OBJECTS is deferred — object placement is deterministic.',
    'Score is out of the full game\'s 350. The pre-troll region reaches a small fraction.',
  ];

  const list = el('ul', 'list-disc pl-5 space-y-1');
  for (const issue of issues) {
    const li = el('li', '');
    li.textContent = issue;
    list.appendChild(li);
  }

  const closeBtn = el('button', 'mt-4 text-xs text-[var(--zork-accent)] underline');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => backdrop.classList.add('hidden'));

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });

  panel.appendChild(title);
  panel.appendChild(list);
  panel.appendChild(closeBtn);
  backdrop.appendChild(panel);

  function open() { backdrop.classList.remove('hidden'); }

  return { open, element: backdrop };
}

// ── Shell mount ───────────────────────────────────────────────────────────────

export function mountShell(app: HTMLElement): void {
  // Clear the loading placeholder.
  app.innerHTML = '';

  const sink = new HttpSink();
  const mapState = new MapState();
  const session = createSession({ sink });

  // ── Theme management ────────────────────────────────────────────────────
  // switcherContainer must be declared before applyTheme is called at boot —
  // applyTheme references it to sync button state.
  //
  // localStorage is a stopgap for Phase 1 (§3): device-local, clearable, per-browser.
  // When real persistence arrives (save slots, cross-device state), migrate to
  // server-side storage (e.g. D1); localStorage stays at most a cache/fallback.
  const savedTheme = localStorage.getItem('zork-theme');
  const currentTheme: ThemeName = isThemeName(savedTheme) ? savedTheme : DEFAULT_THEME;

  // Theme switcher built early so applyTheme can reference it.
  const themeLabel = el('div', 'text-xs text-[var(--zork-accent)] uppercase tracking-wider');
  themeLabel.textContent = 'Theme';
  const switcherContainer = buildThemeSwitcher((name) => applyTheme(name));

  function applyTheme(name: ThemeName) {
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('zork-theme', name);
    syncThemeBtns(switcherContainer, name);
  }

  applyTheme(currentTheme);

  // ── Build components ────────────────────────────────────────────────────
  const statusBar = buildStatusBar();

  const { container: terminal, appendOutput, appendCommand } = buildTerminal((cmd) => {
    if (cmd.trim()) {
      appendCommand(cmd);
    }
    const output = session.submit(cmd);
    if (output) appendOutput(output);
    const snap = session.snapshot();
    statusBar.update(snap.hereName, snap.score, snap.maxScore, snap.moves);
    mapState.update(snap);
    void map.refresh();
  });

  const map = buildMap(mapState);
  const { open: openIssues, element: issuesDialog } = buildKnownIssuesDialog();

  // ── Sidebar content ─────────────────────────────────────────────────────
  const sidebar = el('div', 'flex flex-col gap-4 min-w-0');

  // Status (desktop — compact copy in sidebar header).
  const sidebarStatus = el('div', 'text-xs font-mono text-[var(--zork-fg)] border-b border-[var(--zork-accent)] pb-2');
  sidebarStatus.textContent = 'Status';

  // (themeLabel and switcherContainer are built above — before applyTheme.)
  syncThemeBtns(switcherContainer, currentTheme);

  // Map area.
  const mapLabel = el('div', 'text-xs text-[var(--zork-accent)] uppercase tracking-wider mt-2');
  mapLabel.textContent = 'Map';

  // Known issues button.
  const issuesBtn = el('button', 'text-xs text-[var(--zork-accent)] underline mt-2 text-left');
  issuesBtn.textContent = 'Known Issues & Limitations';
  issuesBtn.addEventListener('click', openIssues);

  // Notice — §4: gameplay may be reviewed.
  const notice = el('p', 'text-[10px] text-[var(--zork-fg)] opacity-60 mt-auto pt-4');
  notice.textContent =
    'Gameplay in this playtest may be recorded and reviewed to help debug the game during development. Sessions are anonymous.';

  // Ko-fi / Patreon links (§7).
  const supportLinks = el('div', 'flex gap-3 text-[10px] mt-2');
  const kofi = el('a', 'text-[var(--zork-accent)] underline', { href: 'https://ko-fi.com', target: '_blank', rel: 'noopener noreferrer' });
  kofi.textContent = 'Ko-fi';
  const patreon = el('a', 'text-[var(--zork-accent)] underline', { href: 'https://patreon.com', target: '_blank', rel: 'noopener noreferrer' });
  patreon.textContent = 'Patreon';
  supportLinks.appendChild(kofi);
  supportLinks.appendChild(patreon);

  sidebar.appendChild(sidebarStatus);
  sidebar.appendChild(themeLabel);
  sidebar.appendChild(switcherContainer);
  sidebar.appendChild(mapLabel);
  sidebar.appendChild(map.element);
  sidebar.appendChild(issuesBtn);
  sidebar.appendChild(notice);
  sidebar.appendChild(supportLinks);

  // ── Mobile drawer ───────────────────────────────────────────────────────
  // Clone sidebar content for the drawer (mobile).
  const drawerContent = sidebar.cloneNode(true) as HTMLElement;
  // Re-wire theme buttons in the cloned node.
  for (const btn of drawerContent.querySelectorAll<HTMLElement>('[data-theme-target]')) {
    const target = btn.getAttribute('data-theme-target') as ThemeName;
    btn.addEventListener('click', () => applyTheme(target));
  }

  const { overlay: drawerOverlay, toggle: drawerToggle } = buildDrawer(drawerContent);

  // ── Layout ──────────────────────────────────────────────────────────────
  // Outer: full height, flex column to stack status bar + main area.
  const outer = el('div', 'flex flex-col h-full');

  // Status bar — pinned above terminal on mobile, inside sidebar on desktop.
  const statusBarWrapper = el('div', 'lg:hidden');
  statusBarWrapper.appendChild(statusBar.element);
  outer.appendChild(statusBarWrapper);

  // Main area: two-col on desktop.
  const main = el('div', 'flex flex-1 min-h-0 overflow-hidden');

  // Terminal column — full width on mobile, flexible on desktop.
  const terminalCol = el('div', 'flex-1 flex flex-col min-w-0 overflow-hidden');
  terminalCol.appendChild(terminal);
  main.appendChild(terminalCol);

  // Sidebar — hidden on mobile (lives in drawer), visible lg+.
  const sidebarCol = el('div', [
    'hidden lg:flex flex-col w-64 xl:w-72 shrink-0',
    'border-l border-[var(--zork-accent)] overflow-y-auto p-4',
  ].join(' '));
  sidebarCol.appendChild(sidebar);
  main.appendChild(sidebarCol);

  outer.appendChild(main);

  app.appendChild(outer);
  app.appendChild(drawerOverlay);
  app.appendChild(drawerToggle);
  app.appendChild(issuesDialog);

  // ── Boot the game ───────────────────────────────────────────────────────
  const banner = session.start();
  appendOutput(banner);
  const snap = session.snapshot();
  statusBar.update(snap.hereName, snap.score, snap.maxScore, snap.moves);
  mapState.update(snap);
  void map.refresh();

  // Focus the input immediately.
  const inputEl = terminal.querySelector<HTMLInputElement>('input');
  if (inputEl) inputEl.focus();

  // ── Teardown ────────────────────────────────────────────────────────────
  // Fire SessionEnd + drain beacon ONLY on real tab teardown (pagehide).
  // visibilitychange→hidden fires on tab switch and must NOT emit SessionEnd.
  let torn = false;
  window.addEventListener('pagehide', () => {
    if (torn) return;
    torn = true;
    session.close();
    sink.drainBeacon();
  });
}
