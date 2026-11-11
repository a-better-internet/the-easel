// Reusable DSP building blocks for the engine: soft clipper, PolyBLEP,
// the oversampling decimator and the spring reverb.

const TAU = Math.PI * 2;

/** Cheap tanh-like soft clipper (Padé), exactly +/-1 beyond +/-3. */
export function softclip(x) {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export function polyblep(t, dt) {
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

export class Decimator {
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

