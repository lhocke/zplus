import { GameObject, type ObjectId, type Exit } from './game-object.js';
import { Flag } from './flags.js';
import { Room, type PseudoEntry } from './room.js';
import { Thing } from './thing.js';
import { Container } from './container.js';
import { Actor } from './actor.js';

// Mirrors the ObjectData schema emitted by the extractor (src/data/objects.json,
// src/data/rooms.json).  Kept local so world.ts has no hard dep on the extractor.
interface ObjectData {
  id: ObjectId;
  kind: 'room' | 'thing' | 'container' | 'actor';
  desc: string;
  ldesc?: string;
  fdesc?: string;
  flags: string[];
  props: Record<string, number | string>;
  parent?: ObjectId;
  synonyms: string[];
  adjectives: string[];
  exits?: Exit[];
  actionRoutine?: string;
  /** ZIL P?PSEUDO — rooms only; list of {word, action} pseudo-object entries. */
  pseudo?: PseudoEntry[];
}

const FLAG_NAME_MAP: Record<string, Flag> = {
  Light:        Flag.Light,
  Takeable:     Flag.Takeable,
  Container:    Flag.Container,
  Open:         Flag.Open,
  Door:         Flag.Door,
  Transparent:  Flag.Transparent,
  Flammable:    Flag.Flammable,
  OnFire:       Flag.OnFire,
  Weapon:       Flag.Weapon,
  Food:         Flag.Food,
  Drink:        Flag.Drink,
  Readable:     Flag.Readable,
  Turnable:     Flag.Turnable,
  Climbable:    Flag.Climbable,
  Sacred:       Flag.Sacred,
  Invisible:    Flag.Invisible,
  Touched:      Flag.Touched,
  Vehicle:      Flag.Vehicle,
  Burned:       Flag.Burned,
  Maze:         Flag.Maze,
  Land:         Flag.Land,
  NonDescript:  Flag.NonDescript,
  Searchable:   Flag.Searchable,
  Surface:      Flag.Surface,
  Actor:        Flag.Actor,
  Tool:         Flag.Tool,
  TryTake:      Flag.TryTake,
  Wearable:     Flag.Wearable,
  NonLand:      Flag.NonLand,
  On:           Flag.On,
};

function buildObject(data: ObjectData): GameObject {
  const opts = {
    ldesc:      data.ldesc,
    fdesc:      data.fdesc,
    synonyms:   data.synonyms,
    adjectives: data.adjectives,
  };

  let obj: GameObject;
  switch (data.kind) {
    case 'room':
      obj = new Room(data.id, data.desc, { ...opts, exits: data.exits ?? [], pseudo: data.pseudo });
      break;
    case 'container':
      obj = new Container(data.id, data.desc, opts);
      break;
    case 'actor':
      obj = new Actor(data.id, data.desc, opts);
      break;
    default:
      obj = new Thing(data.id, data.desc, opts);
      break;
  }

  for (const name of data.flags) {
    const flag = FLAG_NAME_MAP[name];
    if (flag !== undefined) obj.set(flag);
  }

  for (const [key, value] of Object.entries(data.props)) {
    obj.props.set(key, value);
  }

  if (data.actionRoutine !== undefined) {
    obj.actionRoutine = data.actionRoutine;
  }

  return obj;
}

export class World {
  private readonly registry: Map<ObjectId, GameObject>;

  private constructor(registry: Map<ObjectId, GameObject>) {
    this.registry = registry;
  }

  /** Build a World from pre-constructed objects (tests, hand-wired scenarios). */
  static fromObjects(objects: GameObject[]): World {
    const registry = new Map<ObjectId, GameObject>();
    for (const obj of objects) {
      registry.set(obj.id, obj);
    }
    return new World(registry);
  }

  static fromData(rawEntries: unknown[]): World {
    const entries = rawEntries as ObjectData[];

    // First pass: build every object and populate the registry.
    const registry = new Map<ObjectId, GameObject>();
    for (const data of entries) {
      registry.set(data.id, buildObject(data));
    }

    // Second pass: wire containment.  Unknown parent ids are silently skipped.
    for (const data of entries) {
      if (data.parent === undefined) continue;
      const child = registry.get(data.id);
      const parent = registry.get(data.parent);
      if (child === undefined || parent === undefined) continue;
      child.moveTo(parent);
    }

    return new World(registry);
  }

  /** Register an object after construction.  Throws on duplicate id. */
  register(obj: GameObject): void {
    if (this.registry.has(obj.id)) {
      throw new Error(`World.register: duplicate id "${obj.id}"`);
    }
    this.registry.set(obj.id, obj);
  }

  get(id: ObjectId): GameObject | undefined {
    return this.registry.get(id);
  }

  contents(id: ObjectId): GameObject[] {
    const obj = this.registry.get(id);
    if (obj === undefined) return [];
    return Array.from(obj.children);
  }

  /** All objects in the world, in insertion order. */
  all(): GameObject[] {
    return Array.from(this.registry.values());
  }
}
