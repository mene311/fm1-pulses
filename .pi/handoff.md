# FM-1 Pulses — handoff

## Mission

A **browser sequence generator for the M-VAVE FM-1** (vanilla JS, no build step,
no deps). Shape randomness with sliders → generate a **bank of 16 phrases** →
hear them in the browser → **freeze** them into the FM-1's own sequencer patterns
over Web MIDI (SysEx `0x20`). Also works as a **live MIDI broadcaster** (loop the
selected slot and morph it in real time).

- **Live:** https://mene311.github.io/fm1-pulses/
- **Repo:** `github.com/mene311/fm1-pulses` (public) — Pages deploys from `main` / root
- **Local:** `~/fm1/projects/fm1-pulses/` (phone — it is phone-local, no SSH needed)
- **Device notes / tools:** `~/Projects/mvave-fm1/` (see its README)
- **Bluetooth:** the FM-1 has native **BLE MIDI** (documented + the standard BLE-MIDI
  GATT UUIDs are in its firmware). Plan, evidence, risks and the verification ladder live
  in **`notes/BLUETOOTH-PLAN.md`** — planned, not implemented.

## Progress

**Toolchain**
- [x] `js/pattern.js` — SysEx `0x20` encoder, byte-verified against Virtual-FM-1's
      `sync/Fm1Seq.cpp` (8 msgs × 177 bytes, checksum included)
- [x] `js/generator.js` — LFO → distribution → quantizer → gate → Deja Vu;
      `generateBank()` = **16 distinct slots from one seed**, `Drift` evolves the
      parameters slot 1 → 16
- [x] `js/midi.js` — finds the FM-1, sends patterns and **reads the reply**
      (surfaces `status 3 = sequencer playing` instead of failing silently)
- [x] `js/audio.js` — small 2-op FM Web Audio preview (hear it with no device)
- [x] `js/app.js` — all UI wiring

**Features**
- [x] Bank strip (16 mini step-maps), tap to select, `←`/`→`
- [x] 64-step grid, one **circle** per step (white = rest, accent = note)
- [x] **Step editing + locks** — click a step, `±` semitone, `✕` empty; edits
      **lock** the step so it survives regeneration; "clear all locks" releases
- [x] **Live loop** — ▶ Play loops the selected slot; any slider re-derives the
      bank in real time (debounced 40 ms) and the loop follows within a step;
      playhead shows the current step
- [x] **Felucca profile** — `js/felucca.js` (editor protocol codec: `INFO`,
      `TRACK_STEP` read/write, step mapping) + `rack.js` detection/freeze/clear.
      Validated on the real unit (Felucca 1.5.1, FM-1_915) over USB from the phone:
      INFO parsed, step write→read→restore round trip clean. Freeze does a dry-run
      diff and writes only changed steps into the T1–T4 target track.
      Codec tests: `node js/felucca.test.mjs` (15 checks).
- [x] **Freeze → FM-1** (selected) / **Send all 16**
- [x] **7 themes** = the FM-1's own (decoded from its firmware)
- [x] Tooltips on every control + typeable number boxes
- [x] **LFO rate is "LFO cycles": cycles across the pattern** (1–16, 0.5 step,
      continuous, no snapping — capped at 16 after listening tests; at 1/32 the high
      rates just read as jitter). `div = len / cycles`; periodic waves are floored at
      div 2.5 so a sine cannot collapse (it degenerates at div 1 and 2 — phase 0 and ½
      both read 0). Multiples of the bar count repeat, fractional ones drift. Default 4.
- [x] **`random` wave** — a Marbles-style stochastic source. It draws a fresh value
      every LFO-rate steps and holds it; `spread` picks the distribution
      (uniform / bell / extremes / constant) and `bias` is a real monotonic skew.
      The deterministic waves are unchanged as contours. Verified: `random` gives
      30 pitches at /1 and 4 at /16 (a sine at /4 is stuck at 3); 16/16 distinct
      slots even at Gate 100%.
- [x] **Bias fixed** — it was a second amplitude (positive values were clamped to a
      no-op). Now `skew(v,bias) = v^(3^-bias)`: measured mean note 53→69 as bias
      goes −100→+100, range unchanged.
- [x] Amplitude/offset show the **notes** they produce; magnet snaps at
      root/3rd/5th/octave
- [x] **Offset is the centre (median) of the pitch range; Amplitude is its
      half-width** — notes span `centre ± 18·amp` semitones, so Amplitude 0 sits
      exactly on the Offset note. The Amplitude readout shows that offset-centred
      range, and `generator.js` no longer has the old "Amplitude 0 = scale root"
      special case (it made 0% ignore Offset).
- [x] **Swing is audible in the browser** — `swingFrac()` delays every offbeat,
      50% straight → 75% triplet (2:1). Before this the slider only wrote the
      header byte for the FM-1 and the browser audition ignored it.
- [x] **Clear all 16** button — writes a full 64-step empty pattern over every slot.
      ⚠ Unresolved on hardware: a single **Freeze** works (Android Chrome) but
      Clear fails with SysEx status 3 even with the FM-1's sequencer stopped, so
      the FM-1 may refuse an all-empty pattern. Probe files made for the verified
      path: `~/fm1/sysex/probe-empty64.syx`, `~/probe-empty1.syx`; test with
      `~/fm1/tools/fm1tool.sh write ~/fm1/sysex/probe-empty64.syx` (a non-empty `~/fm1/projects/fm1-mvp/*.syx` is
      the control). If empty patterns are refused, either find the real erase or
      drop the button.
- [x] **Unipolar** checkbox — Off: notes spread both ways around the Offset note.
      On: the Offset note is the floor and notes only rise from it.
- [x] **Octave up** (0–100%) — chance a note jumps +12. Same scale degree, so it
      stays in key. Own RNG stream, so moving it never reshuffles the melody.
- [x] **Root gravity** (0–100%) — chance a note is pulled to the nearest root note,
      keeping its register. Own RNG stream.
- [x] **Humanize** (0–100%) — per-note velocity jitter, ±40. Own RNG stream. Velocity
      and Humanize only affect the browser / live MIDI; the FM-1 plays its own
      velocity on pattern playback.
- [x] **Grid snap** (0–100%) + **Snap grid** (slider 2–8 steps, odd values allowed).
      Snap keeps only notes that already sit on a grid line, so Gate still decides how
      many lines fire — density and grid no longer fight. Off-grid notes become rests.
- [x] **Loop** (2 → Length÷2 steps, odd allowed) + **Deja Vu** (0–100%). Deja Vu's old
      cross-slot memory is gone: it now repeats the first N steps of the pattern
      itself, filling up to Length, with Deja Vu as the chance each later step loops
      back. This also un-broke Drift (cross-slot reuse used to make all 16 slots
      identical at Deja Vu 100%).
- [x] **`bell` fixed** — it used to push values *away* from the centre; now
      centre-weighted in both the periodic and random paths.
- [x] Defaults: note value 1/16, LFO cycles 4, Loop 8, Deja Vu 0 (so the loop is off on load)

**BLE probe (2026-10-03) — `probe/`**
- [x] `probe/encode.js` — DOM/Bluetooth-free byte layer: BLE-MIDI `packetize`,
      `0x11` read, `0x20` write, `createSysexReassembler`, `decodeReply`.
      This is the byte half of the future `BleTransport`.
- [x] `probe/ble.html` — throwaway Web Bluetooth page on Pages:
      connect → service/char dump → note on/off → `0x11` (R1) → `0x20` (R2).
      **https://mene311.github.io/fm1-pulses/probe/ble.html** (deployed, HTTP 200)
- [x] Byte-verified **before hardware**: `0x20` output is byte-identical to
      `fm1pat.py encode_write`; 177 B → 10 packets, all ≤ 20 B (MTU 23);
      reassembler round-trips byte-exact for reply lengths 0/20/127/128/179/180
      at **all 217** split points.
- [x] **Bug found:** the reply length field is 2× 7-bit groups ⇒ shift is **7**,
      not 8. `js/midi.js` and `fm1tool.c` both use `<< 8`, which cannot represent
      a length ≥ 128. Unused in both, so harmless — but wrong.
- [ ] **Run the ladder on the phone (Chrome, FM-1 paired to the phone).**
      Hardware is the last gate; nothing else stays blocked on it.

## Rack UI (the app now) — session 2026-10-04

**`index.html` IS the rack UI.** The slider version is archived as
**`sliders.html`** (still live, built from `app.js` + `style.css`) and frozen at
tag **`mvp-1`**. `rack.html` no longer exists. Files: `index.html`, `js/rack.js`,
`js/knob.js`, `css/rack.css`, `css/fonts/*.woff2`.

**Layout: a 6-rail grid.** `.rack` is `grid-template-columns: repeat(6, 1fr)`;
sections span 2 rails (Rhythm / Global / Pitch, 3 rows each) or 6 (Shape,
Memory). Every control is exactly **one rail wide** so nothing drifts. Two traps
that broke alignment, both fixed:
- Section boxes must NOT use a border or horizontal padding — a 2-rail box and a
  6-rail box then resolve to different cell widths. Draw the box with
  `box-shadow: inset 0 0 0 1px` instead (costs no layout), and keep the internal
  grid gap equal to the panel gap.
- A short section must be centred on **whole columns** (`gridColumn = off + i`),
  never by width (`width: 50%; margin: auto`), which lands on half-rails.
  Verified: rail centres 152/238/324/410/496/582 at a constant 86px pitch.

**Control types: no text boxes on the panel at all.** `knob()` (tick ring, domed
cap, drag/wheel/keys, shift for fine, double-click resets) and `rotary()` (a knob
over an option list, `ticks = positions-1, majorEvery: 0` so there is one detent
per position). Wave/Scale/Note/Spread/Unipolar are rotaries; the seed is a knob
that rolls. Short panel legends for the waves (`randomWalk` → `walk`), full name
in the tooltip. `sw()` still exists in `knob.js` but is unused.

**THE PANEL IS THE CASE COLOUR.** Painting every surface near-black with a small
accent measured **79% near-black / 19% coloured** and read as dull. The FM-1 is a
*coloured case with dark knobs and a dark screen*, so `--panel` is the case
colour, the knobs are dark, and `.display` carries its **own local dark palette**
so steps stay a dark TFT. After: 32% near-black / 66% coloured.
**Ink is chosen per theme by comparing dark vs light**, never by a lightness
guess: orange needs dark ink (5.4:1) where light ink only managed 3.6:1.

**Themes are calibrated off real hardware.** Case/key pairs came from M-VAVE
product photos, then five were re-derived by **k-means clustering the user's own
close-up photos into 4 colours** and reading the two dominant non-shadow clusters
as case and keys — the shadow falls out as its own cluster, which is what fixed
purple's secondary. Tools: `~/fm1-colours.py` (k-means palettes) and
`~/fm1-calib.py` (one photo → proposed theme line + contrast checks).
Take the **75th percentile**, not the mean: the mean drags toward the shadowed
gaps between keys and read the brown unit too dark. **`black` and `grey` are
still product-shot estimates** — both are near-neutral, so a close-up gives two
greys clustering cannot separate from shadow.
Contrast is enforced numerically: legends 4.5:1 on the panel, dividers 3:1,
accent 4.5:1 on the dark screen.

**Typeface:** Barlow Semi Condensed, self-hosted (`css/fonts/`, 3 weights, 68KB,
SIL OFL) so the app still works offline. A condensed grotesk is what a panel
legend is printed in; the system sans read as a web dashboard.

**Audition timing had a real bug (but it was NOT the user's complaint).** The
gate floors (`max(12ms note, max 3ms release)`) ADDED to each step instead of
eating into it, because the loop slept relative durations: measured +5.4% at gate
5% on 1/16 and **+16.1% on 1/32**. Now the loop waits until an **absolute** target
time per step (measured +0.0%) and re-anchors if it falls >250 ms behind. Fixed in
both `rack.js` and `app.js`.
**Do not claim this explained the tempo mismatch.** The user's ear was about the
tempo, not the step length; this was a separate defect found while looking.

**The guide (`guide.html`) documents the rack**: Rhythm / Global / Pitch / Shape
/ Memory, each control tagged knob or switch.

### ⚠ Tempo does not reach the FM-1 (Baud Girl 093) — RESOLVED (2026-10-04): the firmware ignores the 0x20 tempo bytes

**The app sends it correctly.** Verified end to end: knob → `state.tempo` →
`syncHeader()` → `encodeWrite` → `tempoLo`/`tempoHi`; tempo 140 emits `0c 01`
which decodes back to 140, with `save` on the last of 8 parts. Layout matches the
reference codec exactly (`0x20, pat, part, save, len, rate, tempoLo, tempoHi,
gate, swing, voice`), and the reference's own test asserts `tempo = 97` survives.

**But the device never takes it. This is now deterministic, not intermittent.**
Full battery on the live unit (single USB session, every write acked `status 0`):

    freeze slot10 tempo=137  8/8 acked  → gset identical, tempo stays 200
    freeze slot10 tempo=137  8/8 acked  → gset identical
    freeze slot10 tempo=163  part-by-part, gset read after each part → never moves
    freeze slot 3 tempo=201  8/8 acked  → gset identical
    freeze slot10 tempo=45   8/8 acked  → gset identical (programmatic diff)
    freeze slot10 tempo=250  8/8 acked  → gset identical (programmatic diff)

while in the SAME messages, on the SAME device:

    swing gset[34+p] 75 → 50   ✓ landed (slots 3 and 10)
    rate  gset[50+p]  4 → 8    ✓ landed

So the 0x20 header fields work — except tempo. The firmware acks the write and
discards the tempo bytes. The unit's global tempo (currently 200, mirrored across
all 16 slots at `gset[66 + 2*p]`) is only changed by the unit's own controls so
far. The earlier "~99% worked" impression is superseded: with read-back
instrumentation, tempo never lands.

**Tooling built for the battery (phone-local, outside the repo):** `fm1batch`
(runs a whole test script in ONE USB session — repeated `termux-usb` claim/release
cycles make the FM-1 go deaf until replug, which cost an hour of false "device
dead" readings), `fm1-tempo-test.py` (patch .syx tempo/slot + checksum — checksum
is at byte 175, F7 at 176), `fm1param` (single-parameter write `F0 43 10 pp qq vv
F7`), `fm1clock` (F8 @ 24 PPQN stream).

**Quirk worth encoding in the app:** the FIRST `0x11` read of a USB session
returns 0 bytes; every later one works. Retry reads once before reporting failure.

**Remaining untested paths that COULD set the global BPM over MIDI:**
1. Single-param write `F0 43 10 pp qq vv F7` (params 0–155) — sweep them looking
   for the one that moves `gset[66]`. Not yet run (writes 156 unknown params).
2. `F8` MIDI Clock while the unit's sync mode is ON — streams tempo while the
   app is connected; the unit's stored BPM is untouched.

**Design consequence (what the app should do):**
- The device is the source of truth for BPM. Read `gset[66]` on connect and show
  "FM-1 holds N BPM"; sync the Tempo knob to it.
- The Tempo knob drives the browser player and is *attempted* at freeze, but the
  UI must say the device's own tempo governs standalone playback (caveat on the
  knob + in the freeze status line).
- Keep sending the tempo bytes in the header (acked, harmless) in case a firmware
  update honours them.

Facts that are solid:

- `gset[66 + 2*pattern]` holds the tempo, little-endian, plain BPM (the user set
  200 on the unit → `c8 00` at that offset, for **all 16 slots**). So the tempo
  behaves like a unit-global value mirrored per pattern.
- `GSET_ADDR = 0x01C0E840 + 5816`, `GSET_LEN = 137`; rate `gset[50+p]`, swing
  `gset[34+p]`, gate `gset[18+p]`, length `gset[98+p]` all confirmed live.
- The only memory opcodes: `0x04` write voice, `0x10` read sound, `0x11` read
  memory, `0x20` write pattern — plus the documented single-parameter write
  `F0 43 10 pp qq vv F7` (params 0–155), which is the one remaining candidate
  for a MIDI-side global-tempo write.
- The device's own tempo range goes to 300, so the hardware can hold it.

### Diagnostics kept in the app

- **`read device`** (status row) dumps the whole 137-byte settings block as hex,
  read-only. Change ONE thing on the FM-1, read again, and the bytes that move are
  that setting. This is how the tempo offset was pinned.
- **Freeze reports what the DEVICE holds**: `sent 140 bpm, device holds 140 bpm`,
  or on disagreement `sent 61 but the device holds 127 · gset[60..72] = …`.
  Implemented with `midi.readMemory(GSET_ADDR, 137)` (SysEx `0x11`), which needed
  `decodeReply` to return `len` + `data`.
- `GSET_ADDR = 0x01C0E840 + 5816`, `GSET_LEN = 137`.

### Verification habits (learned the hard way)

- `thum.io` never executes module JS. `microlink` races it, pin with
  `waitFor=#steps .cell` — and it has a **daily free-tier limit**; when exhausted,
  ask the user for a screenshot instead (analysis with PIL still works).
- The DeepSeek vision model **downscales the screenshot**, so it cannot see 1px
  grain, 4px screws or 2px shadows and will flatly say "no texture, no screws".
  It also misread a photo of the panel as "an aircraft cockpit". Trust PIL
  measurements against the pixels; use the model for prose, not geometry.
- **Run the edit, then commit, in SEPARATE tool calls.** Twice a file edit and the
  `git commit` ran in parallel and a CSS change silently never got committed,
  which then looked like "the fix did nothing".

## Key device facts (hard-won — do not re-learn)

- **Pattern write** (FM-1+VA / baud girl firmware only): SysEx `0x20`, 8 steps per
  message, 177 bytes:
  `F0 43 00 7D 20 <pat> <part> <save> <len> <rate> <tempoLo> <tempoHi> <gate> <swing> <voice> [8 × (rate, nNotes, notes[9], vels[9])] <sum> F7`,
  `sum = Σ(b ^ 0xFF) & 0x7F` over the body. `parts = max(2, ceil(len/8))`, last carries `save`.
- **Replies:** `F0 7D <7-bit LSB-first packed> F7` = `7D <kind> <status> <arg:4LE> <len:2LE> <data> <sum8>`.
  kind `0x50` sound, `0x51` mem, `0x52` pattern. status `0` done, `1` out of range,
  `2` damaged, **`3` the sequencer is playing**.
- **⚠ The FM-1's sequencer must be STOPPED** to accept a write (status 3 otherwise).
- **⚠ USB-MIDI SysEx framing trap:** CIN `0x04` for the start **and every
  continuation** packet; only the **last** packet uses `0x05/0x06/0x07`. Using
  `0x06` for continuations truncates every SysEx at its first continuation packet
  — the write silently does nothing. (Cost hours; Web MIDI does this for you.)
- **Themes:** `BGTHEME` table in `baudgirl_092_app.bin` @ `0x8ecbc` — 7 entries of
  12-byte name + 4 × RGB565 (accent, tint, dark bg, mid).

## Remaining

- [ ] **Bluetooth / wireless.** Probe built and byte-verified — see `probe/`.
  Remaining: run the hardware ladder, then implement `BleTransport` behind the
  transport seam. The FM-1 is a
  standard **BLE-MIDI peripheral** (`03B80E5A-…` service + `7772E5DB-…` data I/O
  characteristic, both found in `baudgirl_092_flash.bin`), so the browser can drive it via
  **Web Bluetooth** — no cable, no OS pairing, and unlike Web MIDI it also works on
  Android Chrome. Blocked on one binary unknown: **does the FM-1's BLE side accept the
  proprietary `0x20` pattern write, or only SysEx voice dumps?** Run the verification
  ladder (power on → BT scan → small SysEx → the 177-byte write) before writing any code.
- [ ] **Spread/Bias behave differently per wave, but neither is inert.** Both run on
      the periodic waves: Bias is a monotonic skew applied after the branch (sine mean
      note 53.3 → 67.5 across bias −100 → +100, range unchanged), and Spread reshapes
      the contour (sine: constant → 1 pitch, extremes → 2, bell/uniform → 9). The
      `random` wave is just where Spread's modes act as true probability
      distributions. Default wave is `sine`.
- [ ] **Verify a browser freeze against the real device.** The encoder and reply
  parsing are verified, but the Web MIDI freeze has not been confirmed on hardware
  (the phone path uses `mvave-fm1/mvp/fm1tool` over libusb, which IS verified).
  Note Android Chrome may not expose USB-OTG MIDI through Web MIDI — desktop works.
- [x] **Audition timing fixed in the rack** (`rack.js`): the loop now waits until an
      ABSOLUTE target time per step instead of accumulating relative sleeps. The gate
      floors (`max(12ms note, max 3ms release)`) used to ADD to each step instead of
      eating into it — measured **+5.4% slow at gate 5% on 1/16 and +16.1% on 1/32**,
      which is why the browser sounded slower than the FM-1. Now +0.0%. It also
      re-anchors if it falls >250ms behind (throttled tab) rather than bursting.
      `app.js` (the MVP) still has the old accumulating loop — not ported, MVP frozen.
- [ ] Still `setTimeout`, so there is residual jitter inside a step. A lookahead
      scheduler using `MIDIOutput.send(data, timestamp)` would remove that too.
- [ ] Magnet interval set (root/m3/4th/5th/octave) is a guess — tune to taste.
- [ ] No persistence yet (bank + locks are lost on reload) — localStorage.
- [ ] Out of scope of the app but open on the device side: per-step
  ratchet/chance/accent/tie & slide and per-pattern Chain are **not** carried by
  `0x20` (firmware layout unpublished); ties are reachable only via real-time
  recording. See `mvave-fm1/README.md`.

## How it's deployed

```bash
cd ~/fm1/projects/fm1-pulses
git add -A && git commit -m "..." && git push    # Pages rebuilds in ~1 min
python3 -m http.server 8099                      # local (Web MIDI needs localhost/https)
```

GitHub Pages caches assets `max-age=600`. **Every asset is versioned through the
imports**: `index.html` loads `app.js?v=N`, and `app.js` imports
`generator.js?v=N`, `midi.js?v=N`, `pattern.js?v=N`, `audio.js?v=N`.
**When you change any JS, bump N in BOTH places** (`index.html` and the import
block at the top of `app.js`) or the browser will keep serving the stale module.
This bit once: the modules were unversioned, so `generator.js` changes never
reached the phone even though `app.js` did. `guide.html` carries its own `?v=N`
on `css/style.css`. To force a one-off refresh, open the page in Incognito or append
`?v=N` to the page URL.

## Session 2026-10-04 (evening) — euclid, perlin, Shape knob, tempo WYSIWYG

### Bug fix 2026-10-06 — wave switch reshuffled the gates

The stochastic waves (perlin/random/randomWalk/sampleHold) drew from the
shared main RNG stream that also rolls the gates, so switching to them moved
the whole gate mask (7–26 steps differed); sine/triangle/saw/square consumed
no extra draws and stayed put — which is what the user heard. Fix: `lfoRng =
mulberry32(seed ^ 0x3c6ef372)` — the LFO (factory + drawRandom) now has its
own stream, like vel/oct/grav/loop/snap already had. Verified: all 8 waves
keep the identical gate mask per seed while the notes still change per wave.
Committed `45b2887`, pushed from the phone (gh token, no laptop needed).

### UI fix 2026-10-06 — loop region darkened instead of highlighted

Loop steps were tinted on the dot itself (20-30% accent), so notes inside the
loop looked darker than notes outside it (full accent). Now the highlight sits
on the cell behind the dot: notes keep full brightness, loop rests lift out of
the dim, the region's first step glows with an fg ring. Minimap (style.css)
matching. Committed `19874df`.

### User feedback round — 2026-10-07 (`bdfeec1`)

1. Slot preview: `playOnce(s)` takes the slot explicitly + `panicPreview()` kills
   still-sounding preview notes on switch (no more previous-slot bleed). If it
   persists on a phone it is likely touch-target size on the 16-up bank row —
   make preview opt-in (first tap selects, second plays) if reported again.
2. Step dots: `fitSteps()` sizes dots to min(cell width, row height) via --dot;
   `min-width: 0` stops note labels stretching circles when rows are short.
   NOT browser-verified (laptop was down) — check on a small phone on refresh.
3. Tooltips: "tips on/off" toggle in the status row, persisted (fm1p.tips);
   MutationObserver strips titles set later by renders.

### Wave scope + LFO free-run — 2026-10-06

Added a canvas scope in the display (between steps grid and editor): pitch
contour line (pre-quantize raw pitch), played notes as dots on stems back to
the contour, loop backdrop + start guide, playhead line, wave/cycles label and
min/max note labels. Hooks: renderBuffer, markStep/clearPlayhead, applyTheme,
resize. The user wanted proof the waves do what they should.

Also: the LFO now advances every clock tick (free-run) regardless of the gate
— the stateful waves used to pause during rests. Deterministic waves are
byte-identical; random/walk/smooth/hold changed how they sound by design.
Committed `8c4d229`. `generate()` now returns `contour` (64 raw pitches).

Scope upgraded to a debug readout (`e99b71b`, per user: it does not have to
fit the UI): 150px tall, plain bg, cycle-boundary grid (div math), C-octave
lines + labels, gate trigger lane (dim = gate opened, accent = note survived),
staircase trace of played notes, hover readout per step. `generate()` also
returns the raw `gates` mask now.

### Perlin fix 2026-10-06 (`7515282`)

Gradient noise reads exactly 0 at lattice points; at 4 cycles the 1.5
cells/step sampling hit the lattice every other step → half the contour froze
at centre → quantized to root (36/47 notes). Switched perlin to smoothed VALUE
noise + peak normalization; spread now matches sine's. The Shape knob's
"octave shimmer" term uses the same noise.

### Quantizer octave bug 2026-10-06 (`a8246da`)

User spotted (via the debug scope) notes an octave off the contour with root
gravity and octave up at 0. Quantiuze kept the octave of the INPUT's rel
offset: B (rel 11) whose nearest scale note was C wrapped DOWN an octave
(59 -> 48 instead of 60). Sweep: 90 bad cases, worst 11 semitones. Now each
degree is taken at its nearest octave occurrence; ties go higher per DESIGN.
After: worst 1.5 semitones over 720 patterns.

**The tempo verdict is now deterministic** (see the RESOLVED section above): the
firmware acks the 0x20 tempo bytes and discards them; 6 test tempos, zero gset
changes, while swing/rate/gate land. The single-param write (`F0 43 10 pp qq vv
F7`, params 0–155) is ALSO dead on this firmware — swept all 156, zero gset
moves, no replies. F8 clock streams cleanly but changes nothing stored. So the
device's own tempo is the only tempo.

**App changes for WYSIWYG tempo (rack only):**
- `syncDeviceTempo()` — reads the device's BPM (gset[66+2*slot]) and snaps the
  Tempo knob to it. Runs on connect, on "read device", and after every freeze
  (reusing the read-back data). The freeze status says plainly when the device
  ignored the sent tempo.
- Tempo knob tooltip + guide now state: BPM is device-global, freezing cannot
  change it, the app re-syncs to the device.

**New generator features (rack only; the slider app is frozen):**
- **Euclid gate mode** — Gate mode rotary `random`/`euclid`. In euclid mode the
  Gate % is the DENSITY: N = round(gate%×M) hits spread as evenly as possible
  (Bjorklund, rotated so rot 0 hits the downbeat) over M = Loop length (or 16 if
  the loop is off). Rotate knob (0–15, wraps) turns the mask. The loop info line
  shows `E(N,M) rot R`. Drift moves euclidRot ±6 across the bank.
- **Perlin wave** — 1D gradient noise contour (24 points per LFO cycle,
  smoothstep interpolation). Long evolving arcs; at 1 cycle it's one 64-step
  contour.
- **Shape knob (0–100)** — per-wave morph: sine = wavefold amount, triangle/saw
  = exponential bend, square = pulse width 50→5%, perlin = detuned octave
  shimmer, randomWalk = step size, smoothRandom = slew. Drift moves it ±30.
- knob.js gained a `tip` option: a persistent tooltip suffix (caveat text) that
  survives repaints.
- Guide updated: Tempo caveat, Gate mode, Rotate, Wave (perlin), Shape entries.

**Test tools now on the phone (outside the repo):** `fm1batch` (one-USB-session
scripted ops: read/write/param/sweep/clock/sleep — the ONLY reliable way to
drive the FM-1: repeated termux-usb claim/release cycles make the device deaf
until replug), `fm1param`, `fm1clock`, `fm1-tempo-test.py` (syx patcher with
correct checksum at 175 / F7 at 176), `fm1-tempo-battery.sh`.

**Still open:** the audible F8 follow test (unit Timing→Sync=On, app streams
clock) — gset proves nothing, needs ears on the device.

**F8 clock following — tested 2026-10-04, verdict: REAL BUT BROKEN on Baud Girl 093.**
The unit audibly slows when F8 streams (user confirmed by ear) and the change is
measurable in the note stream, but the resulting tempo does NOT match the streamed
BPM by any consistent factor:

    no clock (control)       step ≈ 125 ms   (internal 120 BPM, 1/16)  ✓ exact
    F8 @ 90, 24 PPQN         step ≈ 216 ms
    F8 @ 120, 24 PPQN        step ≈ 297-300 ms   (≈50 BPM, 2.4× off)
    F8 @ 120, 48 PPQN        step ≈ 241 ms
    F8 @ 120, CIN 0x05       step ≈ 300 ms (same)

So it is not a PPQN (24 vs 48) issue and not a USB-MIDI CIN issue — the firmware's
clock follower is just wrong. Transport over MIDI also does nothing useful in
slave mode: FA does not arm the sequencer (it only plays when started from the
unit's own PLAY button), FC seems ignored. The device must be armed from the
unit, then it follows the clock — badly.
**Decision: no clock-sync feature in the app.** The WYSIWYG tempo read (gset) is
the correct and only reliable path; the unit's own knob is the tempo setter.

**Gate mode became a GRADIENT (2026-10-04 late).** The `random`/`euclid` rotary
is now a 0-100% **Euclid** knob: 0% = per-step random, 100% = pure Bjorklund
mask, in between each step rolls which law governs it (seeded, reproducible).
Gate % stays the density on both ends (measured flat across the gradient), so
the knob moves the rhythm's character only. `gateBlend` state key; legacy
`gateMode:"euclid"` still maps to blend 100 when `gateBlend` is absent. Drift
moves blend ±30. Loop info shows `E(N,M) @blend%`. The trailing tempo probe
(one device read 1.2s after the last knob tweak) shipped with it.

**BLE verdict (2026-10-04):** the ladder ran on hardware — connect/notes-out/
notes-in all work, but `0x11` reads get no reply and `0x20` writes do not land
(slot 15 empty after SAVE). BLE is notes/CC-only on Baud Girl 093; the hybrid
fallback (BLE play, USB freeze) is the design. Two GATT drops in the first
minute → any BLE transport needs auto-reconnect. Plan doc updated.

**BLE play transport shipped (2026-10-04).** After the ladder verdict
(notes/CC-only), `midi.js` grew the BLE half: `connectBle` (namePrefix FM-1,
silent reconnect via `getDevices()`), BLE-MIDI packetizer for short messages,
`bleSendNoteOn/Off`, and an auto-reconnect loop with doubling backoff (6 tries
then "lost"). rack.js routes the live loop through `liveNoteOn/Off` (BLE when
connected, USB otherwise — never both, the FM-1 would double every note) and a
**bluetooth** glink in the status row toggles the link (✓ / … / plain). Freeze,
Send 16, Clear, device-BPM reads stay USB-only; guide documents the split.

**Reddit launch post unslopped with the real scanners (2026-10-05).** Ran the
full detector suite on the laptop (noslop + theclaymethod phrase/structure/
silhouette, `--genre social`, body-only). Journey: noslop 11.4/1k → **0.0/1k**,
phrase FLAG ("no install, no accounts" = the No-X family) → CLEAN, structure
FLAG (sentence_burstiness 0.528) → CLEAN, silhouette callback 1.308 → **0.1**.
Adding the personal preface (VCV Rack/Cardinal habit, weak hand-sequencing,
Baud Girl unlocking the box) dropped the composite to **0.899 — under the
threshold. All four scanners clean on the final body**: noslop 0.0/1k, phrase
CLEAN, structure CLEAN, silhouette 0.899. The two metrics the skill says actually matter
(scaffold_opener_share, role_entropy_bits) are 0.0. Bullet lists were converted
to prose, preview labels ("Firmware heads-up:", "Things I found", "Also in
there") removed, and the closing shares zero topic vocabulary with the opener.
