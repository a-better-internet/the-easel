// Builds the 208 panel: ten sections, laid out in two rows the way the
// breakdown's signal-flow map reads (control sources on top, audio path below).

import { MODULES } from '../spec.js';
import { h, slider, knob, switchCtl, toggle, modSlider, led, jack } from './controls.js';

function section(key, { cls = '', body, inputs = [], outputs = [], extraHead } = {}) {
  const m = MODULES[key];
  const jacks = [];
  if (inputs.length) jacks.push(h('div', { class: 'jack-group in' }, h('span', { class: 'jg-label' }, 'in'), inputs));
  if (outputs.length) jacks.push(h('div', { class: 'jack-group out' }, h('span', { class: 'jg-label' }, 'out'), outputs));
  return h(
    'section',
    { class: `module m-${key} c-${m.color} ${cls}`, 'aria-label': m.title, dataset: { module: key } },
    h('header', { class: 'm-head' }, h('h2', {}, m.title), h('span', { class: 'm-tag' }, m.tag), extraHead),
    h('div', { class: 'm-body' }, body),
    jacks.length ? h('div', { class: 'm-jacks' }, jacks) : null,
  );
}

const col = (...kids) => h('div', { class: 'col' }, kids);
const group = (title, ...kids) =>
  h('div', { class: 'grp' }, title ? h('span', { class: 'grp-title' }, title) : null, h('div', { class: 'grp-row' }, kids));

export function buildPanel(root, store, { onKick } = {}) {
  const leds = {};
  const L = (key, color, opts) => {
    const el = led(color, opts);
    leds[key] = el.classList.contains('led') ? el : el.querySelector('.led');
    return el;
  };

  // ---------------------------------------------------------------- pulser
  const pulser = section('pulser', {
    body: [
      slider(store, 'pulser.period'),
      modSlider(store, 'pulser.mod', 'pulser.modSrc'),
      col(
        switchCtl(store, 'pulser.trig'),
        switchCtl(store, 'pulser.mode', { labels: ['cycle', 'once'] }),
        h(
          'div',
          { class: 'kick-row' },
          L('pulse', 'pulser'),
          h(
            'button',
            { type: 'button', class: 'kick', title: 'Start / resync the pulser (a power-on pulse)', onclick: () => onKick?.() },
            'kick',
          ),
        ),
      ),
    ],
    inputs: [jack('pulser.trigIn'), jack('pulser.periodCv')],
    outputs: [jack('pulser.pulse'), jack('pulser.ramp')],
  });

  // ---------------------------------------------------------------- sequencer
  const stageLeds = [];
  const stages = [1, 2, 3, 4, 5].map((n) => {
    const l = led('seq');
    stageLeds.push(l);
    return h('div', { class: 'stage' }, l, slider(store, `seq.s${n}`, { size: 'sm' }), toggle(store, `seq.p${n}`), h('span', { class: 'stage-num' }, n));
  });
  leds.stages = stageLeds;
  const seq = section('seq', {
    body: [
      h('div', { class: 'stages' }, stages, h('span', { class: 'stages-legend' }, 'pulse')),
      col(switchCtl(store, 'seq.stages'), switchCtl(store, 'seq.clock')),
    ],
    inputs: [jack('seq.clockIn')],
    outputs: [jack('seq.cv'), jack('seq.pulse')],
  });

  // ---------------------------------------------------------------- envelope
  const env = section('env', {
    body: [
      slider(store, 'env.attack'),
      slider(store, 'env.sustain'),
      slider(store, 'env.decay'),
      col(switchCtl(store, 'env.mode'), switchCtl(store, 'env.trig'), h('div', { class: 'row' }, knob(store, 'env.cvDepth'), L('env', 'env'))),
    ],
    inputs: [jack('env.trigIn'), jack('env.attackCv'), jack('env.sustainCv'), jack('env.decayCv')],
    outputs: [jack('env.out')],
  });

  // ---------------------------------------------------------------- random
  const rand = section('rand', {
    body: [col(switchCtl(store, 'rand.trig'), knob(store, 'rand.slew'), h('div', { class: 'row leds' }, L('r1', 'rand', { label: '1' }), L('r2', 'rand', { label: '2' })))],
    inputs: [jack('rand.trigIn')],
    outputs: [jack('rand.r1'), jack('rand.r2')],
  });

  // ---------------------------------------------------------------- preamp
  const pre = section('pre', {
    body: [slider(store, 'pre.gain'), col(switchCtl(store, 'pre.empty'), h('div', { class: 'row' }, knob(store, 'pre.speed'), L('det', 'det')))],
    inputs: [jack('pre.in')],
    outputs: [jack('pre.out'), jack('pre.det')],
  });

  // ---------------------------------------------------------------- inverter
  const inv = section('inv', {
    cls: 'compact',
    body: [
      h(
        'div',
        { class: 'inv-grid' },
        jack('inv.aIn', { label: 'A in' }),
        h('span', { class: 'inv-arrow', 'aria-hidden': 'true' }, '×−1'),
        jack('inv.aOut'),
        jack('inv.bIn', { label: 'B in' }),
        h('span', { class: 'inv-arrow', 'aria-hidden': 'true' }, '×−1'),
        jack('inv.bOut'),
      ),
    ],
  });

  // ---------------------------------------------------------------- mod osc
  const mo = section('mo', {
    body: [
      group('frequency', slider(store, 'mo.freq'), col(knob(store, 'mo.fine'), switchCtl(store, 'mo.range')), modSlider(store, 'mo.freqMod', 'mo.freqModSrc')),
      group(null, col(switchCtl(store, 'mo.wave'), switchCtl(store, 'mo.mode', { labels: ['off', 'f.m.', 'a.m.', 'ring'] }))),
      group('modulation', slider(store, 'mo.index'), modSlider(store, 'mo.indexMod', 'mo.indexModSrc'), col(knob(store, 'mo.fmLevel'))),
    ],
    inputs: [jack('mo.freqCv'), jack('mo.indexCv'), jack('mo.fmIn'), jack('mo.fmLevelCv')],
    outputs: [jack('mo.out')],
  });

  // ---------------------------------------------------------------- complex osc
  const co = section('co', {
    body: [
      group('pitch', slider(store, 'co.pitch'), col(knob(store, 'co.fine')), modSlider(store, 'co.pitchMod', 'co.pitchModSrc')),
      group('timbre', slider(store, 'co.timbre'), modSlider(store, 'co.timbreMod', 'co.timbreModSrc')),
      group(null, col(switchCtl(store, 'co.wave'), switchCtl(store, 'co.polarity', { horizontal: true }))),
    ],
    inputs: [jack('co.pitchCv'), jack('co.timbreCv')],
    outputs: [jack('co.out')],
  });

  // ---------------------------------------------------------------- lopass gates
  const lpg = section('lpg', {
    body: [
      group('gate 1', slider(store, 'lpg1.level'), modSlider(store, 'lpg1.mod', 'lpg1.modSrc'), col(switchCtl(store, 'lpg1.mode'), L('v1', 'lpg'))),
      group(
        'gate 2',
        slider(store, 'lpg2.level'),
        modSlider(store, 'lpg2.mod', 'lpg2.modSrc'),
        col(switchCtl(store, 'lpg2.mode'), switchCtl(store, 'lpg2.src'), L('v2', 'lpg')),
      ),
    ],
    inputs: [jack('lpg1.in'), jack('lpg2.in'), jack('lpg1.cv'), jack('lpg2.cv')],
    outputs: [jack('lpg1.out'), jack('lpg2.out')],
  });

  // ---------------------------------------------------------------- output
  const out = section('out', {
    body: [
      slider(store, 'out.a'),
      slider(store, 'out.b'),
      slider(store, 'out.reverb'),
      slider(store, 'out.master', { cls: 'master' }),
      col(switchCtl(store, 'out.stereo'), L('peak', 'out', { label: 'level' }), L('limit', 'limit', { label: 'limit' })),
    ],
    outputs: [jack('out.mix')],
  });

  // One wrapping container; CSS `order` and the row break arrange the rows
  // per breakpoint (control sources on top, audio path below).
  root.append(h('div', { class: 'modules' }, pulser, seq, env, rand, pre, inv, h('div', { class: 'row-break', 'aria-hidden': 'true' }), mo, co, lpg, out));

  const jacks = new Map();
  for (const el of root.querySelectorAll('.jack')) jacks.set(el.dataset.jack, el);
  return { jacks, leds };
}
