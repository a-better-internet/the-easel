// Shared, DOM-free description of the instrument.
//
// Imported by the UI *and* by the AudioWorklet, so parameter ids, jack ids and
// the curves that turn slider positions into physical values can never drift
// apart between what you see and what you hear.
//
// Conventions
// - Sliders and knobs store a normalised position (0..1, fine knobs -1..1).
//   The panel prints them on the Easel's 0-10 scale.
// - Switches store the index of the selected option.
// - Every modulated parameter follows one rule:
//       effective position = slider + depth * scale * cv
//   so a mod slider literally sets "how much" a bus source reaches a destination.
// - A cable in an input jack overrides the internal switch for that input
//   (named in `overrides`), the way a normalled jack breaks its normal.

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------
// Control bus: the five internal sources a mod slider can pick from.
// Colours follow the Easel's own convention (blue sequencer, yellow pulser,
// orange envelope, white/grey random, purple pressure/external).
// ---------------------------------------------------------------------------
export const BUS_SOURCES = [
  { id: 'seq', label: 'SEQ', name: 'Sequencer voltage', color: 'seq' },
  { id: 'puls', label: 'PULS', name: 'Pulser ramp', color: 'pulser' },
  { id: 'env', label: 'ENV', name: 'Envelope', color: 'env' },
  { id: 'rand', label: 'RAND', name: 'Random voltage 1', color: 'rand' },
  { id: 'det', label: 'DET', name: 'Envelope detector', color: 'det' },
];

export const MODULES = {
  pulser: { title: 'Pulser', tag: 'clock · ramp', color: 'pulser' },
  seq: { title: 'Sequential Voltage Source', tag: '3-5 stages', color: 'seq' },
  env: { title: 'Envelope Generator', tag: 'trans · sust · self', color: 'env' },
  rand: { title: 'Random', tag: 'S&H voltages', color: 'rand' },
  pre: { title: 'Preamp / Detector', tag: 'audio → control', color: 'det' },
  inv: { title: 'Inverter', tag: 'x −1', color: 'out' },
  mo: { title: 'Modulation Oscillator', tag: 'FM · AM · ring', color: 'osc' },
  co: { title: 'Complex Oscillator', tag: 'waveshape · timbre', color: 'osc' },
  lpg: { title: 'Dual Lopass Gate', tag: 'VCA · filter · combo', color: 'lpg' },
  out: { title: 'Output & Reverb', tag: 'mix · spring', color: 'out' },
};

// ---------------------------------------------------------------------------
// Curves (position -> physical value). Shared by engine and UI read-outs.
// ---------------------------------------------------------------------------
const exp2 = (x) => Math.pow(2, x);

export const curves = {
  /** Pulser period in seconds: 5 ms .. 10 s across the slider. */
  pulserPeriod: (pos) => 0.005 * exp2(clamp(pos, -0.75, 1.5) * 11),
  /** Envelope segment time in seconds: 1 ms .. 8 s. */
  envTime: (pos) => 0.001 * exp2(clamp(pos, -0.3, 1.4) * 13),
  /** Modulation oscillator, high range: 8 Hz .. 8 kHz. */
  moHigh: (pos) => 8 * exp2(clamp(pos, -0.8, 1.4) * 10),
  /** Modulation oscillator, low range: 0.02 Hz .. 41 Hz. */
  moLow: (pos) => 0.02 * exp2(clamp(pos, -0.8, 1.4) * 11),
  /** Complex oscillator: 16 Hz .. 4.2 kHz (8 octaves). */
  coFreq: (pos) => 16.35 * exp2(clamp(pos, -1, 1.6) * 8),
  /** Fine tune knobs: +/- half an octave as a frequency ratio. */
  fine: (k) => exp2(k * 0.5),
  /** Preamp gain: 0 .. 20x. */
  preGain: (p) => 20 * p * p,
  /** Envelope-detector release time: 20 ms .. 1.3 s. */
  detRelease: (p) => 0.02 * exp2(p * 6),
  /** Random-voltage slew time (0 = stepped): up to 2 s. */
  randSlew: (p) => (p <= 0.001 ? 0 : 0.002 * exp2(p * 10)),
  /** Lopass-gate cutoff from vactrol state (0..1): 25 Hz .. ~19 kHz. */
  lpgCutoff: (v) => 25 * exp2(clamp(v, 0, 1.2) * 9.6),
  /** Master gain law. */
  master: (p) => 2 * p * p,
};

// How far a full mod slider (depth 1) with a full-scale cv (1.0) moves each
// destination, in slider positions.
export const MOD_SCALE = {
  pulserPeriod: 0.6, // ~6.6 octaves of period
  coPitch: 0.5, // 4 octaves
  coTimbre: 1.0,
  moFreq: 0.5,
  moIndex: 1.0,
  lpgLevel: 1.0,
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
const P = (id, type, def, extra = {}) => ({ id, type, def, ...extra });
const ON_OFF = ['on', 'off'];

export const PARAMS = [
  // Pulser ------------------------------------------------------------------
  P('pulser.period', 'slider', 0.5, { label: 'period' }),
  P('pulser.mod', 'slider', 0, { label: 'mod' }),
  P('pulser.modSrc', 'bus', 0, { label: 'period mod source' }),
  P('pulser.trig', 'switch', 0, { label: 'trigger', options: ['self', 'seq'] }),
  P('pulser.mode', 'switch', 0, { label: 'mode', options: ['cycle', 'once'] }),

  // Sequential voltage source ------------------------------------------------
  P('seq.s1', 'slider', 0.2, { label: '1' }),
  P('seq.s2', 'slider', 0.55, { label: '2' }),
  P('seq.s3', 'slider', 0.35, { label: '3' }),
  P('seq.s4', 'slider', 0.75, { label: '4' }),
  P('seq.s5', 'slider', 0.45, { label: '5' }),
  P('seq.p1', 'toggle', 0, { label: 'pulse 1', options: ON_OFF }),
  P('seq.p2', 'toggle', 0, { label: 'pulse 2', options: ON_OFF }),
  P('seq.p3', 'toggle', 0, { label: 'pulse 3', options: ON_OFF }),
  P('seq.p4', 'toggle', 0, { label: 'pulse 4', options: ON_OFF }),
  P('seq.p5', 'toggle', 0, { label: 'pulse 5', options: ON_OFF }),
  P('seq.stages', 'switch', 2, { label: 'stages', options: ['3', '4', '5'] }),
  P('seq.clock', 'switch', 0, { label: 'clock', options: ['puls', 'hold'] }),

  // Envelope -----------------------------------------------------------------
  P('env.attack', 'slider', 0.2, { label: 'attack' }),
  P('env.sustain', 'slider', 0.3, { label: 'sustain' }),
  P('env.decay', 'slider', 0.55, { label: 'decay' }),
  P('env.mode', 'switch', 0, { label: 'mode', options: ['trans', 'sust', 'self'] }),
  P('env.trig', 'switch', 0, { label: 'trigger', options: ['puls', 'seq'] }),
  P('env.cvDepth', 'knob', 0.5, { label: 'time cv' }),

  // Random -------------------------------------------------------------------
  P('rand.trig', 'switch', 0, { label: 'trigger', options: ['puls', 'seq'] }),
  P('rand.slew', 'knob', 0, { label: 'slew' }),

  // Preamp / envelope detector ------------------------------------------------
  P('pre.gain', 'slider', 0, { label: 'gain' }),
  P('pre.empty', 'switch', 0, { label: 'empty in', options: ['noise', 'silent'] }),
  P('pre.speed', 'knob', 0.35, { label: 'release' }),

  // Modulation oscillator ----------------------------------------------------
  P('mo.freq', 'slider', 0.5, { label: 'freq' }),
  P('mo.fine', 'knob', 0, { label: 'fine', bipolar: true }),
  P('mo.freqMod', 'slider', 0, { label: 'mod' }),
  P('mo.freqModSrc', 'bus', 0, { label: 'freq mod source' }),
  P('mo.range', 'switch', 0, { label: 'range', options: ['high', 'low'] }),
  P('mo.wave', 'switch', 2, { label: 'wave', options: ['saw', 'square', 'tri'] }),
  P('mo.mode', 'switch', 1, { label: 'mode', options: ['off', 'fm', 'am', 'ring'] }),
  P('mo.index', 'slider', 0, { label: 'index' }),
  P('mo.indexMod', 'slider', 0, { label: 'mod' }),
  P('mo.indexModSrc', 'bus', 0, { label: 'index mod source' }),
  P('mo.fmLevel', 'knob', 0, { label: 'f.m. in' }),

  // Complex oscillator -------------------------------------------------------
  P('co.pitch', 'slider', 0.35, { label: 'pitch' }),
  P('co.fine', 'knob', 0, { label: 'fine', bipolar: true }),
  P('co.pitchMod', 'slider', 0, { label: 'mod' }),
  P('co.pitchModSrc', 'bus', 0, { label: 'pitch mod source' }),
  P('co.timbre', 'slider', 0, { label: 'timbre' }),
  P('co.timbreMod', 'slider', 0, { label: 'mod' }),
  P('co.timbreModSrc', 'bus', 2, { label: 'timbre mod source' }),
  P('co.wave', 'switch', 0, { label: 'wave', options: ['sine', 'tri', 'square', 'spike'] }),
  P('co.polarity', 'switch', 0, { label: 'cv polarity', options: ['+', '−'] }),

  // Dual lopass gate ---------------------------------------------------------
  P('lpg1.level', 'slider', 0.6, { label: 'level' }),
  P('lpg1.mod', 'slider', 0, { label: 'mod' }),
  P('lpg1.modSrc', 'bus', 2, { label: 'gate 1 mod source' }),
  P('lpg1.mode', 'switch', 1, { label: 'mode', options: ['vca', 'combo', 'lp'] }),
  P('lpg2.level', 'slider', 0, { label: 'level' }),
  P('lpg2.mod', 'slider', 0, { label: 'mod' }),
  P('lpg2.modSrc', 'bus', 2, { label: 'gate 2 mod source' }),
  P('lpg2.mode', 'switch', 1, { label: 'mode', options: ['vca', 'combo', 'lp'] }),
  P('lpg2.src', 'switch', 0, { label: 'source', options: ['m.o.', 'pre', 'g1 −'] }),

  // Output -------------------------------------------------------------------
  P('out.a', 'slider', 0.7, { label: 'A' }),
  P('out.b', 'slider', 0.7, { label: 'B' }),
  P('out.reverb', 'slider', 0.25, { label: 'reverb' }),
  P('out.master', 'slider', 0.45, { label: 'master' }),
  P('out.stereo', 'switch', 0, { label: 'image', options: ['mono', 'wide'] }),
];

export const PARAM_INDEX = Object.freeze(
  Object.fromEntries(PARAMS.map((p, i) => [p.id, i])),
);
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
  const n = p.type === 'bus' ? BUS_SOURCES.length : p.options.length;
  return clamp(Math.round(v), 0, n - 1);
}

// ---------------------------------------------------------------------------
// Jacks
// kind: 'audio' | 'cv' | 'pulse' (drives jack colour and cable colour)
// ---------------------------------------------------------------------------
const OUT = (id, module, kind, label, extra = {}) => ({ id, module, kind, label, dir: 'out', ...extra });
const IN = (id, module, kind, label, extra = {}) => ({ id, module, kind, label, dir: 'in', ...extra });

export const OUTPUTS = [
  OUT('pulser.pulse', 'pulser', 'pulse', 'pulse'),
  OUT('pulser.ramp', 'pulser', 'cv', 'ramp'),
  OUT('seq.cv', 'seq', 'cv', 'volts'),
  OUT('seq.pulse', 'seq', 'pulse', 'pulse'),
  OUT('env.out', 'env', 'cv', 'env'),
  OUT('rand.r1', 'rand', 'cv', 'rand 1'),
  OUT('rand.r2', 'rand', 'cv', 'rand 2'),
  OUT('pre.out', 'pre', 'audio', 'pre out'),
  OUT('pre.det', 'pre', 'cv', 'env det'),
  OUT('inv.aOut', 'inv', 'cv', '−A'),
  OUT('inv.bOut', 'inv', 'cv', '−B'),
  OUT('mo.out', 'mo', 'audio', 'm.o. out'),
  OUT('co.out', 'co', 'audio', 'c.o. out'),
  OUT('lpg1.out', 'lpg', 'audio', 'gate 1'),
  OUT('lpg2.out', 'lpg', 'audio', 'gate 2'),
  OUT('out.mix', 'out', 'audio', 'mix out'),
];

export const INPUTS = [
  IN('pulser.trigIn', 'pulser', 'pulse', 'trig', { overrides: 'pulser.trig' }),
  IN('pulser.periodCv', 'pulser', 'cv', 'period', { overrides: 'pulser.modSrc' }),
  IN('seq.clockIn', 'seq', 'pulse', 'clock', { overrides: 'seq.clock' }),
  IN('env.trigIn', 'env', 'pulse', 'trig', { overrides: 'env.trig' }),
  IN('env.attackCv', 'env', 'cv', 'A cv'),
  IN('env.sustainCv', 'env', 'cv', 'S cv'),
  IN('env.decayCv', 'env', 'cv', 'D cv'),
  IN('rand.trigIn', 'rand', 'pulse', 'trig', { overrides: 'rand.trig' }),
  IN('pre.in', 'pre', 'audio', 'input', { overrides: 'pre.empty' }),
  IN('inv.aIn', 'inv', 'cv', 'A'),
  IN('inv.bIn', 'inv', 'cv', 'B'),
  IN('mo.freqCv', 'mo', 'cv', 'freq', { overrides: 'mo.freqModSrc' }),
  IN('mo.indexCv', 'mo', 'cv', 'index', { overrides: 'mo.indexModSrc' }),
  IN('mo.fmIn', 'mo', 'audio', 'f.m. in'),
  IN('mo.fmLevelCv', 'mo', 'cv', 'f.m. lvl'),
  IN('co.pitchCv', 'co', 'cv', 'pitch', { overrides: 'co.pitchModSrc' }),
  IN('co.timbreCv', 'co', 'cv', 'timbre', { overrides: 'co.timbreModSrc' }),
  IN('lpg1.in', 'lpg', 'audio', 'in 1'),
  IN('lpg2.in', 'lpg', 'audio', 'in 2', { overrides: 'lpg2.src' }),
  IN('lpg1.cv', 'lpg', 'cv', 'lvl 1', { overrides: 'lpg1.modSrc' }),
  IN('lpg2.cv', 'lpg', 'cv', 'lvl 2', { overrides: 'lpg2.modSrc' }),
];

export const JACKS = [...OUTPUTS, ...INPUTS];
export const JACK_BY_ID = Object.freeze(Object.fromEntries(JACKS.map((j) => [j.id, j])));
export const OUT_INDEX = Object.freeze(Object.fromEntries(OUTPUTS.map((j, i) => [j.id, i])));
export const IN_INDEX = Object.freeze(Object.fromEntries(INPUTS.map((j, i) => [j.id, i])));

// Bus source -> output jack feeding it.
export const BUS_OUTPUT = ['seq.cv', 'pulser.ramp', 'env.out', 'rand.r1', 'pre.det'];
