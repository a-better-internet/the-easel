// Human-readable values for the floating read-out.

import { curves, PARAM_BY_ID, MODULES } from '../spec.js';

const MODULE_NAMES = {
  seq: 'Sequencer',
  rand: 'Random',
  env: 'Envelope',
  pulser: 'Pulser',
  mo: 'Mod osc',
  co: 'Complex osc',
  lpg: 'Lo pass gate',
  lpg1: 'Gate 1',
  lpg2: 'Gate 2',
  pre: 'Preamp',
  out: 'Output',
};

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function fmtTime(s) {
  if (s < 1) return `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms`;
  return `${s.toFixed(s < 10 ? 2 : 1)} s`;
}

export function fmtHz(f) {
  if (f >= 1000) return `${(f / 1000).toFixed(2)} kHz`;
  if (f >= 10) return `${f.toFixed(1)} Hz`;
  return `${f.toFixed(2)} Hz`;
}

export function noteName(f) {
  if (!(f > 0)) return '';
  const midi = 69 + 12 * Math.log2(f / 440);
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  const name = NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  return cents === 0 ? name : `${name} ${cents > 0 ? '+' : ''}${cents}¢`;
}

export function paramTitle(id) {
  const [mod] = id.split('.');
  const p = PARAM_BY_ID[id];
  return `${MODULE_NAMES[mod] || MODULES[mod]?.title || mod} ${p?.label ?? id}`;
}

/** Value text. `params` gives context (e.g. the M.O. range switch). */
export function formatParam(id, v, params = {}) {
  const p = PARAM_BY_ID[id];
  if (!p) return String(v);
  if (p.type === 'switch' || p.type === 'toggle') return p.options[v] ?? String(v);

  const ten = (v * 10).toFixed(1);
  if (p.cv) return `${ten} · cv amount`;
  switch (id) {
    case 'pulser.period': {
      const s = curves.time(v);
      return `${fmtTime(s)} (${fmtHz(1 / s)})`;
    }
    case 'env.attack':
    case 'env.sustain':
    case 'env.decay':
      return fmtTime(curves.time(v));
    case 'mo.freq': {
      const f = (params['mo.range'] === 1 ? curves.moLow(v) : curves.pitch(v)) * curves.fine(params['mo.fine'] ?? 0);
      return fmtHz(f);
    }
    case 'co.pitch': {
      const f = curves.pitch(v) * curves.fine(params['co.fine'] ?? 0);
      return `${fmtHz(f)} · ${noteName(f)}`;
    }
    case 'mo.fine':
    case 'co.fine':
      return `${v >= 0 ? '+' : ''}${(v * 6).toFixed(2)} semitones`;
    case 'co.shape': {
      const wave = PARAM_BY_ID['co.wave'].options[params['co.wave'] ?? 0];
      return v < 0.005 ? 'sine' : `sine → ${wave} ${Math.round(v * 100)}%`;
    }
    case 'out.master':
    case 'out.monitor': {
      const g = curves.master(v);
      return `${ten} · ${g > 0 ? (20 * Math.log10(g)).toFixed(1) : '−∞'} dB`;
    }
    default:
      return ten;
  }
}
