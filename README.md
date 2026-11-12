# the easel

A browser-based **no-input Music Easel**. It models the 208C Stored Program
Sound Source panel with every section self-running and patchable back into
itself. There's no keyboard and nothing is played. All movement comes from
self-oscillation, self-clocking, and signals the instrument routes back into
itself.

Built from:

- the *Feature Breakdown for No-Input & Internal Feedback Playing*, for
  sections, feedback loops, recipes and DSP notes;
- the banana-plug stacking spec (section 9), for patching;
- the 208C Quick Start Guide, for the panel layout, printed scales, controls,
  jack conventions and Quick Start Patches A and B.

It's an independent, unofficial homage and isn't affiliated with Buchla USA.

## Run it

No build step and no dependencies. AudioWorklet needs a secure context, so serve it over `http://localhost` or `https`.

```bash
npm start
```

Then open http://localhost:5173, press **power**, and pick a patch. Any static
host works for deployment, GitHub Pages included: serve the repository root.

```bash
npm test
```

The tests run in Node with no browser: DSP behaviour, the patch graph, every
patch and quick-start step, and a randomized feedback fuzz.

## The panel

The layout follows the 208C as photographed in the Quick Start Guide. The
keyboard inputs, program card, MIDI control and pressure outputs are left out,
since this is a no-input build. The panel scales to fit the window, and below
about half size it scrolls sideways.

- **Top strip:** jacks for mod osc in/out (f.m. in, m.osc, mod out), the
  inverter, comp osc (w.s., c.osc, gate1 in), preamp / envelope det (aux in /
  nse, gain low/high, env out) and mix out (master out ×2). The program-card
  slot shows the current patch.
- **Switch strip:** bat-handle toggles with their positions printed beside
  them. Click a position, or the lever to step through them. Arrow keys work
  when focused.
  - Sequential voltage: trigger source, stages, pulse sequence.
  - Random voltage: trigger source.
  - Envelope generator: trigger source; sustained / transient / self.
  - Pulser: self / sequencer; sustnd / trans / off-ext; the **one** button.
  - Modulation oscillator: f.m. in, waveshape, range, fine tune; bal. ext /
    a.m. osc / f.m. osc.
  - Complex oscillator: polarity, fine tune, the waveshape knob (sine → the
    selected spike / square / triangle).
  - Dual lo pass gate: gate 2 source (aux / nse, mod osc, gate 1 inverted);
    lo pass / combination / VCA per gate.
- **Slider row:** printed scales and rules. Times run .002 s at the **top** to
  10 s at the bottom, so up is faster. Pitch is 33–3000 Hz, and the M.O. low
  range is .4–33 Hz. Every modulated parameter has a **CV slider** beside its
  main slider.
- **Jack field:** under each CV slider is its black CV-input jack. Source
  multiples (blue sequencer, orange envelope, yellow pulser, white random) sit
  beside the inputs so a shorting bar can reach them, as on the real panel.
- **Output:** channel A and B, reverberation, monitor level (what you hear),
  and master volume (the level at the master out jacks, so it's part of any
  loop you patch from there).

## Recording

**rec** (or **R**) records a **24-bit PCM WAV**. Press it again to stop, and
the file downloads. A link to the take stays beside the button until your next
recording, in case the browser blocked the download.

- **Format:** mono, like the instrument's mix, at the audio device's sample
  rate (usually 44.1 or 48 kHz).
- **Metadata:** the file carries a RIFF INFO chunk with the patch name, the
  software and the date. It is named after the patch and time, e.g.
  `easel-howl-box-20261111-213045.wav`.
- **Source: master out** (default). This is the line-level mix: DC-blocked,
  independent of the monitor knob, and never touched by the output limiter.
  Set the recording level with **master volume** and watch the live peak
  read-out (it turns red at full scale).
- **Source: monitor.** Exactly what you hear, limiter included.
- **Capture:** audio is captured inside the AudioWorklet, sample for sample,
  before the browser's output stage. Each chunk is converted to 24-bit right
  away with TPDF dither (±1 LSB) and kept as a Blob, so long takes don't pile
  up in memory.
- **Length:** takes can run for hours. The WAV size field caps a file near
  4 GB (about 8 hours at 48 kHz), and the recorder saves automatically there.
  Switching the power off also stops and saves the take.

## Patching

- **Black** banana jacks are inputs. **Coloured** banana jacks are outputs.
  Audio uses silver **Tini-Jax** jacks, drawn with thin grey cables.
- Patch two **neighbouring** banana jacks and you get a **shorting bar**.
- **Banana stacking:** drop a cable on a plug that's already in a jack. The new
  plug inherits that jack and is drawn offset +6 px / −6 px per stack level.
  Connected jacks merge into one *net* (union-find over cables). Outputs on a
  net mix passively (averaged), and every input on the net hears the mix.
- **Drag a plug** to pull it out and move it. The connection breaks as it
  leaves the jack. Drop it on empty panel to remove it.
  **Alt/Option-drag** a plug to start a new cable stacked on it.
- **Shift-click** a plug, or hold Shift and click a cable, to delete it.
  Double-tap a plug does the same on touch screens.
- **Click two jacks** to patch without dragging. With the keyboard: Tab, Enter
  on one jack, Enter on another. Delete pulls the top plug.
- **C** cycles cable visibility (solid / dim / ghost).

## Patches

- **0. Bare Drone**: the starting point.
- **A. Quick Start Patch A** and **B. Quick Start Patch B**: the guide's two
  patches, seven steps each. Use *prev / next* in the notes bar to build them
  up one connection at a time.
- **1–8**: the no-input recipes from the breakdown, ported to the 208C
  controls.
  1. Breathing Drone (loops B + A)
  2. Self-Clocking Bell Garden (loop D)
  3. Chaos Engine (loop A at high gain)
  4. Howl Box (loop C)
  5. Hollow Phase Choir (loops F + E)
  6. Noise Weather (preamp empty)
  7. Ring Clock (loops D + A)
  8. Long-Form Steering
- **P1–P12: patched presets.** Each one is built around a cable technique,
  not just a knob setting.

| | Preset | Technique | What's patched |
| --- | --- | --- | --- |
| P1 | Stacked Fan-Out | banana stacking, one output → three inputs | sequencer → pitch, timbre and m.o. freq, all stacked on one jack |
| P2 | Contrary Motion | inverter | sequencer → pitch, and through the inverter → m.o. freq |
| P3 | Mixed Voltages | two outputs stacked into one input | sequencer + random → pitch; envelope + pulser → level 1 |
| P4 | Off-Ext Clockwork | pulser off-ext (loops D + E) | envelope drives the pulser; sequencer sets the envelope's decay |
| P5 | Pumping Drone | inverter as a sidechain | pulser pings gate 2, and ducks gate 1 through the inverter |
| P6 | Ringing Filter | Tini-Jax audio loop | gate2 sig → aux in: gate 2 rings on its own feedback when pinged |
| P7 | Gate Swap | gate1 in / aux in re-routing | m.osc → gate1 in, c.osc → aux in: two independently gated voices |
| P8 | Detector Swell | positive loop B + an LFO in the same net | master out → aux in; detector + m.o. mod out → timbre and level 1 |
| P9 | Wobble Fan | mod out stacked three ways | LFO → timbre, w.s. and level 2 (noise) |
| P10 | Bleep Generator | sample & hold FM | random → m.o. freq and modulation; sequencer → pitch |
| P11 | Accelerando | envelope self-patching (loop E) | envelope → its own attack and decay CVs and the pulser period |
| P12 | Feedback Melody | loop C played by the sequencer | master out → aux in; sequencer → level 2 sets each note's pitch |

**Patch sheet.** Beside the notes, the patch sheet lists every connection in
the current patch: source → destination, plus whether it's a shorting bar,
cable or Tini-Jax cable, and whether it's stacked. It updates as you patch,
and hovering a line lights that cable on the panel.

**My presets.** *save as preset…* (in the notes bar or the **file** menu)
saves the whole patch, cables included, with a name and optional notes. It
appears under *my presets* in the patch menu. Saving under an existing name
replaces that preset. A loaded preset can be **updated** after you change it,
or **deleted**. *file › export my presets* backs them all up to one JSON file,
and *import* merges a backup (or loads a single exported patch).

Your current patch also autosaves in the browser, including the quick-start
step you're on. The **file** menu exports and imports single patches or copies
a share link.

## How it's built

```
index.html            page shell, help dialog
styles/easel.css      panel styles
src/spec.js           DOM-free params, jacks, signals, printed scales (shared by UI + audio thread)
src/dsp/engine.js     the whole 208C as one per-sample engine
src/dsp/blocks.js     soft clipper, PolyBLEP, decimator, spring reverb
src/dsp/worklet.js    AudioWorkletProcessor wrapper (all messages in try/catch)
src/audio/host.js     AudioContext, worklet node, analyser, fades
src/audio/recorder.js 24-bit WAV recorder (chunks from the worklet -> PCM Blob parts)
src/audio/wav.js      24-bit PCM encoding with TPDF dither, WAV header + INFO chunk
src/patch/graph.js    cables, banana stacks, nets
src/patch/recipes.js  quick-start patches and no-input recipes
src/patch/patched.js  the cable-technique presets P1-P12
src/patch/values.js   value notation for patches (s(), hz(), lowHz())
src/patch/user-presets.js  my presets: named patches in localStorage
src/ui/*.js           panel, controls, patchbay (SVG cables), scope, read-outs
src/main.js           wiring, scaling, persistence, step-through notes
tests/                node:test suites
```

**One engine, evaluated per sample.** Web Audio feedback cycles need at least
one 128-sample DelayNode, which smears audio-rate loops. So, as section 7 of
the breakdown suggests, the whole instrument runs inside one AudioWorklet.
Each section is evaluated once per tick, and cables read their source's most
recent value, which gives every loop (c.osc → f.m. in included) a one-tick
delay. The engine runs at 2× oversampling by default (1× and 4× in **quality**)
with a Kaiser-windowed FIR decimator. The 1× path gets the same 12-sample
latency, so a master-out feedback loop rings identically at every quality
setting.

| Section | Implementation |
| --- | --- |
| Complex osc | sine core, crossfaded by the waveshape knob (+ w.s. CV) to spike / square / triangle, then a sine wavefolder (timbre); M.O. f.m. or a.m. |
| Modulation osc | PolyBLEP saw/square, triangle; f.m. in is linear FM with a soft clip in the loop; *bal. ext* ring-modulates the aux / preamp signal, heard through gate 2 |
| Lo pass gates | asymmetric vactrol slew (≈2.5 ms on, 40–200 ms off, slower as it darkens) driving a 2-pole TPT state-variable low-pass + amplitude |
| Envelope | analog-style segments (chase past the target, so the printed times are exact) |
| Pulser | phase accumulator; pulse at the *end* of each period, ramp output falls 1 → 0; off-ext takes pulses from the period CV jack |
| Sequencer / random | step array with per-stage pulse switches; sample & hold |
| Preamp / detector | AC-coupled gain (low / high) into a soft clipper; white noise when aux in is empty; average-rectifying follower |
| Spring reverb | two recirculating delays, each through stretched first-order allpasses (the chirp) and damping |
| Output | master out (soft-clipped) × monitor level → DC blocker → peak limiter → soft clip; NaN/Inf triggers an automatic state reset |
| Recorder tap | master out → its own DC blocker → worklet → 24-bit PCM (or the monitor signal itself) |

## Interpretation notes

Where the references leave room, these are the choices I made:

- **Quick-start settings** were read from the guide's photos: slider heights,
  knob angles and toggle positions are approximate. Lever positions that the
  photos can't resolve are set so the no-input version runs: pulser self /
  sustained, envelope and random triggered by the pulser.
- **Brighter is louder.** The timbre circuit *adds* harmonics, so output level
  rises about 4 dB at full timbre. That's what lets loudness loops (B) react
  to timbre.
- **Linear FM has a floor.** Neither oscillator can be swept below 3% of its
  frequency. With true through-zero FM, the c.o. ↔ m.o. loop could freeze both
  oscillators near 0 Hz into silent DC. An analog VCO can't stop or run
  backwards.
- **The pulser pulses at the end of its period,** so a transient pulser is a
  delay. In transient mode with a self trigger it fires one power-on pulse,
  per Buchla's note that self-starting programs need *sustained* mode.
- **Envelope sustain** is a timed hold in transient and self modes. In
  sustained mode it holds while the trigger lasts, which with pulse triggers
  is effectively attack → decay.
- **Gate 2 source** is aux / nse at the top (from the guide), then mod osc,
  then gate 1 inverted (from the breakdown). **Lo pass** mode has a slight
  resonant hump, which is what makes the Howl Box whistle and sweep.
- **Polarity** flips the sense of the pitch and timbre CV inputs.
- **Recipe 7 (Ring Clock)** uses *bal. ext*: c.osc goes into aux in, and gate 2
  listens to the m.o.
- **Recipe 8 (Long-Form Steering)** steers gently. FM spreads energy rather
  than adding it, so the detector mostly tempers the index. The 208C has no CV
  on the f.m.-in level, so sweep that knob by hand.

The *100 Series* schematic scan (#140, #144, #146, #180 and others) shows the
Easel's conceptual ancestors rather than its own circuits. It informed the
character of the sections, not a component-level model.
