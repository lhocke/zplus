/**
 * Task A5 — types + messages + context (compile-gate).
 *
 * These tests verify the new ParsedCommand shape (list-valued dobjIds/iobjIds,
 * action, preAction, numberValue, autoTaken), the 4-kind ParseResult
 * (ok/fail/orphan/disambig), the three new message constants (M_END, M_FLASH,
 * M_OBJDESC), fatal() on ActionContext, and contFcn on GameObject.
 *
 * Written RED-first per TDD; they flip GREEN once the new types land.
 */

import { describe, expect, it } from 'vitest';
import type { ParsedCommand, ParseResult } from '../../src/engine/parser/types';
import { M_BEG, M_ENTER, M_LOOK, M_END, M_FLASH, M_OBJDESC } from '../../src/engine/messages';
import type { ActionContext } from '../../src/domain/game-object';
import { GameObject } from '../../src/domain/game-object';

// ---------------------------------------------------------------------------
// 1. New message constants
// ---------------------------------------------------------------------------

describe('messages — new constants', () => {
  it('M_END equals 6', () => {
    expect(M_END).toBe(6);
  });

  it('M_FLASH equals 4', () => {
    expect(M_FLASH).toBe(4);
  });

  it('M_OBJDESC equals 5', () => {
    expect(M_OBJDESC).toBe(5);
  });

  it('existing constants are unchanged', () => {
    expect(M_BEG).toBe(1);
    expect(M_ENTER).toBe(2);
    expect(M_LOOK).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. ParsedCommand — list-valued fields
// ---------------------------------------------------------------------------

describe('ParsedCommand — list-valued schema', () => {
  it('accepts a command with dobjIds as an array', () => {
    const cmd: ParsedCommand = {
      verb: 'TAKE',
      action: 'V-TAKE',
      dobjIds: ['LANTERN'],
      raw: ['take', 'lantern'],
    };
    expect(cmd.dobjIds).toEqual(['LANTERN']);
    expect(cmd.dobjIds?.[0]).toBe('LANTERN');
  });

  it('accepts a command with iobjIds as an array', () => {
    const cmd: ParsedCommand = {
      verb: 'PUT',
      action: 'V-PUT',
      dobjIds: ['COIN'],
      iobjIds: ['CHEST'],
      prep: 'IN',
      raw: ['put', 'coin', 'in', 'chest'],
    };
    expect(cmd.iobjIds?.[0]).toBe('CHEST');
  });

  it('accepts a command with no objects (verb-only)', () => {
    const cmd: ParsedCommand = {
      verb: 'LOOK',
      action: 'V-LOOK',
      raw: ['look'],
    };
    expect(cmd.dobjIds).toBeUndefined();
    expect(cmd.iobjIds).toBeUndefined();
  });

  it('accepts a command with preAction', () => {
    const cmd: ParsedCommand = {
      verb: 'TAKE',
      action: 'V-TAKE',
      preAction: 'PRE-TAKE',
      dobjIds: ['SWORD'],
      raw: ['take', 'sword'],
    };
    expect(cmd.preAction).toBe('PRE-TAKE');
  });

  it('accepts a command with numberValue', () => {
    const cmd: ParsedCommand = {
      verb: 'WIND',
      action: 'V-WIND',
      numberValue: 5,
      raw: ['wind', '5'],
    };
    expect(cmd.numberValue).toBe(5);
  });

  it('accepts a command with autoTaken', () => {
    const cmd: ParsedCommand = {
      verb: 'ATTACK',
      action: 'V-ATTACK',
      dobjIds: ['TROLL'],
      iobjIds: ['SWORD'],
      autoTaken: ['SWORD'],
      raw: ['attack', 'troll'],
    };
    expect(cmd.autoTaken).toEqual(['SWORD']);
  });
});

// ---------------------------------------------------------------------------
// 3. ParseResult — 4-kind union
// ---------------------------------------------------------------------------

describe('ParseResult — 4-kind union', () => {
  it('ok variant carries a ParsedCommand', () => {
    const cmd: ParsedCommand = { verb: 'LOOK', action: 'V-LOOK', raw: ['look'] };
    const r: ParseResult = { kind: 'ok', command: cmd };
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.command.verb).toBe('LOOK');
    }
  });

  it('fail variant carries a message string', () => {
    const r: ParseResult = { kind: 'fail', message: 'I beg your pardon?' };
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.message).toBe('I beg your pardon?');
    }
  });

  it('orphan variant carries a message string', () => {
    const r: ParseResult = { kind: 'orphan', message: 'What do you want to take?' };
    expect(r.kind).toBe('orphan');
    if (r.kind === 'orphan') {
      expect(r.message).toContain('take');
    }
  });

  it('disambig variant carries a message string', () => {
    const r: ParseResult = {
      kind: 'disambig',
      message: 'Which lamp do you mean, the brass lamp or the silver lamp?',
    };
    expect(r.kind).toBe('disambig');
    if (r.kind === 'disambig') {
      expect(r.message).toContain('lamp');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. ActionContext.fatal() — type-level check via a partial implementation
// ---------------------------------------------------------------------------

describe('ActionContext — fatal() method', () => {
  it('ActionContext interface includes a fatal() method', () => {
    // We verify by constructing an object that satisfies the type.
    // If fatal() is missing from the interface this won't compile.
    let fatalCalled = false;
    const ctx: Pick<ActionContext, 'fatal'> = {
      fatal: () => { fatalCalled = true; },
    };
    ctx.fatal();
    expect(fatalCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. GameObject.contFcn — slot exists on the class
// ---------------------------------------------------------------------------

describe('GameObject — contFcn slot', () => {
  it('contFcn is undefined by default', () => {
    const obj = new GameObject('TEST', 'test object');
    expect(obj.contFcn).toBeUndefined();
  });

  it('contFcn can be assigned a string', () => {
    const obj = new GameObject('TEST', 'test object');
    obj.contFcn = 'LAMP-CONT';
    expect(obj.contFcn).toBe('LAMP-CONT');
  });
});
