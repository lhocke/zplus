/**
 * golden-commands.ts
 *
 * The 218-command golden walkthrough sequence.  Single source of truth — import
 * this instead of maintaining inline copies (seam.test.ts, gen-walkthrough.mjs).
 *
 * Covers all reachable above-ground rooms, the underground descent, grue death,
 * resurrection, canyon area, and trophy-case scoring.  See walkthrough-master.test.ts
 * for the full annotated room sequence.
 */

export const GOLDEN_COMMANDS: readonly string[] = [
  // ── West of House — opening ─────────────────────────────────────────────
  'look',
  'examine mailbox',
  'open mailbox',
  'take leaflet',
  'read leaflet',
  'close mailbox',
  'examine mailbox',
  'inventory',
  'score',
  'diagnose',
  // ── North of House ────────────────────────────────────────────────────────
  'north',                  // WEST-OF-HOUSE → North of House
  'look',
  'examine house',
  'south',                  // blocked: windows boarded
  // ── East of House (Behind House) ─────────────────────────────────────────
  'west',                   // → West of House
  'north',                  // → North of House
  'east',                   // → East of House (Behind House)
  'look',
  'examine window',
  'open window',            // opens the kitchen window
  'examine window',
  // ── South of House (quick visit) ─────────────────────────────────────────
  'south',                  // East of House → South of House
  'look',
  'examine house',
  'north',                  // blocked: windows boarded
  'east',                   // South of House → East of House
  // ── Enter Kitchen via open window ─────────────────────────────────────────
  'west',                   // East of House → Kitchen
  'look',
  'examine table',
  'examine bottle',
  'take bottle',
  'examine sandwich bag',
  'take sandwich bag',
  'examine chimney',
  'inventory',
  'drop bottle',
  'drop sandwich bag',
  // ── Attic (dark — lit→dark, no grue since Kitchen was lit) ───────────────
  'up',                     // Kitchen → Attic (dark)
  'look',                   // pitch-black
  'down',                   // → Kitchen
  // ── Living Room ───────────────────────────────────────────────────────────
  'west',                   // Kitchen → Living Room
  'look',
  'examine trophy case',
  'examine rug',
  'examine trap door',
  'examine sword',
  'examine door',
  'take sword',             // sword is scenery / not takeable
  'west',                   // blocked: nailed shut
  'take lamp',
  'inventory',
  'score',
  // ── meta-verbs (no clock tick) ────────────────────────────────────────────
  'verbose',
  'brief',
  // ── easter eggs ───────────────────────────────────────────────────────────
  'xyzzy',
  'plugh',
  'frobozz',
  // ── error / edge cases ────────────────────────────────────────────────────
  'zorkify',                // unknown word
  'take',                   // bare take — no object
  'frotz lamp',             // unknown verb
  'examine',                // bare examine — no object
  // ── chained multi-command turns ──────────────────────────────────────────
  'look. score',
  'inventory. diagnose',
  // ── underground descent ───────────────────────────────────────────────────
  'move rug',
  'open trap door',
  'turn on lamp',
  'look',
  'down',                   // Living Room → Cellar (lamp lit, trap door open)
  'look',
  'score',
  'examine ramp',
  // ── Troll Room ────────────────────────────────────────────────────────────
  'north',                  // Cellar → Troll Room
  'look',
  'examine troll',
  'east',                   // blocked: troll fends you off
  'west',                   // blocked: troll fends you off
  'south',                  // → Cellar
  // ── East of Chasm + Gallery + Studio ─────────────────────────────────────
  'south',                  // Cellar → East of Chasm
  'look',
  'examine chasm',
  'east',                   // East of Chasm → Gallery
  'look',
  'examine painting',
  'take painting',          // VALUE=4 scored
  'score',
  'inventory',
  'drop painting',
  'take painting',
  'north',                  // Gallery → Studio
  'look',
  'examine studio',
  'south',                  // → Gallery
  'west',                   // Gallery → East of Chasm
  'examine east of chasm',
  'north',                  // East of Chasm → Cellar
  'look',
  'inventory',
  // ── Troll Room (second visit) ─────────────────────────────────────────────
  'north',                  // Cellar → Troll Room
  'look',
  'south',                  // → Cellar
  // ── GRUE DEATH ────────────────────────────────────────────────────────────
  'turn off lamp',          // lamp off: Cellar is now dark
  'look',                   // pitch-black in Cellar
  'south',                  // CELLAR(dark) → EAST-OF-CHASM(dark) → GRUE → FOREST-1
  // ── Post-resurrection at FOREST-1 ─────────────────────────────────────────
  'look',
  'inventory',              // lamp + painting scattered on death (RANDOMIZE-OBJECTS)
  'diagnose',               // reports "killed once"
  'score',
  'examine forest',
  // ── Forest Path ───────────────────────────────────────────────────────────
  'east',                   // Forest 1 → Forest Path
  'look',
  'examine tree',
  'examine path',
  'up',                     // Forest Path → Up a Tree
  'look',
  'examine view',
  'examine birds',
  'down',                   // → Forest Path
  // ── Grating Clearing ──────────────────────────────────────────────────────
  'north',                  // Forest Path → Grating Clearing
  'look',
  'examine grate',
  'open grate',             // locked: The grating is locked.
  // ── Forest 1 ─────────────────────────────────────────────────────────────
  'south',                  // Grating Clearing → Forest Path
  'west',                   // Forest Path → Forest 1
  'look',
  'north',                  // Forest 1 → Grating Clearing
  'south',                  // → Forest 1
  // ── Forest 3 → South of House ─────────────────────────────────────────────
  'south',                  // Forest 1 → Forest 3
  'look',
  'examine forest',
  'examine trees',
  'north',                  // Forest 3 → Clearing (north exit)
  'look',
  'south',                  // Clearing → Forest 3
  'nw',                     // Forest 3 → South of House
  'look',
  'examine house',
  // ── East of House → Clearing ──────────────────────────────────────────────
  'east',                   // South of House → East of House
  'east',                   // East of House → Clearing
  'look',
  'examine clearing',
  // ── Forest 2 + Mountains ──────────────────────────────────────────────────
  'north',                  // Clearing → Forest 2
  'look',
  'east',                   // Forest 2 → Mountains
  'look',
  'examine mountain',
  'up',                     // blocked: impassable
  'west',                   // Mountains → Forest 2
  'west',                   // Forest 2 → Forest Path
  'north',                  // Forest Path → Grating Clearing
  'west',                   // Grating Clearing → Forest 1
  'east',                   // Forest 1 → Grating Clearing
  'east',                   // Grating Clearing → Forest 2
  'south',                  // Forest 2 → Clearing
  // ── Canyon area ───────────────────────────────────────────────────────────
  'east',                   // Clearing → Canyon View
  'look',
  'examine canyon',
  'examine river',
  'examine view',
  'south',                  // blocked: storm-tossed trees
  'down',                   // Canyon View → Rocky Ledge (CLIFF-MIDDLE)
  'look',
  'examine cliff',
  'examine falls',
  'down',                   // Rocky Ledge → Canyon Bottom
  'look',
  'up',                     // Canyon Bottom → Rocky Ledge
  'down',                   // Rocky Ledge → Canyon Bottom
  'north',                  // Canyon Bottom → End of Rainbow
  'look',
  'examine rainbow',
  'examine beach',
  'examine falls',
  'ne',                     // → On Rainbow (End of Rainbow ne→On Rainbow)
  'look',
  'east',                   // → Aragain Falls
  'look',
  'west',                   // → On Rainbow
  'west',                   // On Rainbow → End of Rainbow
  'sw',                     // End of Rainbow → Canyon Bottom
  'up',                     // Canyon Bottom → Rocky Ledge
  'up',                     // Rocky Ledge → Canyon View
  'nw',                     // Canyon View → Clearing
  // ── Return to house ───────────────────────────────────────────────────────
  'west',                   // Clearing → East of House
  'south',                  // East of House → South of House
  'look',
  'west',                   // South of House → West of House
  'look',
  'east',                   // West of House → front door (boarded — blocked)
  'north',                  // West of House → North of House
  'east',                   // North of House → East of House (Behind House)
  'look',
  'west',                   // East of House → Kitchen (window still open)
  'look',
  'examine sandwich bag',
  'east',                   // Kitchen → East of House
  'west',                   // → Kitchen
  'west',                   // Kitchen → Living Room
  // ── Trophy case deposit + scoring ─────────────────────────────────────────
  'open trap door',
  'open trophy case',
  'put painting in trophy case',  // TVALUE=6 scored via LIVING-ROOM M-END recompute
  'score',
  'examine trophy case',
  'diagnose',
  'look',
  // ── More Living Room verbs ────────────────────────────────────────────────
  'close trophy case',
  'open trophy case',
  'take painting',          // take back from trophy case
  'drop painting',
  'put painting in trophy case',
  'score',
  // ── Lamp off / dark in Living Room ───────────────────────────────────────
  'turn off lamp',
  'look',                   // pitch-black
  'turn on lamp',
  'look',                   // lit
  // ── Chained commands ─────────────────────────────────────────────────────
  'look. score. inventory',
  // ── Final stats ──────────────────────────────────────────────────────────
  'score',
  'diagnose',
  'inventory',
];
