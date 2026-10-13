# FM-1 Pulses

Browser-based generative MIDI sequencer for the **M-VAVE FM-1** (6-op FM synth).
Vanilla JS + Web MIDI API + PWA. No server, no build step, no dependencies.

**▶ Live:** https://mene311.github.io/fm1-pulses/

**Firmware:** the freeze path (pattern write, SysEx `0x20`) exists only on the
**FM-1+VA / Baud Girl** firmware — stock firmware has no pattern-write SysEx.
On any firmware the app still works as a live MIDI broadcaster (▶ Play and
morph in real time).

**Signal chain:** Clock → Gate Probability → S&H → LFO → Distribution → Quantizer → MIDI out → Buffer (Loop + Deja Vu).

## Quick start

It is a **sequence generator**: shape the randomness, generate a 64-step phrase,
and **freeze** it into one of the FM-1's 16 sequencer patterns. Once frozen the
FM-1 plays it standalone — the browser is not needed.

```bash
python3 -m http.server 8080   # Web MIDI needs a secure context (https or localhost)
```

1. Connect the FM-1 via USB and allow the MIDI permission prompt.
2. Pick **FM-1** in the device dropdown → status turns green.
3. Set your parameters → **Generate ⟳** → **16 distinct sequencers** appear, one
   per FM-1 slot. All 16 are **derived from the one Seed** (16 fresh takes on the
   same parameters, so the bank is reproducible), and you tap a slot to view it.
4. **Drift** is the evolution on top: at **0%** the 16 share the parameters and
   differ only by generation; raise it and the parameters themselves move across
   the bank (slot 1 → slot 16) — more/less amplitude, bias, density, LFO speed…
5. Click a slot in the bank to see its 64-step grid → **Freeze → FM-1** (or `F`)
   writes just that one, or **Send all 16** writes the whole bank. **Clear all 16**
   writes empty patterns over the whole bank, wiping the device's sequencer (it asks
   first, and leaves the browser bank alone).

`←` / `→` move between slots. **Randomize** rolls a new seed + parameters;
**Generate** re-derives the bank from the current seed.

> ### ⚠ Caveat: the FM-1's own sequencer must be **stopped**
>
> The firmware **refuses** a pattern write while its sequencer is playing:
> SysEx `0x20` comes back `status 3` — *"the Sequencer is playing; stop it and
> send again"*. So before freezing, turn **SEQ off** (or STOP) on the device.
> The app reads the reply and shows this if a freeze is refused.
> (`status 1` = value out of range, `2` = damaged in transit.)

Auditioning is the **▶ Play** button: it **loops** the selected slot, and keeps
looping. It plays through a **small built-in FM synth in the browser** *and* sends
MIDI to the FM-1 — so you hear it even with no device attached (the **🔊** button
mutes the browser side only). Clicking a bank slot previews that slot once.
Because the sliders re-derive the bank
in real time, you can **morph the sound while it plays** — change Scale, Gate,
Bias, Drift… and the loop follows on the next step. That makes it a live
generative broadcaster: plug in the FM-1, hit Play, and tweak. Press **■ Stop**
(or Space) to end. This path is unaffected by the freeze caveat.

## Docs

- `DESIGN.md` — full design: modules, signal chain, defaults, UI layout.
- `GOTCHAS.md` — known pitfalls (MIDI timing, BLE latency, tab throttling) and mitigations.

## Scale presets

`presets/scales.json` holds the 20 scale presets. Schema:

```json
{ "id": "dorian", "name": "Dorian", "intervals": [0, 2, 3, 5, 7, 9, 10] }
```

`intervals` are semitone offsets from the root note (C = 0). The `custom` entry has
empty `intervals` — the user fills it via the chromatic toggle grid (persisted to localStorage).

## Structure

```
index.html, manifest.json, sw.js, css/style.css
js/pattern.js    — the SysEx 0x20 encoder (byte-verified vs Virtual-FM-1's codec)
js/generator.js  — LFO → distribution → quantizer → gate → grid snap → Loop
js/midi.js       — Web MIDI: find FM-1, send pattern (reads the reply), notes
js/app.js        — UI wiring: controls, step grid, theme menu, freeze/audition
presets/scales.json
```

## Status

**Working** — generate a 16-slot bank → freeze → the FM-1 plays it standalone.
Live-MIDI audition works too. Themes are the FM-1's own seven (decoded from its
firmware's `BGTHEME` table).
