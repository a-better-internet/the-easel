import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EaselEngine, designDecimator, softclip } from '../src/dsp/engine.js';
import { PatchGraph } from '../src/patch/graph.js';
import { RECIPES, recipeParams } from '../src/patch/recipes.js';
import {
  PARAMS,
  PARAM_BY_ID,
  OUTPUTS,
  INPUTS,
  JACK_BY_ID,
  BUS_OUTPUT,
  OUT_INDEX,
  defaultParams,
} from '../src/spec.js';

const SR = 48000;

function engineFor(params = {}, cables = [], os = 2) {
  const e = new EaselEngine(SR, os);
  e.setParams({ ...defaultParams(), ...params });
  e.settleParams();
  e.reset();
  const g = new PatchGraph(JACK_BY_ID);
  g.load(cables);
  e.setPatch(g.nets());
  return e;
}

/** Render `seconds`, calling probe(engine) after every block. */
function render(e, seconds, probe) {
  const N = 128;
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let sum = 0;
  let peak = 0;
  let finite = true;
  const blocks = Math.round((SR * seconds) / N);
  for (let b = 0; b < blocks; b++) {
    e.process(L, R, N);
    for (let i = 0; i < N; i++) {
      const x = L[i];
      if (!Number.isFinite(x) || !Number.isFinite(R[i])) finite = false;
      sum += x * x;
      peak = Math.max(peak, Math.abs(x), Math.abs(R[i]));
    }
    probe?.(e);
  }
  return { rms: Math.sqrt(sum / (blocks * N)), peak, finite };
}

test('spec: ids are unique and overrides point at real params', () => {
  const ids = [...OUTPUTS, ...INPUTS].map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(PARAMS.map((p) => p.id)).size, PARAMS.length);
  for (const i of INPUTS) if (i.overrides) assert.ok(PARAM_BY_ID[i.overrides], i.overrides);
  for (const b of BUS_OUTPUT) assert.ok(OUT_INDEX[b] !== undefined, b);
});

test('every recipe renders finite, bounded, audible output', () => {
  for (const r of RECIPES) {
    const e = engineFor(recipeParams(r), r.cables);
    const { rms, peak, finite } = render(e, 4);
    assert.ok(finite, `${r.name}: non-finite sample`);
    assert.ok(peak <= 1, `${r.name}: peak ${peak}`);
    assert.ok(rms > 0.003, `${r.name}: too quiet (rms ${rms})`);
    assert.equal(e.takeMeters().recovered, 0, `${r.name}: engine had to recover`);
  }
});

test('recipes only reference real params and jacks', () => {
  for (const r of RECIPES) {
    assert.doesNotThrow(() => recipeParams(r), r.name);
    for (const [a, b] of r.cables) {
      assert.ok(JACK_BY_ID[a] && JACK_BY_ID[b], `${r.name}: ${a} -> ${b}`);
    }
  }
});

test('pulser in cycle mode fires once per period', () => {
  // period slider 0.5 -> 0.005 * 2^5.5 s = 0.2263 s
  const e = engineFor({ 'pulser.period': 0.5 });
  let pulses = 0;
  let prev = 0;
  const N = 1;
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  for (let n = 0; n < SR * 2.3; n++) {
    e.process(L, R, N);
    const p = e.O[OUT_INDEX['pulser.pulse']];
    if (p > 0.5 && prev <= 0.5) pulses++;
    prev = p;
  }
  assert.equal(pulses, 10); // 2.3 s / 0.2263 s
});

test('pulser in one-shot self mode fires exactly once (a power-on pulse)', () => {
  const e = engineFor({ 'pulser.period': 0.3, 'pulser.mode': 1 });
  let pulses = 0;
  let prev = 0;
  const L = new Float32Array(1);
  const R = new Float32Array(1);
  for (let n = 0; n < SR; n++) {
    e.process(L, R, 1);
    const p = e.O[OUT_INDEX['pulser.pulse']];
    if (p > 0.5 && prev <= 0.5) pulses++;
    prev = p;
  }
  assert.equal(pulses, 1);
});

test('sequencer loops over 3, 4 or 5 stages', () => {
  for (const [opt, n] of [
    [0, 3],
    [1, 4],
    [2, 5],
  ]) {
    const e = engineFor({ 'pulser.period': 0.2, 'seq.stages': opt });
    const seen = new Set();
    render(e, 2, (en) => seen.add(en.sStage));
    assert.equal(seen.size, n);
  }
});

test('sequencer voltage follows the stage sliders', () => {
  const e = engineFor({ 'pulser.period': 0.2, 'seq.s1': 0.1, 'seq.s2': 0.9, 'seq.stages': 0, 'seq.s3': 0.5 });
  const values = new Set();
  render(e, 2, (en) => values.add(Math.round(en.O[OUT_INDEX['seq.cv']] * 10)));
  for (const v of [1, 5, 9]) assert.ok(values.has(v), `stage voltage ${v / 10} never reached`);
});

test('envelope: transient rises to 1 and falls back to 0; self mode keeps cycling', () => {
  const t = engineFor({ 'env.mode': 0, 'env.attack': 0.2, 'env.decay': 0.3, 'pulser.period': 0.7 });
  render(t, 2);
  // the meter holds the per-sample peak; transient mode touches 1.0 for one sample
  assert.ok(t.takeMeters().env >= 0.999, 'envelope never reached full level');
  assert.equal(t.eLvl, 0, 'envelope did not return to zero');

  const s = engineFor({ 'env.mode': 2, 'env.attack': 0.3, 'env.sustain': 0.1, 'env.decay': 0.4 });
  let cycles = 0;
  let prev = 0;
  render(s, 2, (e) => {
    if (e.eStage === 1 && prev !== 1) cycles++;
    prev = e.eStage;
  });
  assert.ok(cycles >= 3, `self mode cycled ${cycles} times`);
});

test('inverter multiplies by -1', () => {
  const e = engineFor({ 'env.mode': 2 }, [['env.out', 'inv.aIn']]);
  let checked = 0;
  render(e, 0.5, (en) => {
    assert.equal(en.O[OUT_INDEX['inv.aOut']], -en.O[OUT_INDEX['env.out']]);
    checked++;
  });
  assert.ok(checked > 0);
});

test('outputs sharing a net are mixed passively (averaged)', () => {
  const e = engineFor({ 'env.mode': 2 }, [
    ['env.out', 'inv.aIn'],
    ['pulser.ramp', 'inv.aIn'],
  ]);
  render(e, 0.3, (en) => {
    const want = -(en.O[OUT_INDEX['env.out']] + en.O[OUT_INDEX['pulser.ramp']]) / 2;
    assert.ok(Math.abs(en.O[OUT_INDEX['inv.aOut']] - want) < 1e-9);
  });
});

test('a patched cv jack overrides the bus source switch', () => {
  // bus source = sequencer, but the jack carries the inverted envelope
  const e = engineFor({ 'co.pitchModSrc': 0, 'co.pitchMod': 1, 'env.mode': 2 }, [['inv.aOut', 'co.pitchCv']]);
  assert.equal(e.modSource(15, 0), e.readIn(15));
});

test('audio-rate C.O. -> M.O. loop changes the sound', () => {
  const base = { 'mo.mode': 1, 'mo.index': 0.5, 'mo.fmLevel': 0.6, 'lpg1.level': 0.8 };
  const open = render(engineFor(base, []), 1);
  const loop = render(engineFor(base, [['co.out', 'mo.fmIn']]), 1);
  assert.ok(Math.abs(open.rms - loop.rms) > 1e-4 || open.peak !== loop.peak);
});

test('random patching never produces NaN or exceeds full scale', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const outs = OUTPUTS.map((j) => j.id);
  const ins = INPUTS.map((j) => j.id);
  for (let trial = 0; trial < 12; trial++) {
    const params = {};
    for (const p of PARAMS) {
      if (p.type === 'slider' || p.type === 'knob') params[p.id] = rnd() * (p.bipolar ? 2 : 1) - (p.bipolar ? 1 : 0);
      else params[p.id] = Math.floor(rnd() * (p.type === 'bus' ? 5 : p.options.length));
    }
    params['out.master'] = 1; // worst case
    const cables = [];
    for (let k = 0; k < 10; k++) cables.push([outs[Math.floor(rnd() * outs.length)], ins[Math.floor(rnd() * ins.length)]]);
    cables.push(['out.mix', 'pre.in'], ['co.out', 'mo.fmIn']);
    const { finite, peak } = render(engineFor(params, cables), 1);
    assert.ok(finite, `trial ${trial} produced non-finite output`);
    assert.ok(peak <= 1, `trial ${trial} peak ${peak}`);
  }
});

test('engine survives garbage params and patches', () => {
  const e = engineFor();
  assert.equal(e.setParam('nope', 1), false);
  e.setParam('co.pitch', NaN);
  e.setParam('mo.mode', 99);
  e.setPatch([{ outs: ['nope'], ins: ['mo.fmIn'] }, { outs: ['co.out'], ins: ['nope'] }, {}]);
  e.setPatch(null);
  const { finite } = render(e, 0.2);
  assert.ok(finite);
});

test('decimation filter: unity at DC, deep stopband above the new Nyquist', () => {
  for (const os of [2, 4]) {
    const h = designDecimator(os);
    const gainAt = (f) => {
      let re = 0;
      let im = 0;
      for (let n = 0; n < h.length; n++) {
        re += h[n] * Math.cos(2 * Math.PI * f * n);
        im -= h[n] * Math.sin(2 * Math.PI * f * n);
      }
      return Math.hypot(re, im);
    };
    assert.ok(Math.abs(gainAt(0) - 1) < 1e-9);
    // 0.6 x base sample rate, in cycles per oversampled sample
    const stop = 20 * Math.log10(gainAt(0.6 / os));
    assert.ok(stop < -60, `os=${os}: stopband only ${stop.toFixed(1)} dB`);
    const pass = 20 * Math.log10(gainAt(0.3 / os));
    assert.ok(Math.abs(pass) < 0.1, `os=${os}: passband ripple ${pass.toFixed(2)} dB`);
  }
});

test('softclip is bounded, odd and continuous at the knee', () => {
  assert.equal(softclip(10), 1);
  assert.equal(softclip(-10), -1);
  assert.ok(Math.abs(softclip(3 - 1e-9) - 1) < 1e-6);
  assert.equal(softclip(0.5), -softclip(-0.5));
});
