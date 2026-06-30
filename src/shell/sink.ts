/**
 * PlaytestSink — the telemetry transport seam (§4).
 *
 * The session facade emits structured events; the sink decides where they go.
 * Gathered: tester input + game state only. No userAgent/IP/geo/cookies.
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface SessionStart {
  type: 'start';
  sessionId: string;
  buildId: string;
  ts: string;
  // Initial game state — carried so FileSink can write the banner block that
  // tools/play.ts writes on startup (intro output + first status line).
  output: string;
  hereName: string;
  score: number;
  maxScore: number;
  moves: number;
}

export interface TurnEvent {
  type: 'turn';
  sessionId: string;
  buildId: string;
  turn: number;        // 1-based
  command: string;     // raw input
  output: string;      // engine output, verbatim
  score: number;
  maxScore: number;
  moves: number;
  room: string;        // view().here (ObjectId)
  hereName: string;    // view().hereName (display name for status line)
  ts: string;          // ISO 8601
}

export interface SessionEnd {
  type: 'end';
  sessionId: string;
  ts: string;
  lastTurn: number;
}

// Save/restore/restart telemetry (spec §7.2).
// These act as transcript boundaries so readers can spot state jumps.

export interface SaveEvent {
  type: 'save';
  sessionId: string;
  buildId: string;
  turn: number;
  slot: string;
  ok: boolean;
  ts: string;
}

export interface RestoreEvent {
  type: 'restore';
  sessionId: string;
  buildId: string;
  slot: string;
  ok: boolean;
  reason?: 'ok' | 'empty' | 'corrupt' | 'version';
  ts: string;
}

export interface RestartEvent {
  type: 'restart';
  sessionId: string;
  ts: string;
}

export type PlaytestEvent = SessionStart | TurnEvent | SessionEnd | SaveEvent | RestoreEvent | RestartEvent;

// ---------------------------------------------------------------------------
// Sink interface
// ---------------------------------------------------------------------------

export interface PlaytestSink {
  emit(e: PlaytestEvent): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// nullSink — no-op; used in tests and headless runs
// ---------------------------------------------------------------------------

export const nullSink: PlaytestSink = {
  emit(_e) {},
  close() {},
};

// ---------------------------------------------------------------------------
// FileSink — human-readable flat-text format, appendFileSync per event
// ---------------------------------------------------------------------------

const DEFAULT_LOGS_DIR = 'playtest-logs';

// Status line format matches tools/play.ts: "[ room · score/max · moves ]"
function statusLine(room: string, score: number, maxScore: number, moves: number): string {
  return `        [ ${room} · score ${score}/${maxScore} · moves ${moves} ]`;
}

export class FileSink implements PlaytestSink {
  private readonly logPath: string;
  private closed = false;

  constructor(logsDir: string = DEFAULT_LOGS_DIR) {
    mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = join(logsDir, `session-${stamp}.log`);
  }

  emit(e: PlaytestEvent): void {
    if (this.closed) return;
    let text: string;

    if (e.type === 'start') {
      // Header + intro banner + initial status, matching tools/play.ts:35-38.
      const status = statusLine(e.hereName, e.score, e.maxScore, e.moves);
      text = `=== playtest ${e.ts} ===\n${e.output}\n${status}\n\n`;
    } else if (e.type === 'turn') {
      // "> command\n<output>\n<status>\n\n"
      const status = statusLine(e.hereName, e.score, e.maxScore, e.moves);
      text = `> ${e.command}\n${e.output}\n${status}\n\n`;
    } else if (e.type === 'save') {
      const flag = e.ok ? 'ok' : 'failed';
      text = `=== save slot ${e.slot} (${flag}) ===\n`;
    } else if (e.type === 'restore') {
      const flag = e.ok ? 'ok' : (e.reason ?? 'failed');
      text = `=== restore slot ${e.slot} (${flag}) ===\n`;
    } else if (e.type === 'restart') {
      text = `=== restart ===\n`;
    } else {
      // SessionEnd: write terminator and mark closed.
      appendFileSync(this.logPath, '=== end ===\n');
      this.closed = true;
      return;
    }

    appendFileSync(this.logPath, text);
  }

  close(): void {
    // With appendFileSync-per-event there's nothing to flush.
    // Mark closed so subsequent emits are silently dropped.
    this.closed = true;
  }
}
