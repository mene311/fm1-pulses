// codec check for js/felucca.js (run with: node .tmp-felucca.test.mjs)
import * as fel from "./felucca.js";
import assert from "node:assert/strict";

let n = 0;
const ok = (name, fn) => {
  try { fn(); n++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name + ": " + e.message); process.exitCode = 1; }
};

ok("frame INFO", () => assert.deepEqual(fel.frame(fel.CMD.INFO), [0xF0, 0x7D, 0x46, 0x4C, 1, 0xF7]));
ok("frame TRACK_STEP args", () => assert.deepEqual(fel.frame(30, [2, 63]), [0xF0, 0x7D, 0x46, 0x4C, 30, 2, 63, 0xF7]));

// An INFO reply byte-for-byte as firmware/src/editor.c builds it.
const infoArgs = (() => {
  const s = (t) => [...Buffer.from(t, "ascii"), 0];
  const args = [...s("FELUCCA v1.5.1"), 14, 91, 21, 64, 83];
  for (const e of ["ANALOG", "-", "PHASE", "LOFI", "SAMPLE", "VOICE", "TRIO", "WHEEL",
                   "GRAIN", "PHYS", "DRUM", "NOISE", "FM6", "SLICE"]) args.push(...s(e));
  args.push(4, 16, 0x55, 1, 0, 0x4D, 1, 64, 1, 0x42, 1, 3, 0x46, 1, 8, 0, 0x53, 1, 3);
  return args;
})();
const infoReply = [0xF0, 0x7D, 0x46, 0x4C, 1, ...infoArgs, 0xF7];

ok("decodeInfo", () => {
  const info = fel.decodeInfo(fel.reply(infoReply, 1));
  assert.equal(info.version, "FELUCCA v1.5.1");
  assert.equal(info.nengines, 14);
  assert.equal(info.pcount, 91);
  assert.equal(info.nstep, 64);
  assert.equal(info.pe0, 83);
  assert.equal(info.ntrk, 4);
  assert.equal(info.chainRows, 16);
  assert.equal(info.engines.length, 14);
  assert.equal(info.engines[12], "FM6");
});
ok("reply rejects another command", () => assert.equal(fel.reply(infoReply, 6), null));
ok("reply rejects the Baud Girl frame", () => assert.equal(fel.reply([0xF0, 0x7D, 0x00, 0x59, 0x30, 0x00, 0xF7], 1), null));

const st = { n: 2, notes: [60, 64, 0, 0], time: fel.ST.NOTE, flags: fel.SF.ACCENT, vel: 100, chance: 100 };
ok("stepBytes", () => assert.deepEqual(fel.stepBytes(st), [2, 60, 64, 0, 0, 0, 1, 100, 0, 0, 0, 100]));
const stepReplyArgs = [2, 7, ...fel.stepBytes(st), 1, 0];   // + ratchet, nudge
ok("readStep", () => {
  const r = fel.readStep(stepReplyArgs);
  assert.equal(r.track, 2);
  assert.equal(r.index, 7);
  assert.equal(r.n, 2);
  assert.deepEqual(r.notes, [60, 64, 0, 0]);
  assert.equal(r.chance, 100);
  assert.equal(r.ratchet, 1);
});
ok("sameStep", () => assert.equal(fel.sameStep(st, fel.readStep(stepReplyArgs)), true));
ok("sameStep sees a difference", () =>
  assert.equal(fel.sameStep(st, fel.readStep([2, 7, ...fel.stepBytes({ ...st, notes: [60, 65, 0, 0] }), 1, 0])), false));

const pattern = { length: 5, steps: Array.from({ length: 64 }, () => ({ notes: [] })) };
pattern.steps[0] = { notes: [{ note: 60, vel: 99 }, { note: 64 }, { note: 67 }, { note: 72 }, { note: 76 }] };
pattern.steps[2] = { notes: [{ note: 40, vel: 55 }] };
const steps = fel.pulseSteps(pattern, 8);
ok("pulseSteps count", () => assert.equal(steps.length, 8));
ok("pulseSteps truncates to 4 notes", () => {
  assert.equal(steps[0].n, 4);
  assert.deepEqual(steps[0].notes, [60, 64, 67, 72]);
});
ok("pulseSteps vel from the first note", () => assert.equal(steps[0].vel, 99));
ok("pulseSteps note step", () => {
  assert.equal(steps[2].time, fel.ST.NOTE);
  assert.equal(steps[2].vel, 55);
});
ok("pulseSteps rests the tail", () => {
  assert.equal(steps[5].time, fel.ST.REST);
  assert.equal(steps[7].time, fel.ST.REST);
});
ok("restStep", () => assert.deepEqual(fel.restStep(),
  { n: 0, notes: [0, 0, 0, 0], time: 2, flags: 0, vel: 0, hit: 0, acc: 0, hi: 0, chance: 100 }));

console.log(`${n} checks passed`);
