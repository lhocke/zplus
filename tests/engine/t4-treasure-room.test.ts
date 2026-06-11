/**
 * T4 — TREASURE-ROOM-FCN + THIEF-IN-TREASURE + CHALICE-FCN + STILETTO/LARGE-BAG
 *
 * Done-criteria (spec §8 Wave 2, T4):
 *   TS-G  Treasure-room defense: enter TREASURE-ROOM with I-THIEF live →
 *         thief moves here, FIGHTBIT set, INVISIBLE cleared on thief,
 *         non-CHALICE/THIEF children go INVISIBLE; CHALICE TAKE blocked.
 *   Treasure-room reveal (golden): THIEF-IN-TREASURE "gestures mysteriously"
 *         message when ≥2 children; each non-CHALICE/THIEF child set INVISIBLE.
 *   Chalice TAKE block: blocked when PRSO in TREASURE-ROOM, THIEF in
 *         TREASURE-ROOM, THIEF has FIGHTBIT, THIEF not INVISIBLE, THIEF not KO'd.
 *   Stiletto/bag verb messages: STILETTO-FUNCTION (WEAPON-FUNCTION) + LARGE-BAG-F.
 *
 * ZIL citations:
 *   STILETTO-FUNCTION   1actions.zil:626–627
 *   WEAPON-FUNCTION     1actions.zil:629–638
 *   LARGE-BAG-F         1actions.zil:2094–2112
 *   CHALICE-FCN         1actions.zil:2123–2136
 *   TREASURE-ROOM-FCN   1actions.zil:2138–2149
 *   THIEF-IN-TREASURE   1actions.zil:2151–2161
 */

import { describe, it, expect } from 'vitest';
import { Flag } from '../../src/domain/flags.js';
import {
  treasureRoomFcn,
  thiefInTreasure,
  chaliceFcn,
  stilettoFunction,
  largeBagF,
  dumbContainer,
  type T4Ctx,
} from '../../src/actions/treasure-room.js';
import { ROBBER_U_DESC } from '../../src/actions/thief-state.js';
import { M_ENTER } from '../../src/engine/messages.js';

// ---------------------------------------------------------------------------
// Minimal object stub
// ---------------------------------------------------------------------------

interface StubObj {
  id: string;
  parentId: string | null;
  desc: string;
  flags: Set<Flag>;
  tvalue: number;
  ldesc?: string;
}

function makeObj(
  id: string,
  parentId: string | null,
  opts: { desc?: string; flags?: Flag[]; tvalue?: number; ldesc?: string } = {},
): StubObj {
  return {
    id,
    desc: opts.desc ?? id.toLowerCase().replace(/-/g, ' '),
    parentId,
    flags: new Set(opts.flags ?? []),
    tvalue: opts.tvalue ?? 0,
    ldesc: opts.ldesc,
  };
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

function makeCtx(opts: {
  hereId?: string;
  objs?: StubObj[];
  iThiefEnabled?: boolean;
  dead?: boolean;
  verb?: string;
  prsoId?: string;
  prsiId?: string;
  rarg?: number;
} = {}): {
  ctx: T4Ctx;
  emitted: string[];
  objMap: Map<string, StubObj>;
} {
  const emitted: string[] = [];
  const hereId = opts.hereId ?? 'TREASURE-ROOM';
  const iThiefEnabled = opts.iThiefEnabled ?? true;
  const dead = opts.dead ?? false;

  const objMap = new Map<string, StubObj>();
  for (const o of opts.objs ?? []) objMap.set(o.id, o);

  const ctx: T4Ctx = {
    hereId,
    verb: opts.verb ?? 'take',
    prsoId: opts.prsoId,
    prsiId: opts.prsiId,
    rarg: opts.rarg,

    isIThiefEnabled: () => iThiefEnabled,
    isDead: () => dead,

    getObj: (id) => {
      const o = objMap.get(id);
      if (o === undefined) return undefined;
      return {
        get id()       { return o.id; },
        get parentId() { return o.parentId; },
        get desc()     { return o.desc; },
        get tvalue()   { return o.tvalue; },
        get ldesc()    { return o.ldesc; },
        hasFlag: (f) => o.flags.has(f),
        setFlag: (f) => o.flags.add(f),
        clearFlag: (f) => o.flags.delete(f),
        moveTo: (destId) => { o.parentId = destId; },
      };
    },

    childrenOf: (containerId) =>
      [...objMap.values()]
        .filter((o) => o.parentId === containerId)
        .map((o) => o.id),

    tell: (s) => { emitted.push(s); },
  };

  return { ctx, emitted, objMap };
}

// ---------------------------------------------------------------------------
// TREASURE-ROOM-FCN — TS-G
// ---------------------------------------------------------------------------

describe('TREASURE-ROOM-FCN', () => {
  it('M-ENTER: does nothing when I-THIEF is disabled', () => {
    const { ctx, emitted } = makeCtx({ iThiefEnabled: false, rarg: M_ENTER });
    expect(treasureRoomFcn(ctx)).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('M-ENTER: does nothing when dead', () => {
    const { ctx, emitted } = makeCtx({ dead: true, rarg: M_ENTER });
    expect(treasureRoomFcn(ctx)).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('M-ENTER: does nothing for non-M-ENTER rarg', () => {
    const { ctx, emitted } = makeCtx({ rarg: 3 /* M_LOOK */ });
    expect(treasureRoomFcn(ctx)).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  describe('TS-G: full defense', () => {
    it('prints scream message when thief is not already here', () => {
      const thief = makeObj('THIEF', 'ELSEWHERE');
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        objs: [thief],
        rarg: M_ENTER,
      });
      treasureRoomFcn(ctx);
      expect(emitted[0]).toMatch(/scream of anguish/);
      expect(emitted[0]).toMatch(/rushes to its defense/);
    });

    it('moves thief to HERE when thief is elsewhere', () => {
      const thief = makeObj('THIEF', 'ELSEWHERE');
      const { ctx, objMap } = makeCtx({
        hereId: 'TREASURE-ROOM',
        objs: [thief],
        rarg: M_ENTER,
      });
      treasureRoomFcn(ctx);
      expect(objMap.get('THIEF')!.parentId).toBe('TREASURE-ROOM');
    });

    it('does not print scream message when thief is already here', () => {
      const thief = makeObj('THIEF', 'TREASURE-ROOM');
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        objs: [thief],
        rarg: M_ENTER,
      });
      treasureRoomFcn(ctx);
      const hasScream = emitted.some((s) => s.includes('scream'));
      expect(hasScream).toBe(false);
    });

    it('sets FIGHTBIT on the thief', () => {
      const thief = makeObj('THIEF', 'TREASURE-ROOM');
      const { ctx, objMap } = makeCtx({
        hereId: 'TREASURE-ROOM',
        objs: [thief],
        rarg: M_ENTER,
      });
      treasureRoomFcn(ctx);
      expect(objMap.get('THIEF')!.flags.has(Flag.Fight)).toBe(true);
    });

    it('clears INVISIBLE on the thief', () => {
      const thief = makeObj('THIEF', 'TREASURE-ROOM', { flags: [Flag.Invisible] });
      const { ctx, objMap } = makeCtx({
        hereId: 'TREASURE-ROOM',
        objs: [thief],
        rarg: M_ENTER,
      });
      treasureRoomFcn(ctx);
      expect(objMap.get('THIEF')!.flags.has(Flag.Invisible)).toBe(false);
    });

    it('returns true (handled) on success', () => {
      const thief = makeObj('THIEF', 'TREASURE-ROOM');
      const { ctx } = makeCtx({
        hereId: 'TREASURE-ROOM',
        objs: [thief],
        rarg: M_ENTER,
      });
      expect(treasureRoomFcn(ctx)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// THIEF-IN-TREASURE — "gestures mysteriously" golden message + invisibility
// ---------------------------------------------------------------------------

describe('THIEF-IN-TREASURE', () => {
  it('hides non-CHALICE/THIEF children when ≥2 children present', () => {
    const thief  = makeObj('THIEF',   'TREASURE-ROOM');
    const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
    const diamond = makeObj('DIAMOND', 'TREASURE-ROOM', { tvalue: 3 });
    const ruby    = makeObj('RUBY',    'TREASURE-ROOM', { tvalue: 4 });
    const { ctx, objMap } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [thief, chalice, diamond, ruby],
    });
    thiefInTreasure(ctx);
    // DIAMOND and RUBY become invisible
    expect(objMap.get('DIAMOND')!.flags.has(Flag.Invisible)).toBe(true);
    expect(objMap.get('RUBY')!.flags.has(Flag.Invisible)).toBe(true);
    // CHALICE and THIEF stay visible
    expect(objMap.get('CHALICE')!.flags.has(Flag.Invisible)).toBe(false);
    expect(objMap.get('THIEF')!.flags.has(Flag.Invisible)).toBe(false);
  });

  it('emits the golden "gestures mysteriously" message (verbatim) when ≥2 children', () => {
    const thief   = makeObj('THIEF',   'TREASURE-ROOM');
    const diamond = makeObj('DIAMOND', 'TREASURE-ROOM', { tvalue: 3 });
    const ruby    = makeObj('RUBY',    'TREASURE-ROOM', { tvalue: 4 });
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [thief, diamond, ruby],
    });
    thiefInTreasure(ctx);
    expect(emitted[0]).toBe(
      'The thief gestures mysteriously, and the treasures in the room\nsuddenly vanish.',
    );
  });

  it('does NOT emit the message when fewer than 2 children', () => {
    const thief = makeObj('THIEF', 'TREASURE-ROOM');
    const { ctx, emitted } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [thief],
    });
    thiefInTreasure(ctx);
    expect(emitted).toHaveLength(0);
  });

  it('hides a solo non-CHALICE/THIEF child even without the message', () => {
    const diamond = makeObj('DIAMOND', 'TREASURE-ROOM', { tvalue: 3 });
    const { ctx, objMap } = makeCtx({
      hereId: 'TREASURE-ROOM',
      objs: [diamond],
    });
    thiefInTreasure(ctx);
    expect(objMap.get('DIAMOND')!.flags.has(Flag.Invisible)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CHALICE-FCN
// ---------------------------------------------------------------------------

describe('CHALICE-FCN', () => {
  describe('TAKE blocked when live thief guards room', () => {
    it('blocks TAKE with "stabbed in the back" message', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const thief   = makeObj('THIEF',   'TREASURE-ROOM', { flags: [Flag.Fight] });
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        verb: 'take',
        prsoId: 'CHALICE',
        objs: [chalice, thief],
      });
      const result = chaliceFcn(ctx);
      expect(result).toBe(true);
      expect(emitted[0]).toBe("You'd be stabbed in the back first.");
    });

    it('does NOT block TAKE when thief is invisible (FSET INVISIBLE)', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const thief   = makeObj('THIEF', 'TREASURE-ROOM', {
        flags: [Flag.Fight, Flag.Invisible],
      });
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        verb: 'take',
        prsoId: 'CHALICE',
        objs: [chalice, thief],
      });
      chaliceFcn(ctx);
      // falls through to DUMB-CONTAINER or returns false (not stabbed message)
      expect(emitted).not.toContain("You'd be stabbed in the back first.");
    });

    it('does NOT block TAKE when thief is KO\'d (unconscious LDESC)', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const thief   = makeObj('THIEF', 'TREASURE-ROOM', {
        flags: [Flag.Fight],
        ldesc: ROBBER_U_DESC,
      });
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        verb: 'take',
        prsoId: 'CHALICE',
        objs: [chalice, thief],
      });
      chaliceFcn(ctx);
      expect(emitted).not.toContain("You'd be stabbed in the back first.");
    });

    it('does NOT block TAKE when thief has no FIGHTBIT', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const thief   = makeObj('THIEF', 'TREASURE-ROOM');  // no FIGHTBIT
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        verb: 'take',
        prsoId: 'CHALICE',
        objs: [chalice, thief],
      });
      chaliceFcn(ctx);
      expect(emitted).not.toContain("You'd be stabbed in the back first.");
    });

    it('does NOT block TAKE when chalice is not in TREASURE-ROOM', () => {
      // PRSO is elsewhere; the guard checks IN?(PRSO, TREASURE-ROOM)
      const chalice = makeObj('CHALICE', 'ELSEWHERE');
      const thief   = makeObj('THIEF', 'TREASURE-ROOM', { flags: [Flag.Fight] });
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        verb: 'take',
        prsoId: 'CHALICE',
        objs: [chalice, thief],
      });
      chaliceFcn(ctx);
      expect(emitted).not.toContain("You'd be stabbed in the back first.");
    });

    it('does NOT block TAKE when thief is not in TREASURE-ROOM', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const thief   = makeObj('THIEF', 'ELSEWHERE', { flags: [Flag.Fight] });
      const { ctx, emitted } = makeCtx({
        hereId: 'TREASURE-ROOM',
        verb: 'take',
        prsoId: 'CHALICE',
        objs: [chalice, thief],
      });
      chaliceFcn(ctx);
      expect(emitted).not.toContain("You'd be stabbed in the back first.");
    });
  });

  describe('PUT into chalice', () => {
    it('prints "not a very good chalice" message', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const { ctx, emitted } = makeCtx({
        verb: 'put',
        prsiId: 'CHALICE',
        objs: [chalice],
      });
      const result = chaliceFcn(ctx);
      expect(result).toBe(true);
      expect(emitted[0]).toBe("You can't. It's not a very good chalice, is it?");
    });
  });

  describe('falls through to DUMB-CONTAINER for other verbs', () => {
    it('OPEN/CLOSE returns the dumb-container message', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM');
      const { ctx, emitted } = makeCtx({
        verb: 'open',
        prsoId: 'CHALICE',
        objs: [chalice],
      });
      chaliceFcn(ctx);
      expect(emitted[0]).toBe("You can't do that.");
    });

    it('EXAMINE returns the dumb-container desc', () => {
      const chalice = makeObj('CHALICE', 'TREASURE-ROOM', { desc: 'chalice' });
      const { ctx, emitted } = makeCtx({
        verb: 'examine',
        prsoId: 'CHALICE',
        objs: [chalice],
      });
      chaliceFcn(ctx);
      expect(emitted[0]).toBe('It looks pretty much like a chalice.');
    });
  });
});

// ---------------------------------------------------------------------------
// STILETTO-FUNCTION (via WEAPON-FUNCTION)
// ---------------------------------------------------------------------------

describe('STILETTO-FUNCTION', () => {
  it('no-ops when thief is not in HERE', () => {
    const stiletto = makeObj('STILETTO', 'THIEF', { desc: 'stiletto' });
    const thief    = makeObj('THIEF', 'ELSEWHERE');
    const { ctx, emitted } = makeCtx({
      hereId: 'HERE',
      verb: 'take',
      prsoId: 'STILETTO',
      objs: [stiletto, thief],
    });
    expect(stilettoFunction(ctx)).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('TAKE with stiletto in thief: "swings it out of your reach"', () => {
    const stiletto = makeObj('STILETTO', 'THIEF', { desc: 'stiletto' });
    const thief    = makeObj('THIEF', 'HERE');
    const { ctx, emitted } = makeCtx({
      hereId: 'HERE',
      verb: 'take',
      prsoId: 'STILETTO',
      objs: [stiletto, thief],
    });
    const result = stilettoFunction(ctx);
    expect(result).toBe(true);
    expect(emitted[0]).toBe('The thief swings it out of your reach.');
  });

  it('TAKE with stiletto not in thief: "white-hot, can\'t hold on"', () => {
    // Stiletto is on the floor — not with THIEF
    const stiletto = makeObj('STILETTO', 'HERE', { desc: 'stiletto' });
    const thief    = makeObj('THIEF', 'HERE');
    const { ctx, emitted } = makeCtx({
      hereId: 'HERE',
      verb: 'take',
      prsoId: 'STILETTO',
      objs: [stiletto, thief],
    });
    const result = stilettoFunction(ctx);
    expect(result).toBe(true);
    expect(emitted[0]).toBe("The stiletto seems white-hot. You can't hold on to it.");
  });

  it('non-TAKE verb: no-ops', () => {
    const stiletto = makeObj('STILETTO', 'THIEF', { desc: 'stiletto' });
    const thief    = makeObj('THIEF', 'HERE');
    const { ctx, emitted } = makeCtx({
      hereId: 'HERE',
      verb: 'drop',
      prsoId: 'STILETTO',
      objs: [stiletto, thief],
    });
    expect(stilettoFunction(ctx)).toBe(false);
    expect(emitted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// LARGE-BAG-F
// ---------------------------------------------------------------------------

describe('LARGE-BAG-F', () => {
  it('TAKE while thief is KO\'d: "collapsed on the bag"', () => {
    const bag   = makeObj('LARGE-BAG', 'THIEF');
    const thief = makeObj('THIEF', 'HERE', { ldesc: ROBBER_U_DESC });
    const { ctx, emitted } = makeCtx({
      verb: 'take',
      prsoId: 'LARGE-BAG',
      objs: [bag, thief],
    });
    expect(largeBagF(ctx)).toBe(true);
    expect(emitted[0]).toBe(
      'Sadly for you, the robber collapsed on top of the bag. Trying to take\nit would wake him.',
    );
  });

  it('TAKE while thief is alive: "over his dead body"', () => {
    const bag   = makeObj('LARGE-BAG', 'THIEF');
    const thief = makeObj('THIEF', 'HERE');  // no unconscious LDESC
    const { ctx, emitted } = makeCtx({
      verb: 'take',
      prsoId: 'LARGE-BAG',
      objs: [bag, thief],
    });
    expect(largeBagF(ctx)).toBe(true);
    expect(emitted[0]).toBe('The bag will be taken over his dead body.');
  });

  it('PUT into LARGE-BAG: "good trick"', () => {
    const bag = makeObj('LARGE-BAG', 'THIEF');
    const { ctx, emitted } = makeCtx({
      verb: 'put',
      prsiId: 'LARGE-BAG',
      objs: [bag],
    });
    expect(largeBagF(ctx)).toBe(true);
    expect(emitted[0]).toBe('It would be a good trick.');
  });

  it('OPEN/CLOSE: "getting close enough"', () => {
    for (const verb of ['open', 'close']) {
      const { ctx, emitted } = makeCtx({ verb });
      expect(largeBagF(ctx)).toBe(true);
      expect(emitted[0]).toBe('Getting close enough would be a good trick.');
    }
  });

  it('EXAMINE/LOOK-INSIDE: "underneath the thief"', () => {
    for (const verb of ['examine', 'look-inside']) {
      const { ctx, emitted } = makeCtx({ verb });
      expect(largeBagF(ctx)).toBe(true);
      expect(emitted[0]).toBe(
        "The bag is underneath the thief, so one can't say what, if anything, is\ninside.",
      );
    }
  });

  it('other verbs: returns false', () => {
    const { ctx } = makeCtx({ verb: 'listen' });
    expect(largeBagF(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DUMB-CONTAINER (standalone; also used as CHALICE-FCN fallthrough)
// ---------------------------------------------------------------------------

describe('DUMB-CONTAINER', () => {
  it('OPEN/CLOSE/LOOK-INSIDE: "You can\'t do that."', () => {
    for (const verb of ['open', 'close', 'look-inside']) {
      const { ctx, emitted } = makeCtx({ verb });
      expect(dumbContainer(ctx)).toBe(true);
      expect(emitted[0]).toBe("You can't do that.");
    }
  });

  it('EXAMINE: "It looks pretty much like a <desc>."', () => {
    const item = makeObj('CHALICE', 'HERE', { desc: 'chalice' });
    const { ctx, emitted } = makeCtx({
      verb: 'examine',
      prsoId: 'CHALICE',
      objs: [item],
    });
    expect(dumbContainer(ctx)).toBe(true);
    expect(emitted[0]).toBe('It looks pretty much like a chalice.');
  });

  it('other verbs: returns false', () => {
    const { ctx } = makeCtx({ verb: 'take' });
    expect(dumbContainer(ctx)).toBe(false);
  });
});
