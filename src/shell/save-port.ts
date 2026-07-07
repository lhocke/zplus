/**
 * PB-PORT — SavePort capability boundary + localStorage adapter + validator.
 *
 * Security note (spec §5.1): localStorage is user-editable — every read()
 * path treats the stored value as untrusted input.  validateSaveState() does
 * the rejection work; it never throws, always returns VALIDATION_OK or a
 * reason string.  Callers map a non-OK result to the appropriate in-voice
 * message rather than letting a raw error reach the player.
 *
 * Key namespace: `zork-save-<slot>`, parallel to the existing `zork-theme`.
 */

import type { SaveState } from '../engine/save-state.js';
import { SAVE_FORMAT_VERSION } from '../engine/save-state.js';

// ---------------------------------------------------------------------------
// SavePort interface (the capability boundary — spec §5.1)
// ---------------------------------------------------------------------------

export interface SaveSlotMeta {
  slot: string;
  savedAt: string;
  buildId: string;
  hereName: string;
  moves: number;
}

/** Reason a restore failed — verb body maps these to the right player message (§5.3, OQ-3). */
export type RestoreFailReason = 'empty' | 'corrupt' | 'version';

export interface SavePort {
  /** Persist state to slot. Rejects on quota/IO — caller awaits and surfaces as Failed. */
  write(slot: string, state: SaveState): Promise<void>;
  /**
   * Read from slot.  Resolves undefined when:
   * - slot is empty,
   * - stored data fails JSON parse,
   * - stored data fails schema validation,
   * - formatVersion mismatches (refuse before any mutation — spec §5.3).
   * buildId mismatch on same formatVersion is warn-allow (OQ-1).
   */
  read(slot: string): Promise<SaveState | undefined>;
  /**
   * Like read(), but surfaces the failure reason so callers can emit
   * distinct player messages for empty/corrupt/version (OQ-3, §5.3).
   */
  readWithReason(slot: string): Promise<SaveState | RestoreFailReason>;
  /** Metadata for all occupied slots — for the slot picker (§7). */
  list(): Promise<SaveSlotMeta[]>;
  /** Remove a slot.  No-op if absent. */
  remove(slot: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Validator — returns VALIDATION_OK or a reason string.  Never throws.
// ---------------------------------------------------------------------------

export const VALIDATION_OK = 'ok' as const;
export type ValidationResult = typeof VALIDATION_OK | string;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Known top-level keys — extra fields are rejected per security posture.
const KNOWN_TOP_LEVEL_KEYS = new Set([
  'formatVersion', 'buildId', 'savedAt',
  'moveCount', 'deaths', 'dead', 'alwaysLit', 'gameOver', 'lucky',
  'loadAllowed', 'loadMax', 'waterLevel', 'beachDig',
  'hereId', 'visited',
  'lastVerb', 'lastAction', 'lastDobjId', 'lastIobjId', 'lastPrep',
  'rngMain', 'rngCombat',
  'clock', 'scoring', 'flagStore', 'objects', 'parser', 'moduleGlobals',
]);

/**
 * Validate a parsed (but untrusted) value as a SaveState.
 *
 * Checks shape and types only — does NOT resolve objectIds against a live
 * world (that's Game.restore()'s job).  Returns VALIDATION_OK on success;
 * a non-empty reason string on failure.
 */
export function validateSaveState(v: unknown): ValidationResult {
  if (!isObj(v)) return 'not an object';

  // Extra-field check — reject unexpected keys so hand-edited saves with
  // injected fields are caught here rather than silently accepted.
  for (const k of Object.keys(v)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(k)) return `unknown field "${k}"`;
  }

  // Versioning
  if (typeof v.formatVersion !== 'number') return 'formatVersion not a number';
  if (typeof v.buildId !== 'string')       return 'buildId not a string';
  if (typeof v.savedAt !== 'string')       return 'savedAt not a string';

  // Core counters — all required, numeric, non-negative where applicable
  if (typeof v.moveCount !== 'number' || v.moveCount < 0)   return 'moveCount invalid';
  if (typeof v.deaths !== 'number')                          return 'deaths not a number';
  if (typeof v.dead !== 'boolean')                           return 'dead not a boolean';
  if (typeof v.alwaysLit !== 'boolean')                      return 'alwaysLit not a boolean';
  if (typeof v.gameOver !== 'boolean')                       return 'gameOver not a boolean';
  if (typeof v.lucky !== 'boolean')                          return 'lucky not a boolean';
  if (typeof v.loadAllowed !== 'number')                     return 'loadAllowed not a number';
  if (typeof v.loadMax !== 'number')                         return 'loadMax not a number';
  if (typeof v.waterLevel !== 'number')                      return 'waterLevel not a number';
  if (typeof v.beachDig !== 'number')                        return 'beachDig not a number';
  if (typeof v.hereId !== 'string')    return 'hereId not a string';
  if (!Array.isArray(v.visited))       return 'visited not an array';
  for (const e of v.visited as unknown[]) {
    if (typeof e !== 'string') return 'visited entry not a string';
  }

  // M-END stashed command fields
  if (typeof v.lastVerb !== 'string')   return 'lastVerb not a string';
  if (typeof v.lastAction !== 'string') return 'lastAction not a string';
  // Optional M-END fields — if present, must be strings
  if (v.lastDobjId !== undefined && typeof v.lastDobjId !== 'string') return 'lastDobjId not a string';
  if (v.lastIobjId !== undefined && typeof v.lastIobjId !== 'string') return 'lastIobjId not a string';
  if (v.lastPrep !== undefined && typeof v.lastPrep !== 'string')     return 'lastPrep not a string';

  // RNG positions
  if (typeof v.rngMain !== 'number')   return 'rngMain not a number';
  if (typeof v.rngCombat !== 'number') return 'rngCombat not a number';

  // Subsystems — shape check + entry validation.
  // Array.isArray() is necessary but not sufficient: a hand-edited value
  // such as flagStore=[12345,"wat",null] passes isArray() but reaches
  // FlagStore.restore()'s destructuring loop and throws.  Validate entries
  // here so the port boundary stays the only place that can throw.

  if (!Array.isArray(v.clock)) return 'clock not an array';
  for (const e of v.clock as unknown[]) {
    if (!isObj(e) || typeof e.id !== 'string' ||
        typeof e.turnsLeft !== 'number' || typeof e.enabled !== 'boolean') {
      return 'clock entry invalid';
    }
  }

  if (!Array.isArray(v.flagStore)) return 'flagStore not an array';
  for (const e of v.flagStore as unknown[]) {
    // Each entry must be a [string, boolean] tuple.
    if (!Array.isArray(e) || e.length < 2 ||
        typeof e[0] !== 'string' || typeof e[1] !== 'boolean') {
      return 'flagStore entry invalid';
    }
  }

  if (!Array.isArray(v.objects))   return 'objects not an array';

  // Scoring
  if (!isObj(v.scoring))                              return 'scoring not an object';
  if (typeof v.scoring.baseScore !== 'number')        return 'scoring.baseScore not a number';
  if (typeof v.scoring.score !== 'number')            return 'scoring.score not a number';
  if (typeof v.scoring.wonFlag !== 'boolean')         return 'scoring.wonFlag not a boolean';

  // Parser
  if (!isObj(v.parser)) return 'parser not an object';
  if (v.parser.itRef !== undefined && typeof v.parser.itRef !== 'string') {
    return 'parser.itRef not a string';
  }

  // moduleGlobals — object with sub-objects whose fields the restore consumers
  // destructure by name; a null or primitive sub-object throws on first access.
  if (!isObj(v.moduleGlobals)) return 'moduleGlobals not an object';
  const mg = v.moduleGlobals;
  if (!isObj(mg.thiefState))        return 'moduleGlobals.thiefState not an object';
  if (!isObj(mg.aboveGroundState))  return 'moduleGlobals.aboveGroundState not an object';
  if (!isObj(mg.lightSourceState))  return 'moduleGlobals.lightSourceState not an object';

  // objects entries — full shape check.  applyObjectDelta destructures flags
  // (for-of into Set.add), props (for-of [k,v] into Map.set), and text fields.
  // A numeric prop entry throws when destructured as [k, v]; validate to block it here.
  for (const entry of v.objects as unknown[]) {
    if (!isObj(entry) || typeof entry.id !== 'string') {
      return 'objects entry has non-string id';
    }
    if (!Array.isArray(entry.flags)) return 'objects entry: flags not an array';
    if (!Array.isArray(entry.props)) return 'objects entry: props not an array';
    for (const p of entry.props as unknown[]) {
      // Each prop must be a [string, number|string] tuple.
      if (!Array.isArray(p) || p.length < 2 ||
          typeof p[0] !== 'string' ||
          (typeof p[1] !== 'number' && typeof p[1] !== 'string')) {
        return 'objects entry: props entry invalid';
      }
    }
  }

  return VALIDATION_OK;
}

// ---------------------------------------------------------------------------
// localStorage adapter
// ---------------------------------------------------------------------------

function slotKey(slot: string): string {
  return `zork-save-${slot}`;
}

export class LocalStorageSavePort implements SavePort {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async write(slot: string, state: SaveState): Promise<void> {
    // A QuotaExceededError thrown by setItem becomes a rejection of this
    // async method — the verb layer awaits and emits Failed.
    this.storage.setItem(slotKey(slot), JSON.stringify(state));
  }

  async read(slot: string): Promise<SaveState | undefined> {
    const r = await this.readWithReason(slot);
    return typeof r === 'string' ? undefined : r;
  }

  async readWithReason(slot: string): Promise<SaveState | RestoreFailReason> {
    const raw = this.storage.getItem(slotKey(slot));
    if (raw === null) return 'empty';

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'corrupt';
    }

    // Schema validation — reject before further inspection.
    const verdict = validateSaveState(parsed);
    if (verdict !== VALIDATION_OK) return 'corrupt';

    const state = parsed as SaveState;

    // formatVersion mismatch — refuse before mutating anything (spec §5.3).
    if (state.formatVersion !== SAVE_FORMAT_VERSION) return 'version';

    // buildId mismatch on same formatVersion — warn-allow (OQ-1).
    return state;
  }

  async list(): Promise<SaveSlotMeta[]> {
    const prefix = 'zork-save-';
    const results: SaveSlotMeta[] = [];

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key === null || !key.startsWith(prefix)) continue;
      const slot = key.slice(prefix.length);
      const raw = this.storage.getItem(key);
      if (raw === null) continue;

      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { continue; }

      if (validateSaveState(parsed) !== VALIDATION_OK) continue;
      if ((parsed as SaveState).formatVersion !== SAVE_FORMAT_VERSION) continue;

      const s = parsed as SaveState;
      results.push({
        slot,
        savedAt: s.savedAt,
        buildId: s.buildId,
        hereName: s.hereId,   // display name is the room id (best available without world)
        moves: s.moveCount,
      });
    }

    return results;
  }

  async remove(slot: string): Promise<void> {
    this.storage.removeItem(slotKey(slot));
  }
}
