import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';

// DESCRIBE-OBJECT vehicle suffix — gverbs.zil:1722-1725.
// A room-level object described while the player is in a vehicle gets
// " (outside the <vehicle>)".  Per ZIL PRINT-CONT (gverbs.zil:1776-1808) this
// applies only on the Pass-2 path (DESCRIBE-OBJECT, for touched / no-FDESC
// objects); untouched-FDESC objects print their FDESC directly in Pass 1 and get
// NO suffix.  Both behaviours are asserted here.
describe('DESCRIBE-OBJECT — "(outside the <vehicle>)" suffix (gverbs.zil:1722)', () => {
  function boatScene() {
    const g = createGame({ startRoom: 'RIVER-2' });
    g.start();
    const w = g.world;
    const lamp = w.get('LAMP')!;
    lamp.set(Flag.OnFire);
    lamp.set(Flag.Light);
    lamp.moveTo(g.player);
    const boat = w.get('INFLATED-BOAT')!;
    const buoy = w.get('BUOY')!;
    const room = g.player.parent!;
    boat.moveTo(room);
    g.player.moveTo(boat);
    buoy.moveTo(room);
    return { g, buoy };
  }

  it('touched room object in a vehicle → "(outside the magic boat)" (Pass 2)', () => {
    const { g, buoy } = boatScene();
    buoy.set(Flag.Touched); // touched → DESCRIBE-OBJECT path → suffix
    const out = g.turn('look').output;
    expect(out).toContain('There is a red buoy here. (outside the magic boat)');
  });

  it('untouched FDESC object → no suffix (Pass 1 prints the FDESC directly)', () => {
    const { g } = boatScene(); // buoy left untouched → still has its FDESC
    const out = g.turn('look').output;
    expect(out).toContain('(probably a warning)');
    expect(out).not.toContain('(outside the magic boat)');
  });
});
