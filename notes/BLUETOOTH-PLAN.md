# FM-1 Pulses — Bluetooth plan

Status: **verdict reached on hardware (2026-10-04) — BLE is notes/CC-only on Baud
Girl 093.** The ladder ran on the phone (Chrome, FM-1_BLE, probe/ble.html):

- GATT connect, service 03B80E5A… + char 7772E5DB…, notifications — all work.
- Note On/Off **out** works (sounded on the unit); note stream **in** works
  (the sequencer's notes arrive on notify, same as USB).
- **R1 FAILS:** `0x11` reads got no reply in 4s, three times, with the sequencer
  stopped (quiet line). BLE does not route the proprietary parser.
- **R2 FAILS:** `0x20` write + SAVE to slot 15 → slot 15 does not play the
  pattern. The write does not land.

So the manual's "incoming SysEx voice dumps" promise does not extend to the
`F0 43 00 7D` pattern protocol on this firmware. The **hybrid fallback is now the
design**: BLE for live note audition, USB for Freeze / read-device / Send 16 /
tempo sync. Observed in the same session: two GATT drops in the first minute, so
any BLE transport needs a reconnect loop.

Legacy plan below, kept for reference — everything about the transport seam still
applies to a play-only BleTransport (notes, no SysEx, no reply parsing).

## Verdict: the FM-1 has native BLE MIDI — it is a documented interface, not a hack

| Evidence | Finding |
|---|---|
| FM-1 official manual | *"The FM-1 supports three simultaneous MIDI interfaces: USB MIDI · **BLE MIDI** (iOS/Android/Mac/Windows) · 3.5mm MIDI IN."* Also: `HOME` long-press toggles BT — LED blinking = on but not connected, solid = connected, off = off |
| SoC (from the `.fwsc` update blobs) | JieLi **AC79xx** — "BT 5.0 + BR + EDR + BLE". Flash contains `JL_AC79XX_BLE`, `JL_A2DP` (the audio side), `sbc_encoder`, `msbc` |
| `reverse/baudgirl_092_flash.bin` | BLE-MIDI **service** `03B80E5A-EDE8-4B33-A751-6CE34EC4C700` ×2 **and** the **data I/O characteristic** `7772E5DB-3868-4112-A1A9-F2669D106BF3` ×2 — both little-endian, at file offsets `0x495e5` and `0x52807` |

Re-verify the UUID claim:

```bash
cd ~/fm1/mvave-fm1/reverse
xxd -p baudgirl_092_flash.bin | tr -d '\n' > /tmp/fw.hex
for p in 00c7c44ee36c51a7334be8ed5a0eb803 f36b109d66f2a9a112416838dbe57277; do
  printf '%s: %s\n' "$p" "$(grep -o "$p" /tmp/fw.hex | wc -l)"; done   # 2 and 2
```

So the FM-1 is a **standard BLE-MIDI peripheral**. No USB host, no Termux/libusb, no
OTG cable, no `termux-usb` vs Chrome conflict. The advertised name is **`FM-1_092`**
(`FM-1` also appears in the image).

## Which browser API to use

The two are **not** interchangeable, and this decides the architecture:

| | Web MIDI (`requestMIDIAccess`) | Web Bluetooth (`navigator.bluetooth`) |
|---|---|---|
| Talks to | the **OS** MIDI layer | the BLE-MIDI **GATT service** directly |
| Android Chrome (**the phone**) | ✗ — Android only surfaces a BLE-MIDI device to its MIDI service *after a native app calls `MidiManager.openBluetoothDevice()`*; a web page cannot | ✓ |
| Arch + Chrome (**the laptop**) | ✗ — no BLE-MIDI→ALSA path by default (BlueZ has no MIDI bridge) | ✓ (may need `--enable-experimental-web-platform-features`) |
| macOS / Windows | ✓ | ✓ |
| SysEx | ✓ | ✓, but we must chunk it ourselves |
| New code | none | transport + packetizer |

**Decision: Web Bluetooth is the primary path** — the only one covering both boxes, and
it lets the phone browser drive the FM-1 with zero install (the deployed HTTPS Pages
site is already a secure context). Keep Web MIDI as an opportunistic fast path on
desktop, where it already works for free.

## What it takes (shape, not code)

1. **A transport seam.** `js/pattern.js` already emits the exact byte array — do not
   touch it. Introduce one interface the app talks to:
   `connect() · send(Uint8Array) · onMessage(cb) · close()`
   with two backends: `WebMidiTransport` (today's `js/midi.js`, small refactor) and
   `BleTransport` (new).
2. **The BLE-MIDI packetizer.** Per the spec: every ATT packet begins with a **header
   byte** (`0b10` + timestamp bits 12-6), then each message is prefixed by a
   **timestamp byte** (`0b10` + bits 6-0). SysEx spans packets — the first carries
   `F0…`, continuation packets repeat header + timestamp and simply resume the payload.
   ~80 lines, or reuse MIT code (`airmidi` exposes its framing codec separately from its
   Bluetooth part; `ryohey/web-ble-midi` likewise).
3. **The reverse.** The notify handler reassembles packets into a byte stream so the
   existing 7-bit-unpack + `status 3` reply parser in `midi.js` works unchanged.
4. **MTU.** MIDI bytes per packet = **MTU − 5**. Android defaults to 23 → 18 bytes per
   packet, so a **177-byte SysEx = 10 packets**; negotiate 247 → 242 bytes → **1 packet**.
   Both must work.
5. **UX.** `requestDevice()` requires a user gesture → a **"Connect Bluetooth"** button.
   Web Bluetooth cannot filter on a 128-bit UUID, but the device advertises `FM-1_092`:
   ```js
   filters: [{ namePrefix: "FM-1" }],
   optionalServices: ["03b80e5a-ede8-4b33-a751-6ce34ec4c700"]
   ```
   `navigator.bluetooth.getDevices()` allows silent reconnect to an already-granted device
   after a reload.
6. **UI.** A transport selector (`USB / Bluetooth`) replacing today's implicit USB-only
   connect flow; the rest of the app (bank, live loop, freeze, locks) is unchanged.

## Risks

- **R1 — the make-or-break.** The UUIDs prove the standard GATT *service*; they do **not**
  prove the FM-1 routes the **proprietary `0x20` pattern write** through the same parser
  as USB. The manual only promises incoming **SysEx voice dumps**. Everything else here
  is cheap; this one is binary.
- **R2** — a 177-byte message is large for BLE-MIDI. ESP's reference implementation
  literally exposes a `SYSEX_OVERFLOW` event. If the FM-1 truncates, note/CC/params
  still work but the freeze does not.
- **R3** — Linux Web Bluetooth may need a Chrome flag / recent BlueZ.
- **R4** — BLE connection interval is 7.5–30 ms. Fine for notes and the bulk write; the
  `Freeze` reply timeout must be looser than the USB one.
- **R5** — replies are up to ~180 bytes of 7-bit-packed data. If reassembly is wrong, the
  `status 3 = sequencer playing` detection fails **silently** — exactly the bug class
  that cost hours on USB. Add an explicit "no reply received" state.

## Verification ladder (~20 min, cheap → decisive)

1. Long-press **HOME** → LED blinks (advertising).
2. **Scan** — nRF Connect (phone) or `bluetoothctl` (laptop) → expect `FM-1_092` and
   service `03B80E5A…`. ← *the single most informative 5 minutes available*
3. Known-good BLE-MIDI app → press a key → the synth sounds.
4. Send a **small** SysEx (the `0x10` read-preset already used over USB) → same reply.
   ← this alone answers R1.
5. Send the **177-byte `0x20` write** → the pattern lands and acks.

4 passes + 5 fails = a size problem (fixable by chunking strategy or by splitting the
write). 4 fails = BLE is note/CC-only on this firmware.

## Fallbacks

- **Hybrid** — USB for *Freeze*, BT for live auditioning (drops the cable for playing,
  keeps it for programming).
- **Bridge** — the laptop pairs over BT and re-exposes the port over WebSocket; the phone
  browser connects to the laptop. Works where Web Bluetooth does not.
- **Dongle** — an ESP32-S3 as USB host → BLE-MIDI peripheral (only if the FM-1's own BLE
  disappoints).

## Cost

**Half a day**, most of it hardware testing. The encoder, bank model, macros and UI stay
untouched. Bonus: the USB-MIDI **CIN framing bug that cost us hours cannot exist on this
path** (it is a USB packet-layer artifact), and the phone's USB-claim conflict with Chrome
disappears entirely.
