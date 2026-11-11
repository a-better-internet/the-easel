import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EaselEngine, designDecimator, softclip } from '../src/dsp/engine.js';
import { PatchGraph } from '../src/patch/graph.js';
import { RECIPES, RECIPE_BY_ID, recipeParams, recipeCables } from '../src/patch/recipes.js';
import { PARAMS, OUTPUTS, INPUTS, JACK_BY_ID, SIGNAL_INDEX, MULTIPLES, curves, defaultParams, jackColor } from '../src/spec.js';

const SR = 48000;
const S = SIGNAL_INDEX;

function engineFor(params = {}, cables = [], os = 2, sr = SR) {
  const e = new EaselEngine(sr, os);
  e.setParams({ ...defaultParams(), ...params });
  e.settleParams();
  e.reset();
  const g = new PatchGraph(JACK_BY_ID);
  g.load(cables);
  e.setPatch(g.nets());
  return e;
}

/** Render `seconds`, calling probe(engine) after every block. */
function render(e, seconds, probe, N = 128) {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let sum = 0;
  let peak = 0;
  let finite = true;
  const blocks = Math.round((e.sr * seconds) / N);
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

/** Count rising edges of an internal signal, sample by sample. */
function countEdges(e, signal, seconds) {
  const L = new Float32Array(1);
  const R = new Float32Array(1);
  let n = 0;
  let prev = 0;
  for (let i = 0; i < e.sr * seconds; i++) {
    e.process(L, R, 1);
    const v = e.O[signal];
    if (v > 0.5 && prev <= 0.5) n++;
    prev = v;
  }
  return n;
}

test('spec: ids are unique, every output carries a real signal', () => {
  const ids = [...OUTPUTS, ...INPUTS].map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(PARAMS.map((p) => p.id)).size, PARAMS.length);
  for (const o of OUTPUTS) assert.ok(S[o.signal] !== undefined, o.id);
  for (const [sig, n] of Object.entries(MULTIPLES)) for (let i = 1; i <= n; i++) assert.ok(JACK_BY_ID[`${sig}.${i}`], `${sig}.${i}`);
  assert.equal(jackColor(JACK_BY_ID['env.attackCv']), 'black', 'inputs are black');
  assert.equal(jackColor(JACK_BY_ID['co.osc']), 'tiny', 'audio is on Tini-Jax');
});

test('printed scales: time runs .002 s at the top to 10 s at the bottom', () => {
  const near = (a, b) => Math.abs(a / b - 1) < 1e-9;
  assert.ok(near(curves.time(1), 0.002));
  assert.ok(near(curves.time(0.6), 0.2));
  assert.ok(near(curves.time(0), 10));
  assert.ok(near(curves.pitch(0), 33) && near(curves.pitch(0.6), 440) && near(curves.pitch(1), 3000));
  assert.ok(near(curves.moLow(0), 0.4) && near(curves.moLow(1), 33));
});

test('every patch and every quick-start step renders finite, bounded, audible output', () => {
  for (const r of RECIPES) {
    const steps = r.steps ? r.steps.map((_, i) => i) : [Infinity];
    for (const st of steps) {
      const e = engineFor(recipeParams(r, st), recipeCables(r, st));
      const { rms, peak, finite } = render(e, 3);
      const name = `${r.name}${r.steps ? ` step ${st + 1}` : ''}`;
      assert.ok(finite, `${name}: non-finite sample`);
      assert.ok(peak <= 1, `${name}: peak ${peak}`);
      assert.ok(rms > 0.002, `${name}: too quiet (rms ${rms})`);
      assert.equal(e.takeMeters().recovered, 0, `${name}: engine had to recover`);
    }
  }
});

test('patches only reference real params and jacks', () => {
  for (const r of RECIPES) {
    assert.doesNotThrow(() => recipeParams(r), r.name);
    for (const [a, b] of recipeCables(r)) assert.ok(JACK_BY_ID[a] && JACK_BY_ID[b], `${r.name}: ${a} -> ${b}`);
  }
});

test('quick start steps are cumulative', () => {
  const r = RECIPE_BY_ID['quick-start-b'];
  assert.equal(recipeCables(r, 0).length, 1);
  assert.equal(recipeCables(r, 6).length, r.cables.length + r.steps.reduce((n, s) => n + (s.cables?.length ?? 0), 0));
  assert.equal(recipeParams(r, 1)['co.pitchCv'], 0.2);
  assert.equal(recipeParams(r, 0)['co.pitchCv'], 0.8);
  assert.equal(recipeParams(r, 3)['mo.range'], 1, 'step 4 sets the m.o. to low range');
});

test('pulser, sustained + self: one pulse per period', () => {
  const e = engineFor({ 'pulser.period': 0.6 }); // the .2 s mark
  assert.equal(countEdges(e, S['pulser.pulse'], 2.1), 10);
});

test('pulser, transient + self: a single power-on pulse; "one" fires another', () => {
  const e = engineFor({ 'pulser.period': 0.7, 'pulser.mode': 1 });
  assert.equal(countEdges(e, S['pulser.pulse'], 1), 1);
  e.one();
  assert.equal(countEdges(e, S['pulser.pulse'], 1), 1);
});

test('pulser, off-ext: pulses at the period CV jack drive it', () => {
  // a self-cycling envelope makes ~1 rising edge per cycle
  const e = engineFor(
    { 'pulser.mode': 2, 'env.mode': 2, 'env.attack': 0.6, 'env.sustain': 0.8, 'env.decay': 0.6 },
    [['env.3', 'pulser.periodCv']],
  );
  const L = new Float32Array(1);
  const R = new Float32Array(1);
  let envEdges = 0;
  let pulses = 0;
  let pe = 0;
  let pp = 0;
  for (let i = 0; i < SR * 3; i++) {
    e.process(L, R, 1);
    const ev = e.O[S.env];
    const pv = e.O[S['pulser.pulse']];
    if (ev > 0.5 && pe <= 0.5) envEdges++;
    if (pv > 0.5 && pp <= 0.5) pulses++;
    pe = ev;
    pp = pv;
  }
  assert.ok(envEdges >= 3);
  assert.equal(pulses, envEdges);
});

test('sequencer loops over 3, 4 or 5 stages', () => {
  for (const [opt, n] of [
    [0, 3],
    [1, 4],
    [2, 5],
  ]) {
    const e = engineFor({ 'pulser.period': 0.7, 'seq.stages': opt });
    const seen = new Set();
    render(e, 2, (en) => seen.add(en.sStage));
    assert.equal(seen.size, n);
  }
});

test('sequencer voltage follows the stage sliders', () => {
  const e = engineFor({ 'pulser.period': 0.7, 'seq.s1': 0.1, 'seq.s2': 0.9, 'seq.s3': 0.5, 'seq.stages': 0 });
  const values = new Set();
  render(e, 2, (en) => values.add(Math.round(en.O[S.seq] * 10)));
  for (const v of [1, 5, 9]) assert.ok(values.has(v), `stage voltage ${v / 10} never reached`);
});

test('envelope: transient reaches full level and returns to 0; self mode keeps cycling', () => {
  const t = engineFor({ 'env.mode': 1, 'env.attack': 0.9, 'env.sustain': 0.8, 'env.decay': 0.7, 'pulser.period': 0.4 });
  render(t, 2.5);
  assert.ok(t.takeMeters().env >= 0.999, 'envelope never reached full level');
  assert.equal(t.eLvl, 0, 'envelope did not return to zero');

  const s = engineFor({ 'env.mode': 2, 'env.attack': 0.6, 'env.sustain': 0.9, 'env.decay': 0.6 });
  let cycles = 0;
  let prev = 0;
  render(s, 2, (e) => {
    if (e.eStage === 1 && prev !== 1) cycles++;
    prev = e.eStage;
  });
  assert.ok(cycles >= 3, `self mode cycled ${cycles} times`);
});

test('envelope sliders: up is faster', () => {
  const rise = (pos) => {
    const e = engineFor({ 'env.mode': 2, 'env.attack': pos });
    let n = 0;
    while (e.eLvl < 0.99 && n < SR * 20) {
      e.process(new Float32Array(1), new Float32Array(1), 1);
      n++;
    }
    return n / SR;
  };
  assert.ok(rise(1) < 0.01, 'top of the slider should be ~2 ms');
  assert.ok(rise(0.4) > 0.5, 'the "1" mark should be ~1 s');
});

test('inverter multiplies by -1', () => {
  const e = engineFor({ 'env.mode': 2 }, [['env.1', 'inv.in']]);
  let checked = 0;
  render(e, 0.5, (en) => {
    assert.equal(en.O[S.inv], -en.O[S.env]);
    checked++;
  });
  assert.ok(checked > 0);
});

test('outputs sharing a net are mixed passively (averaged)', () => {
  const e = engineFor({ 'env.mode': 2 }, [
    ['env.1', 'inv.in'],
    ['pulser.1', 'inv.in'],
  ]);
  render(e, 0.3, (en) => {
    const want = -(en.O[S.env] + en.O[S.pulser]) / 2;
    assert.ok(Math.abs(en.O[S.inv] - want) < 1e-9);
  });
});

test('multiples carry one signal: two random jacks on a net count once', () => {
  const e = engineFor({}, [
    ['rand.1', 'inv.in'],
    ['rand.5', 'inv.in'],
  ]);
  render(e, 0.2, (en) => assert.equal(en.O[S.inv], -en.O[S.rand]));
});

test('a CV input only acts through its CV-amount slider', () => {
  const pitchAt = (amount) => {
    const e = engineFor({ 'co.pitchCv': amount, 'seq.s1': 1, 'seq.s2': 1, 'seq.s3': 1, 'seq.s4': 1, 'seq.s5': 1, 'mo.index': 0 }, [['seq.5', 'co.pitchCv']]);
    let crossings = 0;
    let prev = 0;
    render(
      e,
      0.5,
      (en) => {
        if (en.O[S.co] > 0 && prev <= 0) crossings++;
        prev = en.O[S.co];
      },
      1,
    );
    return crossings * 2; // Hz
  };
  const off = pitchAt(0);
  const on = pitchAt(0.5);
  assert.ok(Math.abs(off - curves.pitch(0.35)) < 6, `no cv: ${off} Hz`);
  assert.ok(on > off * 2, `cv amount 5 should raise the pitch (${off} -> ${on} Hz)`);
});

test('audio-rate c.osc -> f.m. in loop changes the sound', () => {
  const base = { 'mo.mode': 2, 'mo.index': 0.5, 'mo.fmLevel': 0.6, 'lpg1.level': 0.8 };
  const open = render(engineFor(base, []), 1);
  const loop = render(engineFor(base, [['co.osc', 'mo.fmIn']]), 1);
  assert.ok(Math.abs(open.rms - loop.rms) > 1e-4 || open.peak !== loop.peak);
});

test('cross-modulated oscillators never freeze into silent DC', () => {
  // this patch used to lock both oscillators near 0 Hz with through-zero FM
  const r = RECIPE_BY_ID['long-form-steering'];
  const e = engineFor(recipeParams(r), recipeCables(r));
  for (let s = 0; s < 20; s++) {
    const { rms } = render(e, 1);
    assert.ok(20 * Math.log10(rms) > -40, `second ${s}: ${(20 * Math.log10(rms)).toFixed(1)} dB`);
  }
});

test('master-out feedback loops behave the same at every quality setting', () => {
  const r = RECIPE_BY_ID['howl-box'];
  const ringing = (os) => {
    const e = engineFor(recipeParams(r), recipeCables(r), os);
    let n = 0;
    for (let t = 0; t < 24; t++) if (20 * Math.log10(render(e, 0.25).rms) > -40) n++;
    return n;
  };
  const r1 = ringing(1);
  const r2 = ringing(2);
  const r4 = ringing(4);
  assert.ok(r2 > 2 && r2 < 22, `the howl should pulse, not lock or die (${r2}/24 windows ringing)`);
  assert.ok(Math.abs(r1 - r2) <= 3 && Math.abs(r4 - r2) <= 3, `1x ${r1}, 2x ${r2}, 4x ${r4}`);
});

test('random patching never produces NaN or exceeds full scale', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const outs = OUTPUTS.map((j) => j.id);
  const ins = INPUTS.map((j) => j.id);
  for (let trial = 0; trial < 12; trial++) {
    const params = {};
    for (const p of PARAMS) {
      if (p.type === 'slider' || p.type === 'knob') params[p.id] = rnd() * (p.bipolar ? 2 : 1) - (p.bipolar ? 1 : 0);
      else params[p.id] = Math.floor(rnd() * p.options.length);
    }
    params['out.master'] = 1; // worst case
    params['out.monitor'] = 1;
    const cables = [];
    for (let k = 0; k < 10; k++) cables.push([outs[Math.floor(rnd() * outs.length)], ins[Math.floor(rnd() * ins.length)]]);
    cables.push(['out.master1', 'pre.in'], ['co.osc', 'mo.fmIn']);
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
  e.setPatch([{ outs: ['nope'], ins: ['mo.fmIn'] }, { outs: ['co.osc'], ins: ['nope'] }, {}, null]);
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
