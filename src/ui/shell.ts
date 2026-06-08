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
import { shapeFeedbackPayload, collectBrowserInfo } from './feedback.js';
import { ALLOWED_CATEGORIES } from '../../functions/lib/sanitize.js';

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

// ── Feedback form dialog ──────────────────────────────────────────────────────

// TAILWIND-PLUS SWAP SEAM — modal dialog
// Plain-Tailwind modal; swaps to a Tailwind Plus Dialog as a localized drop-in.
function buildFeedbackDialog(getSessionId: () => string, getActiveTheme: () => ThemeName): {
  open: () => void;
  element: HTMLElement;
} {
  const backdrop = el('div', [
    'fixed inset-0 z-50 flex items-center justify-center',
    'bg-black/70 hidden',
  ].join(' '), { 'aria-modal': 'true', 'role': 'dialog', 'aria-label': 'Send Feedback' });

  const panel = el('div', [
    'w-full max-w-md mx-4 p-6 rounded',
    'bg-[var(--zork-bg)] border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] font-mono text-sm overflow-y-auto max-h-[90vh]',
  ].join(' '));

  const title = el('h2', 'text-base font-bold mb-4 text-[var(--zork-accent)]');
  title.textContent = 'Send Feedback';

  // Category select — constrained to spec-defined allow-list.
  const catLabel = el('label', 'block text-xs mb-1');
  catLabel.textContent = 'Category';
  const catSelect = el('select', [
    'w-full mb-3 px-2 py-1 rounded border border-[var(--zork-accent)]',
    'bg-[var(--zork-bg)] text-[var(--zork-fg)] font-mono text-sm',
  ].join(' '));
  for (const cat of ALLOWED_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    catSelect.appendChild(opt);
  }

  // Message field.
  const msgLabel = el('label', 'block text-xs mb-1');
  msgLabel.textContent = 'Message';
  const msgArea = el('textarea', [
    'w-full mb-3 px-2 py-1 rounded border border-[var(--zork-accent)]',
    'bg-[var(--zork-bg)] text-[var(--zork-fg)] font-mono text-xs',
    'resize-y min-h-[5rem]',
  ].join(' '), { rows: '4', placeholder: 'Describe the issue or suggestion…' });

  // Optional "what were you doing?" field.
  const ctxLabel = el('label', 'block text-xs mb-1');
  ctxLabel.textContent = 'What were you doing? (optional)';
  const ctxArea = el('textarea', [
    'w-full mb-3 px-2 py-1 rounded border border-[var(--zork-accent)]',
    'bg-[var(--zork-bg)] text-[var(--zork-fg)] font-mono text-xs',
    'resize-y min-h-[3rem]',
  ].join(' '), { rows: '2', placeholder: 'e.g. I typed "attack troll" and…' });

  // UI-issue browser info disclosure — shown only when "UI issue" is selected.
  const browserDisclosure = el('p', [
    'text-[10px] opacity-75 mb-3 hidden',
    'border-l-2 border-[var(--zork-accent)] pl-2',
  ].join(' '));
  browserDisclosure.textContent =
    'Because you selected "UI issue", your browser info (user agent, viewport, theme) will be attached to help debug rendering problems.';

  catSelect.addEventListener('change', () => {
    if (catSelect.value === 'UI issue') {
      browserDisclosure.classList.remove('hidden');
    } else {
      browserDisclosure.classList.add('hidden');
    }
  });

  // Submission disclosure — session linkage + no personal info reminder.
  const disclosure = el('p', 'text-[10px] opacity-75 mb-3');
  disclosure.textContent =
    "Submitting links this report to your current session's gameplay transcript (anonymous session ID only). " +
    'Do not type personal information in the fields above.';

  // Status line (empty until submit attempted).
  const status = el('p', 'text-xs min-h-[1.25rem] mb-2');

  // Honeypot — hidden from real users; filled honeypot → rejected by server.
  const hpField = el('input', 'hidden', { type: 'text', autocomplete: 'off', tabindex: '-1', 'aria-hidden': 'true' });

  // Submit button.
  const submitBtn = el('button', [
    'px-3 py-1 rounded border border-[var(--zork-accent)]',
    'text-xs text-[var(--zork-fg)] hover:bg-[var(--zork-accent)] hover:text-[var(--zork-bg)]',
    'disabled:opacity-40 disabled:cursor-not-allowed',
  ].join(' '));
  submitBtn.textContent = 'Send';

  submitBtn.addEventListener('click', async () => {
    const message = (msgArea as HTMLTextAreaElement).value.trim();
    if (!message) {
      status.textContent = 'Message is required.';
      return;
    }

    submitBtn.setAttribute('disabled', 'true');
    submitBtn.textContent = 'Sending…';
    status.textContent = '';

    try {
      const browserInfo =
        catSelect.value === 'UI issue'
          ? collectBrowserInfo(getActiveTheme())
          : undefined;

      const payload = shapeFeedbackPayload({
        category: catSelect.value as typeof ALLOWED_CATEGORIES[number],
        message,
        sessionId: getSessionId(),
        turnstileToken: '', // Turnstile widget injects this at G2; empty string accepted in test mode
        context: (ctxArea as HTMLTextAreaElement).value.trim() || undefined,
        browserInfo,
        hp: (hpField as HTMLInputElement).value || undefined,
      });

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        status.textContent = 'Feedback sent. Thank you!';
        (msgArea as HTMLTextAreaElement).value = '';
        (ctxArea as HTMLTextAreaElement).value = '';
      } else {
        status.textContent = `Send failed (${res.status}). Try again.`;
      }
    } catch {
      status.textContent = 'Send failed. Check your connection.';
    } finally {
      submitBtn.removeAttribute('disabled');
      submitBtn.textContent = 'Send';
    }
  });

  const closeBtn = el('button', 'mt-3 text-xs text-[var(--zork-accent)] underline');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => backdrop.classList.add('hidden'));

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });

  panel.appendChild(title);
  panel.appendChild(catLabel);
  panel.appendChild(catSelect);
  panel.appendChild(msgLabel);
  panel.appendChild(msgArea);
  panel.appendChild(ctxLabel);
  panel.appendChild(ctxArea);
  panel.appendChild(browserDisclosure);
  panel.appendChild(disclosure);
  panel.appendChild(hpField);
  panel.appendChild(status);
  panel.appendChild(submitBtn);
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

  // Capture the sessionId from the SessionStart event so the feedback form can
  // include it. SessionStart is emitted synchronously inside session.start(), so
  // sessionIdRef is populated before any user interaction begins.
  let sessionIdRef = '';
  const trackingSink = {
    emit(e: Parameters<typeof sink.emit>[0]) {
      if (e.type === 'start') sessionIdRef = e.sessionId;
      sink.emit(e);
    },
    close() { sink.close(); },
  };

  const session = createSession({ sink: trackingSink });

  // ── Theme management ────────────────────────────────────────────────────
  // switcherContainer must be declared before applyTheme is called at boot —
  // applyTheme references it to sync button state.
  //
  // localStorage is a stopgap for Phase 1 (§3): device-local, clearable, per-browser.
  // When real persistence arrives (save slots, cross-device state), migrate to
  // server-side storage (e.g. D1); localStorage stays at most a cache/fallback.
  const savedTheme = localStorage.getItem('zork-theme');
  let activeTheme: ThemeName = isThemeName(savedTheme) ? savedTheme : DEFAULT_THEME;

  // Theme switcher built early so applyTheme can reference it.
  const themeLabel = el('div', 'text-xs text-[var(--zork-accent)] uppercase tracking-wider');
  themeLabel.textContent = 'Theme';
  const switcherContainer = buildThemeSwitcher((name) => applyTheme(name));

  function applyTheme(name: ThemeName) {
    activeTheme = name;
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('zork-theme', name);
    syncThemeBtns(switcherContainer, name);
  }

  applyTheme(activeTheme);

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
  const { open: openFeedback, element: feedbackDialog } = buildFeedbackDialog(
    () => sessionIdRef,
    () => activeTheme,
  );

  // ── Sidebar content ─────────────────────────────────────────────────────
  const sidebar = el('div', 'flex flex-col gap-4 min-w-0');

  // Status (desktop — compact copy in sidebar header).
  const sidebarStatus = el('div', 'text-xs font-mono text-[var(--zork-fg)] border-b border-[var(--zork-accent)] pb-2');
  sidebarStatus.textContent = 'Status';

  // (themeLabel and switcherContainer are built above — before applyTheme.)
  syncThemeBtns(switcherContainer, activeTheme);

  // Map area.
  const mapLabel = el('div', 'text-xs text-[var(--zork-accent)] uppercase tracking-wider mt-2');
  mapLabel.textContent = 'Map';

  // Known issues button.
  const issuesBtn = el('button', 'text-xs text-[var(--zork-accent)] underline mt-2 text-left');
  issuesBtn.textContent = 'Known Issues & Limitations';
  issuesBtn.addEventListener('click', openIssues);

  // Feedback button.
  const feedbackBtn = el('button', 'text-xs text-[var(--zork-accent)] underline text-left');
  feedbackBtn.textContent = 'Send Feedback';
  feedbackBtn.addEventListener('click', openFeedback);

  // Notice — §4: gameplay may be reviewed.
  const notice = el('p', 'text-[10px] text-[var(--zork-fg)] opacity-60 mt-auto pt-4');
  notice.textContent =
    'Gameplay in this playtest may be recorded and reviewed to help debug the game during development. Sessions are anonymous.';

  // Ko-fi / Patreon links (§7). GitHub Sponsors is NOT included (deferred — §7).
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
  sidebar.appendChild(feedbackBtn);
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
  app.appendChild(feedbackDialog);

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
