// No-input patch recipes (breakdown section 5) plus a bare starting point.
//
// Every recipe starts from the common state: all params at their defaults
// (master low, reverb about a quarter, both gates in combo mode, nothing
// played). Sliders and knobs are written on the panel's 0-10 scale, switches
// by option name and bus selectors by source id, so a recipe reads like the
// printed one.

import { PARAM_BY_ID, BUS_SOURCES, defaultParams } from '../spec.js';

export const RECIPES = [
  {
    id: 'bare',
    num: 0,
    name: 'Bare Drone',
    loops: 'no loops',
    set: 'The common starting state: complex oscillator sine through gate 1, nothing patched.',
    result: 'A plain, steady tone. Start here and add one loop at a time.',
    params: {},
    cables: [],
  },
  {
    id: 'breathing-drone',
    num: 1,
    name: 'Breathing Drone',
    loops: 'loops B + A',
    set:
      'C.O. pitch ~3, timbre ~2. M.O. high range, FM, index ~1. LPG 1 held open ~6. C.O. audio patched to M.O. f.m. in, knob just above zero. Mix out to preamp; envelope detector to timbre (depth ~3) through the inverter.',
    result: 'A slowly self-balancing drone: as the cross-mod brightens it, the inverted loudness loop pulls timbre back.',
    params: {
      'co.pitch': 3,
      'co.timbre': 2,
      'co.timbreMod': 3,
      'mo.range': 'high',
      'mo.mode': 'fm',
      'mo.freq': 4.4,
      'mo.fine': 0.7,
      'mo.index': 1,
      'mo.fmLevel': 1.2,
      'lpg1.level': 6,
      'lpg1.mode': 'combo',
      'pre.gain': 2.4,
      'pre.speed': 6,
    },
    tip: 'M.O. is tuned just above twice the C.O. so the FM beats slowly; that beat is the breath the loudness loop leans against. Nudge M.O. fine to change the breathing rate.',
    cables: [
      ['co.out', 'mo.fmIn'],
      ['out.mix', 'pre.in'],
      ['pre.det', 'inv.aIn'],
      ['inv.aOut', 'co.timbreCv'],
    ],
  },
  {
    id: 'bell-garden',
    num: 2,
    name: 'Self-Clocking Bell Garden',
    loops: 'loop D',
    set:
      'Pulser self, period ~5. Sequencer 5 stages, clocked by pulser, voltage to pitch and to pulser period. Envelope transient, triggered by sequencer pulses on stages 1, 2, 4. Envelope to LPG 1. M.O. FM, index ~4.',
    result: 'Uneven, repeating FM bell phrases whose step lengths come from the same sliders as their pitches.',
    params: {
      'pulser.trig': 'self',
      'pulser.mode': 'cycle',
      'pulser.period': 5,
      'pulser.mod': 4,
      'pulser.modSrc': 'seq',
      'seq.stages': '5',
      'seq.clock': 'puls',
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
      'co.pitch': 4,
      'co.pitchMod': 5,
      'co.pitchModSrc': 'seq',
      'mo.mode': 'fm',
      'mo.freq': 5.6,
      'mo.index': 4,
      'env.mode': 'trans',
      'env.trig': 'seq',
      'env.attack': 1,
      'env.decay': 6.5,
      'lpg1.level': 0,
      'lpg1.mod': 9,
      'lpg1.modSrc': 'env',
      'out.reverb': 3.5,
    },
    cables: [],
  },
  {
    id: 'chaos-engine',
    num: 3,
    name: 'Chaos Engine',
    loops: 'loop A at high gain',
    set: 'M.O. high range, FM, index ~7. C.O. audio to M.O. f.m. in at ~6. Random (clocked by a slow pulser) to M.O. frequency and to index.',
    result: 'Noisy, granular, ever-changing; each random step drops the loop into a new chaotic regime.',
    params: {
      'mo.range': 'high',
      'mo.mode': 'fm',
      'mo.freq': 5,
      'mo.index': 7,
      'mo.fmLevel': 6,
      'mo.freqMod': 4,
      'mo.freqModSrc': 'rand',
      'mo.indexMod': 3,
      'mo.indexModSrc': 'rand',
      'rand.trig': 'puls',
      'pulser.period': 7.8,
      'co.pitch': 4,
      'lpg1.level': 7,
    },
    cables: [['co.out', 'mo.fmIn']],
  },
  {
    id: 'howl-box',
    num: 4,
    name: 'Howl Box',
    loops: 'loop C',
    set:
      'Oscillators turned down at the gates. Mix out to preamp; preamp audio to LPG 2 via aux. LPG 2 filter mode. Bring preamp gain up very slowly until it rings. Envelope self-mode on LPG 2 level.',
    result: 'Classic no-input-mixer tones (resonant whistles and hums) pulsed by the cycling envelope.',
    params: {
      'lpg1.level': 0,
      'lpg2.src': 'pre',
      'lpg2.mode': 'lp',
      'lpg2.level': 0,
      'lpg2.mod': 8.5,
      'lpg2.modSrc': 'env',
      'env.mode': 'self',
      'env.attack': 6.2,
      'env.sustain': 2.5,
      'env.decay': 8,
      'pre.gain': 2.7,
      'out.reverb': 3,
    },
    tip: 'Preamp gain is preset just past the ring point (about 2.4). Below it the loop falls silent; well above it the howl locks into a constant tone. Turn the master down before raising it.',
    cables: [['out.mix', 'pre.in']],
  },
  {
    id: 'hollow-phase-choir',
    num: 5,
    name: 'Hollow Phase Choir',
    loops: 'loops F + E',
    set: 'LPG 2 source = LPG 1. C.O. timbre ~4. Envelope self-mode to LPG 2 level only; envelope output to its own decay CV.',
    result: 'A hollow, highpassed shadow of the drone that phases in and out at an accelerating / slowing rate.',
    params: {
      'co.pitch': 3.5,
      'co.timbre': 4,
      'lpg1.level': 6,
      'lpg2.src': 'g1 −',
      'lpg2.level': 1,
      'lpg2.mod': 7,
      'lpg2.modSrc': 'env',
      'env.mode': 'self',
      'env.attack': 6.5,
      'env.sustain': 3,
      'env.decay': 7,
      'env.cvDepth': 5,
    },
    cables: [['env.out', 'env.decayCv']],
  },
  {
    id: 'noise-weather',
    num: 6,
    name: 'Noise Weather',
    loops: 'preamp empty',
    set: 'Leave the preamp unplugged so white noise feeds LPG 2. Random (pulser-clocked, slow) to LPG 2 level and mode filter. C.O. quiet sine under it.',
    result: 'Gusts and rain-like noise over a pure tone, nothing patched in.',
    params: {
      'pre.empty': 'noise',
      'pre.gain': 4,
      'lpg2.src': 'pre',
      'lpg2.mode': 'lp',
      'lpg2.level': 0.5,
      'lpg2.mod': 7,
      'lpg2.modSrc': 'rand',
      'rand.trig': 'puls',
      'rand.slew': 5.5,
      'pulser.period': 7.5,
      'co.pitch': 4.5,
      'co.timbre': 0,
      'co.wave': 'sine',
      'mo.mode': 'off',
      'lpg1.level': 3,
      'out.b': 8,
      'out.reverb': 3.5,
    },
    cables: [],
  },
  {
    id: 'ring-clock',
    num: 7,
    name: 'Ring Clock',
    loops: 'loops D + A',
    set: 'M.O. low range, balanced (ring) mode, index ~6 (tremolo-ring). Pulser period from the envelope; envelope triggered by the pulser.',
    result: 'Two timers pushing each other: pulsing ring-mod rhythms that speed up and drift apart.',
    params: {
      'mo.range': 'low',
      'mo.mode': 'ring',
      'mo.freq': 6.2,
      'mo.index': 6,
      'mo.wave': 'tri',
      'pulser.trig': 'self',
      'pulser.period': 4.5,
      'pulser.mod': 5,
      'pulser.modSrc': 'env',
      'env.trig': 'puls',
      'env.mode': 'trans',
      'env.attack': 3.5,
      'env.decay': 7,
      'co.pitch': 4.5,
      'co.timbre': 2.5,
      'lpg1.level': 2.5,
      'lpg1.mod': 6,
      'lpg1.modSrc': 'env',
      'out.reverb': 3,
    },
    cables: [],
  },
  {
    id: 'long-form-steering',
    num: 8,
    name: 'Long-Form Steering',
    loops: 'all slow loops on a fast loop',
    set: "Recipe 3's chaos loop, with the envelope detector (mix out to preamp) inverted onto M.O. index, and random on the M.O. f.m.-in level.",
    result: 'Self-steering: loud chaos pulls its own index down, quiet passages let it build back up.',
    params: {
      'mo.range': 'high',
      'mo.mode': 'fm',
      'mo.freq': 5,
      'mo.index': 7,
      'mo.fmLevel': 5,
      'mo.freqMod': 4,
      'mo.freqModSrc': 'rand',
      'mo.indexMod': 5,
      'rand.trig': 'puls',
      'pulser.period': 7.8,
      'co.pitch': 4,
      'lpg1.level': 7,
      'pre.gain': 2.4,
      'pre.speed': 7,
    },
    tip: 'Give it a minute: it drifts between a calm, steady tone and stretches of quieter chaos. Preamp gain sets how hard the detector steers; too much and it parks on the calm tone.',
    cables: [
      ['co.out', 'mo.fmIn'],
      ['out.mix', 'pre.in'],
      ['pre.det', 'inv.aIn'],
      ['inv.aOut', 'mo.indexCv'],
      ['rand.r2', 'mo.fmLevelCv'],
    ],
  },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** Convert a recipe's human-readable values into engine param values. */
export function recipeParams(recipe) {
  const values = defaultParams();
  for (const [id, raw] of Object.entries(recipe.params || {})) {
    const p = PARAM_BY_ID[id];
    if (!p) throw new Error(`recipe ${recipe.id}: unknown param ${id}`);
    if (p.type === 'slider' || p.type === 'knob') {
      values[id] = raw / 10;
    } else if (p.type === 'bus') {
      const i = BUS_SOURCES.findIndex((s) => s.id === raw);
      if (i < 0) throw new Error(`recipe ${recipe.id}: unknown bus source ${raw}`);
      values[id] = i;
    } else {
      const i = p.options.indexOf(String(raw));
      if (i < 0) throw new Error(`recipe ${recipe.id}: ${id} has no option ${raw}`);
      values[id] = i;
    }
  }
  return values;
}
