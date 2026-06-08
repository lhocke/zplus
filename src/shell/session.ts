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
import type { PlaytestSink, SessionStart, TurnEvent } from './sink.js';

const DEFAULT_SEED = 42;

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
  close(): void;
}

function freshSessionId(): string {
  // crypto.randomUUID is available in Node 14.17+ and all modern browsers.
  return crypto.randomUUID();
}

export function createSession(opts: { sink: PlaytestSink; seed?: number }): GameSession {
  // Reset module-level ZIL globals so each session starts clean (§2 C1).
  resetKitchenWindowFlag();
  resetRugMoved();
  resetGrateRevealed();
  resetGrunlock();
  resetSingSong();
  resetMatchCount();

  const game = createGame({ seed: opts.seed ?? DEFAULT_SEED });
  const sink = opts.sink;
  const sessionId = freshSessionId();
  const buildId = getBuildId();
  let turnCount = 0;
  let closed = false;

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
      const { output } = game.turn(command);
      turnCount++;
      const v = game.view();
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
        ts: new Date().toISOString(),
      };
      sink.emit(event);
      return output;
    },

    snapshot(): GameView {
      return game.view();
    },

    close(): void {
      if (closed) return;
      closed = true;
      sink.emit({ type: 'end', sessionId, ts: new Date().toISOString(), lastTurn: turnCount });
      sink.close();
    },
  };
}
