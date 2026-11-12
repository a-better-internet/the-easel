// Value notation for patches. Sliders and knobs are written on the panel's
// 0-10 scale, switches by their printed label, and these helpers set a slider
// to a printed value instead:
//   s(seconds)  a time slider set to that time (.002 s top .. 10 s bottom)
//   hz(f)       pitch / m.o. high-range slider set to that frequency
//   lowHz(f)    m.o. low-range slider set to that frequency

import { PARAM_BY_ID, curves } from '../spec.js';

const tag = (kind, value) => ({ kind, value });
export const s = (seconds) => tag('time', seconds);
export const hz = (f) => tag('pitch', f);
export const lowHz = (f) => tag('moLow', f);

/** Invert a monotonic curve by bisection. */
export function invert(fn, target) {
  let lo = -0.75;
  let hi = 1.75;
  const rising = fn(hi) > fn(lo);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) < target === rising) lo = mid;
    else hi = mid;
  }
  return Math.min(1, Math.max(0, (lo + hi) / 2));
}

/** Turn one written value into the engine's normalised value. */
export function resolveValue(where, id, raw) {
  const p = PARAM_BY_ID[id];
  if (!p) throw new Error(`${where}: unknown param ${id}`);
  if (raw && typeof raw === 'object') {
    if (raw.kind === 'time') return invert(curves.time, raw.value);
    if (raw.kind === 'pitch') return invert(curves.pitch, raw.value);
    if (raw.kind === 'moLow') return invert(curves.moLow, raw.value);
    throw new Error(`${where}: bad value for ${id}`);
  }
  if (p.type === 'slider' || p.type === 'knob') return raw / 10;
  const i = p.options.indexOf(String(raw));
  if (i < 0) throw new Error(`${where}: ${id} has no option ${raw}`);
  return i;
}
