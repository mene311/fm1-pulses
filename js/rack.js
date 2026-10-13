// rack.js — the single-module knob UI. Same engine as app.js (generator, pattern,
// midi, audio); only the controls differ: one portrait case, knobs on top and the
// pattern display inside the case below. app.js and the MVP are untouched.
import { generate, generateBank, SCALES, LFO_WAVES, midiName, classicName } from "./generator.js?v=71";
import { encodeWrite, emptyPattern } from "./pattern.js?v=65";
import * as midi from "./midi.js?v=69";
import * as fel from "./felucca.js?v=1";
import * as audio from "./audio.js?v=67";
import { knob, sw } from "./knob.js?v=66";

const RATE_NAMES = ["1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
const RATE_QUARTERS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
const SLOTS = 16;

const DEFAULT = {
  seed: (Math.random() * 1e9) | 0,
  drift: 50,
  length: 64, rate: 6, tempo: 120, swing: 50, gate: 50,
  gateProb: 70, velocity: 100, humanize: 0, gateQuant: 0, snapGrid: 4,
  gateBlend: 0, euclidRot: 0,
  scale: "pentMinor", root: 60,
  lfoWave: "sine", lfoShape: 0, lfoAmp: 50, lfoOffset: 0, lfoRate: 4, octave: 0, gravity: 0, unipolar: false,
  spread: "uniform", bias: 0, quantSteps: 100, dejaVu: 0, loop: 8, loopFrom: 1,
};
const state = { ...DEFAULT };
let bank = [];
let selected = 0;
let busy = false;
let editStep = -1;
const locks = new Map();   // "slot:step" -> [{ note, vel }]
const refs = {};           // state key -> control element (has setValue)

function status(msg, cls = "") {
  const el = document.getElementById("status");
  if (el) { el.textContent = msg; el.className = "status " + cls; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------- //
// Sequencer (ported from app.js, unchanged behaviour)
// --------------------------------------------------------------------------- //
function noteCount(p) {
  return p ? p.steps.slice(0, p.length).reduce((a, s) => a + s.notes.length, 0) : 0;
}

function renderBank() {
  const el = document.getElementById("bank");
  el.innerHTML = "";
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);   // where the loop replay begins, 0-based
  const ln = Math.round(state.loop ?? 0);                        // loop material = the first `ln` steps
  for (let s = 0; s < SLOTS; s++) {
    const p = bank[s];
    const cell = document.createElement("button");
    cell.className = "bankcell" + (s === selected ? " sel" : "");
    const num = document.createElement("span"); num.className = "bn"; num.textContent = s + 1;
    const mini = document.createElement("div"); mini.className = "mini";
    const loopOn = p && ln >= 2 && ln <= p.length && ls < p.length;
    for (let i = 0; i < 64; i++) {
      const d = document.createElement("i");
      const cls = [];
      if (p && i < p.length && p.steps[i] && p.steps[i].notes.length) cls.push("on");
      if (loopOn && i < ln) cls.push("loop");                    // the repeated material
      if (loopOn && i === ls) cls.push("loopstart");             // where the replay starts
      d.className = cls.join(" ");
      mini.appendChild(d);
    }
    const cnt = document.createElement("span"); cnt.className = "bc"; cnt.textContent = noteCount(p);
    cell.append(num, mini, cnt);
    cell.title = `slot ${s + 1}: ${noteCount(p)} notes`;
    cell.addEventListener("click", () => { selected = s; renderBank(); renderBuffer(); if (!live) playOnce(s); });
    el.appendChild(cell);
  }
  const el2 = document.getElementById("bufinfo");
  if (el2) el2.textContent = bank.length ? `drift ${state.drift}%` : "";
}

function applyLocks() {
  for (const [key, notes] of locks) {
    const [s, i] = key.split(":").map(Number);
    const p = bank[s];
    if (p && p.steps[i]) p.steps[i].notes = notes.map((n) => ({ ...n }));
  }
}

function refreshLockCount() {
  const el = document.getElementById("lockcount");
  if (el) el.textContent = locks.size ? `${locks.size} locked` : "";
}

function renderEditor() {
  const p = bank[selected];
  const has = editStep >= 0 && p && p.steps[editStep];
  document.getElementById("estep").textContent = editStep >= 0 ? String(editStep + 1) : "—";
  const noteEl = document.getElementById("enote");
  const lockBtn = document.getElementById("elock");
  if (!has) {
    noteEl.textContent = "—";
    lockBtn.textContent = "🔓"; lockBtn.classList.remove("on");
    return;
  }
  const notes = p.steps[editStep].notes;
  noteEl.textContent = notes.length ? notes.map((n) => midiName(n.note)).join(" ") : "(empty)";
  const isL = locks.has(`${selected}:${editStep}`);
  lockBtn.textContent = isL ? "🔒" : "🔓";
  lockBtn.classList.toggle("on", isL);
}

function selectStep(i) { editStep = i; renderBuffer(); }

function setStepNote(i, note) {
  const p = bank[selected];
  if (!p || !p.steps[i]) return;
  if (note == null) p.steps[i].notes = [];
  else {
    const v = p.steps[i].notes[0]?.vel ?? state.velocity ?? 100;
    p.steps[i].notes = [{ note: Math.max(0, Math.min(127, note)), vel: Math.max(1, Math.min(127, v)) }];
  }
  delete p.steps[i].echo;   // an edited step is no longer a pure copy of the motif
  locks.set(`${selected}:${i}`, p.steps[i].notes.map((n) => ({ ...n })));
  renderBank(); renderBuffer(); refreshLockCount();
}

function clearLocks() { locks.clear(); renderBank(); renderBuffer(); refreshLockCount(); status("locks cleared"); }

function renderBuffer() {
  const el = document.getElementById("steps");
  el.innerHTML = "";
  const p = bank[selected];
  if (!p) return;
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);   // where the loop replay begins, 0-based
  const ln = Math.round(state.loop ?? 0);                        // loop material = the first `ln` steps
  const loopOn = ln >= 2 && ln <= p.length && ls < p.length;
  for (let i = 0; i < 64; i++) {
    const st = p.steps[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    const dot = document.createElement("span");
    dot.className = "dot";
    cell.appendChild(dot);
    const on = i < p.length && st && st.notes.length;
    if (on) {
      dot.textContent = midiName(st.notes[0].note);
      cell.classList.add("on");
      cell.title = st.notes.map((n) => `${midiName(n.note)} v${n.vel}`).join("  ");
    } else if (i >= p.length) cell.classList.add("off");
    if (loopOn && i < ln) cell.classList.add("loop");            // the material the loop repeats
    if (loopOn && i === ls) cell.classList.add("loopstart");     // where the replay (re)starts
    if (st && st.echo != null) cell.classList.add("echo");       // a step the loop copied from the material
    if (locks.has(`${selected}:${i}`)) cell.classList.add("locked");
    if (i === editStep) cell.classList.add("edit");
    cell.addEventListener("click", () => selectStep(i));
    el.appendChild(cell);
  }
  document.getElementById("selnum").textContent = String(selected + 1);
  document.getElementById("bufinfo").textContent = `${p.length} steps · ${RATE_NAMES[p.rate]} · ${noteCount(p)} notes`;
  renderEditor();
  fitSteps();
  renderScope();
  renderRoll();
}

// Size every step dot to min(cell width, row height) so the circles can never
// stretch into ellipses when the grid is taller than it is wide (small phones).
function fitSteps() {
  const grid = document.getElementById("steps");
  if (!grid) return;
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.gap) || 0;
  const cellW = (grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * 7) / 8;
  let dot = cellW;
  const hSpace = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - gap * 7;
  // -4px tolerance: in content-sized layouts the measured height IS the current dot
  // size, so without it every render would shave another 2px (feedback loop).
  if (hSpace > 0 && hSpace / 8 < cellW - 4) dot = hSpace / 8;
  grid.style.setProperty("--dot", Math.max(8, Math.floor(dot) - 2) + "px");
}

// --------------------------------------------------------------------------- //
// Piano roll — the Felucca SEQ > STEP view, shown when the Felucca profile is
// on (the dot matrix stays for the Baud Girl bank firmwares). Pitch rows, step
// columns, loop region, locks, echo steps and the live playhead.
// --------------------------------------------------------------------------- //
const ROLL_PADX = 22, ROLL_PADT = 6, ROLL_PADB = 8;
let rollHover = null, rollGeo = null;

function renderRoll() {
  const cv = document.getElementById("roll");
  if (!cv || !cv.clientWidth || profile !== "felucca") return;
  const p = bank[selected];
  if (!p) return;

  const w = cv.clientWidth, h = cv.clientHeight || 200;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0b0e";
  ctx.fillRect(0, 0, w, h);

  // the slot's pitch span, padded, never narrower than an octave
  let lo = 127, hi = 0;
  for (let i = 0; i < p.length && i < 64; i++)
    for (const n of p.steps[i]?.notes ?? []) { if (n.note < lo) lo = n.note; if (n.note > hi) hi = n.note; }
  if (hi < lo) { lo = 60; hi = 71; }
  lo -= 2; hi += 2;
  if (hi - lo < 13) { const c = Math.round((lo + hi) / 2); lo = c - 7; hi = c + 7; }

  const rows = hi - lo + 1;
  const innerW = w - ROLL_PADX - 4;
  const innerH = h - ROLL_PADT - ROLL_PADB;
  const colW = innerW / 64, rowH = innerH / rows;
  rollGeo = { lo, hi, colW, rowH, w, h };
  const X = (i) => ROLL_PADX + i * colW;
  const Y = (n) => ROLL_PADT + (hi - n) * rowH;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e8a33d";

  // rows: in-key rows a touch brighter, C rows labelled
  const scale = SCALES[state.scale] || SCALES.chromatic;
  const root = ((Math.round(state.root ?? 60) % 12) + 12) % 12;
  ctx.font = "8px 'Barlow Semi Condensed', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (let n = lo; n <= hi; n++) {
    const inKey = scale.includes(((n - root) % 12 + 12) % 12);
    ctx.fillStyle = inKey ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.012)";
    ctx.fillRect(ROLL_PADX, Y(n), innerW, rowH);
    if (n % 12 === 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.moveTo(ROLL_PADX, Y(n) + rowH - 0.5); ctx.lineTo(w - 4, Y(n) + rowH - 0.5); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.fillText(midiName(n), 3, Y(n) + rowH / 2);
    }
  }

  // step grid: bar lines every 16 steps, beat lines every 4
  for (let i = 0; i <= 64; i += 4) {
    ctx.strokeStyle = i % 16 === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.055)";
    ctx.beginPath(); ctx.moveTo(X(i) + 0.5, ROLL_PADT); ctx.lineTo(X(i) + 0.5, h - ROLL_PADB); ctx.stroke();
  }

  // loop region (the material + where the replay starts)
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);
  const ln = Math.round(state.loop ?? 0);
  if (ln >= 2 && ls < p.length) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(X(ls), ROLL_PADT, colW * Math.min(ln, p.length - ls), innerH);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath(); ctx.moveTo(X(ls) + 0.5, ROLL_PADT); ctx.lineTo(X(ls) + 0.5, h - ROLL_PADB); ctx.stroke();
  }

  // notes: a bar per note, width from the Gate knob; echo copies dimmer
  const gw = Math.max(0.35, Math.min(0.95, (state.gate ?? 50) / 100)) * colW;
  for (let i = 0; i < 64; i++) {
    const st = p.steps[i];
    if (!st || i >= p.length || !st.notes.length) continue;
    const echo = st.echo != null;
    for (const n of st.notes) {
      const y = Y(n.note);
      ctx.globalAlpha = echo ? 0.4 : 0.6 + 0.4 * Math.min(1, (n.vel ?? 100) / 127);
      ctx.fillStyle = accent;
      ctx.fillRect(X(i) + 1, y + 1, Math.max(2, gw - 1), Math.max(2, rowH - 2));
      ctx.globalAlpha = 1;
      if (locks.has(`${selected}:${i}`)) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(X(i) + 1, y + rowH - 1.5);
        ctx.lineTo(X(i) + Math.max(2, gw - 1), y + rowH - 1.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // hover, selection, playhead
  const hover = rollHover ?? scopeHover;
  if (hover != null && hover !== editStep) {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(X(hover) + 0.5, ROLL_PADT + 0.5, colW - 1, innerH - 1);
  }
  if (editStep >= 0) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(editStep) + 0.5, ROLL_PADT + 0.5, colW - 1, innerH - 1);
    ctx.lineWidth = 1;
  }
  if (scopeNow != null) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(scopeNow) + 0.5, ROLL_PADT); ctx.lineTo(X(scopeNow) + 0.5, h - ROLL_PADB); ctx.stroke();
    ctx.lineWidth = 1;
  }
}

// Which step and pitch a pointer is over (for the tap-to-place editing).
function rollHit(ev) {
  const cv = document.getElementById("roll");
  if (!cv || !rollGeo || profile !== "felucca") return null;
  const r = cv.getBoundingClientRect();
  const x = ev.clientX - r.left - ROLL_PADX;
  const y = ev.clientY - r.top - ROLL_PADT;
  if (x < 0 || y < 0 || x > rollGeo.w - ROLL_PADX || y > rollGeo.h - ROLL_PADT - ROLL_PADB) return null;
  const i = Math.max(0, Math.min(63, Math.floor(x / rollGeo.colW)));
  const note = Math.max(rollGeo.lo, Math.min(rollGeo.hi, rollGeo.hi - Math.floor(y / rollGeo.rowH)));
  return { i, note };
}

// Wave scope — a DEBUG readout, deliberately plainer than the panel UI.
// Shows: the pitch contour the LFO produced (line), the notes that actually
// play (dots + stems), a staircase trace through the played notes (what the
// ear gets after the quantizer), gate triggers as a lane along the bottom,
// cycle boundaries, C-octave reference lines, loop region, playhead, and a
// hover readout per step.
const SCOPE_PADT = 14, SCOPE_PADB = 16, SCOPE_PADX = 20;
let scopeNow = null, scopeHover = null;
function renderScope() {
  const cv = document.getElementById("wave");
  const p = bank[selected];
  if (!cv || !p) return;
  const w = cv.clientWidth || 320, h = cv.clientHeight || 150;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0b0e";
  ctx.fillRect(0, 0, w, h);

  const n = 64;
  const cont = p.contour || [];
  const played = [];
  let lo = 127, hi = 0;
  for (let i = 0; i < n; i++) {
    const v = cont[i];
    if (v != null && v < lo) lo = v;
    if (v != null && v > hi) hi = v;
    const nt = i < p.length && p.steps[i]?.notes.length ? p.steps[i].notes[0].note : null;
    if (nt != null) { played.push([i, nt]); if (nt < lo) lo = nt; if (nt > hi) hi = nt; }
  }
  if (hi - lo < 4) { const c = (lo + hi) / 2; lo = c - 2; hi = c + 2; }
  const Y = (v) => SCOPE_PADT + (h - SCOPE_PADT - SCOPE_PADB) * (1 - (v - lo) / (hi - lo));
  const X = (i) => SCOPE_PADX + i / (n - 1) * (w - 2 * SCOPE_PADX);

  // C-octave reference lines + labels (left)
  ctx.font = "8px 'Barlow Semi Condensed', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (let c = Math.ceil(lo / 12) * 12; c <= hi; c += 12) {
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(SCOPE_PADX, Y(c) + 0.5); ctx.lineTo(w - 4, Y(c) + 0.5); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(midiName(c), 3, Y(c));
  }

  // cycle boundaries (the LFO's own grid, same math as the generator)
  const cycles = Math.max(0.1, Math.min(16, state.lfoRate || 4));
  const isRandom = state.lfoWave === "random";
  const div = Math.max(isRandom ? 1 : 2.5, p.length / cycles);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.setLineDash([2, 3]);
  for (let x = div; x < p.length; x += div) {
    ctx.beginPath(); ctx.moveTo(X(x) + 0.5, SCOPE_PADT); ctx.lineTo(X(x) + 0.5, h - SCOPE_PADB); ctx.stroke();
  }
  ctx.setLineDash([]);

  // loop region backdrop + start guide
  const ls = Math.max(0, Math.round(state.loopFrom ?? 1) - 1);
  const ln = Math.round(state.loop ?? 0);
  if (ln >= 2 && ls + ln <= p.length) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(X(ls), SCOPE_PADT, X(ls + ln) - X(ls), h - SCOPE_PADT - SCOPE_PADB);
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(ls) + 0.5, SCOPE_PADT); ctx.lineTo(X(ls) + 0.5, h - SCOPE_PADB); ctx.stroke();
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e8a33d";
  // contour: full accent inside the phrase, dimmed past its length
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  const seg = (i0, i1, alpha) => {
    if (i0 > i1 || cont[i0] == null) return;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(X(i0), Y(cont[i0]));
    for (let i = i0 + 1; i <= i1; i++) {
      if (cont[i] == null) continue;
      ctx.lineTo(X(i), Y(cont[i]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  seg(0, p.length - 1, 1);
  if (p.length < n) seg(p.length, n - 1, 0.35);

  // staircase: the quantized melody as the ear gets it (connect played dots)
  if (played.length > 1) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(played[0][0]), Y(played[0][1]));
    for (let k = 1; k < played.length; k++) ctx.lineTo(X(played[k][0]), Y(played[k][1]));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // played notes: stem from the contour, dot at the quantized pitch
  for (const [i, nt] of played) {
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(i), Y(cont[i] ?? nt)); ctx.lineTo(X(i), Y(nt)); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(X(i), Y(nt), 2.6, 0, Math.PI * 2); ctx.fill();
  }

  // gate trigger lane: dim bar = gate opened, accent bar = a note survived
  const laneY = h - SCOPE_PADB;
  const laneH = SCOPE_PADB - 4;
  const bw = (w - 2 * SCOPE_PADX) / n;
  for (let i = 0; i < p.length; i++) {
    const gated = p.gates?.[i] === 1;
    const on = p.steps[i]?.notes.length;
    if (!gated && !on) continue;
    ctx.fillStyle = on ? accent : "rgba(255,255,255,0.22)";
    ctx.fillRect(X(i) - bw / 2 + 0.5, laneY + 2, Math.max(1, bw - 1), laneH - 2);
  }

  // playhead
  if (scopeNow != null) {
    ctx.strokeStyle = "#ececf0";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(scopeNow) + 0.5, SCOPE_PADT); ctx.lineTo(X(scopeNow) + 0.5, h - 2); ctx.stroke();
  }
  // hover guide
  if (scopeHover != null) {
    ctx.strokeStyle = "rgba(236,236,240,0.45)";
    ctx.beginPath(); ctx.moveTo(X(scopeHover) + 0.5, SCOPE_PADT); ctx.lineTo(X(scopeHover) + 0.5, h - 2); ctx.stroke();
  }

  // labels: wave · cycles · div | hover readout | lo/hi notes
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "#9a9aa2";
  ctx.font = "9px 'Barlow Semi Condensed', sans-serif";
  ctx.fillText(`${state.lfoWave ?? "sine"} · ${cycles} cyc · div ${div.toFixed(1)}`, 4, 2);
  if (scopeHover != null) {
    const i = scopeHover;
    const gated = i < p.length && p.gates?.[i] === 1;
    const nt = i < p.length && p.steps[i]?.notes.length ? p.steps[i].notes[0].note : null;
    ctx.fillStyle = "#ececf0";
    ctx.fillText(`step ${i + 1}: ${midiName(cont[i] ?? 0)}${nt != null ? " → " + midiName(nt) : gated ? " (gated, no note)" : " (rest)"}`, 150, 2);
  }
  ctx.textAlign = "right";
  ctx.fillText(midiName(Math.round(hi)), w - 4, 2);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(midiName(Math.round(lo)), w - 4, h - SCOPE_PADB - 1);
  ctx.textAlign = "left";
  renderRoll();
}

// Header fields apply to every slot without a regen.
function syncHeader() {
  for (const p of bank) {
    if (!p) continue;
    p.tempo = state.tempo; p.rate = state.rate; p.gate = state.gate; p.swing = state.swing;
    p.length = Math.max(1, Math.min(64, state.length));
    for (const st of p.steps) st.rate = state.rate;
  }
}

// --------------------------------------------------------------------------- //
// Generation
// --------------------------------------------------------------------------- //
function doGenerate(newSeed = false) {
  if (newSeed) state.seed = (Math.random() * 1e9) | 0;
  refs.seed?.setValue(state.seed, false);
  bank = generateBank(state, state.drift);
  applyLocks();
  renderBank(); renderBuffer();
  status(`16 slots · seed ${state.seed}`);
}

let regenTimer = null;
function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    bank = generateBank(state, state.drift);
    applyLocks();
    renderBank(); renderBuffer();
  }, 40);
  scheduleTempoProbe();
}

// Trailing device-tempo probe: every control tweak schedules ONE read that fires
// 1.2s after the user stops interacting. Dragging resets the timer, so there is
// no traffic while turning a knob — just one read after the hand leaves it. The
// busy flag keeps a slow reply from overlapping the next probe.
let tempoProbeTimer = null;
let tempoProbeBusy = false;
function scheduleTempoProbe() {
  if (profile === "felucca") return;      // no 0x11 memory read on this firmware
  if (!midi.hasAccess()) return;
  clearTimeout(tempoProbeTimer);
  tempoProbeTimer = setTimeout(() => {
    if (tempoProbeBusy || !midi.findFm1()) return;
    tempoProbeBusy = true;
    const before = state.tempo;
    syncDeviceTempo().catch(() => null).finally(() => { tempoProbeBusy = false; })
      .then((held) => {
        if (held && held !== before) status(`device BPM: ${held} — Tempo synced`, "ok");
      });
  }, 1200);
}

// --------------------------------------------------------------------------- //
// Freeze / clear
// --------------------------------------------------------------------------- //
// The FM-1 keeps each pattern's tempo in its global settings block, as a
// little-endian halfword at gset[66 + 2*pattern]. Read it back so a freeze can
// report what the DEVICE is holding, not just what we sent.
const GSET_ADDR = 0x01C0E840 + 5816;
const GSET_LEN = 137;
async function readBack(pat) {
  const data = await midi.readMemory(GSET_ADDR, GSET_LEN);
  if (data.length < 68 + 2 * pat) throw new Error(`short read (${data.length} bytes)`);
  return { tempo: data[66 + 2 * pat] | (data[67 + 2 * pat] << 7), data };
}
const hex = (a) => Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(" ");

// Diagnostic: dump the whole settings block. Change ONE thing on the FM-1 itself
// (e.g. its tempo), read again, and the bytes that moved are that setting — which
// pins the true offset for this firmware instead of trusting another version's map.
async function dumpGset() {
  try {
    status("reading the device's settings block…");
    const data = await midi.readMemory(GSET_ADDR, GSET_LEN);
    await syncDeviceTempo(data);
    const rows = [];
    for (let i = 0; i < data.length; i += 16) {
      rows.push(String(i).padStart(3, "0") + ": " +
        Array.from(data.slice(i, i + 16)).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    }
    alert(`FM-1 global settings, ${data.length} bytes\n\n${rows.join("\n")}`);
    status(`read ${data.length} bytes · Tempo synced to the device's BPM`, "ok");
  } catch (e) { status("read failed: " + (e.message || e), "err"); }
}

// The FM-1's tempo is unit-global (mirrored across all 16 slots) and the 0x20
// header tempo is acked but ignored by the firmware, so the DEVICE is the source
// of truth: read it and snap the Tempo knob to it — what you see is what plays.
// `data` skips the read when a caller already has the settings block.
async function syncDeviceTempo(data = null, retries = 2) {
  try {
    if (!data) data = await midi.readMemory(GSET_ADDR, GSET_LEN);
    const held = data[66 + 2 * selected] | (data[67 + 2 * selected] << 7);
    if (held >= 30 && held <= 300) {
      state.tempo = held;
      refs.tempo?.setValue(held, false);
      return held;
    }
    return null;
  } catch (e) {
    if (retries > 0) return syncDeviceTempo(null, retries - 1);
    return null;
  }
}

async function doFreeze(slotIndex) {
  if (!bank[slotIndex]) return;
  if (profile === "felucca") return doFreezeFelucca(slotIndex);
  syncHeader();
  try {
    status(`freezing slot ${slotIndex + 1} · ${Math.round(state.tempo)} bpm · ${RATE_NAMES[state.rate]}…`);
    const name = await midi.sendPattern(encodeWrite(bank[slotIndex], slotIndex, true), `slot ${slotIndex + 1}`);
    // read it back: did the DEVICE store the tempo we just sent? (Spoiler on
    // Baud Girl 093: never. The tempo bytes are acked and discarded, so we
    // re-sync the knob to the device's real BPM instead of pretending.)
    try {
      const { tempo: held, data } = await readBack(slotIndex);
      const want = Math.round(state.tempo);
      const off = 66 + 2 * slotIndex;
      if (held !== want) {
        await syncDeviceTempo(data);
        status(`slot ${slotIndex + 1} frozen ✓ · FM-1 holds ${held} bpm (sent ${want}) — tempo is device-global on this firmware, so Tempo now shows the device's BPM`,
          "err");
      } else {
        status(`slot ${slotIndex + 1} frozen ✓ · sent ${want} bpm, device holds ${held} bpm`, "ok");
      }
    } catch (e) {
      await syncDeviceTempo();
      status(`slot ${slotIndex + 1} frozen ✓ (read-back: ${e.message || e})`, "ok");
    }
  } catch (e) { status(String(e.message || e), "err"); }
}

async function doSendAll() {
  if (profile === "felucca") return doSendAllFelucca();
  if (busy || !bank.length) return;
  busy = true;
  try {
    syncHeader();
    for (let i = 0; i < SLOTS; i++) {
      status(`freezing ${i + 1}/${SLOTS} · ${Math.round(state.tempo)} bpm · ${RATE_NAMES[state.rate]}…`);
      await midi.sendPattern(encodeWrite(bank[i], i, true), `slot ${i + 1}`);
    }
    const held = await syncDeviceTempo();
    status(`all ${SLOTS} slots frozen ✓${held ? ` · device holds ${held} bpm` : ""}`, "ok");
  } catch (e) { status(String(e.message || e), "err"); }
  finally { busy = false; }
}

async function doClearAll() {
  if (busy || !bank.length) return;
  if (!confirm(`Erase all ${SLOTS} patterns on the FM-1?\n\nThis overwrites them with empty patterns. The browser bank is not affected.`)) return;
  busy = true;
  try {
    const blank = emptyPattern(64, state.rate, state.tempo, state.gate, state.swing);
    for (let i = 0; i < SLOTS; i++) {
      status(`clearing ${i + 1}/${SLOTS}…`);
      await midi.sendPattern(encodeWrite(blank, i, true), `slot ${i + 1}`);
    }
    const held = await syncDeviceTempo();
    status(`all ${SLOTS} patterns cleared ✓${held ? ` · device holds ${held} bpm` : ""}`, "ok");
  } catch (e) { status(String(e.message || e), "err"); }
  finally { busy = false; }
}

// --------------------------------------------------------------------------- //
// Felucca (editor protocol v7): detect the firmware, then freeze / clear a track
// --------------------------------------------------------------------------- //
let profile = null;      // null unknown · "felucca" · "baudgirl"
let fwInfo = null;       // the INFO reply while the Felucca profile is on
const felTrack = () => Math.max(0, Math.min(3, Number(document.getElementById("ftrack")?.value ?? 0) || 0));

function paintProfile() {
  const isFel = profile === "felucca";
  const ft = document.getElementById("ftrack");
  if (ft) ft.style.display = isFel ? "" : "none";
  const roll = document.getElementById("roll");
  if (roll) roll.style.display = isFel ? "block" : "none";
  const steps = document.getElementById("steps");
  if (steps) steps.style.display = isFel ? "none" : "";
  if (isFel) renderRoll(); else fitSteps();
  const freezeBtn = document.getElementById("freeze");
  if (freezeBtn) freezeBtn.title = isFel ? "Write the selected slot into the target track (F)"
                                         : "Write the selected slot into the FM-1 (F)";
  const fillBtn = document.getElementById("fill");
  if (fillBtn) {
    fillBtn.disabled = false;
    fillBtn.textContent = isFel ? "Send A–D" : "Send 16";
    fillBtn.title = isFel
      ? "Write all 16 slots into the four projects A–D: slots 1–4 → A tracks 1–4, then B, C, D — replaces their steps and saves flash"
      : "Write all 16 slots into the FM-1";
  }
  const clearBtn = document.getElementById("clearall");
  if (clearBtn) clearBtn.title = isFel ? "Clear the 64 steps of the target track on the FM-1"
                                       : "Erase all 16 patterns on the FM-1";
  const diagBtn = document.getElementById("diag");
  if (diagBtn && isFel) diagBtn.style.display = "none";
}

// INFO answers on Felucca (and its forks); the Baud Girl firmwares do not
// implement it, which is what tells the two apart.
async function detectFirmware() {
  if (!midi.hasAccess() || !midi.findFm1()) { profile = null; fwInfo = null; paintProfile(); return null; }
  try {
    const rep = await midi.sendSysex(fel.frame(fel.CMD.INFO), 1200,
      (d) => d[1] === 0x7D && d[2] === 0x46 && d[3] === 0x4C && d[4] === fel.CMD.INFO);
    const args = fel.reply(rep, fel.CMD.INFO);
    fwInfo = args ? fel.decodeInfo(args) : null;
  } catch { fwInfo = null; }
  profile = fwInfo ? "felucca" : "baudgirl";
  paintProfile();
  if (fwInfo) status(`FM-1 runs ${fwInfo.version} · freeze writes one of ${fwInfo.ntrk} tracks, ${fwInfo.nstep} steps`, "ok");
  return fwInfo;
}

async function felReq(cmd, args, timeoutMs = 1500, tries = 2) {
  for (let k = 0; k < tries; k++) {
    const rep = await midi.sendSysex(fel.frame(cmd, args), timeoutMs,
      (d) => d[1] === 0x7D && d[2] === 0x46 && d[3] === 0x4C && d[4] === (cmd & 0x7F));
    const r = fel.reply(rep, cmd);
    if (r) return r;
  }
  return null;
}

async function felGetStep(track, index) {
  const r = await felReq(fel.CMD.TRACK_STEP, [track, index]);
  if (!r) throw new Error(`no reply for track ${track + 1} step ${index + 1}`);
  return fel.readStep(r);
}

async function felSetStep(track, index, st) {
  const r = await felReq(fel.CMD.TRACK_STEP, [track, index, ...fel.stepBytes(st)]);
  if (!r) throw new Error(`write refused at track ${track + 1} step ${index + 1}`);
  return fel.readStep(r);
}

// PROJECT (9): op 0 load, 1 save, 2 query; slot 0..3. The reply is op, slot, used.
async function felProject(op, slot, timeoutMs = 2500) {
  const r = await felReq(fel.CMD.PROJECT, [op, slot], timeoutMs, 1);
  return r && r.length >= 3 ? { op: r[0], slot: r[1], used: r[2] } : null;
}

// "Send A–D": the Felucca equivalent of Baud Girl's Send 16. Felucca has no
// 16-pattern bank — it has four projects, each with one 64-step sequence per
// track — so slots 1–4 go to project A's tracks 1–4, 5–8 to B, 9–12 to C and
// 13–16 to D. Per project: load it, write only the steps that differ, save it.
// Loads replace the live state (the sounds of that project come with it) and a
// save writes flash (~2 s) with the transport stopped.
async function doSendAllFelucca() {
  if (busy || !bank.length) return;
  if (!confirm("Write all 16 slots into the FM-1's four projects (A–D)?\n\n" +
               "Slots 1–4 → A tracks 1–4, 5–8 → B, 9–12 → C, 13–16 → D.\n\n" +
               "Each project's steps are replaced (its own sounds are kept and saved back). " +
               "Loading replaces the FM-1's live state, and saving writes flash with the transport stopped.")) return;
  busy = true;
  try {
    const info = fwInfo ?? await detectFirmware();
    const nstep = info?.nstep || 64;
    let changedAll = 0;
    for (let b = 0; b < 4; b++) {
      const letter = "ABCD"[b];
      status(`project ${letter}: loading…`);
      const load = await felProject(0, b, 2500);
      if (!load) throw new Error(`project ${letter}: no reply to the load — is the FM-1 connected?`);
      let bankChanged = 0;
      for (let t = 0; t < 4; t++) {
        const slot = b * 4 + t;
        const want = fel.pulseSteps(bank[slot], nstep, Math.round(state.velocity ?? 100));
        let changed = 0;
        for (let i = 0; i < nstep; i++) {
          const cur = await felGetStep(t, i);
          if (!fel.sameStep(want[i], cur)) { await felSetStep(t, i, want[i]); changed++; }
        }
        bankChanged += changed;
        status(`project ${letter} · track ${t + 1} · slot ${slot + 1}: ${changed}/${nstep} steps`);
      }
      changedAll += bankChanged;
      if (bankChanged === 0 && load.used) {
        status(`project ${letter}: already matches — not saved`);
        continue;
      }
      status(`project ${letter}: saving (flash, ~2 s)…`);
      const save = await felProject(1, b, 8000);
      if (!save) throw new Error(`project ${letter}: the save got no reply — stop the song/chain and retry`);
    }
    status(`all 16 slots written to projects A–D ✓ (${changedAll} steps changed)`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  } finally { busy = false; }
}

// Freeze slot -> one Felucca track. A dry run reads the track first and writes
// only the steps that differ, so a repeat freeze is a read-only no-op.
async function doFreezeFelucca(slotIndex) {
  if (busy || !bank[slotIndex]) return;
  busy = true;
  const track = felTrack();
  try {
    const info = fwInfo ?? await detectFirmware();
    const nstep = info?.nstep || 64;
    const want = fel.pulseSteps(bank[slotIndex], nstep, Math.round(state.velocity ?? 100));
    status(`freezing slot ${slotIndex + 1} → track ${track + 1}: reading ${nstep} steps…`);
    const plan = [];
    for (let i = 0; i < nstep; i++) {
      const cur = await felGetStep(track, i);
      if (!fel.sameStep(want[i], cur)) plan.push(i);
      if (i % 16 === 15) status(`freezing slot ${slotIndex + 1} → track ${track + 1}: read ${i + 1}/${nstep}`);
    }
    if (!plan.length) { status(`slot ${slotIndex + 1} is already on track ${track + 1} ✓`, "ok"); return; }
    for (let k = 0; k < plan.length; k++) {
      const i = plan[k];
      const read = await felSetStep(track, i, want[i]);
      if (read.n !== want[i].n || read.notes.join() !== want[i].notes.join())
        throw new Error(`step ${i + 1} did not take (device holds n=${read.n})`);
      if (k % 8 === 7) status(`freezing slot ${slotIndex + 1} → track ${track + 1}: wrote ${k + 1}/${plan.length}`);
    }
    status(`slot ${slotIndex + 1} frozen → track ${track + 1} ✓ (${plan.length}/${nstep} steps changed)`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  } finally { busy = false; }
}

async function doClearTrackFelucca() {
  if (busy) return;
  const track = felTrack();
  if (!confirm(`Clear the ${fwInfo?.nstep || 64} steps of track ${track + 1} on the FM-1?`)) return;
  busy = true;
  try {
    const info = fwInfo ?? await detectFirmware();
    const nstep = info?.nstep || 64;
    const rest = fel.restStep();
    for (let i = 0; i < nstep; i++) {
      await felSetStep(track, i, rest);
      if (i % 16 === 15) status(`clearing track ${track + 1}: ${i + 1}/${nstep}`);
    }
    status(`track ${track + 1} cleared ✓ (${nstep} steps)`, "ok");
  } catch (e) {
    status(String(e.message || e), "err");
  } finally { busy = false; }
}

// --------------------------------------------------------------------------- //
// Audition (browser synth + live MIDI)
// --------------------------------------------------------------------------- //
let live = false, liveToken = 0, nowCell = null, onceToken = 0;

function swingFrac() {
  const s = Math.min(75, Math.max(50, state.swing ?? 50));
  return ((s - 50) / 25) / 3;
}

// Live note out — routes to BLE when it is connected (play-only), USB otherwise.
function liveNoteOn(note, vel) {
  if (midi.bleConnected()) { midi.bleSendNoteOn(note, vel); return; }
  midi.sendNoteOn(note, vel);
}
function liveNoteOff(note) {
  if (midi.bleConnected()) { midi.bleSendNoteOff(note); return; }
  midi.sendNoteOff(note);
}

const previewHeld = new Set();   // pitches still sounding from a slot preview
function panicPreview() {
  for (const n of previewHeld) { try { liveNoteOff(n); } catch (_) {} try { audio.noteOff(n); } catch (_) {} }
  previewHeld.clear();
}

async function playOnce(index) {
  const slot = typeof index === "number" ? index : selected;
  const p = bank[slot];
  if (!p || live) return;
  const token = ++onceToken;
  panicPreview();                // never let the previous slot's notes bleed into this preview
  audio.unlock();
  const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
  const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
  for (let i = 0; i < p.length; i++) {
    if (token !== onceToken || live) return;
    const st = p.steps[i];
    const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
    const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
    const sDur = stepMs - late;
    if (late) await sleep(late);
    if (st.notes.length) {
      for (const n of st.notes) { previewHeld.add(n.note); liveNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
      await sleep(Math.max(12, sDur * gate));
      if (token !== onceToken || live) return;   // cancelled: panicPreview() already stopped these
      for (const n of st.notes) { previewHeld.delete(n.note); liveNoteOff(n.note); audio.noteOff(n.note); }
      await sleep(Math.max(3, sDur * (1 - gate)));
    } else await sleep(sDur);
  }
}

function clearPlayhead() {
  if (nowCell) nowCell.classList.remove("now");
  nowCell = null;
  scopeNow = null;
  renderScope();
}

function markStep(i) {
  const el = document.getElementById("steps");
  if (nowCell) nowCell.classList.remove("now");
  nowCell = el.children[i] || null;
  if (nowCell) nowCell.classList.add("now");
  scopeNow = i;
  renderScope();
}

function stopLive() {
  live = false; liveToken++;
  clearPlayhead();
  const btn = document.getElementById("audition");
  if (btn) { btn.textContent = "▶ Play"; btn.classList.remove("playing"); }
  status("stopped");
}

function toggleLive() {
  if (live) { stopLive(); return; }
  onceToken++;
  panicPreview();
  live = true; liveToken++;
  audio.unlock();
  const btn = document.getElementById("audition");
  btn.textContent = "■ Stop"; btn.classList.add("playing");
  status("playing (loop)");
  // WYSIWYG: re-read the device's BPM on Play so the loop matches the unit
  // even if its tempo knob moved since the last sync.
  syncDeviceTempo().then((held) => {
    if (held) status(`playing · device holds ${held} BPM — Tempo synced`, "ok");
  });
  liveLoop(liveToken);
}

// Scheduled against an ABSOLUTE clock, not by accumulating relative sleeps.
// The gate floors below (max 12ms note, max 3ms release) otherwise ADD to each
// step instead of eating into it, which measured up to 16% slow at low gate on
// short steps. Every step now waits until its own target time, so overhead and
// the floors cannot accumulate.
async function liveLoop(token) {
  const t0 = performance.now();
  let elapsed = 0;      // ms into the phrase, on the absolute clock
  let i = 0;
  while (live && token === liveToken) {
    try {
      const p = bank[selected];
      if (!p || !p.length) { await sleep(100); t0 += 100; continue; }
      if (i >= p.length) i = 0;
      // if we fell a long way behind (throttled tab), re-anchor instead of bursting
      if (performance.now() - (t0 + elapsed) > 250) t0 = performance.now() - elapsed;

      const st = p.steps[i];
      const qMs = 60000 / Math.max(20, Math.min(300, state.tempo || 120));
      const gate = Math.min(100, Math.max(5, state.gate ?? 50)) / 100;
      const stepMs = qMs * (RATE_QUARTERS[st.rate] ?? RATE_QUARTERS[p.rate]);
      const late = i % 2 === 1 ? stepMs * swingFrac() : 0;
      const sDur = stepMs - late;

      const startAt = t0 + elapsed + late;
      let w = startAt - performance.now();
      if (w > 0) await sleep(w);
      markStep(i);
      if (st.notes.length) {
        for (const n of st.notes) { liveNoteOn(n.note, n.vel); audio.noteOn(n.note, n.vel); }
        const offAt = startAt + Math.max(12, sDur * gate);
        w = offAt - performance.now(); if (w > 0) await sleep(w);
        for (const n of st.notes) { liveNoteOff(n.note); audio.noteOff(n.note); }
      }
      w = (t0 + elapsed + stepMs) - performance.now();
      if (w > 0) await sleep(w);
      elapsed += stepMs;
      i++;
    } catch (e) { status("play error: " + (e.message || e), "err"); await sleep(200); t0 += 200; }
  }
  clearPlayhead();
}

// --------------------------------------------------------------------------- //
// Themes (the FM-1's own seven)
// --------------------------------------------------------------------------- //
const THEMES = [
  { id: "purple", name: "Purple", accent: "#ff5da4" },
  { id: "black", name: "Black", accent: "#f6f2f6" },
  { id: "grey", name: "Grey", accent: "#f6e6d5" },
  { id: "orange", name: "Orange", accent: "#ff7939" },
  { id: "green", name: "Green", accent: "#6ae2cd" },
  { id: "blue", name: "Blue", accent: "#8bb2e6" },
  { id: "brown", name: "Brown", accent: "#e69962" },
];

function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  localStorage.setItem("fm1p.theme", id);
  document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.id === id));
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  renderScope();
}

function buildTheme() {
  const menu = document.getElementById("themes");
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.className = "swatch"; b.dataset.id = t.id;
    b.title = t.name; b.setAttribute("aria-label", t.name);
    b.style.background = t.accent;
    b.addEventListener("click", () => applyTheme(t.id));
    menu.appendChild(b);
  }
  const saved = localStorage.getItem("fm1p.theme");
  applyTheme(THEMES.some((t) => t.id === saved) ? saved : "purple");
}

// --------------------------------------------------------------------------- //
// The rack
// --------------------------------------------------------------------------- //
// A section occupies `span` rails of the panel grid. Its controls are laid out on
// the SAME rail width, so every control in the panel lines up on one column.
// A section with fewer controls than rails places them on WHOLE columns (an
// integer offset), never by centring on width — centring lands on half-rails and
// breaks the alignment.
function sect(title, span, kids) {
  const s = document.createElement("section");
  s.className = "sect";
  s.style.gridColumn = `span ${span}`;
  const h = document.createElement("h3");
  h.textContent = title;
  const g = document.createElement("div");
  g.className = "sgrid";
  g.style.gridTemplateColumns = `repeat(${span}, minmax(0, 1fr))`;
  const off = Math.floor((span - Math.min(span, kids.length)) / 2);
  kids.forEach((k, i) => {
    if (off) k.style.gridColumn = `${off + i + 1}`;
  });
  g.append(...kids);
  s.append(h, g);
  return s;
}

function buildRack() {
  const panel = document.getElementById("panel");

  panel.append(
    sect("Rhythm", 2, [
      R("tempo", knob({ label: "Tempo", min: 30, max: 300, value: state.tempo, def: DEFAULT.tempo, size: "lg",
        format: (v) => `${Math.round(v)}`, onInput: setState("tempo"),
        onDblClick: () => {
          syncDeviceTempo().then((held) => {
            status(held ? `device holds ${held} BPM — Tempo synced` : "could not read the device tempo", held ? "ok" : "err");
          });
        },
        tip: "BPM is device-global on the FM-1 — freezing cannot change it; the unit's own BPM governs playback. The app re-syncs to the device after a freeze; double-click re-reads now." })),
      R("swing", knob({ label: "Swing", min: 50, max: 75, value: state.swing, def: DEFAULT.swing, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("swing") })),
      R("gateProb", knob({ label: "Gate", min: 0, max: 100, value: state.gateProb, def: DEFAULT.gateProb, size: "lg",
        format: (v) => `${Math.round(v)}%`,
        onInput: (v) => { state.gateProb = v; refreshLoopInfo(); scheduleRegen(); },
        tip: "random mode: chance each step fires. euclid mode: the DENSITY — Gate % becomes N hits evenly spaced over the cycle (see the loop info line)." })),
      R("gateBlend", knob({ label: "Euclid", min: 0, max: 100, value: state.gateBlend, def: DEFAULT.gateBlend, size: "md",
        format: (v) => v <= 0 ? "random" : v >= 100 ? "euclid" : `${Math.round(v)}%`,
        onInput: (v) => { state.gateBlend = v; refreshLoopInfo(); scheduleRegen(); },
        tip: "Gradient between random placement (0%) and even Euclidean spacing (100%). In between, each step rolls which law it follows — Gate % is the density either way." })),
      R("euclidRot", knob({ label: "Rotate", min: 0, max: 15, step: 1, value: state.euclidRot, def: DEFAULT.euclidRot, size: "sm",
        format: (v) => `${Math.round(v)}`,
        onInput: (v) => { state.euclidRot = v; refreshLoopInfo(); scheduleRegen(); },
        tip: "Rotates the Euclidean hit pattern within its cycle (wraps). Only affects the euclid side of the gradient." })),
      R("gateQuant", knob({ label: "Grid snap", min: 0, max: 100, value: state.gateQuant, def: DEFAULT.gateQuant, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gateQuant") })),
      R("snapGrid", knob({ label: "Snap grid", min: 2, max: 8, step: 1, value: state.snapGrid, def: DEFAULT.snapGrid, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: setState("snapGrid") })),
      R("gate", knob({ label: "Gate len", min: 5, max: 100, value: state.gate, def: DEFAULT.gate, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gate") })),
    ]),

    sect("Global", 2, [
      R("drift", knob({ label: "Drift", min: 0, max: 100, value: state.drift, def: DEFAULT.drift, size: "md",
        format: (v) => `${Math.round(v)}%`, onInput: setState("drift") })),
      R("seed", num("Seed", state.seed, (v) => { state.seed = v | 0; scheduleRegen(); }, { size: "sm" })),
      R("rate", rotary("Note", RATE_NAMES.map((t, v) => ({ v, t })), state.rate, (v) => { state.rate = Number(v); refreshLoopRanges(); scheduleRegen(); }, "sm")),
      R("length", knob({ label: "Length", min: 1, max: 64, value: state.length, def: DEFAULT.length, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: (v) => { state.length = v; refreshLoopRanges(); scheduleRegen(); } })),
      R("quantSteps", knob({ label: "Quantize", min: 0, max: 100, value: state.quantSteps, def: DEFAULT.quantSteps, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("quantSteps") })),
      R("unipolar", rotary("Unipolar", [{ v: false, t: "off" }, { v: true, t: "on" }], state.unipolar, (v) => { state.unipolar = !!v; scheduleRegen(); }, "sm")),
    ]),

    sect("Pitch", 2, [
      R("lfoWave", rotary("Wave", LFO_WAVES.map((w) => ({ v: w, t: WAVE_SHORT[w] ?? w })), state.lfoWave, (v) => { state.lfoWave = v; scheduleRegen(); }, "sm")),
      R("lfoShape", knob({ label: "Shape", min: 0, max: 100, value: state.lfoShape, def: DEFAULT.lfoShape, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("lfoShape"),
        tip: "wave morph — sine: fold amount; triangle/saw: curve bend; square: pulse width 50→5%; perlin: octave shimmer; randomWalk: step size; smoothRandom: slew." })),
      R("lfoRate", knob({ label: "Cycles", min: 1, max: 16, step: 0.5, value: state.lfoRate, def: DEFAULT.lfoRate, size: "md",
        format: (v) => `${v}`, onInput: setState("lfoRate") })),
      R("lfoAmp", knob({ label: "Amp", min: 0, max: 100, value: state.lfoAmp, def: DEFAULT.lfoAmp, size: "lg",
        format: (v) => `${Math.round(v)}%`, onInput: setState("lfoAmp") })),
      R("lfoOffset", knob({ label: "Offset", min: -100, max: 100, value: state.lfoOffset, def: DEFAULT.lfoOffset, size: "lg",
        format: (v) => `${Math.round(v)}`, onInput: setState("lfoOffset") })),
      R("scale", rotary("Scale", Object.keys(SCALES).map((s) => ({ v: s, t: s })), state.scale, (v) => { state.scale = v; scheduleRegen(); }, "sm")),
      R("root", knob({ label: "Root", min: 24, max: 84, value: state.root, def: DEFAULT.root, size: "md",
        format: (v) => midiName(v), onInput: setState("root") })),
    ]),

    sect("Shape", 6, [
      R("spread", rotary("Spread", ["constant", "bell", "uniform", "extremes"].map((s) => ({ v: s, t: s })), state.spread, (v) => { state.spread = v; scheduleRegen(); }, "sm")),
      R("bias", knob({ label: "Bias", min: -100, max: 100, value: state.bias, def: DEFAULT.bias, size: "md",
        format: (v) => `${Math.round(v)}`, onInput: setState("bias") })),
      R("humanize", knob({ label: "Humanize", min: 0, max: 100, value: state.humanize, def: DEFAULT.humanize, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("humanize") })),
      R("velocity", knob({ label: "Velocity", min: 1, max: 127, value: state.velocity, def: DEFAULT.velocity, size: "sm",
        format: (v) => `${Math.round(v)}`, onInput: setState("velocity") })),
      R("octave", knob({ label: "Octave up", min: 0, max: 100, value: state.octave, def: DEFAULT.octave, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("octave") })),
      R("gravity", knob({ label: "Root grav", min: 0, max: 100, value: state.gravity, def: DEFAULT.gravity, size: "sm",
        format: (v) => `${Math.round(v)}%`, onInput: setState("gravity") })),
    ]),

    sect("Memory", 6, [
      R("loopFrom", knob({ label: "Loop from", min: 1, max: Math.max(1, state.length - 1), step: 1, value: state.loopFrom, def: DEFAULT.loopFrom, size: "md",
        format: (v) => `${Math.round(v)}`, tip: "where the loop replay begins. Everything before it plays once; from here to the end the phrase's first Loop len steps repeat. Loop from 1 = the classic repeat-from-the-start.", onInput: (v) => { state.loopFrom = Math.round(v); refreshLoopRanges(); scheduleRegen(); } })),
      R("loop", knob({ label: "Loop len", min: 2, max: Math.max(2, state.length), step: 1, value: state.loop, def: DEFAULT.loop, size: "md",
        format: (v) => `${Math.round(v)}`, tip: "how many of the phrase's first steps form the loop. The loop replays them from Loop from onward, wrapping at Loop len.", onInput: (v) => { state.loop = Math.round(v); refreshLoopInfo(); scheduleRegen(); } })),
      R("dejaVu", knob({ label: "Deja Vu", min: 0, max: 100, value: state.dejaVu, def: DEFAULT.dejaVu, size: "md",
        format: (v) => `${Math.round(v)}%`, tip: "chance each step from Loop from onward copies the loop instead of playing a fresh note. 100% = solid repeat; copied steps get a dashed ring in the grid.", onInput: setState("dejaVu") })),
    ]),
  );
}

// Short panel legends for the LFO waves: a real panel would not print
// "smoothRandom" on a 6mm switch. The full name stays in the tooltip.
const WAVE_SHORT = {
  sine: "sine", triangle: "tri", saw: "saw", square: "sqr", perlin: "perlin",
  random: "random", randomWalk: "walk", smoothRandom: "smooth", sampleHold: "hold",
};

// A ROTARY SWITCH: a knob over a list of options, one detent per position, with
// the chosen name printed underneath. This is what hardware does with a discrete
// setting — no text box anywhere on the panel.
function rotary(label, opts, value, onInput, size = "md") {
  const el = knob({
    label, min: 0, max: opts.length - 1, step: 1,
    value: Math.max(0, opts.findIndex((o) => String(o.v) === String(value))),
    def: 0, size, ticks: Math.max(1, opts.length - 1), majorEvery: 0, smallVal: true,
    format: (v) => opts[Math.min(opts.length - 1, Math.max(0, Math.round(v)))]?.t ?? "",
    onInput: (v) => { const o = opts[Math.round(v)]; if (o) onInput(o.v); },
  });
  const setIdx = el.setValue;
  el.setValue = (v) => {
    const i = opts.findIndex((o) => String(o.v) === String(v));
    if (i >= 0) setIdx(i, false);
  };
  return el;
}

function num(label, value, onInput, extra = {}) {
  const el = knob({
    label, min: 0, max: 999999999, step: 1, value: Math.max(0, Math.round(value) % 1000000000),
    def: 0, size: "sm", onInput: (v) => onInput(v | 0),
    format: (v) => String(Math.round(v)),
    ...extra,
  });
  return el;
}

// register a control under its state key; set(..., false) keeps it silent on sync
function R(key, el) { refs[key] = el; return el; }
const setState = (key, fn) => (v) => { state[key] = fn ? fn(v) : v; scheduleRegen(); };

// The loop region is [Loop from, Loop from + Loop len - 1]; neither knob may push the
// region past Length, so their ranges follow each other. The guard stops the clamp in
// setRange from re-entering through onInput.
let adjustingLoop = false;
function refreshLoopRanges() {
  if (adjustingLoop) return;
  const from = refs.loopFrom, len = refs.loop;
  if (!from || !len) return;
  adjustingLoop = true;
  try {
    const L = Math.max(3, Math.round(state.length || 64));
    from.setRange(1, Math.max(1, L - 1));
    len.setRange(2, Math.max(2, L));
  } finally { adjustingLoop = false; }
  refreshLoopInfo();
}

function refreshLoopInfo() {
  const el = document.getElementById("loopinfo");
  if (!el) return;
  const L = Math.max(3, Math.round(state.length || 64));
  const a = Math.round(refs.loopFrom?.value ?? 1);
  const n = Math.round(refs.loop?.value ?? 8);
  const reps = (L - a + 1) / n;
  const loopTxt = n >= 2 && n <= L && a < L ? `loop 1–${n} ×${reps.toFixed(1)} from ${a}` : "loop off";
  if (state.gateBlend > 0) {
    const blend = Math.min(100, Math.max(0, state.gateBlend ?? 0)) / 100;
    const M = Math.max(2, n >= 2 ? n : 16);
    const N = Math.max(0, Math.min(M, Math.round((state.gateProb ?? 70) / 100 * M)));
    const rot = ((state.euclidRot ?? 0) % M + M) % M;
    el.textContent = `${loopTxt} · E(${N},${M})${rot ? " rot " + rot : ""}${blend < 1 ? " @" + Math.round(blend * 100) + "%" : ""}`;
  } else el.textContent = loopTxt;
}

// push state back into every control (used after Randomize)
function syncRack() {
  for (const [k, el] of Object.entries(refs)) if (el && el.setValue && state[k] !== undefined) el.setValue(state[k], false);
  refreshLoopRanges();
}

// --------------------------------------------------------------------------- //
// Export / import — the bank is fully reproducible from state + locks, so a
// JSON file IS the song. The .syx download is the same bank in the FM-1's own
// SysEx format, for anyone who pushes patterns with another tool.
// --------------------------------------------------------------------------- //
const STATE_VERSION = 1;

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportState() {
  const data = {
    app: "fm1-pulses",
    version: STATE_VERSION,
    seed: state.seed >>> 0,
    params: { ...state },
    locks: Object.fromEntries(locks),
    selected,
  };
  download(`fm1p-${state.seed >>> 0}.json`, JSON.stringify(data, null, 2), "application/json");
  status(`exported seed ${state.seed >>> 0} ✓`);
}

async function importState(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== "fm1-pulses") throw new Error("not an FM-1 Pulses file");
    applyStateData(d);
    status(`imported seed ${state.seed >>> 0} ✓`);
  } catch (e) {
    status("import failed: " + (e.message || e), "err");
  }
}

// --------------------------------------------------------------------------- //
// Local preset slots (localStorage): the same content as an export file, kept
// in the browser. save ▸ / ◂ load arm an action, tap a slot to fire it, or
// double-click a slot to save it directly.
// --------------------------------------------------------------------------- //
const PRESET_N = 5;
const PRESET_KEY = "fm1p.presets";
let presetArm = null;   // "save" | "load" | null

function readPresets() {
  try {
    const p = JSON.parse(localStorage.getItem(PRESET_KEY));
    return Array.isArray(p) ? p.slice(0, PRESET_N) : Array(PRESET_N).fill(null);
  } catch { return Array(PRESET_N).fill(null); }
}

function applyStateData(d) {
  if (d.params) Object.assign(state, d.params);
  else if (d.seed != null) Object.assign(state, d);
  for (const k of Object.keys(state)) if (!(k in DEFAULT)) delete state[k];
  state.seed = (d.seed ?? state.seed) >>> 0;
  locks.clear();
  for (const [k, v] of Object.entries(d.locks ?? {})) locks.set(k, v.map((n) => ({ ...n })));
  selected = Math.max(0, Math.min(SLOTS - 1, Number(d.selected) || 0));
  syncRack(); refreshLoopInfo();
  doGenerate(false);
  refreshLockCount();
}

function savePreset(i) {
  const p = readPresets();
  p[i] = {
    app: "fm1-pulses",
    version: STATE_VERSION,
    seed: state.seed >>> 0,
    params: { ...state },
    locks: Object.fromEntries(locks),
    selected,
  };
  localStorage.setItem(PRESET_KEY, JSON.stringify(p));
  renderPresets();
  status(`preset ${i + 1} saved ✓ seed ${state.seed >>> 0}`);
}

function recallPreset(i) {
  const d = readPresets()[i];
  if (!d) { status(`preset ${i + 1} is empty`, "err"); return; }
  applyStateData(d);
  status(`preset ${i + 1} recalled ✓ seed ${state.seed >>> 0}`);
}

function renderPresets() {
  const el = document.getElementById("presets");
  if (!el) return;
  el.innerHTML = "";
  const p = readPresets();
  const armBtn = (label, arm, title) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = presetArm === arm ? "armed" : "";
    b.title = title;
    b.addEventListener("click", () => {
      presetArm = presetArm === arm ? null : arm;
      renderPresets();
    });
    return b;
  };
  el.append(armBtn("save ▸", "save", "Arm saving, then tap a slot. Or double-click a slot to save it directly."));
  for (let i = 0; i < PRESET_N; i++) {
    const b = document.createElement("button");
    b.className = "pslot" + (p[i] ? " filled" : "");
    b.textContent = String(i + 1);
    b.title = p[i] ? `preset ${i + 1}: seed ${p[i].seed} — tap to recall, double-click to overwrite` : `preset ${i + 1}: empty`;
    b.addEventListener("click", () => {
      if (presetArm === "save") { savePreset(i); presetArm = null; }
      else if (presetArm === "load") { recallPreset(i); presetArm = null; }
      else recallPreset(i);
    });
    b.addEventListener("dblclick", () => savePreset(i));
    el.appendChild(b);
  }
  el.append(armBtn("◂ load", "load", "Arm recalling, then tap a filled slot. Or just tap a slot: tap = recall, double-click = save."));
}

function exportSysex() {
  syncHeader();
  const bytes = [];
  for (let i = 0; i < SLOTS; i++) for (const m of encodeWrite(bank[i], i, true)) bytes.push(...m);
  download(`fm1p-${state.seed >>> 0}.syx`, new Uint8Array(bytes), "application/octet-stream");
  status(`bank .syx downloaded ✓ (${bytes.length} bytes, 16 slots)`);
}

// --------------------------------------------------------------------------- //
// Transport + init
// --------------------------------------------------------------------------- //
function randomize() {
  state.seed = (Math.random() * 1e9) | 0;
  Object.assign(state, {
    scale: Object.keys(SCALES)[(Math.random() * Object.keys(SCALES).length) | 0],
    lfoWave: LFO_WAVES[(Math.random() * LFO_WAVES.length) | 0],
    lfoShape: (Math.random() * 100) | 0,
    lfoAmp: (Math.random() * 100) | 0, lfoOffset: ((Math.random() * 200) - 100) | 0,
    gateProb: (Math.random() * 100) | 0, bias: ((Math.random() * 200) - 100) | 0,
    spread: ["constant", "bell", "uniform", "extremes"][(Math.random() * 4) | 0],
    quantSteps: (Math.random() * 100) | 0, dejaVu: (Math.random() * 100) | 0,
    gateQuant: (Math.random() * 100) | 0, humanize: (Math.random() * 100) | 0,
    gateBlend: (Math.random() * 100) | 0, euclidRot: (Math.random() * 16) | 0,
  });
  syncRack();
  doGenerate(true);
}

function buildTransport() {
  document.getElementById("gen").addEventListener("click", () => doGenerate(true));
  document.getElementById("rand").addEventListener("click", randomize);
  document.getElementById("audition").addEventListener("click", toggleLive);
  // preview timbre: a UI preference, not part of the generative state
  const muteBtn = document.getElementById("mute");
  const soundEl = sw({
    label: "sound",
    options: audio.SOUNDS.map((s) => ({ v: s.id, t: s.name })),
    value: localStorage.getItem("fm1p.sound") || audio.getSound(),
    onInput: (id) => {
      audio.setSound(id);
      localStorage.setItem("fm1p.sound", id);
      status(`preview: ${audio.SOUNDS.find((s) => s.id === id)?.name ?? id}`);
    },
  });
  muteBtn.insertAdjacentElement("beforebegin", soundEl);
  document.getElementById("export")?.addEventListener("click", exportState);
  const finp = document.getElementById("importfile");
  document.getElementById("import")?.addEventListener("click", () => finp.click());
  finp.addEventListener("change", () => {
    const f = finp.files[0];
    if (f) importState(f);
    finp.value = "";
  });
  document.getElementById("syx")?.addEventListener("click", exportSysex);
  // BLE: play-only transport. One glink toggles connect/disconnect; the label
  // reflects the link state and midi.onBleState drives it through reconnects.
  const bleBtn = document.getElementById("ble");
  const blePaint = (s) => {
    if (!bleBtn) return;
    if (s === "open") bleBtn.textContent = "bluetooth ✓";
    else if (s === "reconnecting") bleBtn.textContent = "bluetooth …";
    else bleBtn.textContent = "bluetooth";
  };
  if (bleBtn) {
    if (!midi.bleSupported()) bleBtn.style.display = "none";
    else {
      bleBtn.addEventListener("click", async () => {
        if (midi.bleConnected()) {
          midi.disconnectBle();
          status("bluetooth disconnected");
          return;
        }
        try {
          status("bluetooth: connect…");
          const name = await midi.connectBle();
          status(`bluetooth ✓ ${name} — notes ride BLE, freeze still uses USB`, "ok");
        } catch (e) {
          status("bluetooth: " + (e.message || e), "err");
        }
      });
      midi.onBleState((s) => {
        blePaint(s);
        if (s === "drop") status("bluetooth dropped — reconnecting…", "err");
        else if (s === "reconnecting") status("bluetooth reconnecting…");
        else if (s === "open") status("bluetooth ✓ reconnected — notes ride BLE", "ok");
        else if (s === "lost") status("bluetooth reconnect failed — tap bluetooth to retry", "err");
        else if (s === "closed") status("bluetooth disconnected");
      });
    }
  }
  muteBtn.addEventListener("click", () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    muteBtn.textContent = m ? "🔇" : "🔊";
    status(m ? "browser audio muted" : "browser audio on");
  });
  document.getElementById("freeze").addEventListener("click", () => doFreeze(selected));
  // Felucca target track (shown only for the Felucca profile): Freeze and
  // Clear act on it, since that firmware has four tracks instead of a 16-slot bank.
  const ft = document.createElement("select");
  ft.id = "ftrack";
  ft.title = "Felucca target track — Freeze and Clear act on it";
  ft.setAttribute("style", "display:none;font:600 11px/1.4 inherit;padding:2px 6px;border-radius:6px;background:#1b1926;color:#ececf0;border:1px solid #3a3750");
  for (let i = 0; i < 4; i++) ft.append(new Option(`T${i + 1}`, String(i)));
  document.getElementById("freeze").insertAdjacentElement("beforebegin", ft);
  ft.addEventListener("change", () => status(`Felucca target: track ${Number(ft.value) + 1}`));
  document.getElementById("fill").addEventListener("click", doSendAll);
  document.getElementById("clearall").addEventListener("click",
    () => (profile === "felucca" ? doClearTrackFelucca() : doClearAll()));
  document.getElementById("diag")?.addEventListener("click", dumpGset);
  renderPresets();
}

function buildEditor() {
  const p0 = () => bank[selected];
  document.getElementById("edown").addEventListener("click", () => {
    if (editStep < 0 || !p0()) return;
    const cur = p0().steps[editStep].notes[0]?.note;
    setStepNote(editStep, cur == null ? state.root : cur - 1);
  });
  document.getElementById("eup").addEventListener("click", () => {
    if (editStep < 0 || !p0()) return;
    const cur = p0().steps[editStep].notes[0]?.note;
    setStepNote(editStep, cur == null ? state.root : cur + 1);
  });
  document.getElementById("eclear").addEventListener("click", () => { if (editStep >= 0) setStepNote(editStep, null); });
  document.getElementById("elock").addEventListener("click", () => {
    if (editStep < 0 || !p0()) return;
    const key = `${selected}:${editStep}`;
    if (locks.has(key)) locks.delete(key);
    else locks.set(key, p0().steps[editStep].notes.map((n) => ({ ...n })));
    renderBuffer(); refreshLockCount();
  });
  document.getElementById("eclearlocks").addEventListener("click", clearLocks);
  refreshLockCount();
}

async function initMidi() {
  const nameEl = () => document.getElementById("devname");
  const fill = () => {
    const fm1 = midi.findFm1();
    const outs = midi.listOutputs();
    const n = nameEl();
    if (n) n.textContent = fm1 ? fm1.name : (outs.length ? `${outs[0].name} (no FM-1)` : "no MIDI");
    const led = document.getElementById("led");
    if (led) led.className = "led" + (fm1 ? " ok" : "");
    status(fm1 ? `FM-1: ${fm1.name}` : "FM-1 not found", fm1 ? "ok" : "");
  };
  try {
    await midi.initMidi();
    fill();
    // Re-sync whenever the device (re)connects or drops: the FM-1's tempo is
    // device-global and the device is the source of truth.
    midi.onStateChange(() => {
      fill();
      if (midi.findFm1()) {
        detectFirmware().then((info) => {
          if (!info) syncDeviceTempo().then((held) => {
            if (held) status(`FM-1 connected · device holds ${held} BPM — Tempo synced`, "ok");
          });
        });
      }
    });
    // WYSIWYG tempo: snap the knob to the device's real (unit-global) BPM — the
    // Baud Girl memory read does not exist on Felucca, whose protocol is INFO/step.
    const info = await detectFirmware();
    if (!info) {
      const held = await syncDeviceTempo();
      if (held) status(`FM-1: ${midi.findFm1()?.name ?? ""} · device holds ${held} BPM — Tempo synced`, "ok");
    }
  } catch (e) {
    status(String(e.message || e), "err");
    const n = nameEl();
    if (n) n.textContent = "no Web MIDI";
  }
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); toggleLive(); }
  if (e.key === "f") doFreeze(selected);
  if (e.key === "g") doGenerate(true);
  if (e.key === "ArrowRight") { selected = (selected + 1) % SLOTS; renderBank(); renderBuffer(); }
  if (e.key === "ArrowLeft") { selected = (selected + SLOTS - 1) % SLOTS; renderBank(); renderBuffer(); }
});

// Coming back to the tab re-syncs the Tempo knob to the device's real BPM —
// the user may have turned the tempo knob on the unit while we were away.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && profile !== "felucca" && midi.hasAccess() && midi.findFm1()) syncDeviceTempo();
});

buildTheme();
buildRack();
refreshLoopRanges();
buildTransport();
buildEditor();
doGenerate(true);
initMidi();
// Tooltips on/off: on phones the long-press hints cover the panel. The observer
// keeps them off even for titles set later by renders (banks, knobs, switches).
let tipsOn = localStorage.getItem("fm1p.tips") !== "off";
const tipsLink = document.getElementById("tips");
function applyTips() {
  document.querySelectorAll("[title], [data-tip]").forEach((el) => {
    if (tipsOn) { if (el.dataset.tip) el.setAttribute("title", el.dataset.tip); }
    else if (el.hasAttribute("title")) { el.dataset.tip = el.getAttribute("title"); el.removeAttribute("title"); }
  });
  if (tipsLink) tipsLink.textContent = tipsOn ? "tips on" : "tips off";
}
tipsLink?.addEventListener("click", () => {
  tipsOn = !tipsOn;
  localStorage.setItem("fm1p.tips", tipsOn ? "on" : "off");
  applyTips();
  status(tipsOn ? "tooltips on" : "tooltips off");
});
new MutationObserver((muts) => {
  if (tipsOn) return;
  for (const m of muts) {
    const el = m.target, t = el.getAttribute && el.getAttribute("title");
    if (t != null) { el.dataset.tip = t; el.removeAttribute("title"); }
  }
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["title"] });
setTimeout(applyTips, 0);
window.addEventListener("resize", () => { fitSteps(); renderScope(); });
// scope hover readout (debug tool): show the step under the pointer
const wcv = document.getElementById("wave");
wcv?.addEventListener("mousemove", (e) => {
  const rect = wcv.getBoundingClientRect();
  const stepW = (wcv.clientWidth - 2 * SCOPE_PADX) / 63;
  scopeHover = Math.max(0, Math.min(63, Math.round((e.clientX - rect.left - SCOPE_PADX) / stepW)));
  renderScope();
});
wcv?.addEventListener("mouseleave", () => { scopeHover = null; renderScope(); });

// Piano roll editing: the first tap selects a step, a tap on the same column
// places that pitch (the device's own step-editing feel). Hover shows the column.
const rcv = document.getElementById("roll");
rcv?.addEventListener("mousemove", (e) => { const hit = rollHit(e); rollHover = hit ? hit.i : null; renderRoll(); });
rcv?.addEventListener("mouseleave", () => { rollHover = null; renderRoll(); });
rcv?.addEventListener("pointerdown", (e) => {
  const hit = rollHit(e);
  if (!hit) return;
  if (hit.i !== editStep) { selectStep(hit.i); return; }
  setStepNote(hit.i, hit.note);
});
