/**
 * FsSavePort — filesystem-backed SavePort for the Tauri shell (spec: docs/
 * superpowers/specs/2026-07-06-native-shell-design.md, component 1 +
 * Amendment A).
 *
 * Implements the async SavePort interface directly over the injected FsOps
 * (Tauri plugin-fs in production, a temp-dir fake in tests). Every method
 * awaits its fs op and lets rejections propagate — a failed disk write
 * rejects write(), which the verb layer awaits and surfaces as the
 * byte-exact "Failed." (Amendment A: no cache, no fire-and-forget).
 *
 * The constructor accepts FsOps or Promise<FsOps> so the boot path can stay
 * synchronous: mountShell passes createTauriFsOps()'s promise and each
 * method awaits it internally.
 */

import type { SavePort, SaveSlotMeta, RestoreFailReason } from './save-port.js';
import { validateSaveState, VALIDATION_OK } from './save-port.js';
import type { SaveState } from '../engine/save-state.js';
import { SAVE_FORMAT_VERSION } from '../engine/save-state.js';
import type { FsOps } from './tauri-fs-ops.js';

const SAVES_DIR = 'saves';
const EXT = '.json';

function slotPath(slot: string): string {
  return `${SAVES_DIR}/${slot}${EXT}`;
}

export class FsSavePort implements SavePort {
  private readonly opsP: Promise<FsOps>;

  constructor(ops: FsOps | Promise<FsOps>) {
    this.opsP = Promise.resolve(ops);
  }

  async write(slot: string, state: SaveState): Promise<void> {
    const ops = await this.opsP;
    if (!(await ops.exists(SAVES_DIR))) {
      await ops.mkdir(SAVES_DIR);
    }
    // Any rejection (disk full, permissions, scope violation) propagates to
    // the awaiting verb body, which emits "Failed." — never swallow it here.
    await ops.writeTextFile(slotPath(slot), JSON.stringify(state));
  }

  async read(slot: string): Promise<SaveState | undefined> {
    const r = await this.readWithReason(slot);
    return typeof r === 'string' ? undefined : r;
  }

  async readWithReason(slot: string): Promise<SaveState | RestoreFailReason> {
    const ops = await this.opsP;
    if (!(await ops.exists(slotPath(slot)))) return 'empty';

    let raw: string;
    try {
      raw = await ops.readTextFile(slotPath(slot));
    } catch {
      return 'corrupt';   // exists but unreadable — treat as damaged, not empty
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'corrupt';
    }

    if (validateSaveState(parsed) !== VALIDATION_OK) return 'corrupt';

    const state = parsed as SaveState;
    if (state.formatVersion !== SAVE_FORMAT_VERSION) return 'version';

    return state;
  }

  async list(): Promise<SaveSlotMeta[]> {
    const ops = await this.opsP;
    if (!(await ops.exists(SAVES_DIR))) return [];

    const entries = await ops.readDir(SAVES_DIR);
    const results: SaveSlotMeta[] = [];
    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.endsWith(EXT)) continue;
      const slot = entry.name.slice(0, -EXT.length);
      const r = await this.readWithReason(slot);
      if (typeof r === 'string') continue;   // empty/corrupt/version — not listed
      results.push({
        slot,
        savedAt: r.savedAt,
        buildId: r.buildId,
        hereName: r.hereId,
        moves: r.moveCount,
      });
    }
    return results;
  }

  async remove(slot: string): Promise<void> {
    const ops = await this.opsP;
    if (!(await ops.exists(slotPath(slot)))) return;   // no-op on absent slot
    await ops.remove(slotPath(slot));
  }
}
