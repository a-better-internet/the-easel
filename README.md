# the easel

A browser-based **no-input Music Easel**: the 208 sound source with every
section self-running and patchable back into itself. There's no keyboard and
nothing is played. All movement comes from self-oscillation, self-clocking and
signals the instrument routes back into itself.

Built from the *Feature Breakdown for No-Input & Internal Feedback Playing*
(sections 1-7) and the banana-plug stacking spec (section 9). It's an
independent, unofficial homage and isn't affiliated with Buchla USA.

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
recipe, and a randomized feedback fuzz.

## What's on the panel

| Section | Controls | Jacks (in / out) |
| --- | --- | --- |
| **Pulser** | period, period mod + source, trigger (self / seq), mode (cycle / once), kick | trig, period / pulse, ramp |
| **Sequential voltage source** | 5 stage sliders, 5 pulse switches, stages 3/4/5, clock (puls / hold) | clock / volts, pulse |
| **Envelope** | attack, sustain, decay, mode (trans / sust / self), trigger (puls / seq), time-cv depth | trig, A cv, S cv, D cv / env |
| **Random** | trigger (puls / seq), slew | trig / rand 1, rand 2 |
| **Preamp / detector** | gain, empty input (noise / silent), detector release | input / pre out, env det |
| **Inverter** | two channels, x −1 | A, B / −A, −B |
| **Modulation osc** | freq, fine, freq mod + source, range (high / low), wave (saw / square / tri), mode (off / f.m. / a.m. / ring), index, index mod + source, f.m.-in level | freq, index, f.m. in, f.m. lvl / m.o. out |
| **Complex osc** | pitch, fine, pitch mod + source, timbre, timbre mod + source, wave (sine / tri / square / spike), cv polarity | pitch, timbre / c.o. out |
| **Dual lopass gate** | per gate: level, mod + source, mode (vca / combo / lp); gate 2 source (m.o. / pre / g1 −) | in 1, in 2, lvl 1, lvl 2 / gate 1, gate 2 |
| **Output & reverb** | A, B, spring reverb, master, image (mono / wide), level and limit LEDs | — / mix out |

Features the breakdown marks **(208C)** are included: C.O. audio out, M.O.
f.m. in with level (plus a CV input for that level), envelope time CVs, white
noise from an empty preamp, two random outputs, and a gate 1 input.

**The control bus.** Every *mod* slider sets how much one internal source
reaches its destination. The five coloured dots under it choose the source:
sequencer, pulser ramp, envelope, random 1 or envelope detector. The colour key
follows the Easel convention (blue sequencer, yellow pulser, orange envelope,
grey random, purple for pressure/external). A cable in the destination's input
jack overrides the dots, which then dim and show "patched".

## Patching (banana plugs)

- **Drag** from any jack to any jack. West-coast rules apply, so out→in,
  out→out and in→in are all legal. The only refused drop is a cable onto its
  own jack.
- **Stack** by dropping onto a plug that's already in a jack. The new plug
  inherits that jack and is drawn offset +6 px / −6 px per stack level, on
  top of the plugs below it.
- **Nets:** connected jacks merge into one broadcast node (union-find over
  cables). Outputs on a net mix passively (averaged, like tied banana outputs).
  Every input on the net hears that mix.
- **Drag a plug** to pull it out and move it. The connection breaks the moment
  it leaves the jack. Drop it on empty panel to remove the cable.
  **Alt/Option-drag** a plug to start a new cable stacked on it.
- **Shift-click** a plug, or hold Shift and click a cable, to delete it.
  Double-tap a plug does the same on touch screens.
- **Click two jacks** to patch without dragging. With the keyboard, Tab to a
  jack, press Enter, then press Enter on the destination. Delete pulls the
  top plug.
- **C** cycles cable visibility (solid / dim / ghost) so you can reach the
  controls underneath.

## Patches

The eight recipes from section 5 of the breakdown, plus a bare starting point:

0. Bare Drone
1. Breathing Drone (loops B + A)
2. Self-Clocking Bell Garden (loop D)
3. Chaos Engine (loop A at high gain)
4. Howl Box (loop C)
5. Hollow Phase Choir (loops F + E)
6. Noise Weather (preamp empty)
7. Ring Clock (loops D + A)
8. Long-Form Steering (all slow loops on a fast loop)

Each one shows its *Set / Result* notes, plus a tip where the sweet spot
matters. Your current patch autosaves in the browser, and the **file** menu
exports and imports JSON or copies a share link.

## How it's built

```
index.html            page shell, help dialog
styles/easel.css      panel styles
src/spec.js           DOM-free description of every param, jack and curve (shared by UI + audio thread)
src/dsp/engine.js     the whole 208 as one per-sample engine
src/dsp/worklet.js    AudioWorkletProcessor wrapper (all messages in try/catch)
src/audio/host.js     AudioContext, worklet node, analyser, fades
src/patch/graph.js    cables, banana stacks, nets
src/patch/recipes.js  the patch recipes
src/ui/*.js           panel, controls, patchbay (SVG cables), scope, read-outs
src/main.js           wiring, persistence, header tools
tests/                node:test suites
```

**One engine, evaluated per sample.** Web Audio feedback cycles need at least
one 128-sample DelayNode, which smears audio-rate loops. So, as section 7 of the
breakdown suggests, the entire instrument runs inside a single AudioWorklet.
Each module is evaluated once per tick, and cables read their source's most
recent value. That gives every loop, including C.O. → M.O. f.m. in, a one-tick
delay. The engine runs at 2× oversampling by default (1× and 4× in the
**quality** menu), and a Kaiser-windowed FIR decimates back down.

| Section | Implementation |
| --- | --- |
| Complex osc | sine core → selectable base wave → sine wavefolder (timbre); M.O. FM is linear through-zero, AM / ring after the folder |
| Modulation osc | PolyBLEP saw/square, triangle; f.m. in is linear through-zero FM with a soft clip in the loop |
| Lopass gates | asymmetric vactrol slew (≈2.5 ms on, 40-200 ms off, slower as it darkens) driving a 2-pole TPT state-variable low-pass + amplitude |
| Envelope | analog-style segments (chase past the target, so times are exact), self-retrigger in self mode |
| Pulser | phase accumulator; pulse at the *end* of each period, ramp falls 1 → 0 |
| Sequencer / random | step array with per-stage pulse flags; sample & hold with optional slew |
| Preamp / detector | AC-coupled gain into a soft clipper; average-rectifying follower |
| Spring reverb | two recirculating delays, each through a chain of stretched first-order allpasses (the chirp) and damping |
| Output | DC blocker, peak limiter, final soft clip; NaN/Inf triggers an automatic state reset |

## Interpretation notes

Where the source documents left room, these are the choices I made:

- **Destructive handoff** (referenced in the banana-plug spec, defined in
  sections I didn't have): picking up a plug breaks its connection
  immediately, and dropping it anywhere that isn't a jack or plug destroys the
  cable.
- **Brighter is louder.** The timbre circuit *adds* harmonics, so output level
  rises about 4 dB at full timbre. That's what lets loudness loops (B) react to
  timbre the way the breakdown describes.
- **Pulser pulses at the end of its period.** A one-shot pulser therefore acts
  as a delay, which is what makes "sequencer pulses retrigger the pulser while
  the sequencer voltage sets the period" self-time correctly. In *once* mode
  with *self* trigger it fires a single power-on pulse, per Buchla's note about
  self-starting programs needing *sustained* mode. **kick** re-fires it.
- **Self-cycling envelope ignores bus triggers.** Only a patched trig jack
  resyncs it.
- **LP mode has a slight resonant hump** (combo and VCA modes don't). That's
  what makes the Howl Box sweep and whistle as the envelope moves the cutoff.
- Recipe values follow the printed ones. Where the breakdown leaves something
  unspecified (preamp gain, exact oscillator ratios), the values were tuned by
  rendering each patch offline and checking that its loop actually moves.

The *100 Series* schematic scan (#140, #144, #146, #180 and others) shows the
Easel's conceptual ancestors rather than its own circuits. It informed the
character of the modules, not a component-level model.
