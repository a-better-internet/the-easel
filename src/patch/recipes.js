// Patches: the two 208C Quick Start patches (step by step) and the no-input
// recipes from the feature breakdown (section 5), ported to the 208C panel.
//
// Every patch starts from the defaults (master low-ish, reverb about a
// quarter, both gates in combination mode, nothing patched). Values:
//   number      slider/knob position on the panel's 0-10 scale
//   s(seconds)  a time slider set to that printed time (.002 s top .. 10 s bottom)
//   hz(f)       pitch / m.o. high-range slider set to that frequency
//   lowHz(f)    m.o. low-range slider set to that frequency
//   'name'      switch option by its panel label
// Cables are [from, to] jack pairs; neighbouring jacks draw as shorting bars.

import { PARAM_BY_ID, defaultParams, curves } from '../spec.js';

const tag = (kind, value) => ({ kind, value });
export const s = (seconds) => tag('time', seconds);
export const hz = (f) => tag('pitch', f);
export const lowHz = (f) => tag('moLow', f);

/** Invert a monotonic curve by bisection. */
function invert(fn, target) {
  let lo = -0.75;
  let hi = 1.75;
  const rising = fn(hi) > fn(lo);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) < target === rising) lo = mid;
    else hi = mid;
  }
  return Math.min(1, Math.max(0, (lo + hi) / 2));
}

// Breathing Drone: tune the m.o. just above twice the c.o. so the FM beats slowly.
const DRONE_PITCH = 0.3;
const DRONE_MO_HZ = 2 * curves.pitch(DRONE_PITCH) + 0.35;

// Quick Start Patch A settings, read from the guide's panel photo.
const QS_BASE = {
  'seq.s1': 0,
  'seq.s2': 2.2,
  'seq.s3': 5,
  'seq.s4': 7.2,
  'seq.s5': 10,
  'seq.p1': 'off',
  'seq.p2': 'on',
  'seq.p3': 'off',
  'seq.p4': 'on',
  'seq.p5': 'off',
  'seq.trig': 'pulser',
  'seq.stages': '5',
  'rand.trig': 'pulser',
  'env.trig': 'pulser',
  'env.mode': 'transient',
  'env.attack': s(0.002),
  'env.sustain': s(0.06),
  'env.decay': s(0.002),
  'pulser.trig': 'self',
  'pulser.mode': 'sustnd',
  'pulser.periodCv': 7,
  'pulser.period': s(0.08),
  'mo.fmLevel': 5,
  'mo.wave': 'saw',
  'mo.range': 'high',
  'mo.mode': 'f.m. osc',
  'mo.freqCv': 6,
  'mo.freq': 0,
  'mo.indexCv': 7,
  'mo.index': 0,
  'co.polarity': '+',
  'co.shape': 5,
  'co.wave': 'tri',
  'co.pitchCv': 8,
  'co.pitch': 0,
  'co.timbreCv': 8,
  'co.timbre': 0,
  'lpg.src': 'mod osc',
  'lpg1.mode': 'combo',
  'lpg2.mode': 'combo',
  'lpg1.levelCv': 7.5,
  'lpg1.level': 0,
  'lpg2.levelCv': 7,
  'lpg2.level': 0,
  'out.a': 8,
  'out.b': 8,
  'out.reverb': 6,
  'out.monitor': 5,
  'out.master': 5,
};

export const RECIPES = [
  {
    id: 'bare',
    num: 0,
    group: 'start',
    name: 'Bare Drone',
    loops: 'no loops',
    set: 'Complex oscillator sine through gate 1, nothing patched.',
    result: 'A plain, steady tone. Start here and add one loop at a time.',
    params: {},
    cables: [],
  },
  {
    id: 'quick-start-a',
    num: 'A',
    group: 'quick start',
    name: 'Quick Start Patch A',
    loops: '208C quick start',
    set: 'The quick start settings, with the envelope shorted to the level 1 CV input and the pulser shorted to the level 2 CV input.',
    result: 'A great starting place for creating patches: most CV connections will produce audible results.',
    params: QS_BASE,
    cables: [
      ['env.5', 'lpg1.cv'],
      ['pulser.4', 'lpg2.cv'],
    ],
    steps: [
      {
        text: 'Set all the knobs, switches and sliders to the quick start settings. Short the orange envelope output to the level 1 CV input, and the yellow pulser output to the level 2 CV input. If the pulser is not active, press the pulser one button.',
      },
      {
        text: 'Patch random voltage to the c.o. w.s. (waveshape) CV input. Set the waveshape knob to the sine icon and move level 1 to 4. The random voltage now turns the waveshape knob a full virtual turn, and level 1 lets the c.o. be heard between envelopes.',
        params: { 'co.shape': 0, 'lpg1.level': 4 },
        cables: [['rand.9', 'co.wsCv']],
      },
      {
        text: 'Short random voltage to the complex oscillator timbre CV input (here the bar stacks onto the random jack already feeding w.s.). The timbre now changes with the random voltages.',
        cables: [['rand.9', 'co.timbreCv']],
      },
      {
        text: 'Patch a blue sequential voltage output to the modulation oscillator frequency CV input. The sequencer sliders now set the m.o. frequency.',
        cables: [['seq.4', 'mo.freqCv']],
      },
      {
        text: 'Patch random voltage to the modulation oscillator modulation CV input and move that CV slider to maximum. The m.o. now modulates the c.o. by a random amount.',
        params: { 'mo.indexCv': 10 },
        cables: [['rand.7', 'mo.indexCv']],
      },
      {
        text: 'Patch c.osc into the m.o. f.m. in (a Tini-Jax cable) and turn the f.m. in knob to maximum. The complex oscillator now frequency-modulates the modulation oscillator.',
        params: { 'mo.fmLevel': 10 },
        cables: [['co.osc', 'mo.fmIn']],
      },
      {
        text: 'Patch random voltage to the envelope sustain CV input and move the sustain slider to 1. Random now varies the sustain, in a useful range of times. Quick Start Patch A is complete.',
        params: { 'env.sustain': s(1) },
        cables: [['rand.6', 'env.sustainCv']],
      },
    ],
  },
  {
    id: 'quick-start-b',
    num: 'B',
    group: 'quick start',
    name: 'Quick Start Patch B',
    loops: '208C quick start',
    set: 'The quick start settings from Patch A, but without the shorting bar on the level 2 CV input.',
    result: 'A sequenced, LFO-shaped voice over enveloped noise, with random sustain and sequenced decay.',
    params: QS_BASE,
    cables: [['env.5', 'lpg1.cv']],
    steps: [
      {
        text: 'Quick start settings from Patch A, but no shorting bar on the level 2 CV input.',
      },
      {
        text: 'Short a blue sequential voltage output to the complex oscillator pitch CV input, and lower the pitch CV slider to 2 (near the 88 mark). The sequencer now plays the c.o. pitch, with less influence.',
        params: { 'co.pitchCv': 2 },
        cables: [['seq.5', 'co.pitchCv']],
      },
      {
        text: 'Set the sequencer to 4 stages and set its sliders as shown in the guide. The pitches at each stage change.',
        params: { 'seq.stages': '4', 'seq.s1': 4.3, 'seq.s2': 2.8, 'seq.s3': 4.2, 'seq.s4': 10, 'seq.s5': 10 },
      },
      {
        text: 'Set the m.o. range to low and its waveshape to triangle. Patch m.o. mod out to the c.o. timbre CV input, and set the c.o. waveshape switch to spike (top). The m.o. is now an LFO on the timbre.',
        params: { 'mo.range': 'low', 'mo.wave': 'tri', 'co.wave': 'spike' },
        cables: [['mo.modOut', 'co.timbreCv']],
      },
      {
        text: 'Move level 1 to 3. Stack a second cable on m.o. mod out and patch it to the c.o. w.s. CV input, then set the waveshape knob to the sine icon. The m.o. now also turns the waveshape mix.',
        params: { 'lpg1.level': 3, 'co.shape': 0 },
        cables: [['mo.modOut', 'co.wsCv']],
      },
      {
        text: 'Set the gate 2 source switch to the top position (aux / noise). With nothing in aux in, that is white noise. Patch the envelope output to the level 2 CV input: the envelope now shapes the noise.',
        params: { 'lpg.src': 'aux / nse' },
        cables: [['env.3', 'lpg2.cv']],
      },
      {
        text: 'Short random voltage to the envelope sustain CV input and move sustain to about 1. Patch a blue sequential voltage output to the decay CV input and move decay to about 1. Quick Start Patch B is complete.',
        params: { 'env.sustain': s(1), 'env.decay': s(1) },
        cables: [
          ['rand.5', 'env.sustainCv'],
          ['seq.3', 'env.decayCv'],
        ],
      },
    ],
  },
  {
    id: 'breathing-drone',
    num: 1,
    group: 'no-input recipes',
    name: 'Breathing Drone',
    loops: 'loops B + A',
    set:
      'C.O. pitch ~3, timbre ~2. M.O. high range, f.m., modulation ~1. Level 1 held open ~6. c.osc patched to f.m. in, knob just above zero. Master out to aux in; env out to timbre CV (depth ~3) through the inverter.',
    result: 'A slowly self-balancing drone: as the cross-mod brightens it, the inverted loudness loop pulls timbre back.',
    tip: 'The m.o. is tuned just above twice the c.o., so the FM beats slowly. That beat is the breath the loudness loop leans against. Nudge the m.o. fine tune to change the breathing rate.',
    params: {
      'co.pitch': DRONE_PITCH * 10,
      'co.timbre': 2,
      'co.timbreCv': 3,
      'mo.range': 'high',
      'mo.mode': 'f.m. osc',
      'mo.freq': hz(DRONE_MO_HZ),
      'mo.index': 1,
      'mo.fmLevel': 1.2,
      'lpg1.level': 6,
      'lpg1.mode': 'combo',
      'pre.gain': 'low',
    },
    cables: [
      ['co.osc', 'mo.fmIn'],
      ['out.master1', 'pre.in'],
      ['pre.envOut', 'inv.in'],
      ['inv.out', 'co.timbreCv'],
    ],
  },
  {
    id: 'bell-garden',
    num: 2,
    group: 'no-input recipes',
    name: 'Self-Clocking Bell Garden',
    loops: 'loop D',
    set:
      'Pulser self, period ~5. Sequencer 5 stages, clocked by the pulser, its voltage to pitch and to pulser period. Envelope transient, triggered by sequencer pulses on stages 1, 2, 4. Envelope to level 1. M.O. f.m., modulation ~4.',
    result: 'Uneven, repeating FM bell phrases whose step lengths come from the same sliders as their pitches.',
    params: {
      'pulser.trig': 'self',
      'pulser.mode': 'sustnd',
      'pulser.period': 5,
      'pulser.periodCv': 3,
      'seq.stages': '5',
      'seq.trig': 'pulser',
      'seq.s1': 2,
      'seq.s2': 6,
      'seq.s3': 3.5,
      'seq.s4': 8,
      'seq.s5': 4.5,
      'seq.p1': 'on',
      'seq.p2': 'on',
      'seq.p3': 'off',
      'seq.p4': 'on',
      'seq.p5': 'off',
      'co.pitch': 3,
      'co.pitchCv': 3,
      'mo.mode': 'f.m. osc',
      'mo.freq': 4.6,
      'mo.index': 4,
      'env.mode': 'transient',
      'env.trig': 'sequencer',
      'env.attack': s(0.003),
      'env.sustain': s(0.01),
      'env.decay': s(0.35),
      'lpg1.level': 0,
      'lpg1.levelCv': 9,
      'out.reverb': 3.5,
    },
    cables: [
      ['seq.5', 'co.pitchCv'],
      ['seq.3', 'pulser.periodCv'],
      ['env.5', 'lpg1.cv'],
    ],
  },
  {
    id: 'chaos-engine',
    num: 3,
    group: 'no-input recipes',
    name: 'Chaos Engine',
    loops: 'loop A at high gain',
    set: 'M.O. high range, f.m., modulation ~7. c.osc to f.m. in at ~6. Random (clocked by a slow pulser) to m.o. frequency and to modulation.',
    result: 'Noisy, granular, ever-changing; each random step drops the loop into a new chaotic regime.',
    params: {
      'mo.range': 'high',
      'mo.mode': 'f.m. osc',
      'mo.freq': 4.5,
      'mo.index': 7,
      'mo.fmLevel': 6,
      'mo.freqCv': 4,
      'mo.indexCv': 3,
      'rand.trig': 'pulser',
      'pulser.period': s(2),
      'co.pitch': 4,
      'lpg1.level': 7,
    },
    cables: [
      ['co.osc', 'mo.fmIn'],
      ['rand.7', 'mo.freqCv'],
      ['rand.8', 'mo.indexCv'],
    ],
  },
  {
    id: 'howl-box',
    num: 4,
    group: 'no-input recipes',
    name: 'Howl Box',
    loops: 'loop C',
    set: 'Oscillators turned down at the gates. Master out to aux in; gate 2 source on aux. Gate 2 in lo pass mode. Bring the loop gain up very slowly until it rings. Envelope self-mode on level 2.',
    result: 'Classic no-input-mixer tones (resonant whistles and hums) pulsed by the cycling envelope.',
    tip: 'On the 208C the preamp gain is a low/high switch, so channel B is the fine loop-gain control. It is preset just past the ring point (about 6.5): below it the loop falls silent, well above it the howl locks into one hum. Turn the monitor down before raising it.',
    params: {
      'lpg1.level': 0,
      'lpg.src': 'aux / nse',
      'lpg2.mode': 'lo pass',
      'lpg2.level': 0,
      'lpg2.levelCv': 8.5,
      'env.mode': 'self',
      'env.attack': s(0.35),
      'env.sustain': s(0.05),
      'env.decay': s(1.5),
      'pre.gain': 'low',
      'out.b': 7.2,
      'out.reverb': 3,
    },
    cables: [
      ['out.master1', 'pre.in'],
      ['env.5', 'lpg2.cv'],
    ],
  },
  {
    id: 'hollow-phase-choir',
    num: 5,
    group: 'no-input recipes',
    name: 'Hollow Phase Choir',
    loops: 'loops F + E',
    set: 'Gate 2 source = gate 1 (inverted). C.O. timbre ~4. Envelope self-mode to level 2 only; envelope output to its own decay CV.',
    result: 'A hollow, highpassed shadow of the drone that phases in and out at an accelerating / slowing rate.',
    params: {
      'co.pitch': 3.5,
      'co.timbre': 4,
      'lpg1.level': 6,
      'lpg.src': 'gate 1 −',
      'lpg2.level': 1,
      'lpg2.levelCv': 7,
      'env.mode': 'self',
      'env.attack': s(0.35),
      'env.sustain': s(0.02),
      'env.decay': s(1.2),
    },
    cables: [
      ['env.5', 'lpg2.cv'],
      ['env.2', 'env.decayCv'],
    ],
  },
  {
    id: 'noise-weather',
    num: 6,
    group: 'no-input recipes',
    name: 'Noise Weather',
    loops: 'preamp empty',
    set: 'Leave aux in unplugged so white noise feeds gate 2. Random (pulser-clocked, slow) to level 2; gate 2 in lo pass mode. C.O. quiet sine under it.',
    result: 'Gusts and rain-like noise over a pure tone, nothing patched in.',
    params: {
      'lpg.src': 'aux / nse',
      'pre.gain': 'high',
      'lpg2.mode': 'lo pass',
      'lpg2.level': 0.5,
      'lpg2.levelCv': 7,
      'rand.trig': 'pulser',
      'pulser.period': s(1.5),
      'co.pitch': 4.5,
      'co.timbre': 0,
      'co.shape': 0,
      'mo.index': 0,
      'lpg1.level': 3,
      'out.b': 8,
      'out.reverb': 3.5,
    },
    cables: [['rand.10', 'lpg2.cv']],
  },
  {
    id: 'ring-clock',
    num: 7,
    group: 'no-input recipes',
    name: 'Ring Clock',
    loops: 'loops D + A',
    set: 'M.O. low range, balanced modulation (bal. ext) of the c.o. through aux in, modulation ~6 (tremolo-ring), heard through gate 2. Pulser period from the envelope; envelope triggered by the pulser.',
    result: 'Two timers pushing each other: pulsing ring-mod rhythms that speed up and drift apart.',
    tip: "On the 208C the balanced modulator works on the external input, so c.osc is patched into aux in and gate 2 listens to the m.o.",
    params: {
      'mo.range': 'low',
      'mo.mode': 'bal. ext',
      'mo.freq': lowHz(3),
      'mo.index': 6,
      'mo.wave': 'tri',
      'lpg.src': 'mod osc',
      'pulser.trig': 'self',
      'pulser.mode': 'sustnd',
      'pulser.period': s(0.35),
      'pulser.periodCv': 5,
      'env.trig': 'pulser',
      'env.mode': 'transient',
      'env.attack': s(0.04),
      'env.sustain': s(0.02),
      'env.decay': s(0.6),
      'co.pitch': 4.5,
      'co.timbre': 2.5,
      'lpg1.level': 1.5,
      'lpg2.level': 1,
      'lpg2.levelCv': 7,
      'out.reverb': 3,
    },
    cables: [
      ['co.osc', 'pre.in'],
      ['env.3', 'pulser.periodCv'],
      ['env.5', 'lpg2.cv'],
    ],
  },
  {
    id: 'long-form-steering',
    num: 8,
    group: 'no-input recipes',
    name: 'Long-Form Steering',
    loops: 'all slow loops on a fast loop',
    set: "Recipe 3's chaos loop, with the envelope detector (master out to aux in) inverted onto the m.o. modulation CV. The 208C has no CV on the f.m. in level, so sweep that knob by hand.",
    result: 'Self-steering: loud chaos pulls its own index down, quiet passages let it build back up.',
    tip: 'Here the steering is gentle: FM spreads energy rather than adding it, so the detector mostly tempers the index while each random step moves the loop to a new regime. Raise the modulation CV slider for a heavier hand.',
    params: {
      'mo.range': 'high',
      'mo.mode': 'f.m. osc',
      'mo.freq': 4.5,
      'mo.index': 8,
      'mo.fmLevel': 6,
      'mo.freqCv': 4,
      'mo.indexCv': 3,
      'rand.trig': 'pulser',
      'pulser.period': s(2),
      'co.pitch': 4,
      'lpg1.level': 7,
      'pre.gain': 'low',
    },
    cables: [
      ['co.osc', 'mo.fmIn'],
      ['rand.7', 'mo.freqCv'],
      ['out.master1', 'pre.in'],
      ['pre.envOut', 'inv.in'],
      ['inv.out', 'mo.indexCv'],
    ],
  },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

function resolve(recipe, id, raw, values) {
  const p = PARAM_BY_ID[id];
  if (!p) throw new Error(`recipe ${recipe.id}: unknown param ${id}`);
  if (raw && typeof raw === 'object') {
    if (raw.kind === 'time') return invert(curves.time, raw.value);
    if (raw.kind === 'pitch') return invert(curves.pitch, raw.value);
    if (raw.kind === 'moLow') return invert(curves.moLow, raw.value);
    throw new Error(`recipe ${recipe.id}: bad value for ${id}`);
  }
  if (p.type === 'slider' || p.type === 'knob') return raw / 10;
  const i = p.options.indexOf(String(raw));
  if (i < 0) throw new Error(`recipe ${recipe.id}: ${id} has no option ${raw}`);
  return i;
}

/**
 * Engine param values for a recipe, optionally only up to step `step`
 * (0-based; steps apply cumulatively on top of the recipe's base).
 */
export function recipeParams(recipe, step = Infinity) {
  const values = defaultParams();
  const layers = [recipe.params || {}];
  (recipe.steps || []).slice(0, Math.max(0, step) + 1).forEach((st) => layers.push(st.params || {}));
  for (const layer of layers) for (const [id, raw] of Object.entries(layer)) values[id] = resolve(recipe, id, raw, values);
  return values;
}

/** Cables for a recipe up to step `step`. */
export function recipeCables(recipe, step = Infinity) {
  const cables = [...(recipe.cables || [])];
  (recipe.steps || []).slice(0, Math.max(0, step) + 1).forEach((st) => cables.push(...(st.cables || [])));
  return cables;
}
