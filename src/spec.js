// Shared, DOM-free description of the instrument, modelled on the 208C panel
// as documented in the 208C Quick Start Guide, with the keyboard, program-card,
// MIDI and pressure sections left out (this is a no-input build).
//
// Imported by the UI *and* by the AudioWorklet, so parameter ids, jack ids and
// the curves that turn slider positions into physical values never drift apart.
//
// Conventions (from the panel)
// - Black banana jacks are inputs; coloured banana jacks are outputs, coloured
//   by source (blue sequencer, orange envelope, yellow pulser, white random,
//   green modulation-oscillator out, blue inverter / envelope-detector out).
//   Sources appear several times in the jack field (multiples) so a shorting
//   bar can reach a neighbouring CV input.
// - Audio lives on Tini-Jax (3.5 mm) jacks: f.m. in, m.osc, c.osc, gate1 in,
//   aux in / nse, gate2 sig, master out.
// - Each modulated parameter has a main slider and a CV-amount slider with a
//   black CV-input jack under it:   position = slider + cvAmount * cv
// - Envelope and pulser times are printed .002 s at the top to 10 s at the
//   bottom: pushing a slider (or a CV) up makes things faster.
// - Sliders/knobs store a normalised position (0..1, fine tune -1..1);
//   switches store the index of the selected option.

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------
// Printed scales -> curves (piecewise log interpolation between the marks,
// marks listed bottom (position 0) to top (position 1), evenly spaced).
// ---------------------------------------------------------------------------
export const SCALES = {
  time: [10, 3.5, 1, 0.2, 0.025, 0.002],
  pitch: [33, 88, 200, 440, 1000, 3000],
  moLow: [0.4, 1.0, 2.2, 5.0, 12, 33],
  ten: [0, 2, 4, 6, 8, 10],
};

function logScale(marks, lo, hi) {
  const L = marks.map(Math.log);
  const n = L.length - 1;
  return (pos) => {
    const x = clamp(pos, -0.75, 1.75) * n;
    let i = Math.floor(x);
    if (i < 0) i = 0;
    else if (i > n - 1) i = n - 1;
    return clamp(Math.exp(L[i] + (L[i + 1] - L[i]) * (x - i)), lo, hi);
  };
}

export const curves = {
  /** Envelope segment / pulser period in seconds; top of the slider is fastest. */
  time: logScale(SCALES.time, 0.0005, 40),
  /** Complex oscillator pitch and modulation oscillator (high range), Hz. */
  pitch: logScale(SCALES.pitch, 4, 16000),
  /** Modulation oscillator, low range, Hz. */
  moLow: logScale(SCALES.moLow, 0.01, 400),
  /** Fine tune knobs: +/- half an octave as a frequency ratio. */
  fine: (k) => Math.pow(2, k * 0.5),
  /** Lopass-gate cutoff from vactrol state (0..1): 25 Hz .. ~19 kHz. */
  lpgCutoff: (v) => 25 * Math.pow(2, clamp(v, 0, 1.2) * 9.6),
  /** Output knobs (channel A/B, master, monitor). */
  level: (k) => 1.6 * k * k,
  master: (k) => 2 * k * k,
};

/** Preamp gain for the low / high switch positions. */
export const PREAMP_GAIN = [2, 12];

// How far a full-scale CV (1.0) moves things, in slider positions.
export const CV = {
  amount: 1, // CV-amount sliders: amount 1 x cv 1 = one full slider travel
  envTime: 0.6, // direct attack / sustain / decay CV inputs
  moFreqDirect: 0.5, // the extra "m.o. freq" input
  waveshape: 1, // w.s. input: a full virtual turn of the waveshape knob
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
export const MODULES = {
  seq: { title: 'Sequential Voltage', color: 'seq' },
  rand: { title: 'Random Voltage', color: 'rand' },
  env: { title: 'Envelope Generator', color: 'env' },
  pulser: { title: 'Pulser', color: 'pulser' },
  mo: { title: 'Modulation Oscillator', color: 'mo' },
  co: { title: 'Complex Oscillator', color: 'co' },
  lpg: { title: 'Dual Lo Pass Gate', color: 'lpg' },
  pre: { title: 'Preamp / Envelope Det', color: 'pre' },
  inv: { title: 'Inverter', color: 'inv' },
  out: { title: 'Output', color: 'out' },
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
const P = (id, type, def, extra = {}) => ({ id, type, def, ...extra });
const ON_OFF = ['on', 'off'];
const GATE_MODES = ['lo pass', 'combo', 'vca'];

export const PARAMS = [
  // Sequential voltage ---------------------------------------------------------
  P('seq.s1', 'slider', 0.2, { label: '1', scale: 'ten' }),
  P('seq.s2', 'slider', 0.55, { label: '2', scale: 'ten' }),
  P('seq.s3', 'slider', 0.35, { label: '3', scale: 'ten' }),
  P('seq.s4', 'slider', 0.75, { label: '4', scale: 'ten' }),
  P('seq.s5', 'slider', 0.45, { label: '5', scale: 'ten' }),
  P('seq.p1', 'toggle', 0, { label: 'pulse 1', options: ON_OFF }),
  P('seq.p2', 'toggle', 0, { label: 'pulse 2', options: ON_OFF }),
  P('seq.p3', 'toggle', 0, { label: 'pulse 3', options: ON_OFF }),
  P('seq.p4', 'toggle', 0, { label: 'pulse 4', options: ON_OFF }),
  P('seq.p5', 'toggle', 0, { label: 'pulse 5', options: ON_OFF }),
  P('seq.trig', 'switch', 0, { label: 'trigger source', options: ['pulser', 'off'] }),
  P('seq.stages', 'switch', 2, { label: 'stages', options: ['3', '4', '5'] }),

  // Random voltage -------------------------------------------------------------
  P('rand.trig', 'switch', 0, { label: 'trigger source', options: ['pulser', 'sequencer'] }),

  // Envelope generator ---------------------------------------------------------
  P('env.trig', 'switch', 0, { label: 'trigger source', options: ['pulser', 'sequencer'] }),
  P('env.mode', 'switch', 1, { label: 'mode select', options: ['sustained', 'transient', 'self'] }),
  P('env.attack', 'slider', 0.8, { label: 'attack', scale: 'time' }),
  P('env.sustain', 'slider', 0.7, { label: 'sustain', scale: 'time' }),
  P('env.decay', 'slider', 0.55, { label: 'decay', scale: 'time' }),

  // Pulser ---------------------------------------------------------------------
  P('pulser.trig', 'switch', 0, { label: 'trigger source', options: ['self', 'sequencer'] }),
  P('pulser.mode', 'switch', 0, { label: 'mode', options: ['sustnd', 'trans', 'off-ext'] }),
  P('pulser.periodCv', 'slider', 0, { label: 'period cv', scale: 'ten', cv: true }),
  P('pulser.period', 'slider', 0.55, { label: 'period', scale: 'time' }),

  // Modulation oscillator ------------------------------------------------------
  P('mo.fmLevel', 'knob', 0, { label: 'f.m. in' }),
  P('mo.wave', 'switch', 2, { label: 'waveshape', options: ['saw', 'square', 'tri'] }),
  P('mo.range', 'switch', 0, { label: 'range', options: ['high', 'low'] }),
  P('mo.fine', 'knob', 0, { label: 'fine tune', bipolar: true }),
  P('mo.mode', 'switch', 2, { label: 'modulation', options: ['bal. ext', 'a.m. osc', 'f.m. osc'] }),
  P('mo.freqCv', 'slider', 0, { label: 'freq cv', scale: 'ten', cv: true }),
  P('mo.freq', 'slider', 0.45, { label: 'frequency', scale: 'mo' }),
  P('mo.indexCv', 'slider', 0, { label: 'mod cv', scale: 'ten', cv: true }),
  P('mo.index', 'slider', 0, { label: 'modulation', scale: 'ten' }),

  // Complex oscillator ---------------------------------------------------------
  P('co.polarity', 'switch', 1, { label: 'polarity', options: ['−', '+'] }),
  P('co.fine', 'knob', 0, { label: 'fine tune', bipolar: true }),
  P('co.shape', 'knob', 0, { label: 'waveshape' }),
  P('co.wave', 'switch', 2, { label: 'waveshape', options: ['spike', 'square', 'tri'] }),
  P('co.pitchCv', 'slider', 0, { label: 'pitch cv', scale: 'ten', cv: true }),
  P('co.pitch', 'slider', 0.35, { label: 'pitch', scale: 'pitch' }),
  P('co.timbreCv', 'slider', 0, { label: 'timbre cv', scale: 'ten', cv: true }),
  P('co.timbre', 'slider', 0, { label: 'timbre', scale: 'ten' }),

  // Dual lo pass gate ----------------------------------------------------------
  P('lpg.src', 'switch', 1, { label: 'gate 2 source', options: ['aux / nse', 'mod osc', 'gate 1 −'] }),
  P('lpg1.mode', 'switch', 1, { label: 'gate 1', options: GATE_MODES }),
  P('lpg2.mode', 'switch', 1, { label: 'gate 2', options: GATE_MODES }),
  P('lpg1.levelCv', 'slider', 0, { label: 'level 1 cv', scale: 'ten', cv: true }),
  P('lpg1.level', 'slider', 0.6, { label: 'level 1', scale: 'ten' }),
  P('lpg2.levelCv', 'slider', 0, { label: 'level 2 cv', scale: 'ten', cv: true }),
  P('lpg2.level', 'slider', 0, { label: 'level 2', scale: 'ten' }),

  // Preamp / envelope detector -------------------------------------------------
  P('pre.gain', 'switch', 0, { label: 'gain', options: ['low', 'high'] }),

  // Output -----------------------------------------------------------------------
  P('out.b', 'knob', 0.6, { label: 'channel B', dial: true }),
  P('out.a', 'knob', 0.6, { label: 'channel A', dial: true }),
  P('out.reverb', 'knob', 0.25, { label: 'reverberation', dial: true }),
  P('out.monitor', 'knob', 0.55, { label: 'monitor level', dial: true }),
  P('out.master', 'knob', 0.5, { label: 'master volume', dial: true }),
];

export const PARAM_INDEX = Object.freeze(Object.fromEntries(PARAMS.map((p, i) => [p.id, i])));
export const PARAM_BY_ID = Object.freeze(Object.fromEntries(PARAMS.map((p) => [p.id, p])));

/** True for params whose value is continuous (and should be smoothed). */
export const isContinuous = (p) => p.type === 'slider' || p.type === 'knob';

export function defaultParams() {
  const out = {};
  for (const p of PARAMS) out[p.id] = p.def;
  return out;
}

/** Clamp/round a value into the legal range for its parameter. */
export function sanitizeParam(id, value) {
  const p = PARAM_BY_ID[id];
  if (!p) return undefined;
  const v = Number(value);
  if (!Number.isFinite(v)) return p.def;
  if (p.type === 'slider') return clamp(v, 0, 1);
  if (p.type === 'knob') return clamp(v, p.bipolar ? -1 : 0, 1);
  return clamp(Math.round(v), 0, p.options.length - 1);
}

// ---------------------------------------------------------------------------
// Signals: the engine's output slots. Several jacks can carry one signal.
// ---------------------------------------------------------------------------
export const SIGNALS = [
  'seq', // sequencer voltage
  'seq.pulse', // internal: stage pulses
  'env', // envelope
  'pulser', // pulser ramp (falls 1 -> 0 over each period)
  'pulser.pulse', // internal: pulser pulses
  'rand', // random voltage
  'pre', // preamp audio (internal: feeds gate 2 aux position + bal. ext)
  'pre.env', // envelope detector
  'inv', // inverter
  'mo', // modulation oscillator audio (m.osc)
  'mo.mod', // modulation oscillator as a 0..1 control voltage (mod out)
  'mo.g2', // internal: what the m.o. sends to gate 2 (balanced-modulated in bal. ext)
  'co', // complex oscillator audio (c.osc)
  'lpg1', // internal: gate 1 output
  'lpg2', // gate 2 output (gate2 sig)
  'mix', // master out
];
export const SIGNAL_INDEX = Object.freeze(Object.fromEntries(SIGNALS.map((s, i) => [s, i])));

/** Colour family of each patchable signal (CSS: --c-<color>). */
export const SIGNAL_COLOR = {
  seq: 'seq',
  env: 'env',
  pulser: 'pulser',
  rand: 'rand',
  'pre.env': 'blue',
  inv: 'blue',
  'mo.mod': 'mo',
  mo: 'tiny',
  co: 'tiny',
  lpg2: 'tiny',
  mix: 'tiny',
};

// ---------------------------------------------------------------------------
// Jacks
// type: 'banana' | 'tiny' (Tini-Jax)
// ---------------------------------------------------------------------------
const OUT = (id, signal, label, extra = {}) => ({ id, dir: 'out', signal, label, type: 'banana', ...extra });
const IN = (id, label, extra = {}) => ({ id, dir: 'in', label, type: 'banana', ...extra });

// Multiples in the jack field, so shorting bars can reach neighbouring inputs.
export const MULTIPLES = { seq: 6, env: 5, pulser: 4, rand: 10 };
const multiples = [];
for (const [signal, n] of Object.entries(MULTIPLES)) {
  for (let i = 1; i <= n; i++) {
    const label = { seq: 'seq', env: 'env', pulser: 'pulser', rand: 'random' }[signal];
    multiples.push(OUT(`${signal}.${i}`, signal, label));
  }
}

export const OUTPUTS = [
  ...multiples,
  OUT('mo.modOut', 'mo.mod', 'mod out'),
  OUT('inv.out', 'inv', 'output'),
  OUT('pre.envOut', 'pre.env', 'env out'),
  OUT('mo.osc', 'mo', 'm.osc', { type: 'tiny' }),
  OUT('co.osc', 'co', 'c.osc', { type: 'tiny' }),
  OUT('lpg2.sig', 'lpg2', 'gate2 sig', { type: 'tiny' }),
  OUT('out.master1', 'mix', 'master out', { type: 'tiny' }),
  OUT('out.master2', 'mix', 'master out', { type: 'tiny' }),
];

export const INPUTS = [
  IN('mo.freqIn', 'm.o. freq', { note: 'extra modulation-oscillator frequency input (no attenuator)' }),
  IN('env.attackCv', 'attack'),
  IN('env.sustainCv', 'st.'),
  IN('env.decayCv', 'decay'),
  IN('pulser.periodCv', 'period', { note: 'in off-ext mode, pulses here drive the pulser' }),
  IN('mo.freqCv', 'freq'),
  IN('mo.indexCv', 'mod'),
  IN('co.pitchCv', 'pitch'),
  IN('co.timbreCv', 'timbre'),
  IN('co.wsCv', 'w.s.'),
  IN('lpg1.cv', 'level 1'),
  IN('lpg2.cv', 'level 2'),
  IN('inv.in', 'input'),
  IN('mo.fmIn', 'f.m. in', { type: 'tiny' }),
  IN('lpg1.in', 'gate1 in', { type: 'tiny', note: 'replaces the complex oscillator as gate 1 source' }),
  IN('pre.in', 'aux in / nse', { type: 'tiny', note: 'white noise when nothing is plugged in' }),
];

export const JACKS = [...OUTPUTS, ...INPUTS];
export const JACK_BY_ID = Object.freeze(Object.fromEntries(JACKS.map((j) => [j.id, j])));
export const IN_INDEX = Object.freeze(Object.fromEntries(INPUTS.map((j, i) => [j.id, i])));

// Readable names for patch sheets and announcements.
const SIGNAL_NAMES = {
  seq: 'sequencer',
  env: 'envelope',
  pulser: 'pulser',
  rand: 'random',
  'pre.env': 'env out (detector)',
  inv: 'inverter out',
  'mo.mod': 'm.o. mod out',
  mo: 'm.osc',
  co: 'c.osc',
  lpg2: 'gate2 sig',
  mix: 'master out',
};
const INPUT_NAMES = {
  'mo.freqIn': 'm.o. freq (direct)',
  'env.attackCv': 'attack cv',
  'env.sustainCv': 'sustain cv',
  'env.decayCv': 'decay cv',
  'pulser.periodCv': 'pulser period cv',
  'mo.freqCv': 'm.o. freq cv',
  'mo.indexCv': 'm.o. modulation cv',
  'co.pitchCv': 'c.o. pitch cv',
  'co.timbreCv': 'timbre cv',
  'co.wsCv': 'w.s. cv',
  'lpg1.cv': 'level 1 cv',
  'lpg2.cv': 'level 2 cv',
  'inv.in': 'inverter in',
  'mo.fmIn': 'f.m. in',
  'lpg1.in': 'gate1 in',
  'pre.in': 'aux in',
};

/** "sequencer", "c.o. pitch cv", "master out"... */
export function jackName(id) {
  const j = JACK_BY_ID[id];
  if (!j) return id;
  return j.dir === 'out' ? SIGNAL_NAMES[j.signal] || j.label : INPUT_NAMES[id] || j.label;
}

/** Colour family for a jack (outputs by signal, inputs black/tiny). */
export function jackColor(j) {
  if (j.type === 'tiny') return 'tiny';
  if (j.dir === 'in') return 'black';
  return SIGNAL_COLOR[j.signal] || 'blue';
}
