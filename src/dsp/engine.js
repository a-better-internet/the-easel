// The whole 208C sound source as a single per-sample engine.
//
// Why one engine instead of a graph of Web Audio nodes: Web Audio feedback
// cycles need a DelayNode of at least one render quantum (128 samples), which
// smears audio-rate loops. Here every section is evaluated once per
// (oversampled) tick and patch cables read the most recent value of their
// source, so a loop such as c.osc -> f.m. in -> complex oscillator has a
// one-tick delay, close to hardware.
//
// Signal levels: audio roughly -1..1; control voltages 0..1 (the inverter makes
// them negative); internal pulses are 0/1 with ~4 ms width.

import { PARAMS, PARAM_INDEX, INPUTS, IN_INDEX, JACK_BY_ID, SIGNALS, SIGNAL_INDEX, PREAMP_GAIN, CV, curves, isContinuous, sanitizeParam } from '../spec.js';
import { softclip, polyblep, Decimator, SpringReverb } from './blocks.js';

export { softclip, designDecimator } from './blocks.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const pi = (id) => {
  const i = PARAM_INDEX[id];
  if (i === undefined) throw new Error(`unknown param ${id}`);
  return i;
};
const si = (id) => {
  const i = SIGNAL_INDEX[id];
  if (i === undefined) throw new Error(`unknown signal ${id}`);
  return i;
};
const ii = (id) => {
  const i = IN_INDEX[id];
  if (i === undefined) throw new Error(`unknown input ${id}`);
  return i;
};

// Parameters ------------------------------------------------------------------
const SEQ_S = [1, 2, 3, 4, 5].map((n) => pi(`seq.s${n}`));
const SEQ_P = [1, 2, 3, 4, 5].map((n) => pi(`seq.p${n}`));
const SEQ_TRIG = pi('seq.trig');
const SEQ_STAGES = pi('seq.stages');
const RAND_TRIG = pi('rand.trig');
const ENV_TRIG = pi('env.trig');
const ENV_MODE = pi('env.mode');
const ENV_A = pi('env.attack');
const ENV_S = pi('env.sustain');
const ENV_D = pi('env.decay');
const PULSER_TRIG = pi('pulser.trig');
const PULSER_MODE = pi('pulser.mode');
const PULSER_CV = pi('pulser.periodCv');
const PULSER_PERIOD = pi('pulser.period');
const MO_FMLEVEL = pi('mo.fmLevel');
const MO_WAVE = pi('mo.wave');
const MO_RANGE = pi('mo.range');
const MO_FINE = pi('mo.fine');
const MO_MODE = pi('mo.mode');
const MO_FREQCV = pi('mo.freqCv');
const MO_FREQ = pi('mo.freq');
const MO_INDEXCV = pi('mo.indexCv');
const MO_INDEX = pi('mo.index');
const CO_POL = pi('co.polarity');
const CO_FINE = pi('co.fine');
const CO_SHAPE = pi('co.shape');
const CO_WAVE = pi('co.wave');
const CO_PITCHCV = pi('co.pitchCv');
const CO_PITCH = pi('co.pitch');
const CO_TIMBRECV = pi('co.timbreCv');
const CO_TIMBRE = pi('co.timbre');
const LPG_SRC = pi('lpg.src');
const L1_MODE = pi('lpg1.mode');
const L2_MODE = pi('lpg2.mode');
const L1_CV = pi('lpg1.levelCv');
const L1_LEVEL = pi('lpg1.level');
const L2_CV = pi('lpg2.levelCv');
const L2_LEVEL = pi('lpg2.level');
const PRE_GAIN = pi('pre.gain');
const OUT_A = pi('out.a');
const OUT_B = pi('out.b');
const OUT_REV = pi('out.reverb');
const OUT_MONITOR = pi('out.monitor');
const OUT_MASTER = pi('out.master');

// Signals -----------------------------------------------------------------------
const S_SEQ = si('seq');
const S_SEQ_PULSE = si('seq.pulse');
const S_ENV = si('env');
const S_PULSER = si('pulser');
const S_PULSE = si('pulser.pulse');
const S_RAND = si('rand');
const S_PRE = si('pre');
const S_PRE_ENV = si('pre.env');
const S_INV = si('inv');
const S_MO = si('mo');
const S_MO_MOD = si('mo.mod');
const S_MO_G2 = si('mo.g2');
const S_CO = si('co');
const S_LPG1 = si('lpg1');
const S_LPG2 = si('lpg2');
const S_MIX = si('mix');

// Inputs ------------------------------------------------------------------------
const I_MO_FREQ_IN = ii('mo.freqIn');
const I_ATTACK = ii('env.attackCv');
const I_SUSTAIN = ii('env.sustainCv');
const I_DECAY = ii('env.decayCv');
const I_PERIOD = ii('pulser.periodCv');
const I_MO_FREQ = ii('mo.freqCv');
const I_MO_INDEX = ii('mo.indexCv');
const I_CO_PITCH = ii('co.pitchCv');
const I_CO_TIMBRE = ii('co.timbreCv');
const I_CO_WS = ii('co.wsCv');
const I_LPG1_CV = ii('lpg1.cv');
const I_LPG2_CV = ii('lpg2.cv');
const I_INV = ii('inv.in');
const I_FM_IN = ii('mo.fmIn');
const I_LPG1_IN = ii('lpg1.in');
const I_PRE_IN = ii('pre.in');

// Schmitt-trigger slots
const TRG_PULSER = 0;
const TRG_PULSER_EXT = 1;
const TRG_SEQ = 2;
const TRG_ENV = 3;
const TRG_RAND = 4;

const PULSE_WIDTH = 0.004; // seconds
// Linear FM never drives an oscillator below this fraction of its frequency.
// Like an analog VCO it can't stop or run backwards, so the c.o. <-> m.o.
// loop can lurch and lock but never freezes into silent DC.
const FM_FLOOR = 0.03;
const ALIGN = 12; // decimator group delay, in base-rate samples

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

    this.O = new Float64Array(SIGNALS.length);
    this.inSrc = INPUTS.map(() => new Int32Array(0));
    this.inN = new Int32Array(INPUTS.length);

    this.reverb = new SpringReverb(sampleRate);
    this.seed = 0x2545f491;
    this.detRel = 1 - Math.exp(-1 / (0.15 * sampleRate));
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
    // The decimator delays the output by 12 base samples at any oversampling
    // factor. Without oversampling, a matching delay keeps every master-out
    // feedback loop identical across quality settings.
    this.alignA = new Float64Array(ALIGN);
    this.alignB = new Float64Array(ALIGN);
    this.alignPos = 0;
    this.seqSlew = 1 - Math.exp(-this.dt / 0.0006);
    this.detAtk = 1 - Math.exp(-this.dt / 0.005);
    this.detRel = 1 - Math.exp(-this.dt / 0.15);
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
    for (const id of Object.keys(values || {})) this.setParam(id, values[id]);
  }

  /** Jump smoothed values to their targets (used after loading a patch offline). */
  settleParams() {
    this.pv.set(this.pt);
  }

  /**
   * @param {Array<{outs: string[], ins: string[]}>} nets  jack ids per net
   * Each input on a net hears the mean of the net's distinct output signals.
   */
  setPatch(nets) {
    const src = INPUTS.map(() => []);
    for (const net of nets || []) {
      const sigs = new Set();
      for (const id of net?.outs || []) {
        const j = JACK_BY_ID[id];
        if (j && j.dir === 'out') sigs.add(SIGNAL_INDEX[j.signal]);
      }
      if (!sigs.size) continue;
      const outs = [...sigs];
      for (const id of net.ins || []) {
        const i = IN_INDEX[id];
        if (i !== undefined) src[i] = outs;
      }
    }
    this.inSrc = src.map((a) => Int32Array.from(a));
    this.inN = Int32Array.from(src.map((a) => a.length));
  }

  /** The pulser's "one" button. */
  one() {
    this.pOne = true;
  }

  reset() {
    this.O.fill(0);
    this.trg = new Uint8Array(5);
    // pulser
    this.pPhase = 0;
    this.pRunning = false;
    this.pPulseT = 0;
    this.pStart = true; // power-on pulse (lets a transient, self-triggered program start)
    this.pOne = false;
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
    this.rVal = this.rnd();
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
    this.dcXT = 0;
    this.dcYT = 0;
    this.limEnv = 0;
    this.reverb.reset();
    if (this.decA) {
      this.decA.reset();
      this.decB.reset();
    }
    this.alignA.fill(0);
    this.alignB.fill(0);
  }

  resetMeters() {
    this.m = { pulse: 0, seqPulse: 0, stage: 0, env: 0, rand: 0, det: 0, v1: 0, v2: 0, peak: 0, limit: 0, recovered: 0 };
  }

  /** Snapshot of panel-LED values since the last call. */
  takeMeters() {
    const m = this.m;
    m.stage = this.sStage;
    m.rand = this.O[S_RAND];
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

  /** Patched value of a CV input, or 0 when nothing is plugged in. */
  cv(i) {
    return this.inN[i] ? this.readIn(i) : 0;
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

    // ===== Pulser =====================================================
    {
      const mode = pv[PULSER_MODE]; // 0 sustnd, 1 trans, 2 off-ext
      let fire = this.pOne;
      this.pOne = false;
      if (mode === 2) {
        // off-ext: the internal clock is off; pulses at the period cv jack drive it
        if (this.edge(TRG_PULSER_EXT, this.cv(I_PERIOD))) fire = true;
        this.pStart = false;
        if (fire) {
          this.pPulseT = PULSE_WIDTH;
          this.pPhase = 0;
          this.pRunning = true;
        }
        if (this.pRunning) {
          this.pPhase += dt / curves.time(pv[PULSER_PERIOD]);
          if (this.pPhase >= 1) {
            this.pPhase = 1;
            this.pRunning = false;
          }
        }
      } else {
        const period = curves.time(pv[PULSER_PERIOD] + pv[PULSER_CV] * CV.amount * this.cv(I_PERIOD));
        if (pv[PULSER_TRIG] === 1 && this.edge(TRG_PULSER, O[S_SEQ_PULSE])) fire = true;
        if (this.pStart) {
          this.pStart = false;
          fire = true;
        }
        if (fire) {
          this.pPhase = 0;
          this.pRunning = true;
        }
        if (mode === 0) this.pRunning = true; // sustained: keeps cycling; triggers resync it
        if (this.pRunning) {
          this.pPhase += dt / period;
          if (this.pPhase >= 1) {
            // pulse at the *end* of each period, so a transient pulser is a delay
            this.pPulseT = Math.min(PULSE_WIDTH, period * 0.5);
            if (mode === 1) {
              this.pPhase = 1;
              this.pRunning = false;
            } else this.pPhase -= Math.floor(this.pPhase);
          }
        }
      }
      O[S_PULSER] = this.pRunning ? 1 - this.pPhase : 0;
      O[S_PULSE] = this.pPulseT > 0 ? 1 : 0;
      if (this.pPulseT > 0) this.pPulseT -= dt;
    }

    // ===== Sequential voltage =========================================
    {
      const n = 3 + pv[SEQ_STAGES];
      if (this.sStage >= n) this.sStage = 0;
      this.sSinceClock += dt;
      if (pv[SEQ_TRIG] === 0 && this.edge(TRG_SEQ, O[S_PULSE])) {
        this.sStage = this.sStage + 1 >= n ? 0 : this.sStage + 1;
        if (pv[SEQ_P[this.sStage]] === 0) this.sPulseT = Math.min(PULSE_WIDTH, this.sSinceClock * 0.5);
        this.sSinceClock = 0;
      }
      this.sCv += (pv[SEQ_S[this.sStage]] - this.sCv) * this.seqSlew;
      O[S_SEQ] = this.sCv;
      O[S_SEQ_PULSE] = this.sPulseT > 0 ? 1 : 0;
      if (this.sPulseT > 0) this.sPulseT -= dt;
    }

    // ===== Envelope generator =========================================
    {
      const trig = pv[ENV_TRIG] === 0 ? O[S_PULSE] : O[S_SEQ_PULSE];
      const triggered = this.edge(TRG_ENV, trig);
      const gate = this.trg[TRG_ENV] === 1;
      const mode = pv[ENV_MODE]; // 0 sustained, 1 transient, 2 self
      if (mode === 2) {
        if (this.eStage === 0) this.eStage = 1; // self-cycling; ignores triggers
      } else if (triggered) this.eStage = 1;
      if (this.eStage === 1) {
        const k = (1.466 * dt) / curves.time(pv[ENV_A] + CV.envTime * this.cv(I_ATTACK));
        // analog-style: chase 1.3, arrive at 1.0 after the attack time
        this.eLvl += (1.3 - this.eLvl) * (k > 1 ? 1 : k);
        if (this.eLvl >= 1) {
          this.eLvl = 1;
          this.eStage = 2;
          this.eHold = 0;
        }
      } else if (this.eStage === 2) {
        this.eHold += dt;
        // sustained: hold while the trigger lasts; transient/self: hold for the sustain time
        const done = mode === 0 ? !gate : this.eHold >= curves.time(pv[ENV_S] + CV.envTime * this.cv(I_SUSTAIN));
        if (done) this.eStage = 3;
      } else if (this.eStage === 3) {
        const k = (2.398 * dt) / curves.time(pv[ENV_D] + CV.envTime * this.cv(I_DECAY));
        // chase -0.1, arrive at 0 after the decay time
        this.eLvl += (-0.1 - this.eLvl) * (k > 1 ? 1 : k);
        if (this.eLvl <= 0) {
          this.eLvl = 0;
          this.eStage = 0;
        }
      }
      O[S_ENV] = this.eLvl;
    }

    // ===== Random voltage =============================================
    {
      const trig = pv[RAND_TRIG] === 0 ? O[S_PULSE] : O[S_SEQ_PULSE];
      if (this.edge(TRG_RAND, trig)) this.rVal = this.rnd();
      O[S_RAND] = this.rVal;
    }

    // ===== Preamp / envelope detector =================================
    {
      let x = this.inN[I_PRE_IN] ? this.readIn(I_PRE_IN) : (this.rnd() * 2 - 1) * 0.35; // noise when empty
      // a whisper of analog noise floor, so feedback loops can start from silence
      x += (this.rnd() - 0.5) * 2e-5;
      const hp = x - this.preX + this.preHpR * this.preY; // AC coupling
      this.preX = x;
      this.preY = hp;
      const y = softclip(PREAMP_GAIN[pv[PRE_GAIN]] * hp);
      O[S_PRE] = y;
      const r = y < 0 ? -y : y;
      this.det += (r - this.det) * (r > this.det ? this.detAtk : this.detRel);
      O[S_PRE_ENV] = this.det * 1.57; // a full-scale sine reads ~1
    }

    // ===== Inverter ===================================================
    O[S_INV] = -this.cv(I_INV);

    // ===== Modulation oscillator ======================================
    let index;
    let mo;
    const moMode = pv[MO_MODE]; // 0 bal. ext, 1 a.m. osc, 2 f.m. osc
    {
      const pos = pv[MO_FREQ] + pv[MO_FREQCV] * CV.amount * this.cv(I_MO_FREQ) + CV.moFreqDirect * this.cv(I_MO_FREQ_IN);
      let f = (pv[MO_RANGE] === 0 ? curves.pitch(pos) : curves.moLow(pos)) * curves.fine(pv[MO_FINE]);
      if (this.inN[I_FM_IN]) {
        // audio-rate f.m. input: linear FM, soft-clipped so chaos stays bounded
        const k = 1 + 3 * pv[MO_FMLEVEL] * softclip(1.5 * this.readIn(I_FM_IN));
        f *= k > FM_FLOOR ? k : FM_FLOOR;
      }
      if (f > 20000) f = 20000;
      else if (f < -20000) f = -20000;
      let ph = this.moPh + f * dt;
      ph -= Math.floor(ph);
      this.moPh = ph;
      const inc = f * dt < 0 ? -f * dt : f * dt;
      const wave = pv[MO_WAVE];
      if (wave === 0) {
        mo = 2 * ph - 1 - (inc < 0.5 ? polyblep(ph, inc) : 0);
      } else if (wave === 1) {
        mo = ph < 0.5 ? 1 : -1;
        if (inc < 0.5) {
          const ph2 = ph + 0.5 >= 1 ? ph - 0.5 : ph + 0.5;
          mo += polyblep(ph, inc) - polyblep(ph2, inc);
        }
      } else {
        mo = 1 - 4 * Math.abs(ph - 0.5);
      }
      O[S_MO] = mo;
      O[S_MO_MOD] = 0.5 * (mo + 1);
      index = pv[MO_INDEX] + pv[MO_INDEXCV] * CV.amount * this.cv(I_MO_INDEX);
      index = index < 0 ? 0 : index > 1.25 ? 1.25 : index;
      // bal. ext: the m.o. balanced-modulates the external (aux / preamp) signal;
      // the result is what gate 2 hears in its "mod osc" position
      O[S_MO_G2] = moMode === 0 ? mo + (index > 1 ? 1 : index) * (mo * O[S_PRE] * 1.5 - mo) : mo;
    }

    // ===== Complex oscillator =========================================
    {
      const pol = pv[CO_POL] === 0 ? -1 : 1;
      const pos = pv[CO_PITCH] + pol * pv[CO_PITCHCV] * CV.amount * this.cv(I_CO_PITCH);
      let f = curves.pitch(pos) * curves.fine(pv[CO_FINE]);
      if (moMode === 2) {
        const k = 1 + 3.5 * index * mo; // linear FM
        f *= k > FM_FLOOR ? k : FM_FLOOR;
      }
      if (f > 20000) f = 20000;
      else if (f < -20000) f = -20000;
      let ph = this.coPh + f * dt;
      ph -= Math.floor(ph);
      this.coPh = ph;
      const s = Math.sin(TAU * ph);
      // waveshape: the knob (plus the w.s. cv) turns from sine to the selected shape
      let shape = pv[CO_SHAPE] + CV.waveshape * this.cv(I_CO_WS);
      shape = shape < 0 ? 0 : shape > 1 ? 1 : shape;
      let b = s;
      if (shape > 0) {
        const wave = pv[CO_WAVE]; // 0 spike, 1 square, 2 tri
        let w;
        if (wave === 0) {
          const s2 = s * s;
          w = s2 * s2 * s2 * s; // s^7: narrow spikes
        } else if (wave === 1) w = softclip(4 * s);
        else {
          const q = ph + 0.75 >= 1 ? ph - 0.25 : ph + 0.75;
          w = 4 * Math.abs(q - 0.5) - 1;
        }
        b = s + shape * (w - s);
      }
      let t = pv[CO_TIMBRE] + pol * pv[CO_TIMBRECV] * CV.amount * this.cv(I_CO_TIMBRE);
      t = t < 0 ? 0 : t > 1.25 ? 1.25 : t;
      let y = b;
      if (t > 0) {
        // sine wavefolder; low timbre stays close to the base wave, and since the
        // timbre circuit adds harmonics, brighter is also louder
        const folded = Math.sin(HALF_PI * (1 + 10 * t * t) * b);
        const mix = t * 5 > 1 ? 1 : t * 5;
        y = (b + mix * (folded - b)) * (1 + 0.6 * t);
      }
      if (moMode === 1) y *= (1 + index * mo) / (1 + index);
      O[S_CO] = y;
    }

    // ===== Dual lo pass gate ==========================================
    {
      const x1 = this.inN[I_LPG1_IN] ? this.readIn(I_LPG1_IN) : O[S_CO];
      let c1 = pv[L1_LEVEL] + pv[L1_CV] * CV.amount * this.cv(I_LPG1_CV);
      c1 = c1 < 0 ? 0 : c1 > 1.2 ? 1.2 : c1;
      this.v1 = this.vactrol(this.v1, c1);
      O[S_LPG1] = this.gate(0, x1, this.v1, pv[L1_MODE]);

      const src = pv[LPG_SRC]; // 0 aux / nse, 1 mod osc, 2 gate 1 (inverted)
      const x2 = src === 0 ? O[S_PRE] : src === 1 ? O[S_MO_G2] : -O[S_LPG1];
      let c2 = pv[L2_LEVEL] + pv[L2_CV] * CV.amount * this.cv(I_LPG2_CV);
      c2 = c2 < 0 ? 0 : c2 > 1.2 ? 1.2 : c2;
      this.v2 = this.vactrol(this.v2, c2);
      O[S_LPG2] = this.gate(1, x2, this.v2, pv[L2_MODE]);
    }
  }

  /** Asymmetric vactrol slew: fast on, slow and darkening off. */
  vactrol(v, target) {
    if (target > v) return v + (target - v) * this.vacAtk;
    const tau = 0.04 + 0.16 * (1 - (v > 1 ? 1 : v));
    const k = this.dt / tau;
    return v + (target - v) * (k > 1 ? 1 : k);
  }

  /** One lopass gate (mode 0 lo pass, 1 combination, 2 vca): 2-pole TPT SVF + amplitude. */
  gate(ch, x, v, mode) {
    const amp = mode === 0 ? 1 : v * Math.sqrt(v);
    let g;
    if (mode === 2) g = this.vcaG;
    else {
      let cut = curves.lpgCutoff(v);
      if (cut > this.maxCut) cut = this.maxCut;
      g = Math.tan((Math.PI * cut) / this.fs);
    }
    // damping: lo pass mode has a slight resonant hump, combination is gentle, vca flat
    const k = mode === 0 ? 0.65 : mode === 1 ? 1.1 : 1.3;
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
   * If `tap` is given it receives master out (DC-blocked, not limited, independent
   * of the monitor level): the line-level signal a recording should capture.
   */
  process(outL, outR, frames, tap = null) {
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
      for (let k = 0; k < cont.length; k++) {
        const i = cont[k];
        pv[i] += (pt[i] - pv[i]) * sc;
      }
      const ga = curves.level(pv[OUT_A]);
      const gb = curves.level(pv[OUT_B]);
      let a;
      let b;
      if (os > 1) {
        for (let k = 0; k < os; k++) {
          this.tick();
          decA.push(O[S_LPG1] * ga);
          decB.push(O[S_LPG2] * gb);
        }
        a = decA.out();
        b = decB.out();
      } else {
        this.tick();
        const p = this.alignPos;
        a = this.alignA[p];
        b = this.alignB[p];
        this.alignA[p] = O[S_LPG1] * ga;
        this.alignB[p] = O[S_LPG2] * gb;
        this.alignPos = p + 1 === ALIGN ? 0 : p + 1;
      }

      // ----- output section (base rate): channels A+B, spring, master
      const amt = pv[OUT_REV];
      const mono = a + b;
      const wet = this.reverb.process(mono) * amt * 1.4;
      const mix = mono * (1 - 0.35 * amt) + wet;
      // master out: the jacks you patch back into the Easel (line level, soft-clipped)
      const master = softclip(mix * curves.master(pv[OUT_MASTER]));
      O[S_MIX] = master;
      if (tap) {
        const t = master - this.dcXT + 0.9995 * this.dcYT; // its own DC blocker
        this.dcXT = master;
        this.dcYT = t;
        tap[n] = t;
      }

      // monitor: what the browser plays
      let L = master * curves.master(pv[OUT_MONITOR]);
      const y = L - this.dcXL + 0.9995 * this.dcYL; // DC blocker
      this.dcXL = L;
      this.dcYL = y;
      L = y;
      // peak limiter (instant attack, ~120 ms release) + final soft clip
      const pk = L < 0 ? -L : L;
      if (pk > this.limEnv) this.limEnv = pk;
      else this.limEnv += (pk - this.limEnv) * 0.0002;
      let gain = 1;
      if (this.limEnv > 0.8) {
        gain = 0.8 / this.limEnv;
        if (1 - gain > m.limit) m.limit = 1 - gain;
      }
      L = softclip(L * gain * 1.1) * 0.9;

      if (!(L > -2 && L < 2)) {
        // NaN/Inf escaped somewhere: rebuild the instrument's state, keep going
        this.reset();
        m.recovered = 1;
        L = 0;
        if (tap) tap[n] = 0;
      }
      outL[n] = L;
      outR[n] = L;

      if (O[S_PULSE] > m.pulse) m.pulse = 1;
      if (O[S_SEQ_PULSE] > m.seqPulse) m.seqPulse = 1;
      if (O[S_ENV] > m.env) m.env = O[S_ENV];
      if (O[S_PRE_ENV] > m.det) m.det = O[S_PRE_ENV];
      if (this.v1 > m.v1) m.v1 = this.v1;
      if (this.v2 > m.v2) m.v2 = this.v2;
      if (pk > m.peak) m.peak = pk;
    }
  }
}
