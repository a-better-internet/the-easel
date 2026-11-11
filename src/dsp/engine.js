// The whole 208 as a single per-sample engine.
//
// Why one engine instead of a graph of Web Audio nodes: Web Audio feedback
// cycles need a DelayNode of at least one render quantum (128 samples), which
// smears audio-rate loops. Here every module is evaluated once per (oversampled)
// tick and patch cables read the most recent value of their source, so a loop
// such as complex osc -> mod osc f.m. in -> complex osc has a one-tick delay,
// close to hardware.
//
// Signal levels: audio is roughly -1..1, control voltages 0..1 (the inverter
// makes them negative), pulses are 0/1 with ~4 ms width.

import {
  PARAMS,
  PARAM_INDEX,
  OUTPUTS,
  INPUTS,
  OUT_INDEX,
  IN_INDEX,
  BUS_OUTPUT,
  MOD_SCALE,
  curves,
  isContinuous,
  sanitizeParam,
} from '../spec.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const pi = (id) => {
  const i = PARAM_INDEX[id];
  if (i === undefined) throw new Error(`unknown param ${id}`);
  return i;
};
const oi = (id) => {
  const i = OUT_INDEX[id];
  if (i === undefined) throw new Error(`unknown output ${id}`);
  return i;
};
const ii = (id) => {
  const i = IN_INDEX[id];
  if (i === undefined) throw new Error(`unknown input ${id}`);
  return i;
};

// Parameter indices --------------------------------------------------------
const PULSER_PERIOD = pi('pulser.period');
const PULSER_MOD = pi('pulser.mod');
const PULSER_MODSRC = pi('pulser.modSrc');
const PULSER_TRIG = pi('pulser.trig');
const PULSER_MODE = pi('pulser.mode');
const SEQ_S = [pi('seq.s1'), pi('seq.s2'), pi('seq.s3'), pi('seq.s4'), pi('seq.s5')];
const SEQ_P = [pi('seq.p1'), pi('seq.p2'), pi('seq.p3'), pi('seq.p4'), pi('seq.p5')];
const SEQ_STAGES = pi('seq.stages');
const SEQ_CLOCK = pi('seq.clock');
const ENV_A = pi('env.attack');
const ENV_S = pi('env.sustain');
const ENV_D = pi('env.decay');
const ENV_MODE = pi('env.mode');
const ENV_TRIG = pi('env.trig');
const ENV_CVDEPTH = pi('env.cvDepth');
const RAND_TRIG = pi('rand.trig');
const RAND_SLEW = pi('rand.slew');
const PRE_GAIN = pi('pre.gain');
const PRE_EMPTY = pi('pre.empty');
const PRE_SPEED = pi('pre.speed');
const MO_FREQ = pi('mo.freq');
const MO_FINE = pi('mo.fine');
const MO_FMOD = pi('mo.freqMod');
const MO_FMODSRC = pi('mo.freqModSrc');
const MO_RANGE = pi('mo.range');
const MO_WAVE = pi('mo.wave');
const MO_MODE = pi('mo.mode');
const MO_INDEX = pi('mo.index');
const MO_IMOD = pi('mo.indexMod');
const MO_IMODSRC = pi('mo.indexModSrc');
const MO_FMLEVEL = pi('mo.fmLevel');
const CO_PITCH = pi('co.pitch');
const CO_FINE = pi('co.fine');
const CO_PMOD = pi('co.pitchMod');
const CO_PMODSRC = pi('co.pitchModSrc');
const CO_TIMBRE = pi('co.timbre');
const CO_TMOD = pi('co.timbreMod');
const CO_TMODSRC = pi('co.timbreModSrc');
const CO_WAVE = pi('co.wave');
const CO_POL = pi('co.polarity');
const L1_LEVEL = pi('lpg1.level');
const L1_MOD = pi('lpg1.mod');
const L1_MODSRC = pi('lpg1.modSrc');
const L1_MODE = pi('lpg1.mode');
const L2_LEVEL = pi('lpg2.level');
const L2_MOD = pi('lpg2.mod');
const L2_MODSRC = pi('lpg2.modSrc');
const L2_MODE = pi('lpg2.mode');
const L2_SRC = pi('lpg2.src');
const OUT_A = pi('out.a');
const OUT_B = pi('out.b');
const OUT_REV = pi('out.reverb');
const OUT_MASTER = pi('out.master');
const OUT_STEREO = pi('out.stereo');

// Output indices -----------------------------------------------------------
const O_PULSE = oi('pulser.pulse');
const O_RAMP = oi('pulser.ramp');
const O_SEQ_CV = oi('seq.cv');
const O_SEQ_PULSE = oi('seq.pulse');
const O_ENV = oi('env.out');
const O_R1 = oi('rand.r1');
const O_R2 = oi('rand.r2');
const O_PRE = oi('pre.out');
const O_DET = oi('pre.det');
const O_INV_A = oi('inv.aOut');
const O_INV_B = oi('inv.bOut');
const O_MO = oi('mo.out');
const O_CO = oi('co.out');
const O_LPG1 = oi('lpg1.out');
const O_LPG2 = oi('lpg2.out');
const O_MIX = oi('out.mix');
const BUS = Int32Array.from(BUS_OUTPUT.map(oi));

// Input indices --------------------------------------------------------------
const I_PULSER_TRIG = ii('pulser.trigIn');
const I_PULSER_CV = ii('pulser.periodCv');
const I_SEQ_CLOCK = ii('seq.clockIn');
const I_ENV_TRIG = ii('env.trigIn');
const I_ENV_ACV = ii('env.attackCv');
const I_ENV_SCV = ii('env.sustainCv');
const I_ENV_DCV = ii('env.decayCv');
const I_RAND_TRIG = ii('rand.trigIn');
const I_PRE_IN = ii('pre.in');
const I_INV_A = ii('inv.aIn');
const I_INV_B = ii('inv.bIn');
const I_MO_FREQ = ii('mo.freqCv');
const I_MO_INDEX = ii('mo.indexCv');
const I_MO_FMIN = ii('mo.fmIn');
const I_MO_FMLVL = ii('mo.fmLevelCv');
const I_CO_PITCH = ii('co.pitchCv');
const I_CO_TIMBRE = ii('co.timbreCv');
const I_LPG1_IN = ii('lpg1.in');
const I_LPG2_IN = ii('lpg2.in');
const I_LPG1_CV = ii('lpg1.cv');
const I_LPG2_CV = ii('lpg2.cv');

// Schmitt-trigger slots
const TRG_PULSER = 0;
const TRG_SEQ = 1;
const TRG_ENV = 2;
const TRG_RAND = 3;

const PULSE_WIDTH = 0.004; // seconds
const ENV_CV_SCALE = 0.35; // full cv at full depth = ~x23 time change

/** Cheap tanh-like soft clipper (Padé), exactly +/-1 beyond +/-3. */
export function softclip(x) {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function polyblep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

function besselI0(x) {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}

/** Kaiser-windowed sinc low-pass for decimating from os*fs down to fs. */
export function designDecimator(os) {
  const L = 24 * os + 1;
  const M = (L - 1) / 2;
  const fc = 0.45 / os; // cycles per (oversampled) sample
  const beta = 7.5;
  const h = new Float64Array(L);
  const i0b = besselI0(beta);
  let sum = 0;
  for (let n = 0; n < L; n++) {
    const m = n - M;
    const sinc = m === 0 ? 2 * fc : Math.sin(TAU * fc * m) / (Math.PI * m);
    const r = m / M;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    h[n] = sinc * w;
    sum += h[n];
  }
  for (let n = 0; n < L; n++) h[n] /= sum;
  return h;
}

class Decimator {
  constructor(os) {
    this.h = designDecimator(os);
    this.L = this.h.length;
    this.buf = new Float64Array(this.L * 2);
    this.pos = 0;
  }
  reset() {
    this.buf.fill(0);
    this.pos = 0;
  }
  push(x) {
    this.buf[this.pos] = x;
    this.buf[this.pos + this.L] = x;
    this.pos = this.pos + 1 === this.L ? 0 : this.pos + 1;
  }
  out() {
    // Taps are symmetric, so ordering within the window doesn't matter.
    const h = this.h;
    const b = this.buf;
    const p = this.pos;
    let acc = 0;
    for (let i = 0; i < this.L; i++) acc += h[i] * b[p + i];
    return acc;
  }
}

/**
 * Spring reverb: two "springs", each a recirculating delay whose loop runs
 * through a chain of stretched first-order allpasses (the dispersion that
 * gives springs their drippy chirp) and a damping low-pass.
 */
export class SpringReverb {
  constructor(sr) {
    this.sr = sr;
    const make = (ms, stages, a, K) => ({
      len: Math.max(8, Math.round((sr * ms) / 1000)),
      buf: new Float32Array(Math.max(8, Math.round((sr * ms) / 1000))),
      w: 0,
      a,
      K,
      n: stages,
      xh: new Float64Array(stages * K),
      yh: new Float64Array(stages * K),
      p: 0,
      lp: 0,
    });
    this.springs = [make(37, 12, -0.62, 3), make(49.5, 12, -0.56, 4)];
    this.hpR = Math.exp((-TAU * 160) / sr);
    this.damp = 1 - Math.exp((-TAU * 4200) / sr);
    this.fb = 0.8;
    this.reset();
  }
  reset() {
    this.hpX = 0;
    this.hpY = 0;
    for (const s of this.springs) {
      s.buf.fill(0);
      s.xh.fill(0);
      s.yh.fill(0);
      s.w = 0;
      s.p = 0;
      s.lp = 0;
    }
  }
  process(x) {
    const hp = x - this.hpX + this.hpR * this.hpY;
    this.hpX = x;
    this.hpY = hp;
    const damp = this.damp;
    const fb = this.fb;
    let out = 0;
    for (let k = 0; k < 2; k++) {
      const s = this.springs[k];
      let y = s.buf[s.w];
      const a = s.a;
      const K = s.K;
      const p = s.p;
      const xh = s.xh;
      const yh = s.yh;
      for (let i = 0, j = p; i < s.n; i++, j += K) {
        const o = a * y + xh[j] - a * yh[j];
        xh[j] = y;
        yh[j] = o;
        y = o;
      }
      s.p = p + 1 === K ? 0 : p + 1;
      s.lp += (y - s.lp) * damp;
      s.buf[s.w] = hp * 0.6 + fb * s.lp;
      s.w = s.w + 1 === s.len ? 0 : s.w + 1;
      out += s.lp;
    }
    return out * 0.5;
  }
}

export class EaselEngine {
  constructor(sampleRate, oversample = 2) {
    this.sr = sampleRate;
    this.nP = PARAMS.length;
    this.pv = new Float64Array(this.nP); // smoothed values
    this.pt = new Float64Array(this.nP); // targets
    this.continuous = Int32Array.from(PARAMS.map((p, i) => (isContinuous(p) ? i : -1)).filter((i) => i >= 0));
    PARAMS.forEach((p, i) => {
      this.pv[i] = p.def;
      this.pt[i] = p.def;
    });
    this.smoothCoef = 1 - Math.exp(-1 / (0.012 * sampleRate));

    this.O = new Float64Array(OUTPUTS.length);
    this.inSrc = INPUTS.map(() => new Int32Array(0));
    this.inN = new Int32Array(INPUTS.length);

    this.reverb = new SpringReverb(sampleRate);
    this.seed = 0x2545f491;
    this.randCoef = 1;
    this.detRel = 0.001;
    this.setOversampling(oversample);
    this.reset();
    this.resetMeters();
  }

  // ---------------------------------------------------------------- control
  setOversampling(os) {
    let n = Math.round(Number(os)) || 1;
    n = n >= 4 ? 4 : n >= 2 ? 2 : 1;
    if (this.sr >= 88000) n = 1; // already plenty of headroom
    this.os = n;
    this.fs = this.sr * n;
    this.dt = 1 / this.fs;
    this.decA = n > 1 ? new Decimator(n) : null;
    this.decB = n > 1 ? new Decimator(n) : null;
    this.seqSlew = 1 - Math.exp(-this.dt / 0.0006);
    this.detAtk = 1 - Math.exp(-this.dt / 0.005);
    this.vacAtk = 1 - Math.exp(-this.dt / 0.0025);
    this.preHpR = Math.exp((-TAU * 30) / this.fs);
    this.vcaG = Math.tan((Math.PI * Math.min(18000, 0.45 * this.fs)) / this.fs);
    this.maxCut = 0.45 * this.fs;
  }

  setParam(id, value) {
    const i = typeof id === 'number' ? id : PARAM_INDEX[id];
    if (i === undefined || i < 0 || i >= this.nP) return false;
    const v = sanitizeParam(PARAMS[i].id, value);
    this.pt[i] = v;
    if (!isContinuous(PARAMS[i])) this.pv[i] = v;
    return true;
  }

  setParams(values) {
    for (const id of Object.keys(values)) this.setParam(id, values[id]);
  }

  /** Jump smoothed values to their targets (used after loading a patch offline). */
  settleParams() {
    this.pv.set(this.pt);
  }

  /**
   * @param {Array<{outs: string[], ins: string[]}>} nets
   * Each input on a net hears the mean of the net's outputs.
   */
  setPatch(nets) {
    const src = INPUTS.map(() => []);
    for (const net of nets || []) {
      const outs = (net.outs || []).map((id) => OUT_INDEX[id]).filter((i) => i !== undefined);
      if (!outs.length) continue;
      for (const id of net.ins || []) {
        const i = IN_INDEX[id];
        if (i !== undefined) src[i] = outs;
      }
    }
    this.inSrc = src.map((a) => Int32Array.from(a));
    this.inN = Int32Array.from(src.map((a) => a.length));
  }

  /** Manual start pulse for the pulser (restarts its cycle). */
  kick() {
    this.pStart = true;
  }

  reset() {
    this.O.fill(0);
    this.trg = new Uint8Array(4);
    // pulser
    this.pPhase = 0;
    this.pRunning = false;
    this.pPulseT = 0;
    this.pStart = true;
    // sequencer
    this.sStage = 0;
    this.sCv = this.pt[SEQ_S[0]];
    this.sPulseT = 0;
    this.sSinceClock = 1;
    // envelope
    this.eLvl = 0;
    this.eStage = 0;
    this.eHold = 0;
    // random
    this.rT1 = this.rnd();
    this.rT2 = this.rnd();
    this.r1 = this.rT1;
    this.r2 = this.rT2;
    // preamp / detector
    this.preX = 0;
    this.preY = 0;
    this.det = 0;
    // oscillators
    this.moPh = 0;
    this.coPh = 0;
    // gates: vactrol state, svf integrators
    this.v1 = this.pt[L1_LEVEL];
    this.v2 = this.pt[L2_LEVEL];
    this.s1a = 0;
    this.s1b = 0;
    this.s2a = 0;
    this.s2b = 0;
    // output
    this.dcXL = 0;
    this.dcYL = 0;
    this.dcXR = 0;
    this.dcYR = 0;
    this.limEnv = 0;
    this.lastA = 0;
    this.lastB = 0;
    this.reverb.reset();
    if (this.decA) {
      this.decA.reset();
      this.decB.reset();
    }
  }

  resetMeters() {
    this.m = {
      pulse: 0,
      seqPulse: 0,
      ramp: 0,
      stage: 0,
      env: 0,
      r1: 0,
      r2: 0,
      det: 0,
      v1: 0,
      v2: 0,
      peak: 0,
      limit: 0,
      recovered: 0,
    };
  }

  /** Snapshot of panel-LED values since the last call. */
  takeMeters() {
    const m = this.m;
    m.stage = this.sStage;
    m.ramp = this.O[O_RAMP];
    m.r1 = this.O[O_R1];
    m.r2 = this.O[O_R2];
    const out = { ...m };
    this.resetMeters();
    return out;
  }

  // ---------------------------------------------------------------- helpers
  rnd() {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s | 0;
    return (s >>> 0) / 4294967296;
  }

  readIn(i) {
    const src = this.inSrc[i];
    const O = this.O;
    if (src.length === 1) return O[src[0]];
    let s = 0;
    for (let k = 0; k < src.length; k++) s += O[src[k]];
    return s / src.length;
  }

  /** Patched jack if present, otherwise the selected bus source. */
  modSource(input, sel) {
    return this.inN[input] ? this.readIn(input) : this.O[BUS[sel | 0]];
  }

  edge(slot, x) {
    const t = this.trg;
    if (t[slot] === 0) {
      if (x > 0.5) {
        t[slot] = 1;
        return true;
      }
    } else if (x < 0.25) t[slot] = 0;
    return false;
  }

  // ---------------------------------------------------------------- per tick
  tick() {
    const O = this.O;
    const pv = this.pv;
    const dt = this.dt;
    const inN = this.inN;

    // ===== Pulser =======================================================
    {
      let trig = 0;
      if (inN[I_PULSER_TRIG]) trig = this.readIn(I_PULSER_TRIG);
      else if (pv[PULSER_TRIG] === 1) trig = O[O_SEQ_PULSE];
      const triggered = this.edge(TRG_PULSER, trig);
      const listening = inN[I_PULSER_TRIG] || pv[PULSER_TRIG] === 1;
      const once = pv[PULSER_MODE] === 1;
      const pos = pv[PULSER_PERIOD] + pv[PULSER_MOD] * MOD_SCALE.pulserPeriod * this.modSource(I_PULSER_CV, pv[PULSER_MODSRC]);
      const period = curves.pulserPeriod(pos);

      if ((triggered && listening) || this.pStart) {
        this.pStart = false;
        this.pPhase = 0;
        this.pRunning = true;
      }
      if (!once) this.pRunning = true; // cycle mode always runs; triggers resync it
      if (this.pRunning) {
        this.pPhase += dt / period;
        if (this.pPhase >= 1) {
          // pulse at the *end* of each period, so a one-shot pulser is a delay
          this.pPulseT = Math.min(PULSE_WIDTH, period * 0.5);
          if (once) {
            this.pPhase = 1;
            this.pRunning = false;
          } else this.pPhase -= Math.floor(this.pPhase);
        }
      }
      O[O_RAMP] = this.pRunning ? 1 - this.pPhase : 0;
      O[O_PULSE] = this.pPulseT > 0 ? 1 : 0;
      if (this.pPulseT > 0) this.pPulseT -= dt;
    }

    // ===== Sequential voltage source =====================================
    {
      let clock = 0;
      if (inN[I_SEQ_CLOCK]) clock = this.readIn(I_SEQ_CLOCK);
      else if (pv[SEQ_CLOCK] === 0) clock = O[O_PULSE];
      const n = 3 + pv[SEQ_STAGES];
      if (this.sStage >= n) this.sStage = 0;
      this.sSinceClock += dt;
      if (this.edge(TRG_SEQ, clock)) {
        this.sStage = this.sStage + 1 >= n ? 0 : this.sStage + 1;
        if (pv[SEQ_P[this.sStage]] === 0) this.sPulseT = Math.min(PULSE_WIDTH, this.sSinceClock * 0.5);
        this.sSinceClock = 0;
      }
      this.sCv += (pv[SEQ_S[this.sStage]] - this.sCv) * this.seqSlew;
      O[O_SEQ_CV] = this.sCv;
      O[O_SEQ_PULSE] = this.sPulseT > 0 ? 1 : 0;
      if (this.sPulseT > 0) this.sPulseT -= dt;
    }

    // ===== Envelope generator ===========================================
    {
      let trig;
      if (inN[I_ENV_TRIG]) trig = this.readIn(I_ENV_TRIG);
      else trig = pv[ENV_TRIG] === 0 ? O[O_PULSE] : O[O_SEQ_PULSE];
      const triggered = this.edge(TRG_ENV, trig);
      const gate = this.trg[TRG_ENV] === 1;
      const mode = pv[ENV_MODE]; // 0 trans, 1 sust, 2 self
      const depth = pv[ENV_CVDEPTH];
      // self mode free-runs; only a patched trigger jack can resync it
      if (triggered && (mode !== 2 || inN[I_ENV_TRIG])) this.eStage = 1;
      if (mode === 2 && this.eStage === 0) this.eStage = 1;
      if (this.eStage === 1) {
        const pos = pv[ENV_A] + (inN[I_ENV_ACV] ? depth * ENV_CV_SCALE * this.readIn(I_ENV_ACV) : 0);
        const k = (1.466 * dt) / curves.envTime(pos);
        // analog-style: chase 1.3, arrive at 1.0 after the attack time
        this.eLvl += (1.3 - this.eLvl) * (k > 1 ? 1 : k);
        if (this.eLvl >= 1) {
          this.eLvl = 1;
          this.eStage = mode === 0 ? 3 : 2;
          this.eHold = 0;
        }
      } else if (this.eStage === 2) {
        const pos = pv[ENV_S] + (inN[I_ENV_SCV] ? depth * ENV_CV_SCALE * this.readIn(I_ENV_SCV) : 0);
        this.eHold += dt;
        if (this.eHold >= curves.envTime(pos) && !(mode === 1 && gate)) this.eStage = 3;
      } else if (this.eStage === 3) {
        const pos = pv[ENV_D] + (inN[I_ENV_DCV] ? depth * ENV_CV_SCALE * this.readIn(I_ENV_DCV) : 0);
        const k = (2.398 * dt) / curves.envTime(pos);
        // chase -0.1, arrive at 0 after the decay time
        this.eLvl += (-0.1 - this.eLvl) * (k > 1 ? 1 : k);
        if (this.eLvl <= 0) {
          this.eLvl = 0;
          this.eStage = 0;
        }
      }
      O[O_ENV] = this.eLvl;
    }

    // ===== Random voltage source ========================================
    {
      let trig;
      if (inN[I_RAND_TRIG]) trig = this.readIn(I_RAND_TRIG);
      else trig = pv[RAND_TRIG] === 0 ? O[O_PULSE] : O[O_SEQ_PULSE];
      if (this.edge(TRG_RAND, trig)) {
        this.rT1 = this.rnd();
        this.rT2 = this.rnd();
      }
      const c = this.randCoef;
      this.r1 += (this.rT1 - this.r1) * c;
      this.r2 += (this.rT2 - this.r2) * c;
      O[O_R1] = this.r1;
      O[O_R2] = this.r2;
    }

    // ===== Preamp / envelope detector ===================================
    {
      let x;
      if (inN[I_PRE_IN]) x = this.readIn(I_PRE_IN);
      else x = pv[PRE_EMPTY] === 0 ? (this.rnd() * 2 - 1) * 0.35 : 0;
      // a whisper of analog noise floor, so feedback loops can start from silence
      x += (this.rnd() - 0.5) * 2e-5;
      // AC coupling
      const hp = x - this.preX + this.preHpR * this.preY;
      this.preX = x;
      this.preY = hp;
      const y = softclip(curves.preGain(pv[PRE_GAIN]) * hp);
      O[O_PRE] = y;
      const r = y < 0 ? -y : y;
      this.det += (r - this.det) * (r > this.det ? this.detAtk : this.detRel);
      // scaled so a full-scale sine reads ~1
      O[O_DET] = this.det * 1.57;
    }

    // ===== Inverter =====================================================
    O[O_INV_A] = inN[I_INV_A] ? -this.readIn(I_INV_A) : 0;
    O[O_INV_B] = inN[I_INV_B] ? -this.readIn(I_INV_B) : 0;

    // ===== Modulation oscillator ========================================
    let index;
    {
      const pos = pv[MO_FREQ] + pv[MO_FMOD] * MOD_SCALE.moFreq * this.modSource(I_MO_FREQ, pv[MO_FMODSRC]);
      let f = (pv[MO_RANGE] === 0 ? curves.moHigh(pos) : curves.moLow(pos)) * curves.fine(pv[MO_FINE]);
      if (inN[I_MO_FMIN]) {
        // audio-rate f.m. input: linear through-zero FM, soft-clipped so chaos stays bounded
        let lvl = pv[MO_FMLEVEL] + (inN[I_MO_FMLVL] ? 0.5 * this.readIn(I_MO_FMLVL) : 0);
        lvl = lvl < 0 ? 0 : lvl > 1.2 ? 1.2 : lvl;
        f *= 1 + 3 * lvl * softclip(1.5 * this.readIn(I_MO_FMIN));
      }
      if (f > 20000) f = 20000;
      else if (f < -20000) f = -20000;
      let ph = this.moPh + f * dt;
      ph -= Math.floor(ph);
      this.moPh = ph;
      const inc = f * dt < 0 ? -f * dt : f * dt;
      const wave = pv[MO_WAVE];
      let w;
      if (wave === 0) {
        w = 2 * ph - 1 - (inc < 0.5 ? polyblep(ph, inc) : 0);
      } else if (wave === 1) {
        w = ph < 0.5 ? 1 : -1;
        if (inc < 0.5) {
          const ph2 = ph + 0.5 >= 1 ? ph - 0.5 : ph + 0.5;
          w += polyblep(ph, inc) - polyblep(ph2, inc);
        }
      } else {
        w = 1 - 4 * Math.abs(ph - 0.5);
      }
      O[O_MO] = w;
      index = pv[MO_INDEX] + pv[MO_IMOD] * MOD_SCALE.moIndex * this.modSource(I_MO_INDEX, pv[MO_IMODSRC]);
      index = index < 0 ? 0 : index > 1.25 ? 1.25 : index;
    }

    // ===== Complex oscillator ===========================================
    {
      const pol = pv[CO_POL] === 0 ? 1 : -1;
      const pos = pv[CO_PITCH] + pol * pv[CO_PMOD] * MOD_SCALE.coPitch * this.modSource(I_CO_PITCH, pv[CO_PMODSRC]);
      let f = curves.coFreq(pos) * curves.fine(pv[CO_FINE]);
      const mode = pv[MO_MODE]; // 0 off, 1 fm, 2 am, 3 ring
      const mo = O[O_MO];
      if (mode === 1) f *= 1 + 3.5 * index * mo; // linear through-zero FM
      if (f > 20000) f = 20000;
      else if (f < -20000) f = -20000;
      let ph = this.coPh + f * dt;
      ph -= Math.floor(ph);
      this.coPh = ph;
      const s = Math.sin(TAU * ph);
      const wave = pv[CO_WAVE];
      let b;
      if (wave === 0) b = s;
      else if (wave === 1) {
        const q = ph + 0.75 >= 1 ? ph - 0.25 : ph + 0.75;
        b = 4 * Math.abs(q - 0.5) - 1;
      } else if (wave === 2) b = softclip(4 * s);
      else {
        const s2 = s * s;
        b = s2 * s2 * s2 * s; // s^7: narrow spikes
      }
      let t = pv[CO_TIMBRE] + pol * pv[CO_TMOD] * MOD_SCALE.coTimbre * this.modSource(I_CO_TIMBRE, pv[CO_TMODSRC]);
      t = t < 0 ? 0 : t > 1.25 ? 1.25 : t;
      let y = b;
      if (t > 0) {
        // sine wavefolder; low timbre stays close to the pure base wave
        const folded = Math.sin(HALF_PI * (1 + 10 * t * t) * b);
        const mix = t * 5 > 1 ? 1 : t * 5;
        // the timbre circuit adds harmonics, so brighter is also louder
        y = (b + mix * (folded - b)) * (1 + 0.6 * t);
      }
      if (mode === 2) y *= (1 + index * mo) / (1 + index);
      else if (mode === 3) y *= 1 - index + index * mo;
      O[O_CO] = y;
    }

    // ===== Dual lopass gate =============================================
    {
      const x1 = inN[I_LPG1_IN] ? this.readIn(I_LPG1_IN) : O[O_CO];
      let c1 = pv[L1_LEVEL] + pv[L1_MOD] * MOD_SCALE.lpgLevel * this.modSource(I_LPG1_CV, pv[L1_MODSRC]);
      c1 = c1 < 0 ? 0 : c1 > 1.2 ? 1.2 : c1;
      this.v1 = this.vactrol(this.v1, c1);
      O[O_LPG1] = this.gate(0, x1, this.v1, pv[L1_MODE]);

      let x2;
      if (inN[I_LPG2_IN]) x2 = this.readIn(I_LPG2_IN);
      else {
        const src = pv[L2_SRC];
        // gate 2 is wired 180 degrees out of phase with gate 1
        x2 = src === 0 ? O[O_MO] : src === 1 ? O[O_PRE] : -O[O_LPG1];
      }
      let c2 = pv[L2_LEVEL] + pv[L2_MOD] * MOD_SCALE.lpgLevel * this.modSource(I_LPG2_CV, pv[L2_MODSRC]);
      c2 = c2 < 0 ? 0 : c2 > 1.2 ? 1.2 : c2;
      this.v2 = this.vactrol(this.v2, c2);
      O[O_LPG2] = this.gate(1, x2, this.v2, pv[L2_MODE]);
    }
  }

  /** Asymmetric vactrol slew: fast on, slow and darkening off. */
  vactrol(v, target) {
    if (target > v) return v + (target - v) * this.vacAtk;
    const tau = 0.04 + 0.16 * (1 - (v > 1 ? 1 : v));
    const k = this.dt / tau;
    return v + (target - v) * (k > 1 ? 1 : k);
  }

  /** One lopass gate: 2-pole TPT state-variable low-pass + amplitude. */
  gate(ch, x, v, mode) {
    let amp;
    let g;
    if (mode === 2) {
      amp = 1;
    } else {
      amp = v * Math.sqrt(v);
    }
    if (mode === 0) g = this.vcaG;
    else {
      let cut = curves.lpgCutoff(v);
      if (cut > this.maxCut) cut = this.maxCut;
      g = Math.tan((Math.PI * cut) / this.fs);
    }
    // damping: VCA flat, combo gentle, lowpass mode with a slight resonant hump
    const k = mode === 2 ? 0.65 : mode === 1 ? 1.1 : 1.3;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    let ic1 = ch === 0 ? this.s1a : this.s2a;
    let ic2 = ch === 0 ? this.s1b : this.s2b;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    if (ch === 0) {
      this.s1a = ic1;
      this.s1b = ic2;
    } else {
      this.s2a = ic1;
      this.s2b = ic2;
    }
    return v2 * amp;
  }

  // ---------------------------------------------------------------- block
  /**
   * Render `frames` samples into outL/outR (Float32Array).
   */
  process(outL, outR, frames) {
    const pv = this.pv;
    const pt = this.pt;
    const cont = this.continuous;
    const sc = this.smoothCoef;
    const os = this.os;
    const O = this.O;
    const m = this.m;
    const decA = this.decA;
    const decB = this.decB;

    for (let n = 0; n < frames; n++) {
      // parameter smoothing (per output sample)
      for (let k = 0; k < cont.length; k++) {
        const i = cont[k];
        pv[i] += (pt[i] - pv[i]) * sc;
      }
      // per-sample coefficients that depend only on params
      const slew = curves.randSlew(pv[RAND_SLEW]);
      this.randCoef = slew === 0 ? 1 : 1 - Math.exp(-this.dt / (slew / 3));
      this.detRel = 1 - Math.exp(-this.dt / curves.detRelease(pv[PRE_SPEED]));

      const ga = pv[OUT_A];
      const gb = pv[OUT_B];
      let a;
      let b;
      if (os > 1) {
        for (let k = 0; k < os; k++) {
          this.tick();
          decA.push(O[O_LPG1] * ga);
          decB.push(O[O_LPG2] * gb);
        }
        a = decA.out();
        b = decB.out();
      } else {
        this.tick();
        a = O[O_LPG1] * ga;
        b = O[O_LPG2] * gb;
      }

      // ----- output section (base rate)
      const amt = pv[OUT_REV];
      const mono = a + b;
      const wet = this.reverb.process(mono) * amt * 1.4;
      const dry = 1 - 0.35 * amt;
      const mix = mono * dry + wet;
      O[O_MIX] = softclip(mix); // mix out tap (pre-master) for patching back in

      let L;
      let R;
      if (pv[OUT_STEREO] === 1) {
        L = (a + 0.25 * b) * dry + wet;
        R = (b + 0.25 * a) * dry + wet;
      } else {
        L = mix;
        R = mix;
      }
      const mg = curves.master(pv[OUT_MASTER]);
      L *= mg;
      R *= mg;

      // DC blocker
      const yl = L - this.dcXL + 0.9995 * this.dcYL;
      this.dcXL = L;
      this.dcYL = yl;
      const yr = R - this.dcXR + 0.9995 * this.dcYR;
      this.dcXR = R;
      this.dcYR = yr;
      L = yl;
      R = yr;

      // Peak limiter (instant attack, ~120 ms release) + final soft clip
      const pk = Math.max(L < 0 ? -L : L, R < 0 ? -R : R);
      if (pk > this.limEnv) this.limEnv = pk;
      else this.limEnv += (pk - this.limEnv) * 0.0002;
      let gain = 1;
      if (this.limEnv > 0.8) {
        gain = 0.8 / this.limEnv;
        if (1 - gain > m.limit) m.limit = 1 - gain;
      }
      L = softclip(L * gain * 1.1) * 0.9;
      R = softclip(R * gain * 1.1) * 0.9;

      if (!(L > -2 && L < 2 && R > -2 && R < 2)) {
        // NaN/Inf escaped somewhere: rebuild the instrument's state, keep going
        this.reset();
        m.recovered = 1;
        L = 0;
        R = 0;
      }
      outL[n] = L;
      outR[n] = R;

      // meters
      if (O[O_PULSE] > m.pulse) m.pulse = O[O_PULSE];
      if (O[O_SEQ_PULSE] > m.pulse) m.seqPulse = 1;
      if (O[O_ENV] > m.env) m.env = O[O_ENV];
      if (O[O_DET] > m.det) m.det = O[O_DET];
      if (this.v1 > m.v1) m.v1 = this.v1;
      if (this.v2 > m.v2) m.v2 = this.v2;
      if (pk > m.peak) m.peak = pk;
    }
  }
}
