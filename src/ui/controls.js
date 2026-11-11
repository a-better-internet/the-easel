// Panel controls. Every control reads and writes the Store, so presets,
// loading and undo all flow through one place.

import { PARAM_BY_ID, BUS_SOURCES, JACK_BY_ID } from '../spec.js';
import { formatParam, paramTitle } from './format.js';

/** Minimal hyperscript. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------------------------------------------------------------------------
// Floating read-out
// ---------------------------------------------------------------------------
let readoutEl = null;
let readoutOwner = null;

function readout() {
  if (!readoutEl) {
    readoutEl = h('div', { class: 'readout', role: 'status', 'aria-live': 'off' });
    document.body.append(readoutEl);
  }
  return readoutEl;
}

export function showReadout(anchor, title, value) {
  const el = readout();
  el.replaceChildren(h('span', { class: 'readout-title' }, title), h('span', { class: 'readout-value' }, value));
  el.classList.add('visible');
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  let y = r.top - el.offsetHeight - 8;
  if (y < 8) y = r.bottom + 8;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  readoutOwner = anchor;
}

export function hideReadout(anchor) {
  if (readoutEl && (!anchor || anchor === readoutOwner)) readoutEl.classList.remove('visible');
}

function bindReadout(store, id, el, getAnchor = () => el) {
  const show = () => showReadout(getAnchor(), paramTitle(id), formatParam(id, store.get(id), store.params));
  el.addEventListener('pointerenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerleave', () => {
    if (!el.classList.contains('dragging')) hideReadout(getAnchor());
  });
  el.addEventListener('blur', () => hideReadout(getAnchor()));
  return show;
}

// ---------------------------------------------------------------------------
// Continuous controls (slider / knob) share drag + keyboard handling
// ---------------------------------------------------------------------------
function continuousInput(store, id, el, { travel, min, max, onJump }) {
  const p = PARAM_BY_ID[id];
  const showValue = bindReadout(store, id, el);

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    if (onJump) onJump(e);
    let last = e.clientY;
    let value = store.get(id);
    const move = (ev) => {
      const dy = last - ev.clientY;
      last = ev.clientY;
      const scale = ev.shiftKey ? 0.1 : 1;
      value = Math.min(max, Math.max(min, value + (dy / travel()) * (max - min) * scale));
      store.set(id, value);
      showValue();
    };
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!el.matches(':hover')) hideReadout(el);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    showValue();
  });

  el.addEventListener('dblclick', () => {
    store.set(id, p.def);
    showValue();
  });

  el.addEventListener('keydown', (e) => {
    const span = max - min;
    const step = e.shiftKey ? span / 1000 : span / 100;
    let v = store.get(id);
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        v += step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        v -= step;
        break;
      case 'PageUp':
        v += span / 10;
        break;
      case 'PageDown':
        v -= span / 10;
        break;
      case 'Home':
        v = min;
        break;
      case 'End':
        v = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    store.set(id, Math.min(max, Math.max(min, v)));
    showValue();
  });
}

function setAria(el, store, id, v) {
  const p = PARAM_BY_ID[id];
  el.setAttribute('aria-valuenow', (v * 10).toFixed(1));
  el.setAttribute('aria-valuetext', formatParam(id, v, store.params));
  if (p.bipolar) el.setAttribute('aria-valuemin', '-10');
}

/** Vertical slide pot, Easel style. */
export function slider(store, id, { label, cls = '', size = 'md' } = {}) {
  const p = PARAM_BY_ID[id];
  const cap = h('div', { class: 'slider-cap' });
  const fill = h('div', { class: 'slider-fill' });
  const track = h(
    'div',
    {
      class: 'slider-track',
      role: 'slider',
      tabindex: '0',
      'aria-label': paramTitle(id),
      'aria-orientation': 'vertical',
      'aria-valuemin': '0',
      'aria-valuemax': '10',
      dataset: { param: id },
    },
    h('div', { class: 'slider-scale' }),
    h('div', { class: 'slider-slot' }, fill),
    cap,
  );
  const travel = () => Math.max(20, track.clientHeight - cap.offsetHeight);
  const jump = (e) => {
    // clicking the slot (not the cap) moves the cap there first
    if (e.target === cap) return;
    const r = track.getBoundingClientRect();
    const capH = cap.offsetHeight;
    const v = 1 - (e.clientY - r.top - capH / 2) / (r.height - capH);
    store.set(id, Math.min(1, Math.max(0, v)));
  };
  continuousInput(store, id, track, { travel, min: 0, max: 1, onJump: jump });
  const update = (v) => {
    track.style.setProperty('--v', v);
    setAria(track, store, id, v);
  };
  store.subscribe(id, update);
  update(store.get(id));
  return h('div', { class: `ctl slider size-${size} ${cls}`, dataset: { param: id } }, track, h('label', { class: 'ctl-label' }, label ?? p.label));
}

/** Small rotary knob. */
export function knob(store, id, { label, cls = '' } = {}) {
  const p = PARAM_BY_ID[id];
  const min = p.bipolar ? -1 : 0;
  const body = h(
    'div',
    {
      class: 'knob-body',
      role: 'slider',
      tabindex: '0',
      'aria-label': paramTitle(id),
      'aria-valuemin': '0',
      'aria-valuemax': '10',
      dataset: { param: id },
    },
    h('div', { class: 'knob-pointer' }),
  );
  continuousInput(store, id, body, { travel: () => 160, min, max: 1 });
  const update = (v) => {
    const t = (v - min) / (1 - min);
    body.style.setProperty('--angle', `${-135 + t * 270}deg`);
    setAria(body, store, id, v);
  };
  store.subscribe(id, update);
  update(store.get(id));
  return h(
    'div',
    { class: `ctl knob ${p.bipolar ? 'bipolar' : ''} ${cls}`, dataset: { param: id } },
    body,
    h('label', { class: 'ctl-label' }, label ?? p.label),
  );
}

/** Multi-position switch rendered as a column of lit option buttons. */
export function switchCtl(store, id, { label, labels, cls = '', horizontal = false } = {}) {
  const p = PARAM_BY_ID[id];
  const opts = p.options.map((o, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'sw-opt',
        role: 'radio',
        'aria-checked': 'false',
        tabindex: '-1',
        onclick: () => store.set(id, i),
      },
      h('i', { class: 'led' }),
      h('span', {}, labels?.[i] ?? o),
    ),
  );
  const group = h(
    'div',
    {
      class: `sw-group ${horizontal ? 'horizontal' : ''}`,
      role: 'radiogroup',
      'aria-label': paramTitle(id),
      dataset: { param: id },
    },
    opts,
  );
  group.addEventListener('keydown', (e) => {
    const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const n = p.options.length;
    const v = (store.get(id) + dir + n) % n;
    store.set(id, v);
    opts[v].focus();
  });
  const update = (v) => {
    opts.forEach((o, i) => {
      o.setAttribute('aria-checked', String(i === v));
      o.tabIndex = i === v ? 0 : -1;
    });
  };
  store.subscribe(id, update);
  update(store.get(id));
  const lab = label === null ? null : h('span', { class: 'ctl-label sw-title' }, label ?? p.label);
  return h('div', { class: `ctl switch ${cls}`, dataset: { param: id } }, lab, group);
}

/** Two-state toggle (sequencer per-stage pulse switches). Option 0 is "on". */
export function toggle(store, id, { label } = {}) {
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'toggle',
      'aria-label': paramTitle(id),
      onclick: () => store.set(id, store.get(id) === 0 ? 1 : 0),
      dataset: { param: id },
    },
    h('i', { class: 'toggle-lever' }),
  );
  const update = (v) => btn.setAttribute('aria-pressed', String(v === 0));
  store.subscribe(id, update);
  update(store.get(id));
  return h('div', { class: 'ctl toggle-ctl' }, btn, label ? h('span', { class: 'ctl-label' }, label) : null);
}

/** Control-bus source selector: five colour-coded dots. */
export function busSelect(store, id) {
  const dots = BUS_SOURCES.map((s, i) =>
    h('button', {
      type: 'button',
      class: `bus-dot c-${s.color}`,
      role: 'radio',
      'aria-checked': 'false',
      'aria-label': s.name,
      title: s.name,
      tabindex: '-1',
      onclick: () => store.set(id, i),
    }),
  );
  const group = h(
    'div',
    { class: 'bus', role: 'radiogroup', 'aria-label': paramTitle(id), dataset: { param: id } },
    dots,
  );
  group.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const n = BUS_SOURCES.length;
    const v = (store.get(id) + dir + n) % n;
    store.set(id, v);
    dots[v].focus();
  });
  const show = bindReadout(store, id, group);
  const update = (v) => {
    dots.forEach((d, i) => {
      d.setAttribute('aria-checked', String(i === v));
      d.tabIndex = i === v ? 0 : -1;
    });
    if (group.matches(':hover')) show();
  };
  store.subscribe(id, update);
  update(store.get(id));
  return group;
}

/** Mod-depth slider with its bus selector underneath. */
export function modSlider(store, depthId, srcId, opts = {}) {
  const s = slider(store, depthId, { ...opts, cls: `mod ${opts.cls ?? ''}` });
  s.insertBefore(busSelect(store, srcId), s.querySelector('.ctl-label'));
  s.dataset.src = srcId;
  return s;
}

/** Panel LED. Level set via setLed(). */
export function led(color, { label, cls = '' } = {}) {
  const el = h('i', { class: `led panel-led c-${color} ${cls}`, 'aria-hidden': 'true' });
  return label ? h('span', { class: 'led-wrap' }, el, h('span', { class: 'ctl-label' }, label)) : el;
}

export function setLed(el, level) {
  const v = Math.max(0, Math.min(1, level));
  el.style.setProperty('--lvl', v.toFixed(3));
}

/** Banana jack. */
export function jack(id, { label } = {}) {
  const j = JACK_BY_ID[id];
  const btn = h('button', {
    type: 'button',
    class: `jack ${j.dir} kind-${j.kind} c-${j.module}`,
    'aria-label': `${j.dir === 'out' ? 'Output' : 'Input'} jack: ${label ?? j.label}`,
    dataset: { jack: id },
  });
  return h('div', { class: `jack-wrap ${j.dir}` }, btn, h('span', { class: 'jack-label' }, label ?? j.label));
}
