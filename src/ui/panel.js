// Builds the panel after the 208C layout in the Quick Start Guide:
//   top strip     jacks for mod osc in/out, inverter, comp osc, preamp, mix out
//   switch strip  one box per section: toggles, knobs, LEDs
//   slider row    printed scales; each CV-amount slider stands beside its main slider
//   jack field    black CV inputs under their CV sliders, coloured source
//                 multiples beside them so a shorting bar can reach
//   right column  output knobs
// Keyboard, program-card, MIDI and pressure sections are left out: no input.

import { SCALES } from '../spec.js';
import { h, slider, knob, toggleSwitch, pulseToggle, led, jack, iconEl } from './controls.js';

const box = (cls, title, ...kids) =>
  h('section', { class: `box ${cls}` }, title ? h('h2', { class: 'box-title' }, title) : null, h('div', { class: 'box-body' }, kids));

const row = (cls, ...kids) => h('div', { class: `row ${cls}` }, kids);

/** Printed scale: labels at the six mark positions, top to bottom. */
function scaleCol(name) {
  const marks = {
    time: ['.002', '.025', '.2', '1', '3.5', '10'],
    ten: ['10', '8', '6', '4', '2', '0'],
    pitch: ['3000', '1000', '440', '200', '88', '33'],
  }[name];
  if (name === 'mo') {
    const low = [...SCALES.moLow].reverse().map((v) => (v < 1 ? `.${String(v).split('.')[1]}` : String(v)));
    const high = [...SCALES.pitch].reverse().map(String);
    return h(
      'div',
      { class: 'scale dual', 'aria-hidden': 'true' },
      h('span', { class: 'scale-head' }, h('b', {}, 'low'), h('b', {}, 'high')),
      low.map((l, i) => h('span', { class: 'mark', style: { '--i': i } }, h('i', {}, l), h('i', {}, high[i]))),
    );
  }
  return h(
    'div',
    { class: 'scale', 'aria-hidden': 'true' },
    marks.map((m, i) => h('span', { class: 'mark', style: { '--i': i } }, m)),
  );
}

/**
 * A slider bank with its jack field. `cols` lists the columns left to right:
 *   { slider: id } | { scale: name } | { meter: el }
 * and `upper` / `lower` give the jack (or null) under each column.
 */
function bank(cls, cols, upper = [], lower = []) {
  const grid = h('div', { class: `bank ${cls}`, style: { '--cols': cols.map((c) => (c.scale === 'mo' ? 'var(--scale-dual)' : c.scale ? 'var(--scale-w)' : 'var(--col)')).join(' ') } });
  const ruled = h('div', { class: 'rules', 'aria-hidden': 'true' });
  grid.append(ruled);
  cols.forEach((c, i) => {
    let el;
    if (c.slider) el = slider(c.store, c.slider, c.opts);
    else if (c.scale) el = scaleCol(c.scale);
    else el = c.el;
    el.style.gridColumn = String(i + 1);
    el.style.gridRow = '1';
    grid.append(el);
  });
  const place = (list, rowNum) =>
    list.forEach((id, i) => {
      if (!id) return;
      const el = typeof id === 'string' ? jack(id) : id;
      el.style.gridColumn = String(i + 1);
      el.style.gridRow = String(rowNum);
      el.classList.add(rowNum === 2 ? 'field-upper' : 'field-lower');
      grid.append(el);
    });
  place(upper, 2);
  place(lower, 3);
  return grid;
}

/** The printed inverter symbol: a triangle marked -1. */
function invSymbol() {
  const wrap = h('span', { class: 'inv-symbol', 'aria-hidden': 'true' });
  wrap.innerHTML =
    '<svg viewBox="0 0 30 20" width="30" height="20"><path d="M2 2 L26 10 L2 18 Z" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="5" y="13.5" font-size="8.5" font-weight="700" fill="currentColor">−1</text></svg>';
  return wrap;
}

export function buildPanel(root, store, { onOne } = {}) {
  const leds = {};
  const L = (key, color, opts) => {
    const el = led(color, opts);
    leds[key] = el.classList.contains('led') ? el : el.querySelector('.led');
    return el;
  };
  const S = (id, opts) => ({ store, slider: id, opts });

  // ================================================================ top strip
  const programCard = h('span', { class: 'card-name', id: 'card-name' }, '—');
  const title = h(
    'div',
    { class: 'title-strip' },
    h('div', { class: 'title-line' }, h('span', {}, 'stored program sound source'), h('span', { class: 'model' }, 'no-input · after model 208C')),
    h('div', { class: 'program' }, h('span', { class: 'program-label' }, 'program'), h('div', { class: 'card-slot' }, programCard)),
  );

  const modio = box('top m-modio', 'mod osc in/out', row('jacks', jack('mo.fmIn'), jack('mo.osc'), jack('mo.modOut')));
  const inv = box(
    'top m-inv',
    'inverter',
    row('jacks', jack('inv.in'), invSymbol(), jack('inv.out')),
  );
  const coio = box('top m-coio', 'comp osc', row('jacks', jack('co.wsCv'), jack('co.osc'), jack('lpg1.in')));
  const pre = box(
    'top m-pre',
    'preamp / envelope det',
    row('jacks', jack('pre.in'), toggleSwitch(store, 'pre.gain', { cls: 'compact' }), h('div', { class: 'stack' }, L('det', 'blue'), jack('pre.envOut'))),
  );
  const mixout = box('top m-mixout', 'mix out', row('jacks', jack('out.master1', { label: '' }), jack('out.master2', { label: '' })), h('span', { class: 'jack-label wide' }, 'master out'));

  // ================================================================ switch strip
  const stageLeds = [];
  const pulseSeq = h(
    'div',
    { class: 'pulse-seq' },
    [1, 2, 3, 4, 5].map((n) => {
      const l = led('seq');
      stageLeds.push(l);
      return h('div', { class: 'ps' }, h('span', { class: 'ps-num' }, n), pulseToggle(store, `seq.p${n}`), l);
    }),
  );
  leds.stages = stageLeds;
  const swSeq = box(
    'sw m-seq',
    'sequential voltage',
    row('', toggleSwitch(store, 'seq.trig'), toggleSwitch(store, 'seq.stages')),
    pulseSeq,
    h('span', { class: 'ctl-label sw-title' }, 'pulse sequence'),
  );
  const swRand = box('sw m-rand', 'random voltage', toggleSwitch(store, 'rand.trig', { labels: ['pulser', 'seq'] }), L('rand', 'rand'));
  const swEnv = box(
    'sw m-env',
    'envelope generator',
    toggleSwitch(store, 'env.trig', { labels: ['pulser', 'sequencer'] }),
    row('', toggleSwitch(store, 'env.mode'), L('env', 'env')),
  );
  const swPulser = box(
    'sw m-pulser',
    'pulser',
    toggleSwitch(store, 'pulser.trig'),
    toggleSwitch(store, 'pulser.mode'),
    row(
      'one-row',
      L('pulse', 'pulser'),
      h('button', { type: 'button', class: 'one', title: 'Fire one pulser cycle (also starts a transient pulser)', onclick: () => onOne?.() }, h('span', { class: 'sr-only' }, 'one')),
      h('span', { class: 'ctl-label' }, 'one'),
    ),
  );
  const swMo = box(
    'sw m-mo',
    'modulation oscillator',
    row('', knob(store, 'mo.fmLevel', { size: 'md' }), toggleSwitch(store, 'mo.wave', { icons: ['saw', 'square', 'tri'] })),
    row('', toggleSwitch(store, 'mo.range'), knob(store, 'mo.fine', { size: 'md' }), toggleSwitch(store, 'mo.mode', { labels: ['bal. ext', 'a.m. osc', 'f.m. osc'] })),
  );
  const swCo = box(
    'sw m-co',
    'complex oscillator',
    row('', toggleSwitch(store, 'co.polarity'), knob(store, 'co.fine', { size: 'md' })),
    row(
      'shape-row',
      h('div', { class: 'shape-knob' }, iconEl('sine'), knob(store, 'co.shape', { size: 'lg', label: null })),
      toggleSwitch(store, 'co.wave', { icons: ['spike', 'square', 'tri'], label: 'waveshape' }),
    ),
  );
  const swLpg = box(
    'sw m-lpg',
    'dual lo pass gate',
    row('', toggleSwitch(store, 'lpg.src', { label: 'gate 2 source' }), h('div', { class: 'stack gate-leds' }, L('v1', 'lpg', { label: '1' }), L('v2', 'lpg', { label: '2' }))),
    row(
      'modes',
      toggleSwitch(store, 'lpg1.mode', { label: 'gate 1', labels: ['', '', ''] }),
      h('div', { class: 'mode-legend', 'aria-hidden': 'true' }, h('span', {}, 'lo pass filter'), h('span', {}, 'combination'), h('span', {}, 'voltage cntrld amp')),
      toggleSwitch(store, 'lpg2.mode', { label: 'gate 2', labels: ['', '', ''] }),
    ),
  );

  // ================================================================ sliders + jack field
  const randMeter = h('div', { class: 'rand-meter', 'aria-hidden': 'true' }, h('i', { class: 'rand-fill' }));
  leds.randMeter = randMeter;

  const bSeq = bank(
    'm-seq',
    [{ scale: 'ten' }, S('seq.s1'), S('seq.s2'), S('seq.s3'), S('seq.s4'), S('seq.s5')],
    [null, 'mo.freqIn', 'seq.1', 'rand.1', 'seq.2', 'env.1'],
    [null, null, 'pulser.1', null, 'rand.2', null],
  );
  const bRand = bank('m-rand', [{ el: h('div', { class: 'meter-col' }, randMeter, h('span', { class: 'ctl-label' }, 'voltage')) }], ['rand.3'], ['rand.4']);
  const bEnv = bank(
    'm-env',
    [{ scale: 'time' }, S('env.attack'), S('env.sustain'), S('env.decay')],
    [null, 'env.attackCv', 'env.sustainCv', 'env.decayCv'],
    [null, 'seq.3', 'env.2', 'rand.5'],
  );
  // In each CV pair the source multiples sit under the printed scale, right
  // beside the black CV input, so a shorting bar reaches them.
  const bPulser = bank('m-pulser', [S('pulser.periodCv'), { scale: 'time' }, S('pulser.period')], ['pulser.periodCv', 'env.3'], [null, 'rand.6']);
  const bMo = bank(
    'm-mo',
    [S('mo.freqCv'), { scale: 'mo' }, S('mo.freq'), S('mo.indexCv'), { scale: 'ten' }, S('mo.index')],
    ['mo.freqCv', 'pulser.2', null, 'mo.indexCv', 'seq.4'],
    [null, 'rand.7', null, null, 'rand.8'],
  );
  const bCo = bank(
    'm-co',
    [S('co.pitchCv'), { scale: 'pitch' }, S('co.pitch'), S('co.timbreCv'), { scale: 'ten' }, S('co.timbre')],
    ['co.pitchCv', 'seq.5', null, 'co.timbreCv', 'pulser.3'],
    [null, 'env.4', null, null, 'rand.9'],
  );
  const bLpg = bank(
    'm-lpg',
    [S('lpg1.levelCv'), { scale: 'ten' }, S('lpg1.level'), S('lpg2.levelCv'), { scale: 'ten' }, S('lpg2.level')],
    ['lpg1.cv', 'env.5', null, 'lpg2.cv', 'pulser.4'],
    [null, 'rand.10', null, null, 'seq.6'],
  );

  // ================================================================ output column
  const out = h(
    'section',
    { class: 'box out-col m-out', 'aria-label': 'Output' },
    row('', knob(store, 'out.b', { size: 'md', dial: true }), knob(store, 'out.a', { size: 'md', dial: true })),
    row('', knob(store, 'out.reverb', { size: 'md', dial: true }), knob(store, 'out.monitor', { size: 'md', dial: true })),
    row('small', jack('lpg2.sig'), L('peak', 'out', { label: 'level' }), L('limit', 'limit', { label: 'limit' })),
    row('', knob(store, 'out.master', { size: 'xl', dial: true })),
  );

  const panel = h(
    'div',
    { class: 'panel-grid' },
    h('div', { class: 'cell title' }, title),
    h('div', { class: 'cell t-mo' }, modio),
    h('div', { class: 'cell t-co' }, inv, coio),
    h('div', { class: 'cell t-lpg' }, pre),
    h('div', { class: 'cell t-out' }, mixout),
    swSeq,
    swRand,
    swEnv,
    swPulser,
    swMo,
    swCo,
    swLpg,
    bSeq,
    bRand,
    bEnv,
    bPulser,
    bMo,
    bCo,
    bLpg,
    out,
  );
  root.append(panel);

  const jacks = new Map();
  for (const el of root.querySelectorAll('.jack')) jacks.set(el.dataset.jack, el);
  return { jacks, leds, programCard };
}
