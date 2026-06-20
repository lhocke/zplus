/**
 * GameSession facade — the single integration point between the UI/CLI
 * and the engine (§2). Telemetry lives entirely here; the Game stays pure.
 */

import { createGame } from '../engine/bootstrap.js';
import type { GameView } from '../engine/game.js';
import {
  resetKitchenWindowFlag,
  resetRugMoved,
  resetGrateRevealed,
  resetGrunlock,
  resetSingSong,
} from '../actions/above-ground.js';
import { resetMatchCount } from '../actions/light-sources.js';
import { resetThiefState } from '../actions/thief-state.js';
import type { PlaytestSink, SessionStart, TurnEvent, SaveEvent, RestoreEvent, RestartEvent } from './sink.js';
import type { SavePort, RestoreFailReason } from './save-port.js';

const DEFAULT_SEED = 42;

// Valid manual slot numbers (spec §6: 3 named manual slots).
const VALID_SLOTS = new Set(['1', '2', '3']);

// Injected at Vite build time; falls back to 'dev' in Node/test runs.
declare const __BUILD_ID__: string;
function getBuildId(): string {
  try {
    return __BUILD_ID__;
  } catch {
    return 'dev';
  }
}

export interface GameSession {
  start(): string;
  submit(command: string): string;
  snapshot(): GameView;
  /**
   * Re-bootstrap the game: reset module globals and create a fresh Game.
   * Equivalent to a page reload.  Confirmation is handled at the shell/UI level
   * before this is called (spec §4.4, OQ-4).
   */
  restart(): void;
  close(): void;
}

function freshSessionId(): string {
  // crypto.randomUUID is available in Node 14.17+ and all modern browsers.
  return crypto.randomUUID();
}

// Parse "save [N]" / "restore [N]" → { verb: 'save'|'restore', slot: string }
// Returns undefined when the command doesn't match the save/restore pattern.
// Slot defaults to "1" when no number is given.  Invalid slots are caught by
// the caller, which emits the in-voice message and skips verb dispatch.
const SAVE_RESTORE_RE = /^(save|restore)(?:\s+(\S+))?$/i;

function parseSaveCommand(raw: string): { verb: string; slot: string } | undefined {
  const m = SAVE_RESTORE_RE.exec(raw.trim());
  if (m === null) return undefined;
  return { verb: m[1].toLowerCase(), slot: m[2] ?? '1' };
}

function resetModuleGlobals(): void {
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();
  resetThiefState();
}

export function createSession(opts: { sink: PlaytestSink; seed?: number; savePort?: SavePort }): GameSession {
  // Reset module-level ZIL globals so each session starts clean (§2 C1).
  resetModuleGlobals();

  const sink = opts.sink;
  const sessionId = freshSessionId();
  const buildId = getBuildId();
  let turnCount = 0;
  let closed = false;

  // Wrap the SavePort so the session can observe the restore outcome for telemetry
  // without coupling to the output text.  Only readWithReason() is intercepted;
  // write() failures are captured separately via try/catch in submit().
  let lastRestoreReason: RestoreFailReason | 'ok' | undefined;
  let lastSaveOk: boolean | undefined;

  const wrappedPort: SavePort | undefined = opts.savePort
    ? {
        write(slot, state) {
          // write() may throw (quota/IO); let the exception propagate so the verb
          // catches it and emits "Failed." — but record the outcome first.
          try {
            opts.savePort!.write(slot, state);
            lastSaveOk = true;
          } catch (err) {
            lastSaveOk = false;
            throw err;   // re-throw so verbSave emits "Failed."
          }
        },
        read(slot) {
          return opts.savePort!.read(slot);
        },
        readWithReason(slot) {
          const r = opts.savePort!.readWithReason(slot);
          // r is SaveState on success, or a RestoreFailReason string on failure
          lastRestoreReason = typeof r === 'object' ? 'ok' : r;
          return r;
        },
        list() { return opts.savePort!.list(); },
        remove(slot) { opts.savePort!.remove(slot); },
      }
    : undefined;

  // Re-bootstrap: reset module globals + fresh game.  Called by ctx.restart()
  // inside the engine when V-RESTART fires (§4.4, OQ-4).
  function doRestart(): void {
    resetModuleGlobals();
    game = createGame({ seed: opts.seed ?? DEFAULT_SEED, savePort: wrappedPort, restartFn: doRestart });
  }

  // Mutable so restart() can replace the live game with a fresh one.
  let game = createGame({ seed: opts.seed ?? DEFAULT_SEED, savePort: wrappedPort, restartFn: doRestart });

  return {
    start(): string {
      const output = game.start();
      const v = game.view();
      const event: SessionStart = {
        type: 'start',
        sessionId,
        buildId,
        ts: new Date().toISOString(),
        output,
        hereName: v.hereName,
        score: v.score,
        maxScore: v.maxScore,
        moves: v.moves,
      };
      sink.emit(event);
      return output;
    },

    submit(command: string): string {
      if (closed) return '';
      // Empty/blank input: no-op per spec §9 ("Empty submit('') emits no TurnEvent").
      if (command.trim() === '') return '';

      // Rolling pre-turn autosave (spec §6, OQ-2): snapshot BEFORE the turn runs so
      // the player can recover the state at the START of any turn — including the one
      // that killed them.  Skipped when already gameOver (engine ignores the turn anyway).
      if (wrappedPort !== undefined && !game.view().gameOver) {
        try {
          wrappedPort.write('autosave', game.snapshot());
        } catch {
          // Quota/IO failure silently skipped — autosave is best-effort (spec §6).
        }
      }

      // Pre-process save/restore commands: extract slot, validate, strip from command.
      // spec §4.5: "save 2" → slot "2", command word "save"; invalid slot → in-voice.
      const parsed = parseSaveCommand(command);
      let dispatchCommand = command;
      let saveSlot: string | undefined;

      if (parsed !== undefined) {
        const slot = parsed.slot;
        if (!VALID_SLOTS.has(slot)) {
          // Out-of-range slot: in-voice message, never dispatches the verb body.
          // spec §4.5: "There is no save slot N." — not Failed.
          return `There is no save slot ${slot}.`;
        }
        saveSlot = slot;
        dispatchCommand = parsed.verb;  // stripped: "save" not "save 2"
      }

      // Reset port-level outcome trackers before the turn so stale values
      // from a prior turn don't bleed into this one's telemetry.
      lastSaveOk = undefined;
      lastRestoreReason = undefined;

      const isRestart = /^restart$/i.test(command.trim());
      const { output } = game.turn(dispatchCommand, saveSlot !== undefined ? { saveSlot } : undefined);
      turnCount++;
      const ts = new Date().toISOString();
      const v = game.view();

      // --- telemetry: save/restore/restart boundary events (spec §7.2) ---
      if (parsed?.verb === 'save' && saveSlot !== undefined) {
        const saveEv: SaveEvent = {
          type: 'save',
          sessionId,
          buildId,
          turn: turnCount,
          slot: saveSlot,
          ok: lastSaveOk ?? (output === 'Ok.'),
          ts,
        };
        sink.emit(saveEv);
      } else if (parsed?.verb === 'restore' && saveSlot !== undefined) {
        const ok = lastRestoreReason === 'ok';
        const restoreEv: RestoreEvent = {
          type: 'restore',
          sessionId,
          buildId,
          slot: saveSlot,
          ok,
          reason: lastRestoreReason ?? 'empty',
          ts,
        };
        sink.emit(restoreEv);
      } else if (isRestart) {
        const restartEv: RestartEvent = {
          type: 'restart',
          sessionId,
          ts,
        };
        sink.emit(restartEv);
      }

      const event: TurnEvent = {
        type: 'turn',
        sessionId,
        buildId,
        turn: turnCount,
        command,
        output,
        score: v.score,
        maxScore: v.maxScore,
        moves: v.moves,
        room: v.here,
        hereName: v.hereName,
        ts,
      };
      sink.emit(event);
      return output;
    },

    snapshot(): GameView {
      return game.view();
    },

    restart(): void {
      doRestart();
    },

    close(): void {
      if (closed) return;
      closed = true;
      sink.emit({ type: 'end', sessionId, ts: new Date().toISOString(), lastTurn: turnCount });
      sink.close();
    },
  };
}
