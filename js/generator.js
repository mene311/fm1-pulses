// generator.js — the generative sequence source (Marbles-style, offline).
//
// Produces a 64-step FM-1 pattern from a set of parameters. No timing, no
// real-time — it fills the steps instantly; the FM-1's own clock plays them.
//
// Chain: LFO (pitch source) → distribution (spread/bias) → quantizer (scale)
//        → gate probability (rests) → Deja Vu (reuse the previous generation)

export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  pentMajor: [0, 2, 4, 7, 9],
  pentMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  dimHalfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  dimWholeHalf: [0, 2, 3, 5, 6, 8, 9, 11],
  augmented: [0, 3, 4, 7, 8, 11],
  inSen: [0, 1, 5, 7, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const LFO_WAVES = ["sine", "triangle", "saw", "square", "perlin", "random", "randomWalk", "smoothRandom", "sampleHold"];

// deterministic PRNG so a seed reproduces a generation exactly
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiName = (n) => {
  const m = Math.round(Number(n) || 0);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};

// ---- LFO: value in [0,1] for phase in [0,1), with state for random shapes ----
// `shape` (0..1) is the Shape knob; each wave spends it differently (see the
// guide): sine folds, triangle/saw bend, square narrows its pulse width, the
// random family uses it as slew/step size, perlin adds a detuned octave.
function makePerlin(rng) {
  const N = 24;                          // random points around the cycle
  // Smoothed VALUE noise, not gradient noise: gradient noise reads exactly 0
  // at every lattice point, and with 24 cells sampled at integer cell rates
  // (e.g. 1.5 cells/step at 4 cycles) every other step landed on a lattice
  // point — the wave froze at the centre and quantized to the root. Value
  // noise has full amplitude at its lattice points, so it can never lock.
  const vals = Array.from({ length: N }, () => rng() * 2 - 1);
  const noise = (phase) => {
    const x = (((phase % 1) + 1) % 1) * N;
    const i0 = Math.floor(x) % N;
    const i1 = (i0 + 1) % N;
    const f = x - Math.floor(x);
    const u = f * f * (3 - 2 * f);       // smoothstep
    return vals[i0] * (1 - u) + vals[i1] * u;
  };
  // Normalize to a true ±1 swing (peak scan over the cycle; deterministic per seed).
  let peak = 0;
  const S = 8;                            // samples per cell for the scan
  for (let k = 0; k < N * S; k++) {
    const v = Math.abs(noise(k / (N * S)));
    if (v > peak) peak = v;
  }
  const g = peak > 0.01 ? 1 / peak : 1;
  return (phase) => noise(phase) * g;
}

function lfoFactory(wave, rng, shape) {
  let walk = rng();
  let target = rng();
  let cur = rng();
  const perlin = wave === "perlin" ? makePerlin(rng) : null;
  const fold = (x) => {                  // wavefolder, x in [-1,1]
    const f = ((x + 1) / 2) % 1;
    return Math.abs(f * 2 - 1) * 2 - 1;
  };
  return (phase) => {
    switch (wave) {
      case "sine": {
        const s = Math.sin(2 * Math.PI * phase);
        const f = fold(s * (1 + shape * 4));        // shape drives the sine into the folder
        return 0.5 + 0.5 * (s * (1 - shape) + f * shape);
      }
      case "triangle": {
        const t = 1 - Math.abs(2 * phase - 1);
        return Math.pow(t, 1 + shape * 3);          // bends the ramp toward the floor
      }
      case "saw": return Math.pow(phase, 1 + shape * 3);
      case "square": return phase < 0.5 - shape * 0.45 ? 1 : 0;  // pulse width 50% → 5%
      case "perlin": {
        const base = perlin(phase);
        const det = shape ? perlin(phase * 2 + 0.37) : 0;        // octave shimmer
        return 0.5 + (base * (1 - shape) + det * shape) / 2;
      }
      case "randomWalk": {
        walk += (rng() < 0.5 ? -1 : 1) * (0.04 + shape * 0.28);  // step size follows Shape
        if (walk < 0) walk = 0.15; if (walk > 1) walk = 0.85;
        return walk;
      }
      case "smoothRandom": {
        const t = 0.03 + shape * 0.45;                          // slew rate follows Shape
        cur += (target - cur) * t;
        if (Math.abs(target - cur) < 0.01) target = rng();
        return cur;
      }
      case "sampleHold":
      default: return Math.floor(phase * 4) % 2 ? cur : (cur = rng());
    }
  };
}

// The classic rhythms, pinned to their canonical (Toussaint) forms. The
// bucket algorithm's tie-breaking differs from the literature on exactly these
// pairs, and the ear knows: tresillo is x..x..x., not x..x.x..; son clave is
// x..x..x...x.x..., not five evenly-spaced dots. Everything else stays
// maximally even.
const CLASSIC = {
  "3,8":  { name: "tresillo",  mask: [1, 0, 0, 1, 0, 0, 1, 0] },
  "5,8":  { name: "cinquillo", mask: [1, 0, 1, 1, 0, 1, 1, 0] },
  "5,16": { name: "son clave", mask: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0] },
  "7,16": { name: null,       mask: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] },
};

export function classicName(n, m) { return CLASSIC[`${n},${m}`]?.name ?? null; }

// Bjorklund: N onsets spread as evenly as possible over M steps, then rotated
// so the first hit lands on the downbeat. Classic pairs come from the table
// above in their canonical form.
export function euclid(n, m) {
  const c = CLASSIC[`${n},${m}`];
  if (c) return c.mask.slice();
  const mask = new Array(m).fill(0);
  if (n >= m) return mask.fill(1);
  if (n <= 0) return mask;
  let bucket = 0;
  for (let i = 0; i < m; i++) {
    bucket += n;
    if (bucket >= m) { mask[i] = 1; bucket -= m; }
  }
  const first = mask.indexOf(1);
  if (first > 0) return [...mask.slice(first), ...mask.slice(0, first)];
  return mask;
}

// ---- distribution shaping (spread: constant/bell/uniform/extremes) ----
// Maps a periodic LFO value [0,1] through the spread curve. Used by the
// deterministic waves; the "random" wave draws from `drawRandom` instead.
function shape(v, spread) {
  switch (spread) {
    case "constant": v = 0.5; break;
    case "bell": v = 0.5 + 4 * Math.pow(v - 0.5, 3); break;   // centre-weighted: pulls toward the middle
    case "extremes": v = v < 0.5 ? 0 : 1; break;
    case "uniform":
    default: break;
  }
  return v;
}

// Draw one random value in [0,1] from the distribution named by spread.
// This is the Marbles-style source: spread picks the distribution, not a wave.
function drawRandom(rng, spread) {
  switch (spread) {
    case "constant": return 0.5;                 // no variation, the centre
    case "bell":     return (rng() + rng()) / 2;  // centre-weighted (triangular)
    case "extremes": return rng() < 0.5 ? 0 : 1;  // only the two ends
    case "uniform":
    default:         return rng();                // flat
  }
}

// bias (-1..1): skew the distribution toward high (+) or low (-). A monotonic
// power curve, so it tilts the odds without changing the range (unlike amplitude).
function skew(v, bias) {
  const x = Math.min(1, Math.max(0, v));
  return bias ? Math.pow(x, Math.pow(3, -bias)) : x;
}

// ---- quantize a note value to a scale, `strength` = snap probability ----
function quantize(note, scale, root, strength, rng) {
  const n = Math.round(note);
  if (rng() > strength) return n;
  // Nearest note of the scale in ANY octave: for each degree take its closest
  // occurrence (root + iv + 12k) and keep the closest. The old form snapped
  // `rel` to a degree but kept the octave of `rel`, so a B (rel 11) whose
  // nearest degree is C (0, one semitone up) dropped a full octave: 59 -> 48
  // instead of 60. Ties go to the higher note.
  let best = null, bestD = 99;
  for (const iv of scale) {
    const cand = root + iv + 12 * Math.round((n - root - iv) / 12);
    const d = Math.abs(cand - n);
    if (d < bestD || (d === bestD && best != null && cand > best)) { bestD = d; best = cand; }
  }
  return best == null ? n : best;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SNAP_GRID = 4;   // default grid-snap spacing, in steps

/**
 * generate(params) -> pattern fields + steps.
 * params: seed, length(64), rate, tempo, swing, gate(header), gateProb,
 *         scale, root, lfoWave, lfoAmp(0-100), lfoOffset(-100..100), lfoRate(cycles/pattern),
 *         spread, bias(-100..100), quantSteps(0-100), loop(steps), loopFrom(1-based step), dejaVu(0-100), velocity,
 *         humanize(0-100), octave(0-100), gravity(0-100), unipolar(bool),
 *         gateQuant(0-100), snapGrid(steps)
 */
export function generate(params) {
  const rng = mulberry32(params.seed >>> 0);
  const lfoRng = mulberry32((params.seed ^ 0x3c6ef372) >>> 0);  // separate stream: switching the wave must not shift the gates
  const velRng = mulberry32((params.seed ^ 0x5bd1e995) >>> 0);  // separate stream: humanize must not shift pitch draws
  const octRng = mulberry32((params.seed ^ 0x85ebca6b) >>> 0);  // separate stream: octave jumps must not shift pitch draws
  const gravRng = mulberry32((params.seed ^ 0x27d4eb2f) >>> 0); // separate stream: root gravity must not shift pitch draws
  const loopRng = mulberry32((params.seed ^ 0x2545f491) >>> 0); // separate stream: the loop must not shift pitch draws
  const snapRng = mulberry32((params.seed ^ 0x165667b1) >>> 0); // separate stream: grid snap must not shift pitch draws
  const scale = SCALES[params.scale] || SCALES.pentMinor;
  const len = clamp(params.length || 64, 1, 64);
  const amp = (params.lfoAmp ?? 50) / 100;
  const offset = (params.lfoOffset ?? 0) / 100;         // -1..1
  const center = params.root;                            // notes swing around the root
  const span = 36;                                      // semitones of swing
  const wave = params.lfoWave || "sine";
  const isRandom = wave === "random";
  const shapeAmt = Math.min(1, Math.max(0, (params.lfoShape ?? 0) / 100));
  const lfo = isRandom ? null : lfoFactory(wave, lfoRng, shapeAmt);
  // lfoRate is CYCLES ACROSS THE PATTERN; `div` (steps per cycle) is what the
  // phase math needs. Whole cycles repeat on the phrase, fractional ones drift.
  // A periodic wave degenerates when sampled at 1-2 phases (a sine at div 2 reads
  // phase 0 and 1/2, both 0); the random source is fine at div 1.
  const cycles = Math.max(0.1, Math.min(16, params.lfoRate || 4));
  const div = Math.max(isRandom ? 1 : 2.5, len / cycles);
  let randVal = 0.5;                          // held value of the random source
  const gateProb = (params.gateProb ?? 70) / 100;
  // Gate placement is a GRADIENT: 0% = pure per-step random, 100% = pure
  // Euclidean (N hits at the evenest positions of an M-step cycle), and in
  // between each step rolls which law governs it. Gate % stays the density
  // on both ends, so the knob only moves the rhythm's character, not its
  // note count. The cycle follows the Loop length when the loop is on
  // (default 8 steps), else one bar of sixteenths. Rotation turns the mask.
  // (Legacy: gateMode "euclid" = blend 100.)
  const blend = Math.min(1, Math.max(0,
    (params.gateBlend ?? (params.gateMode === "euclid" ? 100 : 0)) / 100));
  const loopLen0 = Math.round(params.loop || 0);
  const M = Math.max(2, blend > 0 && loopLen0 >= 2 ? loopLen0 : 16);
  const N = blend > 0 ? Math.max(0, Math.min(M, Math.round(gateProb * M))) : 0;
  let eMask = null;
  if (blend > 0) {
    eMask = euclid(N, M);
    const rot = ((params.euclidRot ?? 0) % M + M) % M;
    if (rot) eMask = [...eMask.slice(rot), ...eMask.slice(0, rot)];
  }
  const loopStart = Math.max(0, Math.round(params.loopFrom ?? 1) - 1);  // 1-based in the UI, 0-based here
  const loopLen = Math.round(params.loop || 0);                 // motif length in steps (0 = off)
  const loopSlip = (params.dejaVu ?? 0) / 100;                  // chance a later step loops back
  const quantStrength = (params.quantSteps ?? 100) / 100;
  const fixedVel = params.velocity;
  const hum = (params.humanize ?? 0) / 100 * 40;   // velocity deviation, +/- 40 max
  const octChance = (params.octave ?? 0) / 100;    // chance a note jumps up one octave
  const gravity = (params.gravity ?? 0) / 100;     // chance a note snaps to the nearest root
  const unipolar = !!params.unipolar;              // range rises from Offset instead of centring on it
  const gateQuant = (params.gateQuant ?? 0) / 100; // chance a note snaps to the grid
  const snapGrid = Math.max(2, Math.min(8, Math.round(params.snapGrid || SNAP_GRID)));  // grid spacing in steps

  const steps = Array.from({ length: 64 }, () => ({ rate: params.rate, notes: [] }));
  const contour = new Array(64).fill(0);   // raw pitch per step (pre-quantize), for the wave scope
  const gates = new Array(64).fill(0);     // gate-open per step, for the scope's trigger lane
  for (let i = 0; i < 64; i++) {
    // Gate roll FIRST: its draws own the main stream, so the pitch math below
    // (lfoRng-only or pure) can never shift the gate pattern.
    const active = i < len && (blend <= 0
      ? rng() < gateProb
      : blend >= 1
        ? eMask[i % M] === 1
        : (rng() < blend ? eMask[i % M] === 1 : rng() < gateProb));
    gates[i] = active ? 1 : 0;

    // Pitch source — the LFO free-runs every step (the design: the clock
    // advances it regardless of the gate); S&H only matters at gate-open.
    // Deterministic waves read their periodic shape at `div` steps per cycle;
    // "random" draws a fresh value every `div` steps and holds it (S&H), with
    // spread choosing the distribution and bias skewing it.
    let shaped;
    if (isRandom) {
      // floor-based so fractional `div` works: a draw each time the block index ticks
      if (Math.floor(i / div) !== Math.floor((i - 1) / div)) randVal = drawRandom(lfoRng, params.spread || "uniform");
      shaped = randVal;
    } else {
      const phase = ((i / div) % 1 + 1) % 1;
      shaped = shape(clamp(lfo(phase), 0, 1), params.spread || "uniform");
    }
    shaped = skew(shaped, (params.bias ?? 0) / 100);
    // Offset is the centre of the range and Amplitude its reach. Bipolar spreads
    // both ways; unipolar keeps the Offset note as the floor and rises from it.
    const centreNote = center + offset * (span / 2);
    const dev = amp * (span / 2);
    const raw = unipolar
      ? centreNote + shaped * dev
      : centreNote + (shaped - 0.5) * 2 * dev;
    contour[i] = clamp(raw, 0, 127);
    if (!active) continue;

    // clamp the NOTE, not the LFO position, so offset shifts the range without
    // collapsing the swing (it only pins once the note hits the MIDI limits)
    let note = quantize(clamp(raw, 0, 127), scale, params.root, quantStrength, rng);
    // Root gravity: snap to the nearest root note, keeping the register, so the
    // melody is grounded rather than flattened onto one pitch.
    if (gravity && gravRng() < gravity) note = params.root + Math.round((note - params.root) / 12) * 12;
    // Octave up: +12 keeps the same scale degree, so the note stays in key. Skipped
    // when it would leave the MIDI range, rather than pinning to 127.
    if (octChance && octRng() < octChance && note + 12 <= 127) note += 12;

    const vel = fixedVel === "random" || fixedVel == null
      ? 20 + Math.floor(rng() * 107)
      : clamp(Math.round(fixedVel + (hum ? (velRng() * 2 - 1) * hum : 0)), 1, 127);
    // Grid snap: with the slider's probability, a note survives only if it already
    // sits on a grid line (spacing = Snap grid). Keeping the line's own note instead
    // of moving notes onto it means Gate still decides how many lines fire, so
    // density and grid stop fighting each other. Off-grid notes become rests.
    if (gateQuant && snapRng() < gateQuant && i % snapGrid !== 0) continue;
    steps[i].notes = [{ note: clamp(Math.round(note), 0, 127), vel }];
  }
  // Loop: the loop material is always the phrase's first `loopLen` steps. From
  // `loopStart` to the end, each step copies the material (wrapping at loopLen),
  // so "loop from 42" replays the phrase from its beginning starting at step 42,
  // and loop from 1 (the default) is the classic "repeat the first N steps".
  // loopSlip is the chance each step actually copies; below 100% fresh notes
  // still bleed in. Copied steps carry `echo` so the grid can mark them.
  if (loopLen >= 2 && loopLen <= len && loopStart < len) {
    for (let i = loopStart; i < len; i++) {
      const src = (i - loopStart) % loopLen;
      if (src === i) continue;   // the first pass of the material is the material
      if (loopSlip >= 1 || loopRng() < loopSlip) {
        steps[i].notes = steps[src].notes.map((n) => ({ ...n }));
        steps[i].echo = src;
      }
    }
  }
  return { length: len, rate: params.rate, tempo: params.tempo, gate: params.gate, swing: params.swing, steps, contour, gates };
}

export const LFO_RATES = [1, 2, 4, 8, 16, 32, 64];
export const SPREADS = ["constant", "bell", "uniform", "extremes"];

/**
 * generateBank(base, driftPct) -> 16 patterns.
 *
 * All 16 are derived from `base.seed` (so the bank is reproducible) but the
 * character parameters *evolve* across them: slot 0 is the base, slot 15 is
 * drifted furthest along a seeded direction. Notes are quantised to the same
 * scale/root, so the bank reads as one evolving idea rather than 16 randoms.
 */
export function generateBank(base, driftPct = 50) {
  const drift = Math.max(0, Math.min(100, driftPct)) / 100;
  const seed = base.seed >>> 0;
  const r = mulberry32(seed ^ 0x9e3779b9);
  // seeded drift direction per parameter
  const dir = {
    gateProb: r() < 0.5 ? -1 : 1,
    gateBlend: r() < 0.5 ? -1 : 1,
    lfoAmp: r() < 0.5 ? -1 : 1,
    bias: r() < 0.5 ? -1 : 1,
    lfoOffset: r() < 0.5 ? -1 : 1,
    lfoRate: r() < 0.5 ? -1 : 1,
    lfoShape: r() < 0.5 ? -1 : 1,
    spread: r() < 0.5 ? -1 : 1,
    humanize: r() < 0.5 ? -1 : 1,
    octave: r() < 0.5 ? -1 : 1,
    gravity: r() < 0.5 ? -1 : 1,
    gateQuant: r() < 0.5 ? -1 : 1,
    euclidRot: r() < 0.5 ? -1 : 1,
  };
  const spreadIdx0 = Math.max(0, SPREADS.indexOf(base.spread));

  const bank = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 15) * drift;                 // 0 .. drift
    const p = {
      ...base,
      // 16 DISTINCT generations, all derived from the one seed (so the bank is
      // reproducible). Drift is the optional evolution on top: at 0% the 16 are
      // 16 fresh takes on the same parameters; higher, the parameters themselves
      // move from slot 1 to slot 16.
      seed: (seed + i * 0x9e3779b1) >>> 0,
      gateProb: clamp(base.gateProb + dir.gateProb * t * 40, 5, 100),
      gateBlend: clamp((base.gateBlend ?? 0) + dir.gateBlend * t * 30, 0, 100),
      lfoAmp: clamp(base.lfoAmp + dir.lfoAmp * t * 35, 0, 100),
      bias: clamp(base.bias + dir.bias * t * 55, -100, 100),
      lfoOffset: clamp(base.lfoOffset + dir.lfoOffset * t * 40, -100, 100),
      lfoRate: clamp(+(base.lfoRate * (1 + dir.lfoRate * t * 0.75)).toFixed(1), 1, 16),
      lfoShape: clamp((base.lfoShape ?? 0) + dir.lfoShape * t * 30, 0, 100),
      spread: SPREADS[clamp(spreadIdx0 + Math.round(dir.spread * t * 2), 0, SPREADS.length - 1)],
      humanize: clamp((base.humanize ?? 0) + dir.humanize * t * 45, 0, 100),
      octave: clamp((base.octave ?? 0) + dir.octave * t * 25, 0, 100),   // gentle: octave jumps get busy fast
      gravity: clamp((base.gravity ?? 0) + dir.gravity * t * 30, 0, 100),
      gateQuant: clamp((base.gateQuant ?? 0) + dir.gateQuant * t * 25, 0, 100),   // gentle
      euclidRot: (base.euclidRot ?? 0) + Math.round(dir.euclidRot * t * 6),
    };
    bank.push(generate(p));
  }
  return bank;
}
