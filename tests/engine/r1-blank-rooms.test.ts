/**
 * r1-blank-rooms.test.ts
 *
 * Verifies that each of the 16 rooms previously lacking a static ldesc now
 * renders its default-state description via createGame({ startRoom }).
 *
 * Text is the ZIL default-state output (all flags false, default water level)
 * after normalizeZilString: source newlines → space, '|' → '\n'.
 * Multi-part rooms have their TELL segments joined with a single space.
 *
 * Sources: zil/1actions.zil (cited per room below).
 */

import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/bootstrap.js';
import { Flag } from '../../src/domain/flags.js';
import type { World } from '../../src/domain/world.js';

function worldOf(g: ReturnType<typeof createGame>): World {
  return (g as unknown as { world: World }).world;
}

// For dark rooms, move the lit lamp into player inventory so describeCurrentRoom works.
function litStartOutput(roomId: string): string {
  const g = createGame({ startRoom: roomId });
  const w = worldOf(g);
  const lamp = w.get('LAMP')!;
  const player = w.get('PLAYER')!;
  lamp.moveTo(player);
  lamp.set(Flag.OnFire);
  return g.start();
}

// Outdoor (Flag.On) rooms don't need a lamp.
function startOutput(roomId: string): string {
  return createGame({ startRoom: roomId }).start();
}

describe('blank-room static ldesc render', () => {
  // RESERVOIR-SOUTH — 1actions.zil:1434-1442
  // Flag: Land (no On) — needs lamp
  it('RESERVOIR-SOUTH shows default lake description', () => {
    const out = litStartOutput('RESERVOIR-SOUTH');
    expect(out).toContain('You are in a long room on the south shore of a large lake, far too deep and wide for crossing.');
    expect(out).toContain('There is a path along the stream to the east or west, a steep pathway climbing southwest along the edge of a chasm, and a path leading into a canyon to the southeast.');
  });

  // RESERVOIR — 1actions.zil:1457-1461
  // Flag: NonLand (no On) — needs lamp
  it('RESERVOIR shows lake description', () => {
    const out = litStartOutput('RESERVOIR');
    expect(out).toContain('You are on the lake. Beaches can be seen north and south. Upstream a small stream enters the lake through a narrow cleft in the rocks. The dam can be seen downstream.');
  });

  // RESERVOIR-NORTH — 1actions.zil:1480-1485
  // Flag: Land (no On) — needs lamp
  it('RESERVOIR-NORTH shows cavern and stairway', () => {
    const out = litStartOutput('RESERVOIR-NORTH');
    expect(out).toContain('You are in a large cavernous room, north of a large lake.');
    expect(out).toContain('There is a slimy stairway leaving the room to the north.');
  });

  // MIRROR-ROOM-1 — 1actions.zil:961-963
  // Flag: Land (no On) — needs lamp
  it('MIRROR-ROOM-1 shows large square room with mirror', () => {
    const out = litStartOutput('MIRROR-ROOM-1');
    expect(out).toContain('You are in a large square room with tall ceilings. On the south wall is an enormous mirror which fills the entire wall. There are exits on the other three sides of the room.');
  });

  // MIRROR-ROOM-2 — 1actions.zil:961-963 (same routine as MIRROR-ROOM-1)
  // Flag: Land, On — lit outdoors
  it('MIRROR-ROOM-2 shows large square room with mirror', () => {
    const out = startOutput('MIRROR-ROOM-2');
    expect(out).toContain('You are in a large square room with tall ceilings. On the south wall is an enormous mirror which fills the entire wall. There are exits on the other three sides of the room.');
  });

  // DEEP-CANYON — 1actions.zil:1732-1744
  // Flag: Land (no On) — needs lamp
  it('DEEP-CANYON shows canyon edge with flowing water', () => {
    const out = litStartOutput('DEEP-CANYON');
    expect(out).toContain('You are on the south edge of a deep canyon. Passages lead off to the east, northwest and southwest. A stairway leads down.');
    expect(out).toContain('You can hear the sound of flowing water from below.');
  });

  // LOUD-ROOM — 1actions.zil:1661-1672
  // Flag: Land (no On) — needs lamp
  it('LOUD-ROOM shows deafeningly loud room', () => {
    const out = litStartOutput('LOUD-ROOM');
    expect(out).toContain('This is a large room with a ceiling which cannot be detected from the ground. There is a narrow passage from east to west and a stone stairway leading upward.');
    expect(out).toContain('The room is deafeningly loud with an undetermined rushing sound. The sound seems to reverberate from all of the walls, making it difficult even to think.');
  });

  // ENTRANCE-TO-HADES — 1actions.zil:1060-1070
  // Flag: Land, On — always lit
  it('ENTRANCE-TO-HADES shows gateway inscription and evil spirits', () => {
    const out = startOutput('ENTRANCE-TO-HADES');
    expect(out).toContain('You are outside a large gateway, on which is inscribed');
    expect(out).toContain('Abandon every hope all ye who enter here!');
    expect(out).toContain('The gate is open; through it you can see a desolation, with a pile of mangled bodies in one corner. Thousands of voices, lamenting some hideous fate, can be heard.');
    expect(out).toContain('The way through the gate is barred by evil spirits, who jeer at your attempts to pass.');
  });

  // DOME-ROOM — 1actions.zil:1032-1035
  // Flag: Land (no On) — needs lamp
  it('DOME-ROOM shows dome periphery', () => {
    const out = litStartOutput('DOME-ROOM');
    expect(out).toContain('You are at the periphery of a large dome, which forms the ceiling of another room below. Protecting you from a precipitous drop is a wooden railing which circles the dome.');
  });

  // TORCH-ROOM — 1actions.zil:1020-1025
  // Flag: Land (no On) — needs lamp
  it('TORCH-ROOM shows room with pedestal and dome above', () => {
    const out = litStartOutput('TORCH-ROOM');
    expect(out).toContain('This is a large room with a prominent doorway leading to a down staircase. Above you is a large dome. Up around the edge of the dome (20 feet up) is a wooden railing. In the center of the room sits a white marble pedestal.');
  });

  // DAM-ROOM — 1actions.zil:1159-1185
  // Flag: Land, On — always lit
  it('DAM-ROOM shows dam top with sluice gates closed', () => {
    const out = startOutput('DAM-ROOM');
    expect(out).toContain('You are standing on the top of the Flood Control Dam #3, which was quite a tourist attraction in times far distant. There are paths to the north, south, and west, and a scramble down.');
    expect(out).toContain('The sluice gates on the dam are closed. Behind the dam, there can be seen a wide reservoir. Water is pouring over the top of the now abandoned dam.');
    expect(out).toContain('There is a control panel here, on which a large metal bolt is mounted. Directly above the bolt is a small green plastic bubble.');
  });

  // ARAGAIN-FALLS — 1actions.zil:2622-2631
  // Flag: Land, Sacred, On — always lit
  it('ARAGAIN-FALLS shows waterfall and rainbow', () => {
    const out = startOutput('ARAGAIN-FALLS');
    expect(out).toContain('You are at the top of Aragain Falls, an enormous waterfall with a drop of about 450 feet. The only path here is on the north end.');
    expect(out).toContain('A beautiful rainbow can be seen over the falls and to the west.');
  });

  // BAT-ROOM — 1actions.zil:2481
  // Flag: Land, Sacred (no On) — needs lamp
  it('BAT-ROOM shows small room with east and south doors', () => {
    const out = litStartOutput('BAT-ROOM');
    expect(out).toContain('You are in a small room which has doors only to the east and south.');
  });

  // MACHINE-ROOM — 1actions.zil:2490-2500
  // Flag: Land (no On) — needs lamp
  it('MACHINE-ROOM shows machine with closed lid', () => {
    const out = litStartOutput('MACHINE-ROOM');
    expect(out).toContain('This is a large, cold room whose sole exit is to the north. In one corner there is a machine which is reminiscent of a clothes dryer. On its face is a switch which is labelled "START". The switch does not appear to be manipulable by any human hand (unless the fingers are about 1/16 by 1/4 inch). On the front of the machine is a large lid, which is closed.');
  });

  // CYCLOPS-ROOM — 1actions.zil:1618-1631
  // Flag: Land (no On) — needs lamp
  it('CYCLOPS-ROOM shows cyclops blocking staircase (default CYCLOWRATH=0)', () => {
    const out = litStartOutput('CYCLOPS-ROOM');
    expect(out).toContain('This room has an exit on the northwest, and a staircase leading up.');
    expect(out).toContain('A cyclops, who looks prepared to eat horses (much less mere adventurers), blocks the staircase. From his state of health, and the bloodstains on the walls, you gather that he is not very friendly, though he likes people.');
  });

  // GRATING-ROOM — 1actions.zil:837-848
  // Flag: Land (no On) — needs lamp
  it('GRATING-ROOM shows grating locked with skull-and-crossbones lock', () => {
    const out = litStartOutput('GRATING-ROOM');
    expect(out).toContain('You are in a small room near the maze. There are twisty passages in the immediate vicinity.');
    expect(out).toContain('Above you is a grating locked with a skull-and-crossbones lock.');
  });
});
