import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { World } from '../../src/domain/world';
import { Flag } from '../../src/domain/flags';
import { Room } from '../../src/domain/room';

const require = createRequire(import.meta.url);
const objectsData = require('../../src/data/objects.json') as unknown[];
const roomsData = require('../../src/data/rooms.json') as unknown[];

describe('World.fromData — registry and containment', () => {
  let world: World;

  beforeAll(() => {
    world = World.fromData([...roomsData, ...objectsData]);
  });

  it('MAILBOX is in the registry', () => {
    expect(world.get('MAILBOX')).toBeDefined();
  });

  it('WEST-OF-HOUSE is in the registry', () => {
    expect(world.get('WEST-OF-HOUSE')).toBeDefined();
  });

  it("MAILBOX.parent.id is 'WEST-OF-HOUSE'", () => {
    const mailbox = world.get('MAILBOX');
    expect(mailbox).toBeDefined();
    expect(mailbox!.parent).not.toBeNull();
    expect(mailbox!.parent!.id).toBe('WEST-OF-HOUSE');
  });

  it('contents(WEST-OF-HOUSE) includes the mailbox', () => {
    const ids = world.contents('WEST-OF-HOUSE').map(o => o.id);
    expect(ids).toContain('MAILBOX');
  });

  it('get returns undefined for unknown id', () => {
    expect(world.get('NO-SUCH-OBJECT')).toBeUndefined();
  });

  it('contents returns empty array for unknown id', () => {
    expect(world.contents('NO-SUCH-OBJECT')).toEqual([]);
  });

  it('all entries in registry have correct ids', () => {
    const mailbox = world.get('MAILBOX');
    expect(mailbox!.id).toBe('MAILBOX');
  });

  it('flags are hydrated from data', () => {
    const mailbox = world.get('MAILBOX');
    expect(mailbox!.has(Flag.Container)).toBe(true);
    // MAILBOX ZIL: (FLAGS CONTBIT TRYTAKEBIT) — no TAKEBIT, so Takeable is NOT set;
    // TryTake is set (TRYTAKEBIT → Flag.TryTake per C4 schema).
    expect(mailbox!.has(Flag.TryTake)).toBe(true);
    expect(mailbox!.has(Flag.Takeable)).toBe(false);
  });

  it('props are hydrated from data', () => {
    const mailbox = world.get('MAILBOX');
    expect(mailbox!.props.get('CAPACITY')).toBe(10);
  });

  it('synonyms are hydrated from data', () => {
    const mailbox = world.get('MAILBOX');
    expect(mailbox!.synonyms).toContain('MAILBOX');
    expect(mailbox!.synonyms).toContain('BOX');
  });

  it('Room exits are hydrated', () => {
    const woh = world.get('WEST-OF-HOUSE');
    expect(woh).toBeInstanceOf(Room);
    const exits = (woh as Room).exits;
    expect(exits.length).toBeGreaterThan(0);
    const north = exits.find(e => e.dir === 'north');
    expect(north).toBeDefined();
    expect(north!.to).toBe('NORTH-OF-HOUSE');
  });
});
