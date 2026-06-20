import rawMessages from '../../src/data/messages.json' with { type: 'json' };

/** Minimal RNG interface required by pick() — duck-typed for test flexibility. */
export interface PickRng {
  /** Returns a pseudo-random float in [0, 1). */
  next(): number;
}

/** A PICK-ONE table corresponding to a ZIL LTABLE of strings. */
export interface PickTable {
  readonly entries: readonly string[];
}

export type RoomObjectListing = typeof rawMessages.roomObjectListing;
export type ParserMessages = typeof rawMessages.parserMessages;

/**
 * Replace each `%s` placeholder in `template` with the corresponding
 * positional argument.  Modelled on the ZIL `TELL D ,PRSO` / `TELL D ,PRSI`
 * substitution pattern.
 */
export function fmt(template: string, ...args: string[]): string {
  let idx = 0;
  return template.replace(/%s/g, () => {
    const val = args[idx];
    idx++;
    return val !== undefined ? val : '%s';
  });
}

/**
 * Pick one entry at random from a PICK-ONE table.
 * Mirrors ZIL `<PICK-ONE ,TABLE>`.
 */
export function pick(table: PickTable, rng: PickRng): string {
  const idx = Math.floor(rng.next() * table.entries.length);
  return table.entries[idx] ?? table.entries[0] ?? '';
}

const dv = rawMessages.defaultVerbs;
const rt = rawMessages.randomTables;
const pm = rawMessages.parserMessages;
const ro = rawMessages.roomObjectListing;

export const roomObject = ro;
export const parser = pm;

export const describeRoom = dv.describeRoom;
export const finish = dv.finish;
export const goto = dv.goto;
export const hackHack = dv.hackHack;
export const hellos: PickTable = rt.hellos;
export const hitSpot = dv.hitSpot;
export const hoHum: PickTable = rt.hoHum;
export const idrop = dv.idrop;
export const itake = dv.itake;
export const jumploss: PickTable = rt.jumploss;
export const preBoard = dv.preBoard;
export const preBurn = dv.preBurn;
export const preGive = dv.preGive;
export const preMung = dv.preMung;
export const preMove = dv.preMove;
export const preRead = dv.preRead;
export const preTake = dv.preTake;
export const jigsUp = dv.jigsUp;
export const scoreUpd = dv.scoreUpd;
export const tellNoPrsi = dv.tellNoPrsi;
export const vAdvent = dv.vAdvent;
export const vAlarm = dv.vAlarm;
export const vAnswer = dv.vAnswer;
export const vAttack = dv.vAttack;
export const vBack = dv.vBack;
export const vBlast = dv.vBlast;
export const vBoard = dv.vBoard;
export const vBrief = dv.vBrief;
export const vBrush = dv.vBrush;
export const vBug = dv.vBug;
export const vBurn = dv.vBurn;
export const vChomp = dv.vChomp;
export const vClimbUp = dv.vClimbUp;
export const vClose = dv.vClose;
export const vCommand = dv.vCommand;
export const vCount = dv.vCount;
export const vCross = dv.vCross;
export const vCurses = dv.vCurses;
export const vCut = dv.vCut;
export const vDeflate = dv.vDeflate;
export const vDig = dv.vDig;
export const vDisembark = dv.vDisembark;
export const vDrinkFrom = dv.vDrinkFrom;
export const vDrop = dv.vDrop;
export const vEat = dv.vEat;
export const vExamine = dv.vExamine;
export const vExorcise = dv.vExorcise;
export const vFill = dv.vFill;
export const vFind = dv.vFind;
export const vFollow = dv.vFollow;
export const vFrobozz = dv.vFrobozz;
export const vGive = dv.vGive;
export const vHatch = dv.vHatch;
export const vHello = dv.vHello;
export const vInflate = dv.vInflate;
export const vInventory = dv.vInventory;
export const vKiss = dv.vKiss;
export const vKnock = dv.vKnock;
export const vLampOff = dv.vLampOff;
export const vLampOn = dv.vLampOn;
export const vLaunch = dv.vLaunch;
export const vLeanOn = dv.vLeanOn;
export const vLeap = dv.vLeap;
export const vListen = dv.vListen;
export const vLock = dv.vLock;
export const vLookBehind = dv.vLookBehind;
export const vLookInside = dv.vLookInside;
export const vLookOn = dv.vLookOn;
export const vLookUnder = dv.vLookUnder;
export const vMake = dv.vMake;
export const vMelt = dv.vMelt;
export const vMove = dv.vMove;
export const vMumble = dv.vMumble;
export const vMung = dv.vMung;
export const vOil = dv.vOil;
export const vOpen = dv.vOpen;
export const vOverboard = dv.vOverboard;
export const vPick = dv.vPick;
export const vPlug = dv.vPlug;
export const vPourOn = dv.vPourOn;
export const vPray = dv.vPray;
export const vPump = dv.vPump;
export const vPushTo = dv.vPushTo;
export const vPut = dv.vPut;
export const vPutBehind = dv.vPutBehind;
export const vPutOn = dv.vPutOn;
export const vPutUnder = dv.vPutUnder;
export const vVersion = dv.vVersion;
export const vScript = dv.vScript;
export const vQuit = dv.vQuit;
export const vRape = dv.vRape;
export const vRead = dv.vRead;
export const vRepent = dv.vRepent;
export const vReply = dv.vReply;
export const vRestart = dv.vRestart;
export const vRing = dv.vRing;
export const vSay = dv.vSay;
export const vSearch = dv.vSearch;
export const vSend = dv.vSend;
export const vShake = dv.vShake;
export const vSmell = dv.vSmell;
export const vSpin = dv.vSpin;
export const vSqueeze = dv.vSqueeze;
export const vStab = dv.vStab;
export const vStand = dv.vStand;
export const vStay = dv.vStay;
export const vStrike = dv.vStrike;
export const vSuperBrief = dv.vSuperBrief;
export const vSwim = dv.vSwim;
export const vSwing = dv.vSwing;
export const vTake = dv.vTake;
export const vTell = dv.vTell;
export const vThrow = dv.vThrow;
export const vThrowOff = dv.vThrowOff;
export const vTie = dv.vTie;
export const vTieUp = dv.vTieUp;
export const vTurn = dv.vTurn;
export const vUntie = dv.vUntie;
export const vVerbose = dv.vVerbose;
export const vWait = dv.vWait;
export const vWalk = dv.vWalk;
export const vWalkAround = dv.vWalkAround;
export const vWalkTo = dv.vWalkTo;
export const vWear = dv.vWear;
export const vWin = dv.vWin;
export const vWind = dv.vWind;
export const vWish = dv.vWish;
export const vYell = dv.vYell;
export const vZork = dv.vZork;
export const wheeeee: PickTable = rt.wheeeee;
export const yuks: PickTable = rt.yuks;
export const dummy: PickTable = rt.dummy;

/** Convenience bundle — single import point used by the engine. */
export const MSG = {
  fmt,
  pick,
  roomObject,
  parser,
  describeRoom,
  finish,
  goto,
  jigsUp,
  hackHack,
  hellos,
  hitSpot,
  hoHum,
  idrop,
  itake,
  jumploss,
  preBoard,
  preBurn,
  preGive,
  preMung,
  preMove,
  preRead,
  preTake,
  scoreUpd,
  tellNoPrsi,
  vAdvent,
  vAlarm,
  vAnswer,
  vAttack,
  vBack,
  vBlast,
  vBoard,
  vBrief,
  vBrush,
  vBug,
  vBurn,
  vChomp,
  vClimbUp,
  vClose,
  vCommand,
  vCount,
  vCross,
  vCurses,
  vCut,
  vDeflate,
  vDig,
  vDisembark,
  vDrinkFrom,
  vDrop,
  vEat,
  vExamine,
  vExorcise,
  vFill,
  vFind,
  vFollow,
  vFrobozz,
  vGive,
  vHatch,
  vHello,
  vInflate,
  vInventory,
  vKiss,
  vKnock,
  vLampOff,
  vLampOn,
  vLaunch,
  vLeanOn,
  vLeap,
  vListen,
  vLock,
  vLookBehind,
  vLookInside,
  vLookOn,
  vLookUnder,
  vMake,
  vMelt,
  vMove,
  vMumble,
  vMung,
  vOil,
  vOpen,
  vOverboard,
  vPick,
  vPlug,
  vPourOn,
  vPray,
  vPump,
  vPushTo,
  vPut,
  vPutBehind,
  vPutOn,
  vPutUnder,
  vVersion,
  vScript,
  vQuit,
  vRape,
  vRead,
  vRepent,
  vReply,
  vRestart,
  vRing,
  vSay,
  vSearch,
  vSend,
  vShake,
  vSmell,
  vSpin,
  vSqueeze,
  vStab,
  vStand,
  vStay,
  vStrike,
  vSuperBrief,
  vSwim,
  vSwing,
  vTake,
  vTell,
  vThrow,
  vThrowOff,
  vTie,
  vTieUp,
  vTurn,
  vUntie,
  vVerbose,
  vWait,
  vWalk,
  vWalkAround,
  vWalkTo,
  vWear,
  vWin,
  vWind,
  vWish,
  vYell,
  vZork,
  wheeeee,
  yuks,
  dummy,
} as const;
