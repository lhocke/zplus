import type { ObjectId } from '../domain/game-object.js';
import type { Flag } from '../domain/flags.js';

// ---------------------------------------------------------------------------
// Event union — all signals the engine can emit.
// Shape is frozen; new event types require amending the plan contract first.
// ---------------------------------------------------------------------------

export type EngineEvent =
  | { type: 'room-entered';    room: ObjectId;                firstVisit: boolean  }
  | { type: 'item-taken';      item: ObjectId                                       }
  | { type: 'item-dropped';    item: ObjectId;                room: ObjectId       }
  | { type: 'flag-changed';    obj: ObjectId; flag: Flag;     value: boolean       }
  | { type: 'turn-complete';   moves: number                                       }
  | { type: 'score-changed';   score: number;                 delta: number        }
  | { type: 'lantern-fuel';    remaining: number; message?: string; dark: boolean  }
  | { type: 'candle-fuel';     remaining: number; message?: string; dark: boolean  }
  | { type: 'game-over';       won: boolean                                        }
  | { type: 'invocation';      name: 'frotz' | 'rezrov'                            };

// ---------------------------------------------------------------------------
// EventEmitter interface — typed, minimal, unsubscribe-via-returned-function.
// ---------------------------------------------------------------------------

export interface EventEmitter {
  on<T extends EngineEvent['type']>(
    t: T,
    fn: (e: Extract<EngineEvent, { type: T }>) => void,
  ): () => void;
  emit(e: EngineEvent): void;
}

// ---------------------------------------------------------------------------
// SimpleEventEmitter — concrete implementation used by the engine and tests.
// ---------------------------------------------------------------------------

type AnyHandler = (e: EngineEvent) => void;

export class SimpleEventEmitter implements EventEmitter {
  private readonly handlers = new Map<string, Set<AnyHandler>>();

  on<T extends EngineEvent['type']>(
    t: T,
    fn: (e: Extract<EngineEvent, { type: T }>) => void,
  ): () => void {
    let bucket = this.handlers.get(t);
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(t, bucket);
    }
    const handler = fn as AnyHandler;
    bucket.add(handler);
    return () => bucket!.delete(handler);
  }

  emit(e: EngineEvent): void {
    const bucket = this.handlers.get(e.type);
    if (bucket) {
      for (const fn of bucket) fn(e);
    }
  }
}
