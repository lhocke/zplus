/**
 * C7 — Orphan + WHICH-PRINT + ORPHAN-MERGE tests.
 *
 * Red→Green TDD for:
 *   1. ORPHAN prompt: "What do you want to <verb>?" when GWIM finds 0 or 2+ objects
 *      for a bare transitive verb (gparser.zil:756–774)
 *   2. ORPHAN prompt with prep: "What do you want to <verb> <prep>?"
 *   3. WHICH-PRINT: "Which <noun> do you mean, the A, the B, or the C?"
 *      Oxford comma for 3+; no comma for exactly 2 (gparser.zil:1146–1166)
 *   4. ORPHAN-MERGE: answer on the next turn fills the missing slot
 *      - bare noun fills missing dobj
 *      - adjective disambiguates from candidates
 *      - compatible prep is accepted
 *   5. Non-fitting answer (fresh verb) abandons the orphan and re-parses
 *
 * Verbatim messages from §17 of td1-parser-algorithm.md:
 *   "What do you want to <verb>?"
 *   "What do you want to <verb> <prep>?"
 *   "Which <noun> do you mean, the A or the B?"   (2-item, no Oxford comma)
 *   "Which <noun> do you mean, the A, the B, or the C?"  (3+, Oxford comma)
 *
 * Oracle: gparser.zil:756–774 (ORPHAN), 1146–1166 (WHICH-PRINT),
 *         543–630 (ORPHAN-MERGE).
 */

import { describe, it, expect } from 'vitest';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import { World } from '../../src/domain/world.js';
import { Parser } from '../../src/engine/parser/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoom(id: string, desc: string, light = true): Room {
  const r = new Room(id, desc);
  if (light) r.set(Flag.On);
  return r;
}

function makeThing(
  id: string,
  desc: string,
  synonyms: string[],
  adjectives: string[] = [],
  flags: Flag[] = [],
): Thing {
  const t = new Thing(id, desc, { synonyms, adjectives });
  for (const f of flags) t.set(f);
  return t;
}

function makeActor(id: string, synonyms: string[] = []): Actor {
  return new Actor(id, 'actor', { synonyms });
}

// ---------------------------------------------------------------------------
// §1. ORPHAN prompt — bare transitive verb with no objects in scope
// ---------------------------------------------------------------------------

describe('C7 — ORPHAN prompt: bare transitive verb', () => {
  it('"take" with no objects in room → "What do you want to take?" orphan', () => {
    // EAT has dobjLocBits=248 (SH|SC|SIR|SOG|STAKE) and requires a food object.
    // With no food objects in the room, GWIM finds 0 candidates → orphan.
    // But "take" is simpler: TAKE needs 1 object; if 0 nouns typed and no GWIM
    // candidate → orphan (verb is transitive, player typed bare verb).
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    // Empty room — no takeable objects
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    const result = parser.parse('take', room, player, world);
    expect(result.kind).toBe('orphan');
    if (result.kind === 'orphan') {
      expect(result.message).toBe('What do you want to take?');
    }
  });

  it('"eat" with no food in room → "What do you want to eat?" orphan', () => {
    // EAT OBJECT (FIND FOODBIT) — with no FOODBIT objects in scope, GWIM fails
    // → orphan prompt with the verb word
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    // No food items
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    const result = parser.parse('eat', room, player, world);
    expect(result.kind).toBe('orphan');
    if (result.kind === 'orphan') {
      expect(result.message).toBe('What do you want to eat?');
    }
  });

  it('"listen" → orphan prompt (LISTEN has no 0-obj form → drive1 fires)', () => {
    // LISTEN has two forms: LISTEN TO OBJECT (declared first) and LISTEN FOR OBJECT.
    // SYNTAX-CHECK first-wins for DRIVE1: first qualifying form wins = LISTEN TO.
    // GWIM will find 0 or 2+ objects → orphan with prep = TO.
    // Oracle: dfrotz (zork1.z3) > listen => "What do you want to listen to?"
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    const result = parser.parse('listen', room, player, world);
    expect(result.kind).toBe('orphan');
    if (result.kind === 'orphan') {
      // First-wins DRIVE1 = LISTEN TO form → prep = "to"
      expect(result.message).toBe('What do you want to listen to?');
    }
  });
});

// ---------------------------------------------------------------------------
// §2. ORPHAN-MERGE — answer fills missing dobj slot
// ---------------------------------------------------------------------------

describe('C7 — ORPHAN-MERGE: bare noun fills missing dobj', () => {
  it('"take" with 2+ items in room → orphan; then "lamp" → take executes on the lamp', () => {
    // With 2+ takeable objects in room, GWIM(locBits=52) finds 2 → ambiguous → fails.
    // GWIM fail with ncn=0 → orphan "What do you want to take?"
    // Answer "lamp" → ORPHAN-MERGE resolves unambiguously → ok take lamp.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN', 'LIGHT'], ['BRASS'], [Flag.Takeable]);
    lamp.moveTo(room);
    const scroll = makeThing('SCROLL', 'old scroll', ['SCROLL', 'PARCHMENT'], ['OLD'], [Flag.Takeable]);
    scroll.moveTo(room);
    const world = World.fromObjects([room, player, lamp, scroll]);
    const parser = new Parser();

    // Turn 1: bare "take" with 2 items → GWIM ambiguous → orphan
    const r1 = parser.parse('take', room, player, world);
    expect(r1.kind).toBe('orphan');
    if (r1.kind === 'orphan') {
      expect(r1.message).toBe('What do you want to take?');
    }

    // Turn 2: answer "lamp" → ORPHAN-MERGE resolves to take lamp
    const r2 = parser.parse('lamp', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.verb).toBe('take');
      expect(r2.command.action).toBe('V-TAKE');
      expect(r2.command.dobjIds).toContain('LAMP');
    }
  });

  it('"take" orphan clears after successful merge', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const lamp = makeThing('LAMP', 'brass lantern', ['LAMP', 'LANTERN', 'LIGHT'], ['BRASS'], [Flag.Takeable]);
    lamp.moveTo(room);
    const scroll = makeThing('SCROLL', 'old scroll', ['SCROLL', 'PARCHMENT'], ['OLD'], [Flag.Takeable]);
    scroll.moveTo(room);
    const world = World.fromObjects([room, player, lamp, scroll]);
    const parser = new Parser();

    // Turn 1: orphan (2 items → GWIM fail)
    parser.parse('take', room, player, world);
    // Turn 2: merge answer "lamp"
    const r2 = parser.parse('lamp', room, player, world);
    expect(r2.kind).toBe('ok');

    // Turn 3: fresh command (orphan state should be cleared)
    const r3 = parser.parse('look', room, player, world);
    expect(r3.kind).toBe('ok');
    if (r3.kind === 'ok') {
      expect(r3.command.verb).toBe('look');
    }
  });

  it('"eat" orphan (no food in room), fresh verb answer → abandons orphan and re-parses new command', () => {
    // ZIL behavior: a non-fitting answer (a fresh verb) abandons the orphan.
    // In this case "look" is a fresh command and should be re-parsed from scratch.
    // Use EAT (FOODBIT filter) with no food in room → 0 GWIM candidates → orphan.
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    // Turn 1: orphan (EAT needs FOODBIT object; none in scope → GWIM fail)
    const r1 = parser.parse('eat', room, player, world);
    expect(r1.kind).toBe('orphan');

    // Turn 2: answer is a fresh verb "look" → abandon orphan, execute look
    const r2 = parser.parse('look', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.verb).toBe('look');
    }
  });
});

// ---------------------------------------------------------------------------
// §3. WHICH-PRINT — disambiguation message format
// ---------------------------------------------------------------------------

describe('C7 — WHICH-PRINT: disambiguation message format', () => {
  it('2-item list: "Which sword do you mean, the rusty sword or the elvish sword?"', () => {
    // Two swords with same synonym "sword" → disambiguation needed
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const rusty = makeThing('RUSTY-SWORD', 'rusty sword', ['SWORD'], ['RUSTY'], [Flag.Weapon, Flag.Takeable]);
    rusty.moveTo(room);
    const elvish = makeThing('ELVISH-SWORD', 'elvish sword', ['SWORD'], ['ELVISH'], [Flag.Weapon, Flag.Takeable]);
    elvish.moveTo(room);
    const world = World.fromObjects([room, player, rusty, elvish]);
    const parser = new Parser();

    const result = parser.parse('take sword', room, player, world);
    // With 2 candidates, should produce disambig result
    expect(result.kind).toBe('disambig');
    if (result.kind === 'disambig') {
      // 2-item: no Oxford comma, just "or"
      expect(result.message).toMatch(/^Which sword do you mean, the (rusty|elvish) sword or the (rusty|elvish) sword\?$/);
      // Both should appear
      expect(result.message).toContain('rusty sword');
      expect(result.message).toContain('elvish sword');
      // Should NOT have "," before "or" (no Oxford comma for 2-item list)
      expect(result.message).not.toMatch(/, or/);
    }
  });

  it('3-item list uses Oxford comma: "Which X do you mean, the A, the B, or the C?"', () => {
    // Three objects with same synonym → 3-item Oxford comma
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const a = makeThing('COIN-A', 'gold coin', ['COIN'], ['GOLD'], [Flag.Takeable]);
    a.moveTo(room);
    const b = makeThing('COIN-B', 'silver coin', ['COIN'], ['SILVER'], [Flag.Takeable]);
    b.moveTo(room);
    const c = makeThing('COIN-C', 'copper coin', ['COIN'], ['COPPER'], [Flag.Takeable]);
    c.moveTo(room);
    const world = World.fromObjects([room, player, a, b, c]);
    const parser = new Parser();

    const result = parser.parse('take coin', room, player, world);
    expect(result.kind).toBe('disambig');
    if (result.kind === 'disambig') {
      // Oxford comma: "the X, the Y, or the Z"
      expect(result.message).toMatch(/, or the/);
      // Starts with "Which coin do you mean, "
      expect(result.message).toMatch(/^Which coin do you mean, /);
      // Ends with "?"
      expect(result.message.endsWith('?')).toBe(true);
      // All three appear
      expect(result.message).toContain('gold coin');
      expect(result.message).toContain('silver coin');
      expect(result.message).toContain('copper coin');
    }
  });

  it('4-item list also uses Oxford comma', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const items = [
      makeThing('ITEM-A', 'red gem', ['GEM'], ['RED'], [Flag.Takeable]),
      makeThing('ITEM-B', 'blue gem', ['GEM'], ['BLUE'], [Flag.Takeable]),
      makeThing('ITEM-C', 'green gem', ['GEM'], ['GREEN'], [Flag.Takeable]),
      makeThing('ITEM-D', 'white gem', ['GEM'], ['WHITE'], [Flag.Takeable]),
    ];
    for (const item of items) item.moveTo(room);
    const world = World.fromObjects([room, player, ...items]);
    const parser = new Parser();

    const result = parser.parse('take gem', room, player, world);
    expect(result.kind).toBe('disambig');
    if (result.kind === 'disambig') {
      // Oxford comma: "the A, the B, the C, or the D"
      expect(result.message).toMatch(/, or the/);
      // Count occurrences of "the" — should be 4 (one per candidate)
      const theCount = (result.message.match(/\bthe\s/g) ?? []).length;
      expect(theCount).toBe(4);
    }
  });
});

// ---------------------------------------------------------------------------
// §4. ORPHAN-MERGE with disambiguation
// ---------------------------------------------------------------------------

describe('C7 — ORPHAN-MERGE: disambiguation answer merges', () => {
  it('disambig "take sword" → "rusty" → takes the rusty sword', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const rusty = makeThing('RUSTY-SWORD', 'rusty sword', ['SWORD'], ['RUSTY'], [Flag.Weapon, Flag.Takeable]);
    rusty.moveTo(room);
    const elvish = makeThing('ELVISH-SWORD', 'elvish sword', ['SWORD'], ['ELVISH'], [Flag.Weapon, Flag.Takeable]);
    elvish.moveTo(room);
    const world = World.fromObjects([room, player, rusty, elvish]);
    const parser = new Parser();

    // Turn 1: disambig
    const r1 = parser.parse('take sword', room, player, world);
    expect(r1.kind).toBe('disambig');

    // Turn 2: disambig answer by adjective "rusty" → takes rusty sword
    const r2 = parser.parse('rusty', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.verb).toBe('take');
      expect(r2.command.dobjIds).toContain('RUSTY-SWORD');
    }
  });

  it('disambig "take sword" → "elvish sword" (full noun phrase) → takes elvish sword', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const rusty = makeThing('RUSTY-SWORD', 'rusty sword', ['SWORD'], ['RUSTY'], [Flag.Weapon, Flag.Takeable]);
    rusty.moveTo(room);
    const elvish = makeThing('ELVISH-SWORD', 'elvish sword', ['SWORD'], ['ELVISH'], [Flag.Weapon, Flag.Takeable]);
    elvish.moveTo(room);
    const world = World.fromObjects([room, player, rusty, elvish]);
    const parser = new Parser();

    // Turn 1: disambig
    parser.parse('take sword', room, player, world);

    // Turn 2: answer with full noun phrase "elvish sword"
    const r2 = parser.parse('elvish sword', room, player, world);
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') {
      expect(r2.command.dobjIds).toContain('ELVISH-SWORD');
    }
  });

  it('disambig cleared after successful answer', () => {
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const rusty = makeThing('RUSTY-SWORD', 'rusty sword', ['SWORD'], ['RUSTY'], [Flag.Weapon, Flag.Takeable]);
    rusty.moveTo(room);
    const elvish = makeThing('ELVISH-SWORD', 'elvish sword', ['SWORD'], ['ELVISH'], [Flag.Weapon, Flag.Takeable]);
    elvish.moveTo(room);
    const world = World.fromObjects([room, player, rusty, elvish]);
    const parser = new Parser();

    parser.parse('take sword', room, player, world);
    parser.parse('rusty', room, player, world);

    // Turn 3: fresh command — no orphan/disambig state
    const r3 = parser.parse('look', room, player, world);
    expect(r3.kind).toBe('ok');
    if (r3.kind === 'ok') {
      expect(r3.command.verb).toBe('look');
    }
  });
});

// ---------------------------------------------------------------------------
// §5. ORPHAN with prep in the prompt
// ---------------------------------------------------------------------------

describe('C7 — ORPHAN prompt includes prep when drive has one', () => {
  it('"listen" → "What do you want to listen to?" (includes the TO prep, first-wins drive1)', () => {
    // LISTEN has two forms: LISTEN TO OBJECT (declared first) and LISTEN FOR OBJECT.
    // First-wins DRIVE1 gives the TO form.
    // Oracle: dfrotz (zork1.z3) > listen => "What do you want to listen to?"
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const world = World.fromObjects([room, player]);
    const parser = new Parser();

    const result = parser.parse('listen', room, player, world);
    expect(result.kind).toBe('orphan');
    if (result.kind === 'orphan') {
      expect(result.message).toBe('What do you want to listen to?');
    }
  });
});

// ---------------------------------------------------------------------------
// §6. Pre-C7 stub behaviors that must flip
// ---------------------------------------------------------------------------

describe('C7 — GWIM-fail paths now produce orphan instead of fallback ok', () => {
  it('"attack troll" with no weapon → orphan prompt (C7 replaces pre-C7 fallback ok)', () => {
    // Pre-C7: "attack troll" with no weapon in scope returned ok with iobj=undefined.
    // C7: GWIM(WEAPONBIT) fails → orphan prompt "What do you want to attack the troll with?"
    const room = makeRoom('ROOM', 'A room');
    const player = makeActor('PLAYER');
    player.moveTo(room);
    const troll = makeActor('TROLL', ['TROLL']);
    troll.set(Flag.Actor);
    troll.moveTo(room);
    // No weapon
    const world = World.fromObjects([room, player, troll]);
    const parser = new Parser();

    const result = parser.parse('attack troll', room, player, world);
    // C7: should be orphan, not ok with missing iobj
    expect(result.kind).toBe('orphan');
    if (result.kind === 'orphan') {
      // DRIVE2: player provided dobj (troll), missing iobj (weapon WITH)
      // "What do you want to attack the troll with?"
      expect(result.message).toContain('attack');
      expect(result.message).toMatch(/with\?$/);
    }
  });
});
