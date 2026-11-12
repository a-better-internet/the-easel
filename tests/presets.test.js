import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EaselEngine } from '../src/dsp/engine.js';
import { PatchGraph } from '../src/patch/graph.js';
import { RECIPES, RECIPE_BY_ID, recipeParams, recipeCables } from '../src/patch/recipes.js';
import { PATCHED } from '../src/patch/patched.js';
import { loadUserPresets, saveUserPresets, upsertPreset, removePreset, findByName, isUserPresetId, USER_PRESETS_KEY } from '../src/patch/user-presets.js';
import { JACKS, JACK_BY_ID, jackName, curves, defaultParams } from '../src/spec.js';

function engineFor(recipe, os = 2) {
  const e = new EaselEngine(48000, os);
  e.setParams(recipeParams(recipe));
  e.settleParams();
  e.reset();
  const g = new PatchGraph(JACK_BY_ID);
  g.load(recipeCables(recipe));
  e.setPatch(g.nets());
  return { e, g };
}

function windows(e, seconds, win) {
  const N = Math.round(48000 * win);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const out = [];
  for (let t = 0; t < seconds / win; t++) {
    e.process(L, R, N);
    let s = 0;
    let zc = 0;
    for (let i = 1; i < N; i++) {
      s += L[i] * L[i];
      if (L[i] > 0 !== L[i - 1] > 0) zc++;
    }
    out.push({ db: 10 * Math.log10(s / N + 1e-12), hz: zc / 2 / win });
  }
  return out;
}

class MemoryStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
}

// ---------------------------------------------------------------- patched presets

test('every patched preset is built on cables, and every cable is real', () => {
  assert.equal(PATCHED.length, 12);
  for (const r of PATCHED) {
    const cables = recipeCables(r);
    assert.ok(cables.length >= 2, `${r.name} has only ${cables.length} cable(s)`);
    for (const [a, b] of cables) assert.ok(JACK_BY_ID[a] && JACK_BY_ID[b], `${r.name}: ${a} -> ${b}`);
    assert.ok(r.set && r.result && r.loops, `${r.name} needs set / result / technique text`);
    const g = new PatchGraph(JACK_BY_ID);
    g.load(cables);
    assert.equal(g.cables.size, cables.length, `${r.name}: a cable was rejected on load`);
  }
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length, 'preset ids are unique');
});

test('Stacked Fan-Out really stacks three plugs on one jack', () => {
  const { g } = engineFor(RECIPE_BY_ID['stacked-fan-out']);
  assert.equal(g.stack('seq.5').length, 3);
  const net = g.nets().find((n) => n.outs.includes('seq.5'));
  assert.deepEqual(net.ins, ['co.pitchCv', 'co.timbreCv', 'mo.freqCv']);
});

test('Mixed Voltages puts two outputs on each of two inputs', () => {
  const { g } = engineFor(RECIPE_BY_ID['mixed-voltages']);
  const nets = g.nets();
  assert.deepEqual(nets.find((n) => n.ins.includes('co.pitchCv')).outs, ['rand.7', 'seq.5']);
  assert.deepEqual(nets.find((n) => n.ins.includes('lpg1.cv')).outs, ['env.5', 'pulser.3']);
});

test('Feedback Melody: the loop hums a different pitch on each sequencer step', () => {
  const r = RECIPE_BY_ID['feedback-melody'];
  const { e } = engineFor(r);
  const step = curves.time(recipeParams(r)['pulser.period']);
  windows(e, step * 6, step); // settle
  const pitches = windows(e, step * 5, step).filter((w) => w.db > -45).map((w) => Math.round(w.hz / 5) * 5);
  assert.equal(pitches.length, 5, 'every step should sound');
  assert.ok(new Set(pitches).size >= 4, `pitches ${pitches.join(', ')}`);
});

test('Ringing Filter: pings ring and then die away', () => {
  const { e } = engineFor(RECIPE_BY_ID['ringing-filter']);
  const db = windows(e, 6, 0.15).map((w) => w.db);
  assert.ok(Math.max(...db) > -30, 'it should ring');
  assert.ok(Math.min(...db) < -45, 'and fall quiet between pings');
});

test('Detector Swell swells and recedes without hitting the limiter', () => {
  const { e } = engineFor(RECIPE_BY_ID['detector-swell']);
  const db = windows(e, 14, 0.5).map((w) => w.db);
  assert.ok(Math.max(...db) - Math.min(...db) > 8, `range ${Math.min(...db).toFixed(1)}..${Math.max(...db).toFixed(1)} dB`);
  assert.equal(e.takeMeters().limit, 0);
});

test('every jack has a readable name for the patch sheet', () => {
  for (const j of JACKS) assert.notEqual(jackName(j.id), j.id, j.id);
  assert.equal(jackName('seq.5'), 'sequencer');
  assert.equal(jackName('co.pitchCv'), 'c.o. pitch cv');
});

// ---------------------------------------------------------------- my presets

const state = (extra = {}) => ({ v: 2, params: { ...defaultParams(), ...extra }, cables: [[['co.osc', 1], ['mo.fmIn', 2]]] });

test('my presets: save, reload, replace by name, delete', () => {
  const store = new MemoryStorage();
  let list = loadUserPresets(store);
  assert.deepEqual(list, []);

  let r = upsertPreset(list, { name: '  Night  Drone ', notes: 'slow', state: state({ 'co.pitch': 0.2 }), based: 'bare' }, 1000);
  assert.equal(r.replaced, false);
  assert.equal(r.preset.name, 'Night Drone');
  assert.ok(isUserPresetId(r.preset.id));
  list = r.list;
  r = upsertPreset(list, { name: 'Bells', state: state() }, 2000);
  list = r.list;
  assert.deepEqual(
    list.map((p) => p.name),
    ['Bells', 'Night Drone'],
    'sorted by name',
  );

  // same name, different case: replaces, keeps id and creation time
  const before = findByName(list, 'night drone');
  r = upsertPreset(list, { name: 'NIGHT DRONE', notes: 'slower', state: state({ 'co.pitch': 0.3 }) }, 3000);
  assert.equal(r.replaced, true);
  assert.equal(r.preset.id, before.id);
  assert.equal(r.preset.created, 1000);
  assert.equal(r.preset.updated, 3000);
  assert.equal(r.preset.based, 'bare', 'keeps what it was based on');
  list = r.list;
  assert.equal(list.length, 2);

  assert.equal(saveUserPresets(store, list), true);
  const again = loadUserPresets(store);
  assert.equal(again.length, 2);
  assert.equal(findByName(again, 'night drone').state.params['co.pitch'], 0.3);
  assert.deepEqual(findByName(again, 'bells').state.cables, state().cables, 'cables survive the round trip');

  list = removePreset(again, findByName(again, 'bells').id);
  assert.deepEqual(
    list.map((p) => p.name),
    ['NIGHT DRONE'],
  );
});

test('my presets: refuses empty names and empty state; ignores junk in storage', () => {
  assert.throws(() => upsertPreset([], { name: '   ', state: state() }), /name/);
  assert.throws(() => upsertPreset([], { name: 'x', state: { v: 1 } }), /Nothing/);

  const store = new MemoryStorage();
  store.setItem(USER_PRESETS_KEY, JSON.stringify([{ id: 'user:ok', name: 'ok', state: state() }, { id: 'nope', name: 'bad id', state: state() }, { id: 'user:x', name: '', state: state() }, 42]));
  assert.deepEqual(
    loadUserPresets(store).map((p) => p.name),
    ['ok'],
  );
  store.setItem(USER_PRESETS_KEY, '{not json');
  assert.deepEqual(loadUserPresets(store), []);
  assert.deepEqual(loadUserPresets(null), []);
  assert.equal(saveUserPresets({ setItem() { throw new Error('quota'); } }, []), false);
});
