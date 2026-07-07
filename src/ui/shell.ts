// Web shell — wires GameSession, terminal, status bar, and HttpSink.
// Called from src/main.ts after the theme is applied.
//
// Layout (§3):
//   Desktop (≥lg): two columns — terminal left, sidebar right.
//   Mobile (<lg): terminal full-width; sidebar behind drawer toggle.
//   Plain Tailwind throughout; Tailwind Plus components adapted into TS.

import { createSession } from '../shell/session.js';
import type { GameView } from '../engine/game.js';
import { HttpSink } from '../shell/http-sink.js';
import { LocalStorageSavePort } from '../shell/save-port.js';
import type { SaveSlotMeta } from '../shell/save-port.js';
import { MapState, type ExitRecord } from './map-state.js';
import {
  REGION_DISPLAY_NAMES,
  type RegionKey,
  type MappedRegionKey,
  type RoomSeam,
} from './map-layout.js';
import { parseDirection } from './directions.js';
import { isThemeName, DEFAULT_THEME, type ThemeName } from './themes.js';
import { shapeFeedbackPayload, collectBrowserInfo } from './feedback.js';
import { ALLOWED_CATEGORIES } from '../../functions/lib/sanitize.js';

// Turnstile global — injected by the CF script after lazy load.
declare const turnstile: {
  render(container: HTMLElement | string, options: {
    sitekey: string;
    callback?: (token: string) => void;
    'error-callback'?: (code: string) => void;
    theme?: 'auto' | 'light' | 'dark';
    size?: 'normal' | 'flexible' | 'compact';
  }): string;
  getResponse(widgetId: string): string | undefined;
  reset(widgetId: string): void;
};

const TURNSTILE_SITEKEY = '0x4AAAAAADgm7Z4BgxQT7f5W';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Load the Turnstile script once; resolves when the global is ready. */
let turnstileReady: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (turnstileReady) return turnstileReady;
  turnstileReady = new Promise((resolve) => {
    if (typeof turnstile !== 'undefined') { resolve(); return; }
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT;
    s.defer = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
  return turnstileReady;
}

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

// Tailwind Plus: button group (01-basic.html)
function buildThemeSwitcher(onSwitch: (t: ThemeName) => void): HTMLElement {
  const wrap = el('span', 'isolate inline-flex rounded-md shadow-xs');
  const names: ThemeName[] = ['crt', 'literary', 'parchment'];
  const labels: Record<ThemeName, string> = { crt: 'CRT', literary: 'Literary', parchment: 'Parchment' };

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const isFirst = i === 0;
    const isLast = i === names.length - 1;
    const btn = el('button', [
      'theme-btn relative inline-flex items-center px-3 py-1.5 text-xs font-semibold',
      'border border-[var(--zork-accent)] text-[var(--zork-fg)] bg-[var(--zork-bg)]',
      'hover:bg-[var(--zork-accent)] hover:text-[var(--zork-bg)] focus:z-10',
      'data-[active=true]:bg-[var(--zork-accent)] data-[active=true]:text-[var(--zork-bg)]',
      isFirst ? 'rounded-l-md' : '-ml-px',
      isLast ? 'rounded-r-md' : '',
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

// Tailwind Plus: slide-over with background overlay (02-with-background-overlay.html)
function buildDrawer(content: HTMLElement): { overlay: HTMLElement; toggle: HTMLElement } {
  // Outer container — always in DOM, toggled via aria-hidden + pointer-events.
  const overlay = el('div', 'fixed inset-0 z-40 overflow-hidden');
  overlay.setAttribute('aria-hidden', 'true');

  // Backdrop — fades in/out.
  const backdrop = el('div', [
    'absolute inset-0 bg-gray-500/75',
    'transition-opacity duration-500 ease-in-out opacity-0',
  ].join(' '));
  overlay.appendChild(backdrop);

  // Slide panel wrapper.
  const panelWrap = el('div', 'absolute inset-0 pl-10 flex justify-end');

  const panel = el('div', [
    'ml-auto flex h-full max-w-xs w-full',
    'transform transition duration-500 ease-in-out translate-x-full',
  ].join(' '));

  // Panel inner — styled with Tailwind Plus drawer look, zork theme vars for colors.
  const panelInner = el('div', [
    'relative flex h-full flex-col overflow-y-auto',
    'bg-[var(--zork-bg)] border-l border-[var(--zork-accent)] py-6 shadow-xl',
  ].join(' '));
  panelInner.setAttribute('role', 'dialog');
  panelInner.setAttribute('aria-label', 'Sidebar');

  // Header row with close button (inside panel, per 02 variant).
  const header = el('div', 'px-4 sm:px-6');
  const headerRow = el('div', 'flex items-start justify-between');
  const drawerTitle = el('h2', 'text-base font-semibold text-[var(--zork-accent)]');
  drawerTitle.textContent = 'Menu';
  const closeBtnWrap = el('div', 'ml-3 flex h-7 items-center');
  const closeBtn = el('button', [
    'relative rounded-md text-[var(--zork-accent)] hover:opacity-75',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
  ].join(' '), { type: 'button', 'aria-label': 'Close panel' });
  const closeSr = el('span', 'absolute -inset-2.5');
  const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  closeIcon.setAttribute('viewBox', '0 0 24 24');
  closeIcon.setAttribute('fill', 'none');
  closeIcon.setAttribute('stroke', 'currentColor');
  closeIcon.setAttribute('stroke-width', '1.5');
  closeIcon.setAttribute('aria-hidden', 'true');
  closeIcon.setAttribute('class', 'size-6');
  const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  closePath.setAttribute('d', 'M6 18 18 6M6 6l12 12');
  closePath.setAttribute('stroke-linecap', 'round');
  closePath.setAttribute('stroke-linejoin', 'round');
  closeIcon.appendChild(closePath);
  closeBtn.appendChild(closeSr);
  closeBtn.appendChild(closeIcon);
  closeBtnWrap.appendChild(closeBtn);
  headerRow.appendChild(drawerTitle);
  headerRow.appendChild(closeBtnWrap);
  header.appendChild(headerRow);

  // Content area.
  const contentWrap = el('div', 'relative mt-6 flex-1 px-4 sm:px-6');
  contentWrap.appendChild(content);

  panelInner.appendChild(header);
  panelInner.appendChild(contentWrap);
  panel.appendChild(panelInner);
  panelWrap.appendChild(panel);
  overlay.appendChild(panelWrap);

  // Backdrop click closes.
  backdrop.addEventListener('click', () => closeDrawer());

  function openDrawer() {
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.pointerEvents = '';
    backdrop.classList.add('opacity-100');
    backdrop.classList.remove('opacity-0');
    panel.classList.remove('translate-x-full');
    // Hide the open-sidebar toggle so it doesn't sit on top of the panel's close
    // button while the drawer is open.
    toggle.classList.add('hidden');
  }
  function closeDrawer() {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    panel.classList.add('translate-x-full');
    // Wait for slide transition before hiding pointer events + restoring the toggle.
    overlay.addEventListener('transitionend', () => {
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.pointerEvents = 'none';
      toggle.classList.remove('hidden');
    }, { once: true });
  }

  overlay.style.pointerEvents = 'none';

  closeBtn.addEventListener('click', () => closeDrawer());

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

// ── Map (box-drawing spatial fog-of-war) ─────────────────────────────────────

const MAZE_MESSAGE = 'You are hopelessly lost in a maze of twisting little passages. No map will help you here.';

// Exported for unit testing.
export function renderMapGrid(
  visited: ReadonlySet<string>,
  current: string | null,
  rooms: ReadonlyMap<string, { id: string; label: string; region: RegionKey; col?: number; row?: number }>,
  connections: ReadonlyArray<{ a: string; b: string; reciprocal: boolean }>,
  seams: ReadonlyArray<RoomSeam>,
  exitRecords: ReadonlyMap<string, ReadonlyMap<string, ExitRecord>>,
  regionFilter: MappedRegionKey,
): string {
  // Only show rooms in the current region.
  const visibleVisited = new Set<string>();
  for (const id of visited) {
    if (rooms.get(id)?.region === regionFilter) visibleVisited.add(id);
  }
  if (visibleVisited.size === 0) return '';

  const CELL_W = 9;
  const CELL_H = 3;
  const CON_W = 3;
  const CON_H = 1;
  const MARGIN = 1;

  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const id of visibleVisited) {
    const r = rooms.get(id);
    if (!r || r.col === undefined || r.row === undefined) continue;
    if (r.col < minCol) minCol = r.col;
    if (r.col > maxCol) maxCol = r.col;
    if (r.row < minRow) minRow = r.row;
    if (r.row > maxRow) maxRow = r.row;
  }
  if (!isFinite(minCol)) return '';

  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const W = cols * (CELL_W + 2) + (cols - 1) * CON_W + 2 * MARGIN;
  const H = rows * CELL_H + (rows - 1) * CON_H + 2 * MARGIN;

  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill(' '));

  function put(cx: number, cy: number, ch: string) {
    if (cy >= 0 && cy < H && cx >= 0 && cx < W) grid[cy]![cx] = ch;
  }
  function putStr(cx: number, cy: number, s: string) {
    for (let i = 0; i < s.length; i++) put(cx + i, cy, s[i]!);
  }

  function cellOrigin(col: number, row: number): [number, number] {
    const x = MARGIN + (col - minCol) * (CELL_W + 2 + CON_W);
    const y = MARGIN + (row - minRow) * (CELL_H + CON_H);
    return [x, y];
  }

  function drawRoom(id: string, col: number, row: number, isCurrent: boolean) {
    const [ox, oy] = cellOrigin(col, row);
    const w = CELL_W + 2;
    put(ox, oy, '┌');
    putStr(ox + 1, oy, '─'.repeat(CELL_W));
    put(ox + w - 1, oy, '┐');
    put(ox, oy + 2, '└');
    putStr(ox + 1, oy + 2, '─'.repeat(CELL_W));
    put(ox + w - 1, oy + 2, '┘');
    put(ox, oy + 1, '│');
    put(ox + w - 1, oy + 1, '│');
    const room = rooms.get(id);
    const rawLabel = room?.label ?? id;
    const label = isCurrent ? `▶${rawLabel}` : rawLabel;
    const truncated = label.slice(0, CELL_W).padEnd(CELL_W);
    putStr(ox + 1, oy + 1, truncated);
  }

  function drawConnection(colA: number, rowA: number, colB: number, rowB: number, reciprocal: boolean) {
    const dc = colB - colA;
    const dr = rowB - rowA;
    if (Math.abs(dc) > 1 || Math.abs(dr) > 1) return;
    if (dc !== 0 && dr !== 0) return;
    const [ox, oy] = cellOrigin(colA, rowA);
    const w = CELL_W + 2;
    if (dc === 1 && dr === 0) {
      const gapX = ox + w;
      const cy = oy + 1;
      putStr(gapX, cy, reciprocal ? '───' : '╌╌╌');
    } else if (dc === -1 && dr === 0) {
      // A is right of B — handled when we process the (B,A) pair.
    } else if (dc === 0 && dr === 1) {
      const cx = ox + Math.floor(w / 2);
      const gy = oy + CELL_H;
      put(cx, gy, reciprocal ? '│' : '╎');
    } else if (dc === 0 && dr === -1) {
      // A is below B — handled when we process the (B,A) pair.
    }
  }

  // Render connection only when at least one endpoint has a walked or
  // backtrack record pointing at the other. Prevents phantom edges before
  // discovery.
  function hasExitRecord(roomId: string, toId: string): boolean {
    const recMap = exitRecords.get(roomId);
    if (!recMap) return false;
    for (const [, rec] of recMap) {
      if ((rec.kind === 'walked' || rec.kind === 'backtrack') && rec.to === toId) return true;
    }
    return false;
  }

  // Draw ✕ glyphs at the wall face for each blocked exit record.
  // (drawInterLevelStub is deleted outright — no successor under
  // legend-only cross-region seams, spec §6.3. drawBlockedStubs is
  // otherwise untouched.)
  function drawBlockedStubs(roomId: string, col: number, row: number) {
    const recMap = exitRecords.get(roomId);
    if (!recMap) return;
    const [ox, oy] = cellOrigin(col, row);
    const w = CELL_W + 2;
    for (const [, rec] of recMap) {
      if (rec.kind !== 'blocked') continue;
      const midY = oy + 1;
      const midX = ox + Math.floor(w / 2);
      switch (rec.dir) {
        case 'east':  put(ox + w, midY, '✕'); break;
        case 'west':  put(ox - 1, midY, '✕'); break;
        case 'north': put(midX, oy - 1, '✕'); break;
        case 'south': put(midX, oy + CELL_H, '✕'); break;
        case 'up':    put(midX, oy - 1, '✕'); break;
        case 'down':  put(midX, oy + CELL_H, '✕'); break;
      }
    }
  }

  // Pass 1: draw connections (so room boxes overdraw them at junctions).
  for (const c of connections) {
    const ra = rooms.get(c.a);
    const rb = rooms.get(c.b);
    if (!ra || !rb || ra.col === undefined || ra.row === undefined || rb.col === undefined || rb.row === undefined) continue;
    if (!visibleVisited.has(c.a) || !visibleVisited.has(c.b)) continue;
    if (!hasExitRecord(c.a, c.b) && !hasExitRecord(c.b, c.a)) continue;
    drawConnection(ra.col, ra.row, rb.col, rb.row, c.reciprocal);
    drawConnection(rb.col, rb.row, ra.col, ra.row, c.reciprocal);
  }

  // Pass 2: draw room boxes.
  for (const id of visibleVisited) {
    const r = rooms.get(id);
    if (!r || r.col === undefined || r.row === undefined) continue;
    drawRoom(id, r.col, r.row, id === current);
  }

  // Pass 3: blocked stubs (on top of room boxes).
  for (const id of visibleVisited) {
    const r = rooms.get(id);
    if (!r || r.col === undefined || r.row === undefined) continue;
    drawBlockedStubs(id, r.col, r.row);
  }

  const gridText = grid.map(row => row.join('')).join('\n');
  const legendLines = buildSeamLegend(visibleVisited, rooms, seams, exitRecords);
  if (legendLines.length === 0) return gridText;
  return `${gridText}\n\n${legendLines.join('\n')}`;
}

// The sole seam representation (spec §6.4) — no in-grid glyph exists anywhere.
// Discovery gate: a seam is discovered iff exitRecords has a walked/backtrack
// record on `seam.from` matching `seam.dir` exactly (spec §6.3) — the same
// fog-of-war gate hasExitRecord uses for in-region connections. No dedup by
// destination (spec §5.4): SMALL-CAVE's down+south and RIVER-1's west+out
// each produce their own line.
function buildSeamLegend(
  visibleVisited: ReadonlySet<string>,
  rooms: ReadonlyMap<string, { id: string; label: string; region: RegionKey; col?: number; row?: number }>,
  seams: ReadonlyArray<RoomSeam>,
  exitRecords: ReadonlyMap<string, ReadonlyMap<string, ExitRecord>>,
): string[] {
  const discovered: Array<{ seam: RoomSeam; fromLabel: string }> = [];
  for (const seam of seams) {
    if (!visibleVisited.has(seam.from)) continue;
    const rec = exitRecords.get(seam.from)?.get(seam.dir);
    if (!rec || (rec.kind !== 'walked' && rec.kind !== 'backtrack')) continue;
    discovered.push({ seam, fromLabel: rooms.get(seam.from)?.label ?? seam.from });
  }
  discovered.sort((a, b) =>
    a.fromLabel.localeCompare(b.fromLabel) || a.seam.dir.localeCompare(b.seam.dir));
  return discovered.map(({ seam, fromLabel }) =>
    `→ ${REGION_DISPLAY_NAMES[seam.toRegion]} (via ${fromLabel}, ${seam.dir})`);
}

// ── Paths from Here panel ─────────────────────────────────────────────────────

function buildPathsPanel(
  mapState: MapState,
  roomById: ReadonlyMap<string, { id: string; label: string; region: string; col?: number; row?: number }>,
): { element: HTMLElement; refresh: () => void } {
  const element = el('div', 'text-xs font-mono text-[var(--zork-fg)] py-1');
  element.setAttribute('data-testid', 'paths-panel');

  const DIR_LABELS: Record<string, string> = {
    north: 'North', south: 'South', east: 'East',  west: 'West',
    ne:    'NE',    nw:    'NW',    se:   'SE',     sw:   'SW',
    up:    'Up',    down:  'Down',  in:   'In',     out:  'Out',
  };
  const DIR_PAD = 6; // fixed left-pad width for direction labels

  function refresh() {
    const current = mapState.currentRoom();
    if (!current) { element.textContent = ''; return; }

    const exits = mapState.exitsFor(current);
    const lines: string[] = [];

    for (const [, record] of exits) {
      const dirLabel = (DIR_LABELS[record.dir] ?? record.dir).padEnd(DIR_PAD);
      if (record.kind === 'blocked') {
        lines.push(`  ${dirLabel}  →  ✕ blocked`);
      } else if (record.to) {
        const destLabel = roomById.get(record.to)?.label ?? record.to;
        lines.push(`  ${dirLabel}  →  ${destLabel}`);
      }
    }

    element.textContent = lines.join('\n') || '';
  }

  return { element, refresh };
}

// This grid quick-view was retired from the visible sidebar in favor of the
// "Paths from Here" text list (7a5d03c) — the sidebar/drawer no longer show
// a "Map" section (tests/shell/paths-panel.test.ts pins that). The renderer
// (renderMapGrid) and this wrapper stay alive because buildMapModal's `map`
// command surface still needs the region auto-follow + maze-message logic
// generalized here (spec §7, §8.1); `element` is mounted `hidden` (DOM-
// present, not visually rendered) purely so that logic stays exercised and
// test-observable end-to-end without resurrecting the retired sidebar panel.
function buildMap(mapState: MapState): { element: HTMLElement; refresh: () => Promise<void> } {
  const element = el('div', 'hidden text-xs font-mono text-[var(--zork-fg)] py-2 overflow-x-auto');

  let _layoutPromise: Promise<typeof import('./map-layout.js')> | null = null;
  function getLayout() {
    if (!_layoutPromise) _layoutPromise = import('./map-layout.js');
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

    const currentRegion = (current ? layout.ROOM_BY_ID.get(current)?.region : undefined) ?? 'surface';
    if (!(layout.MAPPED_REGIONS as readonly string[]).includes(currentRegion)) {
      element.textContent = MAZE_MESSAGE;
      return;
    }
    // Narrowed by the includes() check above — MAPPED_REGIONS only ever
    // holds MappedRegionKey values.
    const mappedRegion = currentRegion as MappedRegionKey;
    const text = renderMapGrid(
      visited,
      current,
      layout.ROOM_BY_ID,
      layout.ROOM_CONNECTIONS,
      layout.ROOM_SEAMS,
      mapState.getAllExits(),
      mappedRegion,
    );
    element.textContent = text || '';
  }

  return { element, refresh };
}


// ── Credits dialog ───────────────────────────────────────────────────────────

// Modal dialog via div+classList toggle (not native <dialog>) so it works in jsdom.
function buildCreditsDialog(): { open: () => void; element: HTMLElement } {
  const MIT_LICENSE =
    'MIT License\n\nCopyright (c) 2025 Microsoft\n\n' +
    'Permission is hereby granted, free of charge, to any person obtaining a copy\n' +
    'of this software and associated documentation files (the "Software"), to deal\n' +
    'in the Software without restriction, including without limitation the rights\n' +
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n' +
    'copies of the Software, and to permit persons to whom the Software is\n' +
    'furnished to do so, subject to the following conditions:\n\n' +
    'The above copyright notice and this permission notice shall be included in all\n' +
    'copies or substantial portions of the Software.\n\n' +
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n' +
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n' +
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n' +
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n' +
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n' +
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n' +
    'SOFTWARE.';

  // Outer overlay — backdrop + centering shell. Hidden until open().
  const overlay = el('div', [
    'hidden fixed inset-0 z-50 overflow-y-auto',
    'bg-black/70',
  ].join(' '), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'credits-dialog-title' });
  overlay.id = 'credits-dialog';

  const outer = el('div', 'flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0');

  const panel = el('div', [
    'relative transform overflow-hidden rounded-lg px-4 pt-5 pb-4 text-left shadow-xl',
    'sm:my-8 sm:w-full sm:max-w-lg sm:p-6',
    'bg-[var(--zork-bg)] border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] font-mono text-sm overflow-y-auto max-h-[80vh]',
  ].join(' '));

  // Close button — top-right (Plus pattern).
  const closeBtnWrap = el('div', 'absolute top-0 right-0 hidden pt-4 pr-4 sm:block');
  const closeBtn = el('button', [
    'rounded-md text-[var(--zork-accent)] hover:opacity-75',
    'focus:outline-2 focus:outline-offset-2',
  ].join(' '), { type: 'button' });
  const closeSr = el('span', 'sr-only');
  closeSr.textContent = 'Close';
  const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  closeIcon.setAttribute('viewBox', '0 0 24 24');
  closeIcon.setAttribute('fill', 'none');
  closeIcon.setAttribute('stroke', 'currentColor');
  closeIcon.setAttribute('stroke-width', '1.5');
  closeIcon.setAttribute('aria-hidden', 'true');
  closeIcon.setAttribute('class', 'size-6');
  const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  closePath.setAttribute('d', 'M6 18 18 6M6 6l12 12');
  closePath.setAttribute('stroke-linecap', 'round');
  closePath.setAttribute('stroke-linejoin', 'round');
  closeIcon.appendChild(closePath);
  closeBtn.appendChild(closeSr);
  closeBtn.appendChild(closeIcon);
  closeBtnWrap.appendChild(closeBtn);

  const title = el('h2', 'text-base font-bold mb-4 text-[var(--zork-accent)]');
  title.id = 'credits-dialog-title';
  title.textContent = 'About & Credits';

  const p1 = el('p', 'text-xs mb-2');
  p1.textContent = 'A fan-made re-creation of ZORK I: The Great Underground Empire, rebuilt for the web from the original Infocom source code.';

  const p2 = el('p', 'text-xs mb-2');
  p2.textContent = 'Zork I was written by Marc Blank, Dave Lebling, Bruce Daniels, and Tim Anderson, and published by Infocom in 1981.';

  const p3 = el('p', 'text-xs mb-2');
  p3.textContent = 'In 2025, Microsoft released the original ZIL source code as open source under the MIT License. This project\'s game text and behavior derive from that release:';

  const sourceLink = el('a', 'block text-xs mb-2 underline text-[var(--zork-accent)]', {
    href: 'https://github.com/historicalsource/zork1',
    target: '_blank',
    rel: 'noopener noreferrer',
  });
  sourceLink.textContent = 'github.com/historicalsource/zork1';

  const p4 = el('p', 'text-xs mb-2 opacity-75');
  p4.textContent = 'The Infocom copyright notice shown in the terminal is part of the original game\'s opening text, reproduced faithfully.';

  const licenseHeading = el('p', 'text-xs font-bold mt-4 mb-2 text-[var(--zork-accent)]');
  licenseHeading.textContent = 'MIT License (original Zork I source)';

  const licensePre = el('pre', 'm-0 text-[10px] whitespace-pre-wrap break-words border-l-2 border-[var(--zork-accent)] pl-2 opacity-75');
  licensePre.textContent = MIT_LICENSE;

  const trademark = el('p', 'text-[10px] opacity-60 mt-3');
  trademark.textContent = 'This project is not affiliated with, or endorsed by, Microsoft, Activision, or Infocom. ZORK is a trademark of its respective owner.';

  function closeDialog() { overlay.classList.add('hidden'); }

  closeBtn.addEventListener('click', closeDialog);
  // Backdrop click (outside the panel) closes.
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === outer) closeDialog(); });
  // Escape key closes.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeDialog(); });

  panel.appendChild(closeBtnWrap);
  panel.appendChild(title);
  panel.appendChild(p1);
  panel.appendChild(p2);
  panel.appendChild(p3);
  panel.appendChild(sourceLink);
  panel.appendChild(p4);
  panel.appendChild(licenseHeading);
  panel.appendChild(licensePre);
  panel.appendChild(trademark);
  outer.appendChild(panel);
  overlay.appendChild(outer);

  function open() { overlay.classList.remove('hidden'); }

  return { open, element: overlay };
}

// ── Feedback form dialog ──────────────────────────────────────────────────────

// Tailwind Plus: modal dialog with dismiss button (04-simple-with-dismiss-button.html)
// Uses div+classList toggle (not native <dialog>) so it works in jsdom and any env
// that doesn't implement HTMLDialogElement.showModal.
function buildFeedbackDialog(getSessionId: () => string, getActiveTheme: () => ThemeName): {
  open: () => void;
  element: HTMLElement;
} {
  // Outer overlay — backdrop + centering shell. Hidden until open().
  const overlay = el('div', [
    'hidden fixed inset-0 z-50 overflow-y-auto',
    'bg-black/70',
  ].join(' '), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'feedback-dialog-title' });
  overlay.id = 'feedback-dialog';

  const outer = el('div', 'flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0');

  const panel = el('div', [
    'relative transform overflow-hidden rounded-lg px-4 pt-5 pb-4 text-left shadow-xl',
    'sm:my-8 sm:w-full sm:max-w-lg sm:p-6',
    'bg-[var(--zork-bg)] border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] font-mono text-sm overflow-y-auto max-h-[90vh]',
  ].join(' '));

  // Close button — top-right (Plus pattern).
  const fbCloseBtnWrap = el('div', 'absolute top-0 right-0 hidden pt-4 pr-4 sm:block');
  const fbCloseBtn = el('button', [
    'rounded-md text-[var(--zork-accent)] hover:opacity-75',
    'focus:outline-2 focus:outline-offset-2',
  ].join(' '), { type: 'button' });
  const fbCloseSr = el('span', 'sr-only');
  fbCloseSr.textContent = 'Close';
  const fbCloseIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fbCloseIcon.setAttribute('viewBox', '0 0 24 24');
  fbCloseIcon.setAttribute('fill', 'none');
  fbCloseIcon.setAttribute('stroke', 'currentColor');
  fbCloseIcon.setAttribute('stroke-width', '1.5');
  fbCloseIcon.setAttribute('aria-hidden', 'true');
  fbCloseIcon.setAttribute('class', 'size-6');
  const fbClosePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fbClosePath.setAttribute('d', 'M6 18 18 6M6 6l12 12');
  fbClosePath.setAttribute('stroke-linecap', 'round');
  fbClosePath.setAttribute('stroke-linejoin', 'round');
  fbCloseIcon.appendChild(fbClosePath);
  fbCloseBtn.appendChild(fbCloseSr);
  fbCloseBtn.appendChild(fbCloseIcon);
  fbCloseBtnWrap.appendChild(fbCloseBtn);

  const title = el('h2', 'text-base font-bold mb-4 text-[var(--zork-accent)]');
  title.id = 'feedback-dialog-title';
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

  // Turnstile widget container — rendered lazily when the dialog first opens.
  const tsContainer = el('div', 'mb-3');
  let tsWidgetId: string | null = null;
  let tsToken = '';

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

    if (!tsToken) {
      status.textContent = 'Please complete the challenge above.';
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
        turnstileToken: tsToken,
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
        // Let the confirmation land, then dismiss the dialog.
        setTimeout(closeFeedback, 1200);
      } else {
        status.textContent = `Send failed (${res.status}). Try again.`;
      }
    } catch {
      status.textContent = 'Send failed. Check your connection.';
    } finally {
      submitBtn.removeAttribute('disabled');
      submitBtn.textContent = 'Send';
      // Tokens are single-use — reset so next submit gets a fresh one.
      tsToken = '';
      if (tsWidgetId !== null) turnstile.reset(tsWidgetId);
    }
  });

  function closeFeedback() { overlay.classList.add('hidden'); }

  fbCloseBtn.addEventListener('click', closeFeedback);
  // Backdrop click (outside the panel) closes.
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === outer) closeFeedback(); });
  // Escape key closes.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeFeedback(); });

  panel.appendChild(fbCloseBtnWrap);
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
  panel.appendChild(tsContainer);
  panel.appendChild(status);
  panel.appendChild(submitBtn);
  outer.appendChild(panel);
  overlay.appendChild(outer);

  function open() {
    overlay.classList.remove('hidden');
    // Lazy-load the Turnstile script on first open; render widget once ready.
    loadTurnstile().then(() => {
      if (tsWidgetId === null) {
        tsToken = '';
        tsWidgetId = turnstile.render(tsContainer, {
          sitekey: TURNSTILE_SITEKEY,
          callback: (token: string) => { tsToken = token; },
          'error-callback': () => { tsToken = ''; },
          theme: 'auto',
          size: 'flexible',
        });
      }
    });
  }
  return { open, element: overlay };
}

// ── Map modal ─────────────────────────────────────────────────────────────────

// Same div+classList pattern as buildCreditsDialog. Uses async open() so
// the map layout can be lazy-loaded and the grid centered on the current room.
function buildMapModal(
  mapState: MapState,
  getLayout: () => Promise<typeof import('./map-layout.js')>,
): { open: () => void; close: () => void; noteRegion: (roomId: string) => void; element: HTMLElement } {
  const overlay = el('div', [
    'hidden fixed inset-0 z-50 overflow-y-auto',
    'bg-black/70',
  ].join(' '), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'map-modal-title' });
  overlay.id = 'map-modal';
  overlay.setAttribute('data-testid', 'map-modal');

  const outer = el('div', 'flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0');

  const panel = el('div', [
    'relative transform overflow-hidden rounded-lg px-4 pt-5 pb-4 text-left shadow-xl',
    'sm:my-8 sm:w-full sm:max-w-3xl sm:p-6',
    'bg-[var(--zork-bg)] border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] font-mono text-sm',
  ].join(' '));

  const closeBtnWrap = el('div', 'absolute top-0 right-0 hidden pt-4 pr-4 sm:block');
  const closeBtn = el('button', [
    'rounded-md text-[var(--zork-accent)] hover:opacity-75',
    'focus:outline-2 focus:outline-offset-2',
  ].join(' '), { type: 'button' });
  const closeSr = el('span', 'sr-only');
  closeSr.textContent = 'Close';
  closeBtn.appendChild(closeSr);
  closeBtn.textContent = '✕';
  closeBtnWrap.appendChild(closeBtn);

  // Header row: region label (+ discovered counter) and prev/next paging.
  const headerRow = el('div', 'flex items-center justify-between gap-2 mb-4');
  const title = el('h2', 'text-base font-bold text-[var(--zork-accent)]');
  title.id = 'map-modal-title';
  title.textContent = 'Map';
  const pagerControls = el('div', 'flex items-center gap-2');
  const prevBtn = el('button', 'text-[var(--zork-accent)] underline disabled:opacity-30 disabled:no-underline', {
    type: 'button',
    'data-testid': 'map-modal-prev',
  });
  prevBtn.textContent = '‹ Prev';
  const nextBtn = el('button', 'text-[var(--zork-accent)] underline disabled:opacity-30 disabled:no-underline', {
    type: 'button',
    'data-testid': 'map-modal-next',
  });
  nextBtn.textContent = 'Next ›';
  pagerControls.appendChild(prevBtn);
  pagerControls.appendChild(nextBtn);
  headerRow.appendChild(title);
  headerRow.appendChild(pagerControls);

  const gridContainer = el('div', 'overflow-auto max-h-[70vh]');
  const gridPre = el('pre', 'text-xs font-mono text-[var(--zork-fg)] m-0 p-0');
  gridContainer.appendChild(gridPre);

  function closeModal() { overlay.classList.add('hidden'); }

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === outer) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
  });

  // ── Paging state (spec §8.3) ──────────────────────────────────────────────
  // pageRegion: reset every open() per the three-way rule below. Always a
  // MappedRegionKey once set (paging only ever cycles discovered *mapped*
  // regions — a maze region never enters the cycle, spec §8.2).
  let pageRegion: MappedRegionKey | null = null;
  // lastMappedRegion: SEPARATE from pageRegion, persists across opens/closes.
  // Updated on every turn via noteRegion(), regardless of whether the modal
  // is open, so it always holds the most recent mapped region actually stood
  // in — the rule-(2) fallback when currentRegion is unmapped at open time.
  let lastMappedRegion: MappedRegionKey | null = null;
  // pagedAway: reset on every open(); set once the player clicks Prev/Next.
  // Resolves a tension between §7 ("the modal shows the maze message while
  // paging controls stay enabled, letting the player page away") and §8.3's
  // pageRegion reset rule (which always resolves to a MAPPED region, never
  // the literal maze region) — see the note in Step 1.7's task description.
  // Until the player pages away, an unmapped currentRegion renders the maze
  // message (matching buildMap and satisfying the maze-message test guard,
  // spec §11); the moment they click Prev/Next, the view switches to
  // pageRegion's grid, which was already primed to a sensible fallback.
  let pagedAway = false;

  function isMappedRegion(layout: Awaited<ReturnType<typeof getLayout>>, region: string): region is MappedRegionKey {
    return (layout.MAPPED_REGIONS as readonly string[]).includes(region);
  }

  function discoveredMappedRegions(layout: Awaited<ReturnType<typeof getLayout>>): MappedRegionKey[] {
    const visited = mapState.visitedRooms();
    const found = new Set<MappedRegionKey>();
    for (const id of visited) {
      const r = layout.ROOM_BY_ID.get(id);
      if (r && isMappedRegion(layout, r.region)) found.add(r.region as MappedRegionKey);
    }
    return layout.MAPPED_REGIONS.filter(k => found.has(k));
  }

  async function noteRegion(roomId: string) {
    const layout = await getLayout();
    const region = layout.ROOM_BY_ID.get(roomId)?.region;
    if (region && isMappedRegion(layout, region)) lastMappedRegion = region;
  }

  async function renderPage() {
    const layout = await getLayout();
    const current = mapState.currentRoom();
    const currentRegion = (current ? layout.ROOM_BY_ID.get(current)?.region : undefined) ?? 'surface';
    const discovered = discoveredMappedRegions(layout);
    const count = discovered.length;

    prevBtn.disabled = count <= 1;
    nextBtn.disabled = count <= 1;

    if (!pagedAway && !isMappedRegion(layout, currentRegion)) {
      title.textContent = 'Map';
      gridPre.textContent = MAZE_MESSAGE;
      return;
    }

    const activeRegion: MappedRegionKey = pageRegion ?? 'surface';
    const idx = discovered.indexOf(activeRegion);
    title.textContent = count > 1
      ? `${layout.REGION_DISPLAY_NAMES[activeRegion]} (${idx + 1} of ${count} discovered)`
      : layout.REGION_DISPLAY_NAMES[activeRegion];

    const visited = mapState.visitedRooms();
    const text = renderMapGrid(
      visited,
      current,
      layout.ROOM_BY_ID,
      layout.ROOM_CONNECTIONS,
      layout.ROOM_SEAMS,
      mapState.getAllExits(),
      activeRegion,
    );
    gridPre.textContent = text;

    // Center viewport on current room — only while genuinely auto-following
    // (spec §8.3: pageRegion === currentRegion).
    if (activeRegion === currentRegion && current) {
      const r = layout.ROOM_BY_ID.get(current);
      if (r && r.col !== undefined && r.row !== undefined) {
        const CELL_W = 9, CELL_H = 3, CON_W = 3, CON_H = 1;
        const charW = CELL_W + 2 + CON_W;
        const charH = CELL_H + CON_H;
        const pxPerCol = 8;
        const pxPerRow = 14;
        let minCol = Infinity, minRow = Infinity;
        for (const id of visited) {
          const rm = layout.ROOM_BY_ID.get(id);
          if (!rm || rm.region !== activeRegion || rm.col === undefined || rm.row === undefined) continue;
          if (rm.col < minCol) minCol = rm.col;
          if (rm.row < minRow) minRow = rm.row;
        }
        if (isFinite(minCol)) {
          const cellX = (r.col - minCol) * charW * pxPerCol;
          const cellY = (r.row - minRow) * charH * pxPerRow;
          const halfW = gridContainer.clientWidth / 2;
          const halfH = gridContainer.clientHeight / 2;
          gridContainer.scrollLeft = Math.max(0, cellX - halfW);
          gridContainer.scrollTop = Math.max(0, cellY - halfH);
        }
      }
    }
  }

  function stepPage(delta: 1 | -1) {
    void (async () => {
      const layout = await getLayout();
      const discovered = discoveredMappedRegions(layout);
      if (discovered.length === 0) return;
      const current = mapState.currentRoom();
      const currentRegion = (current ? layout.ROOM_BY_ID.get(current)?.region : undefined) ?? 'surface';
      const wasOnMazeMessage = !pagedAway && !isMappedRegion(layout, currentRegion);
      pagedAway = true;
      if (wasOnMazeMessage) {
        // First page-away from the maze message lands on the primed
        // pageRegion (§8.3's lastMappedRegion/surface fallback) rather than
        // stepping past it — the player hasn't seen that grid yet.
        if (!discovered.includes(pageRegion ?? 'surface')) pageRegion = discovered[0]!;
        await renderPage();
        return;
      }
      const cur = pageRegion ?? discovered[0]!;
      const idx = discovered.indexOf(cur);
      const base = idx < 0 ? 0 : idx;
      const nextIdx = (base + delta + discovered.length) % discovered.length;
      pageRegion = discovered[nextIdx]!;
      await renderPage();
    })();
  }

  prevBtn.addEventListener('click', () => stepPage(-1));
  nextBtn.addEventListener('click', () => stepPage(1));

  async function open() {
    overlay.classList.remove('hidden');
    const layout = await getLayout();
    const current = mapState.currentRoom();
    const currentRegion = (current ? layout.ROOM_BY_ID.get(current)?.region : undefined) ?? 'surface';

    pagedAway = false;
    // Three-way reset rule (spec §8.3), evaluated fresh every open() —
    // never carries over whatever the player had paged to before closing.
    if (isMappedRegion(layout, currentRegion)) {
      pageRegion = currentRegion;
    } else if (lastMappedRegion !== null) {
      pageRegion = lastMappedRegion;
    } else {
      pageRegion = 'surface';
    }

    await renderPage();
  }

  panel.appendChild(closeBtnWrap);
  panel.appendChild(headerRow);
  panel.appendChild(gridContainer);
  outer.appendChild(panel);
  overlay.appendChild(outer);

  return { open, close: closeModal, noteRegion: (roomId: string) => { void noteRegion(roomId); }, element: overlay };
}

// ── Slot picker modal ─────────────────────────────────────────────────────────

// Same div+classList pattern as the other modals (§7.1).
// The picker lists SavePort.list() metadata and lets the player save to / restore
// from a named slot.  Thin sugar over the verbs — calls the same session substrate.
function buildSlotPickerModal(
  getSlots: () => SaveSlotMeta[],
  onSave: (slot: string) => void,
  onRestore: (slot: string) => void,
): { open: () => void; close: () => void; element: HTMLElement } {
  const overlay = el('div', [
    'hidden fixed inset-0 z-50 overflow-y-auto',
    'bg-black/70',
  ].join(' '), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'slot-picker-title' });
  overlay.id = 'slot-picker-modal';
  overlay.setAttribute('data-testid', 'slot-picker-modal');

  const outer = el('div', 'flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0');

  const panel = el('div', [
    'relative transform overflow-hidden rounded-lg px-4 pt-5 pb-4 text-left shadow-xl',
    'sm:my-8 sm:w-full sm:max-w-lg sm:p-6',
    'bg-[var(--zork-bg)] border border-[var(--zork-accent)]',
    'text-[var(--zork-fg)] font-mono text-sm overflow-y-auto max-h-[80vh]',
  ].join(' '));

  const closeBtnWrap = el('div', 'absolute top-0 right-0 hidden pt-4 pr-4 sm:block');
  const closeBtn = el('button', [
    'rounded-md text-[var(--zork-accent)] hover:opacity-75',
    'focus:outline-2 focus:outline-offset-2',
  ].join(' '), { type: 'button' });
  const closeSr = el('span', 'sr-only');
  closeSr.textContent = 'Close';
  closeBtn.appendChild(closeSr);
  closeBtn.textContent = '✕';
  closeBtnWrap.appendChild(closeBtn);

  const title = el('h2', 'text-base font-bold mb-4 text-[var(--zork-accent)]');
  title.id = 'slot-picker-title';
  title.textContent = 'Save Slots';

  // Slot list — rebuilt each time the modal opens.
  const slotList = el('div', 'space-y-3');

  const MANUAL_SLOTS = ['1', '2', '3'] as const;

  function renderSlots() {
    slotList.innerHTML = '';
    const occupied = new Map(getSlots().map(s => [s.slot, s]));

    for (const slot of MANUAL_SLOTS) {
      const meta = occupied.get(slot);
      const row = el('div', 'flex items-center justify-between gap-2 border-b border-[var(--zork-accent)] pb-2');

      const label = el('div', 'flex-1 text-xs');
      const slotName = el('span', 'font-semibold');
      slotName.textContent = `Slot ${slot}`;
      label.appendChild(slotName);

      if (meta) {
        const info = el('span', 'ml-2 opacity-75');
        const savedDate = new Date(meta.savedAt).toLocaleString();
        info.textContent = `${meta.hereName} · ${meta.moves} moves · ${savedDate}`;
        label.appendChild(info);
      } else {
        const empty = el('span', 'ml-2 opacity-50');
        empty.textContent = 'empty';
        label.appendChild(empty);
      }

      const btnRow = el('div', 'flex gap-1 shrink-0');

      const saveBtn = el('button', [
        'px-2 py-0.5 text-xs rounded border border-[var(--zork-accent)]',
        'hover:bg-[var(--zork-accent)] hover:text-[var(--zork-bg)]',
      ].join(' '), { type: 'button' });
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => {
        onSave(slot);
        closeModal();
      });

      const restoreBtn = el('button', [
        'px-2 py-0.5 text-xs rounded border border-[var(--zork-accent)]',
        meta ? '' : 'opacity-40 cursor-not-allowed',
      ].join(' '), { type: 'button' });
      restoreBtn.textContent = 'Restore';
      if (!meta) restoreBtn.setAttribute('disabled', 'true');
      restoreBtn.addEventListener('click', () => {
        if (!meta) return;
        onRestore(slot);
        closeModal();
      });

      btnRow.appendChild(saveBtn);
      btnRow.appendChild(restoreBtn);
      row.appendChild(label);
      row.appendChild(btnRow);
      slotList.appendChild(row);
    }
  }

  function closeModal() { overlay.classList.add('hidden'); }

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === outer) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
  });

  panel.appendChild(closeBtnWrap);
  panel.appendChild(title);
  panel.appendChild(slotList);
  outer.appendChild(panel);
  overlay.appendChild(outer);

  return {
    open() {
      renderSlots();
      overlay.classList.remove('hidden');
    },
    close: closeModal,
    element: overlay,
  };
}

// ── Game-over affordance ──────────────────────────────────────────────────────

// Appended into the scrollback once gameOver fires (§7.1).  Two actions:
//   Restore — restores from the autosave slot (the pre-turn snapshot before death).
//   Restart — shell-level confirm, then session.restart() (OQ-4).
//
// §6 mandated disclosure: restoring puts the player at the START of the fatal turn.
// Replaying the identical command re-kills deterministically (same RNG position).
// The affordance text must make this clear so the player knows to choose differently.
function buildGameOverAffordance(
  onRestore: () => void,
  onRestart: () => void,
): HTMLElement {
  const wrap = el('div', [
    'mt-3 p-3 border border-[var(--zork-accent)] rounded font-mono text-sm',
  ].join(' '));
  wrap.setAttribute('data-testid', 'game-over-affordance');

  const msg = el('p', 'mb-2 opacity-75 text-xs');
  msg.textContent = 'What would you like to do?';
  wrap.appendChild(msg);

  // §6: disclose the start-of-fatal-turn semantics — the player must understand
  // that Restore rewinds to the start of that turn, and the same command re-kills.
  const note = el('p', 'mb-2 opacity-60 text-xs');
  note.textContent =
    'Restore returns you to the start of the turn you died on. ' +
    'Replaying the same command will re-kill you — choose differently.';
  wrap.appendChild(note);

  const btnRow = el('div', 'flex gap-2');

  const restoreBtn = el('button', [
    'px-3 py-1 text-xs rounded border border-[var(--zork-accent)]',
    'hover:bg-[var(--zork-accent)] hover:text-[var(--zork-bg)]',
  ].join(' '), { type: 'button' });
  restoreBtn.textContent = 'Restore last position';
  restoreBtn.addEventListener('click', onRestore);

  const restartBtn = el('button', [
    'px-3 py-1 text-xs rounded border border-[var(--zork-accent)]',
    'hover:bg-[var(--zork-accent)] hover:text-[var(--zork-bg)]',
  ].join(' '), { type: 'button' });
  restartBtn.textContent = 'Restart game';
  restartBtn.addEventListener('click', onRestart);

  btnRow.appendChild(restoreBtn);
  btnRow.appendChild(restartBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ── Shell mount ───────────────────────────────────────────────────────────────

export function mountShell(app: HTMLElement): {
  mapState: MapState;
  session: import('../shell/session.js').GameSession;
  refreshMap: () => Promise<void>;
  noteRegion: (roomId: string) => void;
} {
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

  // Save port — localStorage-backed, same key namespace as zork-theme (§5.2, §7.1).
  const savePort = new LocalStorageSavePort(localStorage);

  const session = createSession({ sink: trackingSink, savePort });

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

  // Updates the mobile bar plus every sidebar/drawer copy in one pass.
  function updateStatus(snap: GameView) {
    statusBar.update(snap.hereName, snap.score, snap.maxScore, snap.moves);
    const line = `${snap.hereName} · ${snap.score}/${snap.maxScore} · moves: ${snap.moves}`;
    for (const node of document.querySelectorAll<HTMLElement>('[data-status-line]')) {
      node.textContent = line;
    }
  }

  const map = buildMap(mapState);

  // Paths panel (sidebar replacement for map). Layout is lazy-loaded; swap in
  // the real panel once the import resolves.
  let _pathsLayoutPromise: Promise<typeof import('./map-layout.js')> | null = null;
  function getPathsLayout() {
    if (!_pathsLayoutPromise) _pathsLayoutPromise = import('./map-layout.js');
    return _pathsLayoutPromise;
  }
  const pathsPanelPlaceholder = el('div', '');
  pathsPanelPlaceholder.setAttribute('data-testid', 'paths-panel');
  let pathsPanel: { element: HTMLElement; refresh: () => void } = {
    element: pathsPanelPlaceholder,
    refresh: () => { /* no-op until layout ready */ },
  };
  void getPathsLayout().then((layout) => {
    const real = buildPathsPanel(mapState, layout.ROOM_BY_ID);
    if (pathsPanel.element.parentNode) {
      pathsPanel.element.parentNode.replaceChild(real.element, pathsPanel.element);
    }
    pathsPanel = real;
    real.refresh();
  });

  // Map modal — lazy-loads layout on first open.
  let _modalLayoutPromise: Promise<typeof import('./map-layout.js')> | null = null;
  const mapModal = buildMapModal(mapState, () => {
    if (!_modalLayoutPromise) _modalLayoutPromise = import('./map-layout.js');
    return _modalLayoutPromise;
  });

  // Slot picker — open/close driven by the "Saves" sidebar button.
  let currentGameOverAffordance: HTMLElement | null = null;

  function doRestoreFromAutosave() {
    // Bypass game.turn() (which gates on gameOver) via the dedicated session method.
    const output = session.restoreFromAutosave();
    if (output) appendOutput(output);
    const snap = session.snapshot();
    updateStatus(snap);
    mapState.update(snap, null);
    void map.refresh();
    pathsPanel.refresh();
    // Only remove the affordance when the restore actually worked — if the autosave
    // slot was absent (quota eviction, first turn, etc.) the session stays gameOver
    // and the player still needs the Restart option.  Removing it unconditionally
    // would strand the player with no recovery path (house-style no-hard-lock).
    if (!snap.gameOver && currentGameOverAffordance) {
      currentGameOverAffordance.remove();
      currentGameOverAffordance = null;
    }
  }

  function doRestartWithConfirm() {
    if (!window.confirm('Are you sure you want to restart? Your current game will be lost.')) return;
    session.restart();
    const snap = session.snapshot();
    updateStatus(snap);
    mapState.update(snap, null);
    void map.refresh();
    pathsPanel.refresh();
    // Remove the affordance — the game is running again.
    if (currentGameOverAffordance) {
      currentGameOverAffordance.remove();
      currentGameOverAffordance = null;
    }
  }

  const slotPicker = buildSlotPickerModal(
    () => savePort.list(),
    (slot) => {
      const output = session.submit(`save ${slot}`);
      if (output) appendOutput(output);
    },
    (slot) => {
      const output = session.submit(`restore ${slot}`);
      if (output) appendOutput(output);
      const snap = session.snapshot();
      updateStatus(snap);
      mapState.update(snap, null);
      void map.refresh();
      pathsPanel.refresh();
    },
  );

  const { container: terminal, appendOutput, appendCommand } = buildTerminal((cmd) => {
    // Intercept 'map' before the engine sees it — no submit, no moves advance.
    if (cmd.trim().toLowerCase() === 'map') {
      void mapModal.open();
      return;
    }
    if (cmd.trim()) {
      appendCommand(cmd);
    }
    const prevRoom = mapState.currentRoom();
    const output = session.submit(cmd);
    if (output) appendOutput(output);
    const snap = session.snapshot();
    updateStatus(snap);

    // Show RESTART/RESTORE affordance once the game ends (§7.1).
    if (snap.gameOver && currentGameOverAffordance === null) {
      const affordance = buildGameOverAffordance(doRestoreFromAutosave, doRestartWithConfirm);
      currentGameOverAffordance = affordance;
      // Append into the scrollback so it reads as natural continuation.
      const scrollback = terminal.querySelector('[role="log"]');
      if (scrollback) scrollback.appendChild(affordance);
    }

    const parsedDir = parseDirection(cmd);

    if (snap.here !== prevRoom) {
      mapState.update(snap, parsedDir);
    } else {
      mapState.update(snap, null);
      if (parsedDir !== null) {
        mapState.recordBlocked(parsedDir);
      }
    }

    pathsPanel.refresh();
    void map.refresh();
    mapModal.noteRegion(snap.here);
  });
  const { open: openCredits, element: creditsDialog } = buildCreditsDialog();
  const { open: openFeedback, element: feedbackDialog } = buildFeedbackDialog(
    () => sessionIdRef,
    () => activeTheme,
  );

  // ── Sidebar content ─────────────────────────────────────────────────────
  const sidebar = el('div', 'flex flex-col gap-4 min-w-0');

  // Status (desktop — compact copy in sidebar header). data attr lets the
  // drawer's cloned copy receive updates too.
  const sidebarStatus = el('div', 'text-xs font-mono text-[var(--zork-fg)] border-b border-[var(--zork-accent)] pb-2');
  sidebarStatus.setAttribute('data-status-line', '');
  sidebarStatus.textContent = 'Status';

  // (themeLabel and switcherContainer are built above — before applyTheme.)
  syncThemeBtns(switcherContainer, activeTheme);

  // Map area.
  const mapLabel = el('div', 'text-xs text-[var(--zork-accent)] uppercase tracking-wider mt-2');
  mapLabel.textContent = 'Paths from Here';

  // Saves button — opens the slot picker (§7.1).
  const savesBtn = el('button', 'text-xs text-[var(--zork-accent)] underline mt-2 text-left');
  savesBtn.textContent = 'Saves';
  savesBtn.addEventListener('click', () => slotPicker.open());

  // Credits button.
  const creditsBtn = el('button', 'text-xs text-[var(--zork-accent)] underline text-left', { 'data-open-credits': '' });
  creditsBtn.textContent = 'About & Credits';
  creditsBtn.addEventListener('click', openCredits);

  // Feedback button.
  const feedbackBtn = el('button', 'text-xs text-[var(--zork-accent)] underline text-left', { 'data-open-feedback': '' });
  feedbackBtn.textContent = 'Send Feedback';
  feedbackBtn.addEventListener('click', openFeedback);

  // Notice — §4: gameplay may be reviewed.
  const notice = el('p', 'text-[10px] text-[var(--zork-fg)] opacity-60 mt-auto pt-4');
  notice.textContent =
    'Gameplay in this playtest may be recorded and reviewed to help debug the game during development. Sessions are anonymous.';

  // License line — always-visible provenance notice.
  const licenseLine = el('p', 'text-[10px] text-[var(--zork-fg)] opacity-60 pt-1');
  licenseLine.textContent = 'Based on Infocom\'s ZORK I. Original source open-sourced by Microsoft under the MIT License (2025).';

  // Ko-fi / Patreon links (§7). GitHub Sponsors is NOT included (deferred — §7).
  // Inline SVG logos — no external scripts or trackers (§4).
  const supportLinks = el('div', 'flex gap-3 text-[10px] mt-2 items-center');

  const kofi = el('a', 'flex items-center gap-1 text-[#72a4f2] underline', {
    href: 'https://ko-fi.com/N4N35ZO95',
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': 'Support me on Ko-fi',
  });
  kofi.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.048 2.683-2.575 2.683-2.575s.084-1.501.097-2.292c4.15.572 7.019-2.241 6.527-5.783zm-6.967 4.01h-.636v2.399h-2.17V12.96h-.666V11.4h3.472zm5.274-.583c-.24 1.59-1.813 2.38-3.42 2.184V9.944c1.565-.271 3.433.372 3.42 2.431z"/>' +
    '</svg>' +
    'Ko-fi';

  const patreon = el('a', 'flex items-center gap-1 text-[var(--zork-accent)] underline', {
    href: 'https://www.patreon.com/lhocke',
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': 'Support on Patreon',
  });
  patreon.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<path d="M14.82 2.41c3.96 0 7.18 3.24 7.18 7.21 0 3.96-3.22 7.18-7.18 7.18-3.97 0-7.21-3.22-7.21-7.18 0-3.97 3.24-7.21 7.21-7.21zM2 21.6h3.5V2.41H2V21.6z"/>' +
    '</svg>' +
    'Patreon';
  supportLinks.appendChild(kofi);
  supportLinks.appendChild(patreon);

  sidebar.appendChild(sidebarStatus);
  sidebar.appendChild(themeLabel);
  sidebar.appendChild(switcherContainer);
  sidebar.appendChild(mapLabel);
  sidebar.appendChild(pathsPanel.element);
  sidebar.appendChild(savesBtn);
  sidebar.appendChild(creditsBtn);
  sidebar.appendChild(feedbackBtn);
  sidebar.appendChild(notice);
  sidebar.appendChild(licenseLine);
  sidebar.appendChild(supportLinks);

  // ── Mobile drawer ───────────────────────────────────────────────────────
  // Clone sidebar content for the drawer (mobile).
  const drawerContent = sidebar.cloneNode(true) as HTMLElement;
  // Re-wire theme buttons in the cloned node.
  for (const btn of drawerContent.querySelectorAll<HTMLElement>('[data-theme-target]')) {
    const target = btn.getAttribute('data-theme-target') as ThemeName;
    btn.addEventListener('click', () => applyTheme(target));
  }
  // Re-wire the sidebar buttons in the cloned node — cloneNode(true) copies the
  // markup but NOT event listeners, so each interactive control the drawer reuses
  // must be re-bound here by its data attribute.
  const drawerCreditsBtn = drawerContent.querySelector<HTMLElement>('[data-open-credits]');
  if (drawerCreditsBtn) drawerCreditsBtn.addEventListener('click', openCredits);
  const drawerFeedbackBtn = drawerContent.querySelector<HTMLElement>('[data-open-feedback]');
  if (drawerFeedbackBtn) drawerFeedbackBtn.addEventListener('click', openFeedback);

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
  app.appendChild(creditsDialog);
  app.appendChild(feedbackDialog);
  app.appendChild(mapModal.element);
  app.appendChild(slotPicker.element);
  // Hidden — see the comment on buildMap(). Kept out of `sidebar` so it is
  // never cloned into the mobile drawer.
  app.appendChild(map.element);

  // ── Boot the game ───────────────────────────────────────────────────────
  const banner = session.start();
  appendOutput(banner);
  const snap = session.snapshot();
  updateStatus(snap);
  mapState.update(snap, null);
  mapModal.noteRegion(snap.here);
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

  return {
    mapState,
    session,
    // Test handles: force a sidebar map refresh (async — awaits the lazy
    // layout import), and record a room's region as lastMappedRegion
    // without driving a full engine turn.
    refreshMap: () => map.refresh(),
    noteRegion: (roomId: string) => mapModal.noteRegion(roomId),
  };
}
