// Panel controls. Every control reads and writes the Store, so presets,
// loading and step-through patches all flow through one place.
//
// The panel may be CSS-scaled to fit the window, so all pointer maths uses
// client (on-screen) pixels from getBoundingClientRect().

import { PARAM_BY_ID, JACK_BY_ID, jackColor } from '../spec.js';
import { formatParam, paramTitle } from './format.js';

/** Minimal hyperscript. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
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
    readoutEl = h('div', { class: 'readout', 'aria-hidden': 'true' });
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

function bindReadout(store, id, el) {
  const show = () => showReadout(el, paramTitle(id), formatParam(id, store.get(id), store.params));
  el.addEventListener('pointerenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerleave', () => {
    if (!el.classList.contains('dragging')) hideReadout(el);
  });
  el.addEventListener('blur', () => hideReadout(el));
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
  el.setAttribute('aria-valuenow', (v * 10).toFixed(1));
  el.setAttribute('aria-valuetext', formatParam(id, v, store.params));
}

/** Vertical slide pot. The cap colour comes from --cap on an ancestor. */
export function slider(store, id, { label, cls = '' } = {}) {
  const p = PARAM_BY_ID[id];
  const cap = h('div', { class: 'slider-cap' });
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
    h('div', { class: 'slider-slot' }),
    cap,
  );
  const travel = () => {
    const t = track.getBoundingClientRect().height;
    const c = cap.getBoundingClientRect().height;
    return Math.max(10, t - c);
  };
  const jump = (e) => {
    // clicking the slot (not the cap) moves the cap there first
    if (e.target === cap) return;
    const r = track.getBoundingClientRect();
    const c = cap.getBoundingClientRect().height;
    const v = 1 - (e.clientY - r.top - c / 2) / (r.height - c);
    store.set(id, Math.min(1, Math.max(0, v)));
  };
  continuousInput(store, id, track, { travel, min: 0, max: 1, onJump: jump });
  const update = (v) => {
    track.style.setProperty('--v', v);
    setAria(track, store, id, v);
  };
  store.subscribe(id, update);
  update(store.get(id));
  return h(
    'div',
    { class: `ctl slider ${p.cv ? 'cv' : ''} ${cls}`, dataset: { param: id } },
    track,
    h('label', { class: 'ctl-label' }, label ?? (p.cv ? 'cv' : p.label)),
  );
}

/** Rotary knob. size: 'sm' | 'md' | 'lg' | 'xl'. */
export function knob(store, id, { label, cls = '', size = 'md', dial = false } = {}) {
  const p = PARAM_BY_ID[id];
  const min = p.bipolar ? -1 : 0;
  const body = h(
    'div',
    {
      class: 'knob-body',
      role: 'slider',
      tabindex: '0',
      'aria-label': paramTitle(id),
      'aria-valuemin': p.bipolar ? '-10' : '0',
      'aria-valuemax': '10',
      dataset: { param: id },
    },
    h('div', { class: 'knob-skirt' }),
    h('div', { class: 'knob-cap' }, h('div', { class: 'knob-pointer' })),
  );
  continuousInput(store, id, body, { travel: () => 160, min, max: 1 });
  const update = (v) => {
    const t = (v - min) / (1 - min);
    body.style.setProperty('--angle', `${-150 + t * 300}deg`);
    setAria(body, store, id, v);
  };
  store.subscribe(id, update);
  update(store.get(id));
  const marks = dial
    ? h(
        'div',
        { class: 'dial-marks', 'aria-hidden': 'true' },
        Array.from({ length: 11 }, (_, i) => h('span', { style: { '--a': `${-150 + i * 30}deg` } }, i)),
      )
    : null;
  return h(
    'div',
    { class: `ctl knob size-${size} ${p.bipolar ? 'bipolar' : ''} ${cls}`, dataset: { param: id } },
    h('div', { class: 'knob-wrap' }, marks, body),
    label === null ? null : h('label', { class: 'ctl-label' }, label ?? p.label),
  );
}

/**
 * Bat-handle toggle switch with its positions printed beside it, as on the
 * panel. Click a printed position (or the lever, to step through them).
 * `icons` optionally replaces position labels with small SVG icons.
 */
export function toggleSwitch(store, id, { label, labels, icons, cls = '' } = {}) {
  const p = PARAM_BY_ID[id];
  const n = p.options.length;
  const opts = p.options.map((o, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'sw-opt',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': `${paramTitle(id)}: ${o}`,
        tabindex: '-1',
        onclick: () => store.set(id, i),
      },
      icons?.[i] ? iconEl(icons[i]) : (labels?.[i] ?? o),
    ),
  );
  const lever = h(
    'button',
    {
      type: 'button',
      class: 'sw-lever',
      tabindex: '-1',
      'aria-hidden': 'true',
      onclick: () => store.set(id, (store.get(id) + 1) % n),
    },
    h('i', { class: 'sw-nut' }),
    h('i', { class: 'sw-bat' }),
  );
  const group = h(
    'div',
    { class: `sw-group positions-${n}`, role: 'radiogroup', 'aria-label': paramTitle(id), dataset: { param: id } },
    lever,
    h('div', { class: 'sw-opts' }, opts),
  );
  group.addEventListener('keydown', (e) => {
    const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const v = Math.min(n - 1, Math.max(0, store.get(id) + dir));
    store.set(id, v);
    opts[v].focus();
  });
  const update = (v) => {
    group.style.setProperty('--pos', n === 1 ? 0 : v / (n - 1));
    opts.forEach((o, i) => {
      o.setAttribute('aria-checked', String(i === v));
      o.tabIndex = i === v ? 0 : -1;
    });
  };
  store.subscribe(id, update);
  update(store.get(id));
  return h(
    'div',
    { class: `ctl switch ${cls}`, dataset: { param: id } },
    group,
    label === null ? null : h('span', { class: 'ctl-label sw-title' }, label ?? p.label),
  );
}

/** Small mini-toggle for the sequencer pulse switches (option 0 is "on"). */
export function pulseToggle(store, id) {
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'mini-toggle',
      'aria-label': paramTitle(id),
      onclick: () => store.set(id, store.get(id) === 0 ? 1 : 0),
      dataset: { param: id },
    },
    h('i', { class: 'sw-nut' }),
    h('i', { class: 'sw-bat' }),
  );
  const update = (v) => btn.setAttribute('aria-pressed', String(v === 0));
  store.subscribe(id, update);
  update(store.get(id));
  return btn;
}

/** Panel LED. Level set via setLed(). */
export function led(color, { label, cls = '' } = {}) {
  const el = h('i', { class: `led c-${color} ${cls}`, 'aria-hidden': 'true' });
  return label ? h('span', { class: 'led-wrap' }, el, h('span', { class: 'ctl-label' }, label)) : el;
}

export function setLed(el, level) {
  const v = Math.max(0, Math.min(1, level));
  el.style.setProperty('--lvl', v.toFixed(3));
}

/** Banana or Tini-Jax jack. */
export function jack(id, { label, cls = '' } = {}) {
  const j = JACK_BY_ID[id];
  const name = label ?? j.label;
  const btn = h('button', {
    type: 'button',
    class: `jack ${j.dir} ${j.type} c-${jackColor(j)}`,
    'aria-label': `${j.dir === 'out' ? 'Output' : 'Input'}: ${name}${j.type === 'tiny' ? ' (Tini-Jax)' : ''}`,
    title: j.note || undefined,
    dataset: { jack: id },
  });
  return h('div', { class: `jack-wrap ${j.dir} ${j.type} ${cls}` }, btn, name ? h('span', { class: 'jack-label' }, name) : null);
}

// ---------------------------------------------------------------------------
// Little line icons printed on the panel (waveshapes etc.)
// ---------------------------------------------------------------------------
const ICONS = {
  saw: 'M1 9 L7 2 L7 9 L13 2 L13 9 L19 2 L19 9',
  square: 'M1 9 L1 2 L5 2 L5 9 L9 9 L9 2 L13 2 L13 9 L17 9 L17 2 L19 2',
  tri: 'M1 9 L4.5 2 L8 9 L11.5 2 L15 9 L18.5 2',
  sine: 'M1 5.5 C3 0 5 0 7 5.5 C9 11 11 11 13 5.5 C15 0 17 0 19 5.5',
  spike: 'M1 9 L3 9 L3.6 1.5 L4.2 9 L7 9 L7.6 1.5 L8.2 9 L11 9 L11.6 1.5 L12.2 9 L15 9 L15.6 1.5 L16.2 9 L19 9',
};

export function iconEl(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 11');
  svg.setAttribute('class', `icon icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  const wrap = h('span', { class: 'icon-wrap' });
  wrap.append(svg, h('span', { class: 'sr-only' }, name));
  return wrap;
}
