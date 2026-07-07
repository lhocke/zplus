/**
 * CB3 — V-PRAY audit (verify-only, spec §4.2 AMENDED)
 *
 * Audit: verbPray vs gverbs.zil:1047–1054
 *
 *   <ROUTINE V-PRAY ()
 *     <COND (<EQUAL? ,HERE ,SOUTH-TEMPLE> <GOTO ,FOREST-1>)
 *           (T <TELL "If you pray enough, your prayers may be answered." CR>)>>
 *
 * Findings (no divergence — no build required):
 *   1. SOUTH-TEMPLE branch: impl does moveTo(FOREST-1), returns moved:true, empty output.
 *      ZIL <GOTO ,FOREST-1> teleports with no text from V-PRAY itself. ✓
 *   2. Fallback string: "If you pray enough, your prayers may be answered." — byte-identical
 *      to gverbs.zil:1054. ✓
 *   3. Registration: ACTION_HANDLERS['V-PRAY'] = verbPray. ✓
 *   4. V-PRAY is NOT in META_ACTIONS — consumes time. ✓
 *
 * Ghost-precedence seam (spec §4.2):
 *   When dead===true, ghostDispatch (game.ts:411–446) intercepts V-PRAY before
 *   verbPray is ever called. The living V-PRAY is the not-dead path only.
 *
 * ZIL refs:
 *   gverbs.zil:1047–1054  V-PRAY living path
 *   1actions.zil:3152–3169 DEAD-FUNCTION ghost PRAY (Phase-2 DT2)
 */

import { describe, it, expect } from 'vitest';
import { newGameAt } from '../helpers/new-game.js';

// ---------------------------------------------------------------------------
// 1. Living path — SOUTH-TEMPLE teleport (gverbs.zil:1049)
// ---------------------------------------------------------------------------

describe('CB3: V-PRAY living path — SOUTH-TEMPLE teleport', () => {
  it('pray at SOUTH-TEMPLE moves player to FOREST-1', async () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    await g.turn('pray');
    expect(g.view().here).toBe('FOREST-1');
  });

  it('pray at SOUTH-TEMPLE emits no V-PRAY text (GOTO produces no message)', async () => {
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    const r = await g.turn('pray');
    // ZIL <GOTO ,FOREST-1> doesn't TELL anything — output is the room description
    // from onRoomEntered, not a V-PRAY message.
    expect(r.output).not.toContain('If you pray enough');
    expect(r.output).not.toContain('not heard');
  });
});

// ---------------------------------------------------------------------------
// 2. Living path — fallback string (gverbs.zil:1053–1054)
// ---------------------------------------------------------------------------

describe('CB3: V-PRAY living path — fallback string', () => {
  it('pray outside SOUTH-TEMPLE → exact ZIL string', async () => {
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    const r = await g.turn('pray');
    expect(r.output).toContain('If you pray enough, your prayers may be answered.');
  });

  it('fallback fires at any non-temple room', async () => {
    const g = newGameAt('LIVING-ROOM');
    g.start();
    const r = await g.turn('pray');
    expect(r.output).toContain('If you pray enough, your prayers may be answered.');
  });
});

// ---------------------------------------------------------------------------
// 3. Ghost-precedence seam — dead===true routes through ghostDispatch,
//    NOT through verbPray (spec §4.2: "ghost-mode branch takes precedence
//    when dead; this V-PRAY is the not-dead path").
// ---------------------------------------------------------------------------

describe('CB3: ghost-precedence seam', () => {
  it('dead===true at SOUTH-TEMPLE → ghost resurrection path, not living teleport', async () => {
    // Living V-PRAY at SOUTH-TEMPLE would silently teleport without any resurrection text.
    // Ghost PRAY at SOUTH-TEMPLE should produce the trumpet/resurrection message.
    const g = newGameAt('SOUTH-TEMPLE');
    g.start();
    (g as unknown as { dead: boolean }).dead = true;
    (g as unknown as { alwaysLit: boolean }).alwaysLit = true;
    (g as unknown as { visited: Set<string> }).visited.add('SOUTH-TEMPLE');
    const r = await g.turn('pray');
    // Ghost path produces resurrection text — living path would produce none.
    expect(r.output).toMatch(/trumpet|bright|disembod/i);
    // Ghost path clears dead flag (resurrection).
    expect((g as unknown as { dead: boolean }).dead).toBe(false);
  });

  it('dead===true outside SOUTH-TEMPLE → ghost "not heard", not living fallback', async () => {
    // Living V-PRAY would produce "If you pray enough, your prayers may be answered."
    // Ghost PRAY elsewhere produces "Your prayers are not heard."
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    (g as unknown as { dead: boolean }).dead = true;
    (g as unknown as { alwaysLit: boolean }).alwaysLit = true;
    const r = await g.turn('pray');
    expect(r.output).toContain('not heard');
    expect(r.output).not.toContain('If you pray enough');
  });

  it('dead===false → verbPray is reached (living path fires, ghost path skipped)', async () => {
    // dead===false means ghostDispatch is not entered; verbPray handles the command.
    const g = newGameAt('WEST-OF-HOUSE');
    g.start();
    const r = await g.turn('pray');
    expect(r.output).toContain('If you pray enough, your prayers may be answered.');
    // Ghost fallback must NOT appear.
    expect(r.output).not.toContain('not heard');
    expect(r.output).not.toContain("can't even do that");
  });
});
