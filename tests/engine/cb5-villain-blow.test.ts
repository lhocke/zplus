/**
 * CB5 — VILLAIN-BLOW + WINNER-RESULT + verbTake LOAD-ALLOWED check
 * (spec §6.1, §6.2, §12 CB5)
 *
 * Done-criteria:
 *   - NM-4: -10000 dead sentinel on DEF==0
 *   - NM-8: player UNCONSCIOUS result does NOT change pStrength in villainBlow
 *   - I-CURE queued when net damage (DEF - OD < 0)
 *   - Test D: forced KILLED → pStrength=-10000 → fightStrength()<=0 → jigsUp fires
 *   - verbTake LOAD-ALLOWED consultation (B1 faithful coupling)
 *
 * ZIL refs:
 *   1actions.zil:3413–3474  VILLAIN-BLOW
 *   1actions.zil:3552–3564  WINNER-RESULT
 *   gglobals.zil:94,92      LOAD-ALLOWED / LOAD-MAX (both init 100)
 *   gverbs.zil:1932–1940    verbTake LOAD-ALLOWED gate
 */

import { describe, it, expect } from 'vitest';
import {
  villainBlow, winnerResult,
  fightStrength,
  CURE_WAIT,
} from '../../src/engine/combat.js';
import { executeVerb } from '../../src/engine/verbs/index.js';
import { ScriptedRng } from '../helpers/scripted-rng.js';
import type { VillainEntry } from '../../src/domain/villain-entry.js';
import { GameObject } from '../../src/domain/game-object.js';
import { Room } from '../../src/domain/room.js';
import { Flag } from '../../src/domain/flags.js';
import type { World } from '../../src/domain/world.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVillainEntry(opts: {
  vMsgs?: readonly unknown[];
  vBest?: string | null;
  vBestAdv?: number;
} = {}): VillainEntry {
  return {
    vBest: opts.vBest ?? null,
    vBestAdv: opts.vBestAdv ?? 0,
    vProb: 0,
    vMsgs: opts.vMsgs ?? [],
    action: () => false,
  };
}

// 9-slot dummy MELEE table — one variant per slot, plain string tokens
function dummyMsgs(): readonly unknown[] {
  return [
    [1, [1, 'missed']],
    [1, [1, 'knocked out']],
    [1, [1, 'killed']],
    [1, [1, 'light wound']],
    [1, [1, 'serious wound']],
    [1, [1, 'stagger']],
    [1, [1, 'lose weapon']],
    [1, [1, 'hesitate']],
    [1, [1, 'sitting duck']],
  ];
}

// ---------------------------------------------------------------------------
// Callback bundle for winnerResult / villainBlow
// ---------------------------------------------------------------------------

interface CbState {
  playerPStrength: number;
  loadAllowed: number;
  loadMax: number;
  score: number;
  lucky: boolean;
  emitted: string[];
  jigsUpCalled: boolean;
  jigsUpMsg: string;
  icureCalled: boolean;
  icurePeriod: number;
  staggeredSet: boolean;
  staggeredCleared: boolean;
  playerWeaponId: string | null;
  playerWeaponDropped: boolean;
  villainStaggered: boolean;
}

function makeCbState(overrides: Partial<CbState> = {}): CbState {
  return {
    playerPStrength: 0,
    loadAllowed: 100,
    loadMax: 100,
    score: 0,
    lucky: true,
    emitted: [],
    jigsUpCalled: false,
    jigsUpMsg: '',
    icureCalled: false,
    icurePeriod: 0,
    staggeredSet: false,
    staggeredCleared: false,
    playerWeaponId: 'SWORD',
    playerWeaponDropped: false,
    villainStaggered: false,
    ...overrides,
  };
}

// The callback object that winnerResult / villainBlow accept.
// We use a plain object to keep the tests independent of any class.
function makeCbs(s: CbState) {
  return {
    getPlayerPStrength: () => s.playerPStrength,
    setPlayerPStrength: (v: number) => { s.playerPStrength = v; },
    getLoadAllowed: () => s.loadAllowed,
    setLoadAllowed: (v: number) => { s.loadAllowed = v; },
    getLoadMax: () => s.loadMax,
    getLucky: () => s.lucky,
    getScore: () => s.score,
    findPlayerWeapon: () => s.playerWeaponId,
    findPlayerWeaponDesc: () => s.playerWeaponId,
    dropPlayerWeapon: (_id: string) => {
      s.playerWeaponDropped = true;
      s.playerWeaponId = null;
    },
    getVillainStaggered: () => s.villainStaggered,
    clearVillainStaggered: () => { s.villainStaggered = false; s.staggeredCleared = true; },
    setPlayerStaggered: () => { s.staggeredSet = true; },
    clearPlayerStaggered: () => { s.staggeredCleared = true; },
    emit: (t: string) => { s.emitted.push(t); },
    jigsUp: (msg: string) => { s.jigsUpCalled = true; s.jigsUpMsg = msg; },
    queueICure: (period: number) => { s.icureCalled = true; s.icurePeriod = period; },
  };
}

// ---------------------------------------------------------------------------
// 1. winnerResult — NM-4: -10000 dead sentinel (spec §6.2)
// ---------------------------------------------------------------------------

describe('winnerResult — NM-4: -10000 dead sentinel (spec §6.2)', () => {
  it('DEF==0 → sentinel triggers kill path, final pStrength = 1-base (score=0 → -1)', () => {
    // -10000 is set first (NM-4), then overwritten by the pStrength nudge.
    // score=0 → base=2 → final pStrength = 1-base = -1.
    const s = makeCbState({ score: 0 });
    winnerResult(0, 2, makeCbs(s));
    expect(s.playerPStrength).toBe(-1);
  });

  it('-10000 sentinel drives fightStrength deeply negative', () => {
    // score=0 → base=2; 2 + (-10000) = -9998
    expect(fightStrength(true, 0, -10000)).toBeLessThan(0);
  });

  it('DEF>0 → pStrength = DEF - OD (not -10000)', () => {
    const s = makeCbState();
    winnerResult(3, 2, makeCbs(s));
    expect(s.playerPStrength).toBe(1);   // 3 - 2
  });

  it('DEF - OD negative → pStrength negative (wounded)', () => {
    const s = makeCbState();
    winnerResult(2, 3, makeCbs(s));
    expect(s.playerPStrength).toBe(-1);  // 2 - 3
  });
});

// ---------------------------------------------------------------------------
// 2. winnerResult — I-CURE queued on net damage (spec §6.2)
// ---------------------------------------------------------------------------

describe('winnerResult — I-CURE queue on net damage', () => {
  it('DEF - OD < 0 → queueICure(CURE_WAIT)', () => {
    const s = makeCbState();
    winnerResult(2, 3, makeCbs(s));  // 2-3=-1 < 0
    expect(s.icureCalled).toBe(true);
    expect(s.icurePeriod).toBe(CURE_WAIT);
  });

  it('DEF - OD >= 0 → no I-CURE queued', () => {
    const s = makeCbState();
    winnerResult(3, 2, makeCbs(s));  // 3-2=1 >= 0
    expect(s.icureCalled).toBe(false);
  });

  it('DEF==0, OD>0 → I-CURE queued (DEF-OD = -OD < 0, no DEF!=0 guard)', () => {
    // ZIL: <L? <- .DEF .OD> 0> = (0-2)<0 = true → queue I-CURE
    // 1actions.zil:3556
    const s = makeCbState();
    winnerResult(0, 2, makeCbs(s));
    expect(s.icureCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Test D — killing-blow → jigsUp chain (spec §11.3 test D)
// ---------------------------------------------------------------------------

describe('Test D — killing-blow chain: DEF==0 → pStrength=-10000 → nudge → jigsUp (spec §11.3)', () => {
  it('DEF==0 → -10000 sentinel set, then nudged to 1-base, jigsUp fires', () => {
    // ZIL: pStrength = -10000, then <PUTP WINNER P?STRENGTH 1-base>.
    // score=0 → base=2 → final pStrength = 1-2 = -1
    const s = makeCbState({ score: 0 });
    winnerResult(0, 2, makeCbs(s));
    expect(s.playerPStrength).toBe(-1);  // nudged from -10000 to 1-base
    expect(s.jigsUpCalled).toBe(true);
  });

  it('jigsUp message is byte-exact ZIL text (1actions.zil:3561-3562)', () => {
    // ZIL: "It appears that that last blow was too much for you. I'm afraid you\nare dead."
    const s = makeCbState();
    winnerResult(0, 2, makeCbs(s));
    expect(s.jigsUpMsg).toBe(
      "It appears that that last blow was too much for you. I'm afraid you\nare dead.",
    );
  });

  it('killing blow: pStrength nudged to 1-base before jigsUp (1actions.zil:3559)', () => {
    // ZIL: <PUTP ,WINNER ,P?STRENGTH <+ 1 <- <FIGHT-STRENGTH <>>>>
    //      = 1 + (-base) = 1 - base
    // score=0 → base=2; nudged pStrength = 1 - 2 = -1
    const s = makeCbState({ score: 0 });
    winnerResult(0, 2, makeCbs(s));
    // pStrength starts at -10000 (NM-4), then nudged to 1-base = -1
    expect(s.playerPStrength).toBe(-1);
  });

  it('non-lethal wound (fightStrength > 0): jigsUp NOT called', () => {
    // score=0 → base=2; DEF=3, OD=2 → pStrength=1; fightStrength(true,0,1)=3 > 0
    const s = makeCbState({ score: 0 });
    winnerResult(3, 2, makeCbs(s));
    expect(s.jigsUpCalled).toBe(false);
  });

  it('wound driving fightStrength to zero fires jigsUp', () => {
    // score=0 → base=2; DEF=2, OD=4 → pStrength=-2; fightStrength(true,0,-2)=0 ≤ 0
    const s = makeCbState({ score: 0 });
    winnerResult(2, 4, makeCbs(s));
    expect(s.jigsUpCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. NM-8 — UNCONSCIOUS does NOT change player pStrength in villainBlow
//    spec §6.1 step 6: "UNCONSCIOUS: NO pStrength change here (DO-FIGHT loop handles it)"
// ---------------------------------------------------------------------------

describe('NM-8 — UNCONSCIOUS in villainBlow leaves player pStrength unchanged', () => {
  it('UNCONSCIOUS roll: pStrength stays at 0 (DO-FIGHT handles out counter)', () => {
    // villain ATT=2, player DEF=2 → DEF2_RES[1] = DEF2B@0
    // DEF2B = [M,M,M,S,S,L,L,L,U,K,K,K]; nextInt(9)=8 → index 8 = UNCONSCIOUS
    const s = makeCbState({ score: 0, playerPStrength: 0 });
    const rng = new ScriptedRng([8 / 9 + 0.001]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow(
      'TROLL', 2, entry,
      false,         // thiefEngrossed
      null, false,   // prsiId, prsiIsWeapon
      0,             // out counter
      s.score,
      rng,
      makeCbs(s),
    );

    expect(s.playerPStrength).toBe(0);  // NM-8: unchanged
  });
});

// ---------------------------------------------------------------------------
// 5. villainBlow — LIGHT_WOUND applies encumbrance (spec §6.1 B1)
//    if LOAD_ALLOWED > 50: LOAD_ALLOWED -= 10
// ---------------------------------------------------------------------------

describe('villainBlow — LIGHT_WOUND encumbrance (spec §6.1 B1)', () => {
  // villain ATT=2, player DEF=2 → DEF2B@0; nextInt(9)=5 → DEF2B[5]=LIGHT_WOUND ✓
  // DEF2B = [M,M,M,S,S,L,L,L,U,K,K,K]

  it('LOAD_ALLOWED=100 → 90 on LIGHT_WOUND', () => {
    const s = makeCbState({ score: 0, loadAllowed: 100 });
    const rng = new ScriptedRng([5 / 9 + 0.001]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow('TROLL', 2, entry, false, null, false, 0, s.score, rng, makeCbs(s));

    expect(s.loadAllowed).toBe(90);
  });

  it('LOAD_ALLOWED=50 → unchanged (guard: >50 required)', () => {
    const s = makeCbState({ score: 0, loadAllowed: 50 });
    const rng = new ScriptedRng([5 / 9 + 0.001]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow('TROLL', 2, entry, false, null, false, 0, s.score, rng, makeCbs(s));

    expect(s.loadAllowed).toBe(50);  // unchanged
  });
});

// ---------------------------------------------------------------------------
// 6. villainBlow — SERIOUS_WOUND reduces LOAD_ALLOWED by 20 (spec §6.1)
//    if LOAD_ALLOWED > 50: LOAD_ALLOWED -= 20
// ---------------------------------------------------------------------------

describe('villainBlow — SERIOUS_WOUND encumbrance (spec §6.1)', () => {
  // villain ATT=2, player DEF=3 (pStrength=1 → fightStrength(true,0,1)=3)
  // DEF>=3: net = ATT-DEF = 2-3 = -1 → DEF3_RES[-1+2=1] = DEF3A@1
  // DEF3A = [M,M,M,M,M,S,S,L,L,SW,SW]; from offset 1: [M,M,M,M,S,S,L,L,SW] (9 elems)
  // nextInt(9)=8 → DEF3A[1+8]=DEF3A[9]=SERIOUS_WOUND ✓

  it('LOAD_ALLOWED=100 → 80 on SERIOUS_WOUND', () => {
    const s = makeCbState({ score: 0, loadAllowed: 100, playerPStrength: 1 });
    const rng = new ScriptedRng([8 / 9 + 0.001]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow('TROLL', 2, entry, false, null, false, 0, s.score, rng, makeCbs(s));

    expect(s.loadAllowed).toBe(80);  // 100 - 20
  });
});

// ---------------------------------------------------------------------------
// 7. villainBlow — STAGGER sets player STAGGERED flag (spec §6.1 step 6)
// ---------------------------------------------------------------------------

describe('villainBlow — STAGGER sets player staggered flag', () => {
  // villain ATT=2, player DEF=2 → DEF2B@0; nextInt(9)=3 → DEF2B[3]=STAGGER ✓

  it('STAGGER result → setPlayerStaggered() called', () => {
    const s = makeCbState({ score: 0 });
    const rng = new ScriptedRng([3 / 9 + 0.001]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow('TROLL', 2, entry, false, null, false, 0, s.score, rng, makeCbs(s));

    expect(s.staggeredSet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. villainBlow — staggered villain loses turn (spec §6.1 step 2)
// ---------------------------------------------------------------------------

describe('villainBlow — staggered villain skips blow (spec §6.1 step 2)', () => {
  it('villain staggered: emits recovery message, clears villain stagger, no damage', () => {
    const s = makeCbState({ score: 0, villainStaggered: true });
    const rng = new ScriptedRng([0.5]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow('TROLL', 2, entry, false, null, false, 0, s.score, rng, makeCbs(s));

    expect(s.staggeredCleared).toBe(true);
    expect(s.playerPStrength).toBe(0);  // no damage
    expect(s.emitted.some(e => e.includes('regains'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. villainBlow — out? converts STAGGER→HESITATE (spec §6.1 step 5)
// ---------------------------------------------------------------------------

describe('villainBlow — out? flag: STAGGER becomes HESITATE (spec §6.1 step 5)', () => {
  it('out=1: STAGGER roll → HESITATE: no stagger set, no damage', () => {
    const s = makeCbState({ score: 0 });
    const rng = new ScriptedRng([3 / 9 + 0.001]);
    const entry = makeVillainEntry({ vMsgs: dummyMsgs() });

    villainBlow('TROLL', 2, entry, false, null, false, 1 /*out*/, s.score, rng, makeCbs(s));

    expect(s.staggeredSet).toBe(false);  // HESITATE → no stagger
    expect(s.playerPStrength).toBe(0);   // HESITATE → no damage
  });
});

// ---------------------------------------------------------------------------
// 10. verbTake — LOAD-ALLOWED gate (B1, gverbs.zil:1932–1940)
// ---------------------------------------------------------------------------

function makeTestRoom(id = 'TEST-ROOM'): Room {
  return new Room(id, 'Test Room');
}

function makeTestPlayer(): GameObject {
  return new GameObject('PLAYER', 'player');
}

function makeTestItem(id: string, sizeVal: number): GameObject {
  const o = new GameObject(id, id);
  o.set(Flag.Takeable);
  o.props.set('SIZE', sizeVal);
  return o;
}

const mockWorld = { get: () => undefined, all: () => [] } as unknown as World;

describe('verbTake — LOAD-ALLOWED gate (spec B1, gverbs.zil:1932–1940)', () => {
  it('take succeeds when item+player weight ≤ loadAllowed', () => {
    const player = makeTestPlayer();
    const room = makeTestRoom();
    const item = makeTestItem('SMALL', 5);
    item.moveTo(room);

    const r = executeVerb({
      verb: 'take',
      dobj: item,
      player,
      here: room,
      world: mockWorld,
      loadAllowed: 100,
      loadMax: 100,
    }, 'V-TAKE');

    expect(r.output).toBe('Taken.');
    expect(r.fatal).toBeFalsy();
  });

  it('take blocked when item+player weight > loadAllowed', () => {
    const player = makeTestPlayer();
    const held = makeTestItem('HEAVY', 90);
    held.moveTo(player);  // player carries SIZE=90
    const room = makeTestRoom();
    const item = makeTestItem('ITEM', 20);  // total 90+20=110 > 100
    item.moveTo(room);

    const r = executeVerb({
      verb: 'take',
      dobj: item,
      player,
      here: room,
      world: mockWorld,
      loadAllowed: 100,
      loadMax: 100,
    }, 'V-TAKE');

    expect(r.output).toContain('Your load is too heavy');
    expect(r.fatal).toBe(true);
  });

  it('condition note appended when loadAllowed < loadMax (wounded)', () => {
    // gverbs.zil:1935: "especially in light of your condition."
    const player = makeTestPlayer();
    const held = makeTestItem('HEAVY', 90);
    held.moveTo(player);
    const room = makeTestRoom();
    const item = makeTestItem('ITEM', 20);
    item.moveTo(room);

    const r = executeVerb({
      verb: 'take',
      dobj: item,
      player,
      here: room,
      world: mockWorld,
      loadAllowed: 80,   // < 100 → wounded
      loadMax: 100,
    }, 'V-TAKE');

    expect(r.output).toContain('especially in light of your condition');
  });

  it('plain period appended when loadAllowed == loadMax (unwounded)', () => {
    const player = makeTestPlayer();
    const held = makeTestItem('HEAVY', 90);
    held.moveTo(player);
    const room = makeTestRoom();
    const item = makeTestItem('ITEM', 20);
    item.moveTo(room);

    const r = executeVerb({
      verb: 'take',
      dobj: item,
      player,
      here: room,
      world: mockWorld,
      loadAllowed: 100,
      loadMax: 100,
    }, 'V-TAKE');

    expect(r.output).not.toContain('especially in light of your condition');
    expect(r.output).toContain('Your load is too heavy');
  });

  it('take succeeds when exactly at loadAllowed', () => {
    const player = makeTestPlayer();
    const held = makeTestItem('HELD', 45);
    held.moveTo(player);  // player weight = 5 (player SIZE default) + 45 = 50
    const room = makeTestRoom();
    const item = makeTestItem('NEW', 50);  // 50+50=100 ≤ 100 → allowed
    item.moveTo(room);

    const r = executeVerb({
      verb: 'take',
      dobj: item,
      player,
      here: room,
      world: mockWorld,
      loadAllowed: 100,
      loadMax: 100,
    }, 'V-TAKE');

    expect(r.output).toBe('Taken.');
  });

  it('item inside held container skips load check (grandparent==player, gverbs.zil:1931)', () => {
    // ZIL: <NOT <IN? <LOC ,PRSO> ,WINNER>> — grandparent check.
    // If parent(parent(item)) == player, the load gate does NOT fire.
    const player = makeTestPlayer();
    // The player carries a container (sack, SIZE=5) plus other heavy stuff
    const sack = makeTestItem('SACK', 5);
    sack.moveTo(player);
    const heavyOther = makeTestItem('HEAVY', 95);
    heavyOther.moveTo(player);  // total carried weight already = 5+95=100
    const room = makeTestRoom();
    const item = makeTestItem('GARLIC', 5);
    item.moveTo(sack);  // item inside held container → grandparent = player

    // With loadAllowed=100, weight(player) includes sack+children=100, so
    // item(5)+player(100)=105 > 100.  But because grandparent==player, ZIL skips
    // the load gate and the take succeeds.
    const r = executeVerb({
      verb: 'take',
      dobj: item,
      player,
      here: room,
      world: mockWorld,
      loadAllowed: 100,
      loadMax: 100,
    }, 'V-TAKE');

    expect(r.output).toBe('Taken.');
  });
});
