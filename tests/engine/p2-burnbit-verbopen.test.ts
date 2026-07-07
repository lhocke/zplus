/**
 * P2-1 + P2-2 tests — BURNBIT→Flammable fix + verbOpen FDESC path + Touched flag.
 *
 * P2-1: BURNBIT was mapped to Flag.Burned in the extractor; the correct mapping
 *   is Flag.Flammable.  Twelve objects (boat, book, painting, leaves, coal…) were
 *   mislabeled as already-destroyed.  Fix: extractor FLAG_MAP + re-extract objects.json.
 *
 * P2-2: verbOpen was missing two behaviours from ZIL V-OPEN (gverbs.zil:966-994):
 *   (a) <FSET ,PRSO ,TOUCHBIT> — the container should get Flag.Touched after opening.
 *   (b) Single-untouched-child-with-FDESC path:
 *       when the container has exactly one child, that child lacks Touched, and
 *       that child has an fdesc prop — print "The <container> opens.\n<fdesc>"
 *       rather than "Opening the <container> reveals a <child>."
 */

import { describe, it, expect } from 'vitest';
import objectsData from '../../src/data/objects.json';
import { executeVerb, type VerbContext } from '../../src/engine/verbs/index.js';
import { World } from '../../src/domain/world.js';
import { Room } from '../../src/domain/room.js';
import { Thing } from '../../src/domain/thing.js';
import { Container } from '../../src/domain/container.js';
import { Actor } from '../../src/domain/actor.js';
import { Flag } from '../../src/domain/flags.js';
import type { ObjectData } from '../../tools/extract-zil/extract.js';

// ---------------------------------------------------------------------------
// P2-1 — BURNBIT → Flag.Flammable (data)
// ---------------------------------------------------------------------------

const objects = objectsData as unknown as ObjectData[];

// The 12 objects that have BURNBIT in the ZIL source.
// After the fix they must carry 'Flammable', not 'Burned'.
const BURNBIT_OBJECT_IDS = [
  'BOOK',
  'SANDWICH-BAG',
  'ADVERTISEMENT',
  'INFLATED-BOAT',
  'PAINTING',
  'LEAVES',
  'PUNCTURED-BOAT',
  'INFLATABLE-BOAT',
  'COAL',
  'BOAT-LABEL',
  'GUIDE',
  'NEST',
];

describe('P2-1 — BURNBIT objects carry Flammable, not Burned', () => {
  for (const id of BURNBIT_OBJECT_IDS) {
    it(`${id} has flag Flammable`, () => {
      const obj = objects.find(o => o.id === id);
      expect(obj).toBeDefined();
      expect(obj!.flags).toContain('Flammable');
    });

    it(`${id} does NOT have flag Burned (BURNBIT must not map to Burned)`, () => {
      const obj = objects.find(o => o.id === id);
      expect(obj).toBeDefined();
      expect(obj!.flags).not.toContain('Burned');
    });
  }
});

describe('P2-1 — no object carries Burned from BURNBIT extraction', () => {
  it('zero objects carry Burned when they are among the 12 BURNBIT objects', () => {
    const burnbitSet = new Set(BURNBIT_OBJECT_IDS);
    const mislabeled = objects.filter(
      o => burnbitSet.has(o.id) && o.flags.includes('Burned'),
    );
    expect(mislabeled).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// P2-2 — verbOpen: Flag.Touched + single-child FDESC path
// ---------------------------------------------------------------------------

// Minimal fixture: a container with one child that has an fdesc.
function makeOpenFixture() {
  const room = new Room('ROOM', 'Test Room', { ldesc: 'A plain room.' });
  room.set(Flag.On);

  const player = new Actor('PLAYER', 'yourself');
  player.moveTo(room);

  // A container (pedestal-like) that starts closed.
  const pedestal = new Container('PEDESTAL', 'stone pedestal', {
    synonyms: ['pedestal'],
    adjectives: ['stone'],
    ldesc: 'A stone pedestal.',
  });
  pedestal.moveTo(room);

  // Its single child has an fdesc.
  const torch = new Thing('TORCH', 'flaming torch', {
    synonyms: ['torch'],
    adjectives: ['flaming'],
    ldesc: 'A flaming ivory torch.',
    fdesc: 'Sitting on the pedestal is a flaming torch, made of ivory.',
  });
  torch.set(Flag.Takeable);
  torch.moveTo(pedestal);

  // A second fixture: container with one child that has NO fdesc (mailbox-like).
  const mailbox = new Container('MAILBOX', 'small mailbox', {
    synonyms: ['mailbox'],
    adjectives: ['small'],
    ldesc: 'A standard mailbox.',
  });
  mailbox.moveTo(room);

  const leaflet = new Thing('LEAFLET', 'leaflet', {
    synonyms: ['leaflet'],
    adjectives: [],
    ldesc: 'A small leaflet.',
    // No fdesc — this triggers the "reveals" path
  });
  leaflet.set(Flag.Takeable);
  leaflet.moveTo(mailbox);

  const world = World.fromObjects([room, player, pedestal, torch, mailbox, leaflet]);

  return { room, player, pedestal, torch, mailbox, leaflet, world };
}

function ctx(fix: ReturnType<typeof makeOpenFixture>, dobjId: string): VerbContext {
  return {
    verb: 'open',
    dobj: fix.world.get(dobjId),
    iobj: undefined,
    prep: undefined,
    player: fix.player,
    here: fix.room,
    world: fix.world,
  };
}

describe('P2-2a — verbOpen sets Flag.Touched on container', () => {
  it('container gets Flag.Touched after being opened', async () => {
    const fix = makeOpenFixture();
    expect(fix.pedestal.has(Flag.Touched)).toBe(false);
    await executeVerb(ctx(fix, 'PEDESTAL'), 'V-OPEN');
    expect(fix.pedestal.has(Flag.Touched)).toBe(true);
  });

  it('mailbox gets Flag.Touched after being opened (no-fdesc child)', async () => {
    const fix = makeOpenFixture();
    expect(fix.mailbox.has(Flag.Touched)).toBe(false);
    await executeVerb(ctx(fix, 'MAILBOX'), 'V-OPEN');
    expect(fix.mailbox.has(Flag.Touched)).toBe(true);
  });
});

describe('P2-2b — verbOpen single-child FDESC path', () => {
  it('prints "The <container> opens." when single untouched child has fdesc', async () => {
    const fix = makeOpenFixture();
    const result = await executeVerb(ctx(fix, 'PEDESTAL'), 'V-OPEN');
    // Should contain "The stone pedestal opens." — NOT "Opening the stone pedestal reveals..."
    expect(result.output).toContain('The stone pedestal opens.');
  });

  it('appends the child FDESC on the single-child FDESC path', async () => {
    const fix = makeOpenFixture();
    const result = await executeVerb(ctx(fix, 'PEDESTAL'), 'V-OPEN');
    expect(result.output).toContain('Sitting on the pedestal is a flaming torch, made of ivory.');
  });

  it('does NOT say "Opening the ... reveals ..." for single-child with fdesc', async () => {
    const fix = makeOpenFixture();
    const result = await executeVerb(ctx(fix, 'PEDESTAL'), 'V-OPEN');
    expect(result.output).not.toMatch(/Opening the.*reveals/);
  });
});

describe('P2-2c — verbOpen single-child WITHOUT fdesc uses reveals path (mailbox oracle)', () => {
  it('prints "Opening the small mailbox reveals a leaflet." (oracle match)', async () => {
    const fix = makeOpenFixture();
    const result = await executeVerb(ctx(fix, 'MAILBOX'), 'V-OPEN');
    expect(result.output).toBe('Opening the small mailbox reveals a leaflet.');
  });
});

describe('P2-2d — FDESC path skipped when child already has Touched', () => {
  it('uses "reveals" path when single child has Touched (already seen)', async () => {
    const fix = makeOpenFixture();
    // Mark the torch as already touched
    fix.torch.set(Flag.Touched);
    const result = await executeVerb(ctx(fix, 'PEDESTAL'), 'V-OPEN');
    // Touched child → reveals path, not FDESC path
    expect(result.output).toContain('Opening the stone pedestal reveals a flaming torch.');
    expect(result.output).not.toContain('Sitting on the pedestal');
  });
});
