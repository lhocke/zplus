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

export interface SavePort {
  /** Persist state to slot. May throw on quota/IO — caller surfaces as Failed. */
  write(slot: string, state: SaveState): void;
  /**
   * Read from slot.  Returns undefined when:
   * - slot is empty,
   * - stored data fails JSON parse,
   * - stored data fails schema validation,
   * - formatVersion mismatches (refuse before any mutation — spec §5.3).
   * buildId mismatch on same formatVersion is warn-allow (OQ-1).
   */
  read(slot: string): SaveState | undefined;
  /** Metadata for all occupied slots — for the slot picker (§7). */
  list(): SaveSlotMeta[];
  /** Remove a slot.  No-op if absent. */
  remove(slot: string): void;
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
  if (typeof v.hereId !== 'string')                          return 'hereId not a string';
  if (!Array.isArray(v.visited))                             return 'visited not an array';

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

  // Subsystems — shape check only
  if (!Array.isArray(v.clock))     return 'clock not an array';
  if (!Array.isArray(v.flagStore)) return 'flagStore not an array';
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

  // moduleGlobals — present and is an object
  if (!isObj(v.moduleGlobals)) return 'moduleGlobals not an object';

  // objects entries — id must be a string
  for (const entry of v.objects as unknown[]) {
    if (!isObj(entry) || typeof entry.id !== 'string') {
      return 'objects entry has non-string id';
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

  write(slot: string, state: SaveState): void {
    // May throw QuotaExceededError — let it propagate so the verb layer
    // can catch it and emit Failed.
    this.storage.setItem(slotKey(slot), JSON.stringify(state));
  }

  read(slot: string): SaveState | undefined {
    const raw = this.storage.getItem(slotKey(slot));
    if (raw === null) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON — treat as absent/corrupt; caller gives in-voice message.
      return undefined;
    }

    // Schema validation first — reject before any further inspection.
    const verdict = validateSaveState(parsed);
    if (verdict !== VALIDATION_OK) return undefined;

    const state = parsed as SaveState;

    // formatVersion mismatch — refuse before mutating anything (spec §5.3).
    if (state.formatVersion !== SAVE_FORMAT_VERSION) return undefined;

    // buildId mismatch on same formatVersion — warn-allow (OQ-1).
    // The mismatch is logged to console so devs can see it; gameplay continues.
    // (In production a content patch shouldn't brick saves.)
    // No console.warn here — the caller's context has the right message channel.

    return state;
  }

  list(): SaveSlotMeta[] {
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

  remove(slot: string): void {
    this.storage.removeItem(slotKey(slot));
  }
}
