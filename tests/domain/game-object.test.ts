import { describe, it, expect, beforeEach } from 'vitest';
import { Flag, isLightSource, isTakeable, isContainer, isWeapon, isFood, isDrink, isReadable } from '../../src/domain/flags';
import { GameObject } from '../../src/domain/game-object';
import { Room } from '../../src/domain/room';
import { Thing } from '../../src/domain/thing';
import { Container } from '../../src/domain/container';
import { Actor } from '../../src/domain/actor';

describe('Flag enum', () => {
  it('has expected members', () => {
    expect(Flag.Light).toBeDefined();
    expect(Flag.Takeable).toBeDefined();
    expect(Flag.Container).toBeDefined();
    expect(Flag.Open).toBeDefined();
    expect(Flag.Door).toBeDefined();
    expect(Flag.Transparent).toBeDefined();
    expect(Flag.Flammable).toBeDefined();
    expect(Flag.OnFire).toBeDefined();
    expect(Flag.Weapon).toBeDefined();
    expect(Flag.Food).toBeDefined();
    expect(Flag.Drink).toBeDefined();
    expect(Flag.Readable).toBeDefined();
    expect(Flag.Turnable).toBeDefined();
    expect(Flag.Climbable).toBeDefined();
    expect(Flag.Sacred).toBeDefined();
    expect(Flag.Invisible).toBeDefined();
    expect(Flag.Touched).toBeDefined();
    expect(Flag.Vehicle).toBeDefined();
    expect(Flag.Burned).toBeDefined();
    expect(Flag.Maze).toBeDefined();
    expect(Flag.Land).toBeDefined();
    expect(Flag.NonDescript).toBeDefined();
    expect(Flag.Searchable).toBeDefined();
    expect(Flag.Surface).toBeDefined();
  });
});

describe('capability predicates', () => {
  let obj: GameObject;

  beforeEach(() => {
    obj = new Thing('LAMP', 'brass lantern');
  });

  it('isLightSource reflects Flag.Light', () => {
    expect(isLightSource(obj)).toBe(false);
    obj.set(Flag.Light);
    expect(isLightSource(obj)).toBe(true);
    obj.clear(Flag.Light);
    expect(isLightSource(obj)).toBe(false);
  });

  it('isTakeable reflects Flag.Takeable', () => {
    expect(isTakeable(obj)).toBe(false);
    obj.set(Flag.Takeable);
    expect(isTakeable(obj)).toBe(true);
  });

  it('isContainer reflects Flag.Container', () => {
    expect(isContainer(obj)).toBe(false);
    obj.set(Flag.Container);
    expect(isContainer(obj)).toBe(true);
  });

  it('isWeapon reflects Flag.Weapon', () => {
    expect(isWeapon(obj)).toBe(false);
    obj.set(Flag.Weapon);
    expect(isWeapon(obj)).toBe(true);
  });

  it('isFood reflects Flag.Food', () => {
    expect(isFood(obj)).toBe(false);
    obj.set(Flag.Food);
    expect(isFood(obj)).toBe(true);
  });

  it('isDrink reflects Flag.Drink', () => {
    expect(isDrink(obj)).toBe(false);
    obj.set(Flag.Drink);
    expect(isDrink(obj)).toBe(true);
  });

  it('isReadable reflects Flag.Readable', () => {
    expect(isReadable(obj)).toBe(false);
    obj.set(Flag.Readable);
    expect(isReadable(obj)).toBe(true);
  });
});

describe('GameObject has/set/clear', () => {
  it('has returns false when flag not set', () => {
    const obj = new Thing('SWORD', 'elvish sword');
    expect(obj.has(Flag.Weapon)).toBe(false);
  });

  it('set/has round-trip', () => {
    const obj = new Thing('SWORD', 'elvish sword');
    obj.set(Flag.Weapon);
    expect(obj.has(Flag.Weapon)).toBe(true);
  });

  it('clear removes a flag', () => {
    const obj = new Thing('SWORD', 'elvish sword');
    obj.set(Flag.Weapon);
    obj.clear(Flag.Weapon);
    expect(obj.has(Flag.Weapon)).toBe(false);
  });

  it('multiple flags are independent', () => {
    const obj = new Thing('TORCH', 'torch');
    obj.set(Flag.Light);
    obj.set(Flag.Takeable);
    expect(obj.has(Flag.Light)).toBe(true);
    expect(obj.has(Flag.Takeable)).toBe(true);
    obj.clear(Flag.Light);
    expect(obj.has(Flag.Light)).toBe(false);
    expect(obj.has(Flag.Takeable)).toBe(true);
  });
});

describe('GameObject.moveTo — containment both sides', () => {
  let room: Room;
  let item: Thing;

  beforeEach(() => {
    room = new Room('WEST-OF-HOUSE', 'West of House');
    item = new Thing('LAMP', 'brass lantern');
  });

  it('moveTo sets parent on item', () => {
    item.moveTo(room);
    expect(item.parent).toBe(room);
  });

  it('moveTo adds item to destination children', () => {
    item.moveTo(room);
    expect(room.children.has(item)).toBe(true);
  });

  it('moveTo removes item from previous parent children', () => {
    const room2 = new Room('KITCHEN', 'Kitchen');
    item.moveTo(room);
    item.moveTo(room2);
    expect(room.children.has(item)).toBe(false);
    expect(room2.children.has(item)).toBe(true);
    expect(item.parent).toBe(room2);
  });

  it('moveTo(null) clears parent and removes from old parent', () => {
    item.moveTo(room);
    item.moveTo(null);
    expect(item.parent).toBeNull();
    expect(room.children.has(item)).toBe(false);
  });

  it('initial parent is null', () => {
    expect(item.parent).toBeNull();
  });

  it('children set starts empty', () => {
    expect(item.children.size).toBe(0);
  });
});

describe('GameObject props', () => {
  it('props map starts empty', () => {
    const obj = new Thing('KEY', 'small key');
    expect(obj.props.size).toBe(0);
  });

  it('accepts number and string props', () => {
    const obj = new Thing('KEY', 'small key');
    obj.props.set('size', 1);
    obj.props.set('color', 'gold');
    expect(obj.props.get('size')).toBe(1);
    expect(obj.props.get('color')).toBe('gold');
  });
});

describe('GameObject synonyms and adjectives', () => {
  it('can be set on construction and are readable', () => {
    const obj = new Thing('LAMP', 'brass lantern', { synonyms: ['lantern', 'lamp'], adjectives: ['brass'] });
    expect(obj.synonyms).toContain('lantern');
    expect(obj.synonyms).toContain('lamp');
    expect(obj.adjectives).toContain('brass');
  });
});

describe('Room subclass', () => {
  it('has exits array', () => {
    const room = new Room('WEST-OF-HOUSE', 'West of House');
    expect(Array.isArray(room.exits)).toBe(true);
    expect(room.exits.length).toBe(0);
  });

  it('does not have Takeable flag by default', () => {
    const room = new Room('WEST-OF-HOUSE', 'West of House');
    expect(room.has(Flag.Takeable)).toBe(false);
  });
});

describe('Thing subclass', () => {
  it('does not set Takeable flag automatically', () => {
    // Takeable flag is set by hydration from data, not auto-set in constructor
    const item = new Thing('LAMP', 'brass lantern');
    expect(item.has(Flag.Takeable)).toBe(false);
  });
});

describe('Container subclass', () => {
  it('has Container flag set', () => {
    const c = new Container('MAILBOX', 'small mailbox');
    expect(c.has(Flag.Container)).toBe(true);
  });

  it('children can hold items', () => {
    const box = new Container('MAILBOX', 'small mailbox');
    const leaflet = new Thing('LEAFLET', 'leaflet');
    leaflet.moveTo(box);
    expect(box.children.has(leaflet)).toBe(true);
  });
});

describe('Actor subclass', () => {
  it('can be constructed', () => {
    const player = new Actor('PLAYER', 'you');
    expect(player.id).toBe('PLAYER');
    expect(player.desc).toBe('you');
  });

  it('actor containment works the same as base', () => {
    const room = new Room('LIVING-ROOM', 'Living Room');
    const player = new Actor('PLAYER', 'you');
    player.moveTo(room);
    expect(player.parent).toBe(room);
    expect(room.children.has(player)).toBe(true);
  });
});

describe('nested containment', () => {
  it('moving a container with children does not affect children parent', () => {
    const room1 = new Room('WEST-OF-HOUSE', 'West of House');
    const room2 = new Room('KITCHEN', 'Kitchen');
    const box = new Container('MAILBOX', 'small mailbox');
    const leaflet = new Thing('LEAFLET', 'leaflet');
    leaflet.moveTo(box);
    box.moveTo(room1);
    expect(leaflet.parent).toBe(box);
    box.moveTo(room2);
    // Children of box are unaffected — they are still in box
    expect(leaflet.parent).toBe(box);
    expect(box.children.has(leaflet)).toBe(true);
    expect(room2.children.has(box)).toBe(true);
  });
});
