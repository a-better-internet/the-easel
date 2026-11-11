// Tiny observable store for panel parameters.

import { defaultParams, sanitizeParam, PARAM_BY_ID } from './spec.js';

export class Store {
  constructor() {
    this.params = defaultParams();
    this.listeners = new Map(); // id -> Set<fn>
    this.any = new Set();
  }

  get(id) {
    return this.params[id];
  }

  /** Set one param. Returns true if the value changed. */
  set(id, value) {
    if (!PARAM_BY_ID[id]) return false;
    const v = sanitizeParam(id, value);
    if (this.params[id] === v) return false;
    this.params[id] = v;
    this.emit(id, v);
    return true;
  }

  /** Replace many params at once (missing ids fall back to defaults if `reset`). */
  setAll(values, { reset = false } = {}) {
    const base = reset ? defaultParams() : { ...this.params };
    for (const [id, v] of Object.entries(values || {})) {
      if (PARAM_BY_ID[id]) base[id] = sanitizeParam(id, v);
    }
    for (const id of Object.keys(base)) {
      if (this.params[id] !== base[id]) {
        this.params[id] = base[id];
        this.emit(id, base[id]);
      }
    }
  }

  subscribe(id, fn) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    this.listeners.get(id).add(fn);
    return () => this.listeners.get(id).delete(fn);
  }

  onAny(fn) {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }

  emit(id, v) {
    const set = this.listeners.get(id);
    if (set) for (const fn of set) fn(v);
    for (const fn of this.any) fn(id, v);
  }

  snapshot() {
    return { ...this.params };
  }
}
