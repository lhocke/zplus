/**
 * Verb and preposition vocabulary tables for the parser.
 *
 * Verb synonyms are stored as a map from canonical verb → set of aliases.
 * The lookup table inverts this so any alias (or the canonical itself) maps
 * to the canonical form.
 *
 * Prepositions and directional words are listed separately so the parser can
 * distinguish them from nouns.
 */

// --------------------------------------------------------------------------
// Verb synonym table
// Canonical verb → aliases (all lowercase).
// Sourced from vocabulary.json / gsyntax.zil.
// --------------------------------------------------------------------------

const VERB_SYNONYMS: Record<string, string[]> = {
  attack:     ['fight', 'hurt', 'injure', 'hit'],
  brush:      ['clean'],
  burn:       ['incinerate', 'ignite'],
  climb:      ['sit'],
  enter:      ['board', 'through'],
  move:       [],
  close:      ['shut'],
  cross:      ['ford'],
  cut:        ['slice', 'pierce'],
  destroy:    ['damage', 'break', 'block', 'smash'],
  drink:      ['imbibe', 'swallow'],
  drop:       ['discard', 'release', 'put down', 'leave', 'abandon', 'remove'],
  eat:        ['consume', 'taste', 'bite'],
  examine:    ['x', 'describe', 'what', 'whats', 'inspect'],
  exorcise:   ['banish', 'cast', 'drive', 'begone'],
  extinguish: ['douse', 'quench'],
  follow:     ['pursue', 'chase', 'come'],
  give:       ['donate', 'offer', 'feed'],
  hello:      ['hi'],
  incant:     ['chant'],
  inventory:  ['i', 'inv'],
  jump:       ['leap', 'dive'],
  kick:       ['taunt'],
  kill:       ['murder', 'slay', 'dispatch'],
  knock:      ['rap'],
  look:       ['l', 'stare', 'gaze'],
  lubricate:  ['oil', 'grease'],
  melt:       ['liquify'],
  mumble:     ['sigh'],
  odysseus:   ['ulysses'],
  open:       [],
  plug:       ['glue', 'patch', 'repair', 'fix'],
  plugh:      ['xyzzy'],
  pour:       ['spill'],
  pull:       ['tug', 'yank'],
  push:       ['press'],
  put:        ['stuff', 'insert', 'place', 'hide'],
  quit:       ['q'],
  raise:      ['lift'],
  read:       ['skim'],
  ring:       ['peal'],
  rub:        ['touch', 'feel', 'pat', 'pet'],
  save:       [],
  skip:       ['hop'],
  smell:      ['sniff'],
  swim:       ['bathe', 'wade'],
  swing:      ['thrust'],
  take:       ['get', 'hold', 'carry', 'grab', 'catch', 'pick'],
  tell:       ['ask'],
  throw:      ['hurl', 'chuck', 'toss'],
  tie:        ['fasten', 'secure', 'attach'],
  turn:       ['set', 'flip'],
  untie:      ['free', 'unfasten', 'unattach', 'unhook'],
  wait:       ['z'],
  wake:       ['awake', 'surprise', 'startle'],
  walk:       ['go', 'run', 'proceed', 'step'],
  wave:       ['brandish'],
  wind:       [],
  win:        ['winnage'],
  yell:       ['scream', 'shout'],
};

// Inverted lookup: alias → canonical.
const VERB_LOOKUP = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(VERB_SYNONYMS)) {
  VERB_LOOKUP.set(canonical, canonical);
  for (const alias of aliases) {
    VERB_LOOKUP.set(alias, canonical);
  }
}

/**
 * Return the canonical verb for a given token, or undefined if the token
 * is not a recognized verb (or verb alias).
 */
export function lookupVerb(token: string): string | undefined {
  return VERB_LOOKUP.get(token.toLowerCase());
}

// --------------------------------------------------------------------------
// Direction words — treated as shorthand "walk <dir>" commands.
// --------------------------------------------------------------------------

export const DIRECTIONS = new Set<string>([
  'north', 'south', 'east', 'west',
  'ne', 'nw', 'se', 'sw',
  'up', 'down', 'in', 'out',
  'n', 's', 'e', 'w', 'u', 'd',
  'northwest', 'northeast', 'southwest', 'southeast',
]);

// Map abbreviated/long direction tokens to the canonical Dir value.
const DIR_NORMALIZE: Record<string, string> = {
  n:         'north',
  s:         'south',
  e:         'east',
  w:         'west',
  u:         'up',
  d:         'down',
  northwest: 'nw',
  northeast: 'ne',
  southwest: 'sw',
  southeast: 'se',
};

export function normalizeDir(token: string): string {
  const lc = token.toLowerCase();
  return DIR_NORMALIZE[lc] ?? lc;
}

// --------------------------------------------------------------------------
// Prepositions — split a command like "put X in Y" into dobj + prep + iobj.
// --------------------------------------------------------------------------

export const PREPOSITIONS = new Set<string>([
  'in', 'into', 'inside',
  'on', 'onto', 'on top of',
  'under', 'underneath', 'beneath', 'below',
  'with', 'using', 'through', 'thru',
  'from', 'off', 'out of',
  'to', 'at', 'about',
]);

// Normalize preposition aliases to a canonical form.
const PREP_NORMALIZE: Record<string, string> = {
  into:       'in',
  inside:     'in',
  onto:       'on',
  underneath: 'under',
  beneath:    'under',
  below:      'under',
  using:      'with',
  through:    'with',
  thru:       'with',
  'out of':   'from',
};

export function normalizePrep(token: string): string {
  const lc = token.toLowerCase();
  return PREP_NORMALIZE[lc] ?? lc;
}

export function isPreposition(token: string): boolean {
  return PREPOSITIONS.has(token.toLowerCase());
}
