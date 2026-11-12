// Patch cables with banana-plug stacking.
//
// Interaction model
// - Drag from a jack to start a new cable. Drop it on a jack, or on any plug
//   head already in a jack: the new plug stacks onto that plug and inherits
//   its jack (unrestricted west-coast rules, so out->in, out->out and in->in
//   are all allowed; only a cable looped onto its own jack is refused).
// - Drag a plug head to pull that end out and move it ("destructive handoff":
//   the connection is broken the moment the plug leaves the jack). Dropping it
//   anywhere that isn't a jack or plug deletes the cable.
// - Alt/Option-drag a plug head to start a new cable stacked on it.
// - Shift-click a plug or (with Shift held) a cable to delete it. Double-tap a
//   plug does the same, for touch screens.
// - Click a jack, then another jack (or plug) to patch without dragging. This
//   is also how keyboard patching works: Enter on one jack, Enter on another.
//   Delete/Backspace on a focused jack pulls its top plug.

import { PatchGraph } from '../patch/graph.js';
import { JACK_BY_ID, jackColor, jackName } from '../spec.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 4;
const DOUBLE_TAP_MS = 320;
export const STACK_OFFSET = 6;
/** Plug-head radii [body, ring, tip] for banana plugs, Tini-Jax plugs and bar screws. */
const PLUG_RADII = { banana: [7.5, 5, 2.4], tiny: [6.5, 4, 2], bar: [5.5, 3.6, 1.2] };
/** Cables whose ends are both above this line (panel px) loop upward. */
const TOP_STRIP = 90;
/** Two banana jacks closer than this (panel px) are joined by a shorting bar. */
export const BAR_REACH = 78;

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Banana-plug coordinate helper. Each plug stacked on a jack sits a little
 * further up and to the right, as if extending out toward the player.
 * Coordinates are in the cable layer's own (unscaled) pixels; `origin` is its
 * bounding rect plus the CSS scale the panel is drawn at.
 */
export function getStackedCenter(element, stackIndex, origin = { left: 0, top: 0, scale: 1 }) {
  const rect = element.getBoundingClientRect();
  const k = origin.scale || 1;
  let x = (rect.left + rect.width / 2 - origin.left) / k;
  let y = (rect.top + rect.height / 2 - origin.top) / k;
  if (stackIndex > 0) {
    x += STACK_OFFSET * stackIndex;
    y -= STACK_OFFSET * stackIndex;
  }
  return { x, y };
}

/**
 * A hanging cable. `floor` (optional) caps how far below the panel it may
 * droop: a cubic with both control points `sag` below the ends bottoms out
 * about 0.75 * sag below the lower end.
 */
export function cablePath(a, b, floor = Infinity, loopUp = false) {
  const dx = b.x - a.x;
  const dist = Math.hypot(dx, b.y - a.y);
  let sag = Math.min(150, 26 + dist * 0.3);
  sag = Math.max(18, Math.min(sag, (floor - Math.max(a.y, b.y)) / 0.75));
  // stiff short cables between jacks along the top edge loop up over the panel
  if (loopUp) sag = -Math.min(80, 24 + dist * 0.22);
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${(a.x + dx * 0.18).toFixed(1)},${(a.y + sag).toFixed(1)} ${(b.x - dx * 0.18).toFixed(1)},${(b.y + sag).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

export class Patchbay {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container  positioned element the cables are drawn over
   * @param {Map<string, HTMLElement>} o.jacks  jack id -> jack element
   * @param {(nets: any[]) => void} o.onChange
   * @param {(msg: string) => void} [o.announce]
   */
  constructor({ container, jacks, onChange, announce }) {
    this.container = container;
    this.jacks = jacks;
    this.onChange = onChange;
    this.announce = announce || (() => {});
    this.graph = new PatchGraph(JACK_BY_ID);
    this.views = new Map();
    this.drag = null;
    this.press = null;
    this.pending = null;
    this.lastTap = { cable: null, t: 0 };
    this.suppressClick = false;
    this.hoverTarget = null;

    this.svg = svg('svg', { class: 'cables', 'aria-hidden': 'true' });
    this.cableLayer = svg('g', { class: 'cable-layer' });
    this.plugLayer = svg('g', { class: 'plug-layer' });
    this.svg.append(this.cableLayer, this.plugLayer);
    container.append(this.svg);

    this.bindJacks();
    this.bindGlobal();
  }

  // ------------------------------------------------------------ public API
  load(list) {
    this.cancelPending();
    try {
      this.graph.load(list);
    } catch (err) {
      console.error('patch load failed', err);
      this.graph.clear();
    }
    this.refresh();
    this.emit();
  }

  serialize() {
    return this.graph.serialize();
  }

  clear() {
    this.graph.clear();
    this.refresh();
    this.emit();
    this.announce('All cables removed');
  }

  connect(a, b) {
    if (!a || !b || a === b) return false;
    const id = this.graph.addCable(a, b);
    this.raise(id);
    this.refresh();
    this.emit();
    this.announce(`Patched ${this.jackName(a)} to ${this.jackName(b)}`);
    return true;
  }

  removeCable(id) {
    if (!this.graph.removeCable(id)) return;
    this.refresh();
    this.emit();
    this.announce('Cable removed');
  }

  jackName(id) {
    return jackName(id);
  }

  /**
   * The current patch as a list of connections, outputs first:
   * [{ id, from, to, style: 'bar'|'tini'|'cable', stacked, color }]
   */
  describe() {
    const rows = [];
    for (const cable of this.graph.cables.values()) {
      let [a, b] = cable.ends;
      if (!a.jack || !b.jack) continue;
      let ends = [0, 1];
      if (JACK_BY_ID[a.jack].dir === 'in' && JACK_BY_ID[b.jack].dir === 'out') {
        [a, b] = [b, a];
        ends = [1, 0];
      }
      const style = this.views.get(cable.id)?.g.dataset.style || 'cable';
      rows.push({
        id: cable.id,
        from: a.jack,
        to: b.jack,
        style,
        stacked: ends.some((e) => this.graph.stackIndex(cable.id, e) > 0),
        color: this.colorFor(cable),
      });
    }
    return rows;
  }

  /** Highlight one cable (from the patch sheet). */
  setHot(id, on) {
    const v = this.views.get(id);
    if (!v) return;
    v.g.classList.toggle('hot', on);
    v.g.classList.toggle('sheet-hot', on);
    for (const p of v.plugs) p.classList.toggle('sheet-hot', on);
    if (on) this.cableLayer.append(v.g);
  }

  emit() {
    let nets = [];
    try {
      nets = this.graph.nets();
    } catch (err) {
      console.error('net computation failed', err);
    }
    this.onChange?.(nets);
  }

  // ------------------------------------------------------------ views
  colorFor(cable) {
    const ends = cable.ends.map((e) => e.jack && JACK_BY_ID[e.jack]).filter(Boolean);
    const src = ends.find((j) => j.dir === 'out') || ends[0];
    return src ? `var(--cable-${jackColor(src)})` : 'var(--cable-black)';
  }

  /** 'bar' (shorting bar), 'tini' (Tini-Jax cable) or 'cable' (banana cable). */
  styleFor(cable, a, b) {
    const types = cable.ends.map((e) => e.jack && JACK_BY_ID[e.jack]?.type);
    if (types[0] === 'tiny' && types[1] === 'tiny') return 'tini';
    if (a && b && types[0] === 'banana' && types[1] === 'banana' && !(this.drag && this.drag.cableId === cable.id)) {
      if (Math.hypot(a.x - b.x, a.y - b.y) <= BAR_REACH) return 'bar';
    }
    return 'cable';
  }

  makeView(id) {
    const g = svg('g', { class: 'cable', 'data-cable': id });
    const shadow = svg('path', { class: 'cable-shadow' });
    const core = svg('path', { class: 'cable-core' });
    const shine = svg('path', { class: 'cable-shine' });
    const hit = svg('path', { class: 'cable-hit' });
    g.append(shadow, core, shine, hit);
    const plugs = [0, 1].map((end) => {
      const p = svg('g', { class: 'plug', 'data-cable': id, 'data-end': end });
      p.append(
        svg('circle', { class: 'plug-hit', r: 10 }),
        svg('circle', { class: 'plug-body', r: 7.5 }),
        svg('circle', { class: 'plug-ring', r: 5 }),
        svg('circle', { class: 'plug-tip', r: 2.4 }),
      );
      p.addEventListener('pointerdown', (e) => this.onPlugDown(e, id, end));
      p.addEventListener('pointerenter', () => g.classList.add('hot'));
      p.addEventListener('pointerleave', () => g.classList.remove('hot'));
      return p;
    });
    hit.addEventListener('pointerdown', (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this.removeCable(id);
      }
    });
    hit.addEventListener('pointerenter', () => g.classList.add('hot'));
    hit.addEventListener('pointerleave', () => g.classList.remove('hot'));
    this.cableLayer.append(g);
    this.plugLayer.append(...plugs);
    const view = { g, shadow, core, shine, hit, plugs };
    this.views.set(id, view);
    return view;
  }

  /** Newest connection renders on top. */
  raise(id) {
    const v = this.views.get(id);
    if (v) this.cableLayer.append(v.g);
  }

  origin() {
    const r = this.svg.getBoundingClientRect();
    const w = this.container.offsetWidth;
    return { left: r.left, top: r.top, width: r.width, height: r.height, scale: w > 0 ? r.width / w : 1 };
  }

  endPoint(id, end, origin) {
    const e = this.graph.cables.get(id).ends[end];
    if (e.jack) {
      const el = this.jacks.get(e.jack);
      if (!el) return null;
      return getStackedCenter(el, this.graph.stackIndex(id, end), origin);
    }
    return this.drag && this.drag.cableId === id ? this.dragPos : null;
  }

  renderCable(id, origin = this.origin()) {
    const cable = this.graph.cables.get(id);
    if (!cable) return;
    const v = this.views.get(id) || this.makeView(id);
    const a = this.endPoint(id, 0, origin);
    const b = this.endPoint(id, 1, origin);
    const color = this.colorFor(cable);
    const style = this.styleFor(cable, a, b);
    v.g.style.setProperty('--cc', color);
    v.g.dataset.style = style;
    v.plugs.forEach((p, end) => {
      const pt = end === 0 ? a : b;
      const j = cable.ends[end].jack && JACK_BY_ID[cable.ends[end].jack];
      p.style.setProperty('--cc', color);
      const ps = style === 'bar' ? 'bar' : (j?.type ?? (style === 'tini' ? 'tiny' : 'banana'));
      if (p.dataset.style !== ps) {
        p.dataset.style = ps;
        const [rb, rr, rt] = PLUG_RADII[ps];
        const [, body, ring, tip] = p.children;
        body.setAttribute('r', rb);
        ring.setAttribute('r', rr);
        tip.setAttribute('r', rt);
      }
      p.style.display = pt ? '' : 'none';
      if (pt) p.setAttribute('transform', `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
    });
    if (!a || !b) {
      v.g.style.display = 'none';
      return;
    }
    v.g.style.display = '';
    const d = style === 'bar' ? `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}` : cablePath(a, b, origin.height / origin.scale + 26, Math.max(a.y, b.y) < TOP_STRIP);
    v.shadow.setAttribute('d', d);
    v.core.setAttribute('d', d);
    v.shine.setAttribute('d', d);
    v.hit.setAttribute('d', d);
  }

  /** Full re-render: create/remove views, reposition, restack plugs. */
  refresh() {
    for (const [id, v] of this.views) {
      if (!this.graph.cables.has(id)) {
        v.g.remove();
        v.plugs.forEach((p) => p.remove());
        this.views.delete(id);
      }
    }
    const origin = this.origin();
    for (const id of this.graph.cables.keys()) this.renderCable(id, origin);
    this.sortPlugs();
    this.markJacks();
  }

  /** Higher stack positions render later, so stacked plugs sit on top. */
  sortPlugs() {
    const items = [];
    for (const [id, v] of this.views) {
      const cable = this.graph.cables.get(id);
      v.plugs.forEach((el, end) => {
        const floating = !cable.ends[end].jack;
        items.push({ el, idx: floating ? 1e6 : this.graph.stackIndex(id, end), order: cable.ends[end].order });
      });
    }
    items.sort((x, y) => x.idx - y.idx || x.order - y.order);
    for (const it of items) this.plugLayer.append(it.el);
  }

  markJacks() {
    for (const [id, el] of this.jacks) {
      const n = this.graph.stack(id).length;
      el.classList.toggle('occupied', n > 0);
      if (n > 1) el.dataset.stack = String(n);
      else delete el.dataset.stack;
    }
  }

  // ------------------------------------------------------------ input
  bindJacks() {
    for (const [id, el] of this.jacks) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this.suppressClick = false;
        this.press = { type: 'jack', jack: id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      });
      el.addEventListener('click', (e) => {
        if (this.suppressClick) {
          this.suppressClick = false;
          return;
        }
        e.stopPropagation();
        this.tapJack(id);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const top = this.graph.topPlug(id);
          if (top) {
            e.preventDefault();
            this.removeCable(top.cable);
          }
        }
      });
    }
  }

  bindGlobal() {
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') document.body.classList.add('shift-down');
      if (e.key === 'Escape') {
        if (this.drag) this.endDrag(null, true);
        this.cancelPending();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') document.body.classList.remove('shift-down');
    });
    window.addEventListener('blur', () => document.body.classList.remove('shift-down'));
    document.addEventListener('click', (e) => {
      if (this.pending && !e.target.closest?.('.jack, .plug')) this.cancelPending();
    });
    const ro = new ResizeObserver(() => this.refresh());
    ro.observe(this.container);
    window.addEventListener('resize', () => this.refresh());
  }

  onPlugDown(e, cableId, end) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      this.removeCable(cableId);
      return;
    }
    this.suppressClick = false;
    this.press = { type: 'plug', cable: cableId, end, alt: e.altKey, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }

  onPointerMove(e) {
    if (this.drag) {
      if (e.pointerId !== this.drag.pointerId) return;
      this.dragPos = this.toLocal(e.clientX, e.clientY);
      this.highlight(this.targetAt(e.clientX, e.clientY));
      this.renderCable(this.drag.cableId);
      return;
    }
    const p = this.press;
    if (!p || e.pointerId !== p.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    this.press = null;
    this.cancelPending();
    if (p.type === 'jack') {
      const id = this.graph.addCable(p.jack, null);
      this.beginDrag(id, 1, e, { fresh: true });
    } else if (p.alt) {
      const jack = this.graph.cables.get(p.cable)?.ends[p.end].jack;
      if (!jack) return;
      const id = this.graph.addCable(jack, null);
      this.beginDrag(id, 1, e, { fresh: true });
    } else {
      // pick the plug up: the connection is broken immediately
      const prevJack = this.graph.cables.get(p.cable)?.ends[p.end].jack;
      this.graph.detach(p.cable, p.end);
      this.beginDrag(p.cable, p.end, e, { fresh: false, prevJack });
      this.emit();
    }
  }

  onPointerUp(e, cancelled = false) {
    if (this.drag) {
      if (e.pointerId !== this.drag.pointerId) return;
      this.endDrag(e, cancelled);
      return;
    }
    const p = this.press;
    this.press = null;
    if (!p || p.type !== 'plug' || cancelled) return;
    // a tap on a plug (no drag)
    const now = performance.now();
    if (this.lastTap.cable === p.cable && now - this.lastTap.t < DOUBLE_TAP_MS) {
      this.lastTap = { cable: null, t: 0 };
      this.removeCable(p.cable);
      return;
    }
    this.lastTap = { cable: p.cable, t: now };
    if (this.pending) {
      const jack = this.graph.resolveTarget({ cable: p.cable, end: p.end });
      const from = this.pending;
      this.cancelPending();
      if (jack && jack !== from) this.connect(from, jack);
    }
  }

  beginDrag(cableId, end, e, info) {
    this.drag = { cableId, end, pointerId: e.pointerId, ...info };
    this.suppressClick = true;
    this.dragPos = this.toLocal(e.clientX, e.clientY);
    const v = this.views.get(cableId) || this.makeView(cableId);
    v.g.classList.add('dragging');
    v.plugs.forEach((pl) => pl.classList.add('dragging'));
    this.raise(cableId);
    document.body.classList.add('patching');
    this.refresh();
  }

  /**
   * Drop validation ("destructive handoff" extended for banana stacking):
   * 1. find what is under the pointer: a plug head or a jack;
   * 2. a plug head resolves to the jack it sits in (inheritance);
   * 3. refuse a cable looping onto its own jack;
   * 4. anything else destroys the cable.
   */
  endDrag(e, cancelled) {
    const { cableId, end, prevJack } = this.drag;
    const target = cancelled || !e ? null : this.targetAt(e.clientX, e.clientY);
    const jack = this.graph.resolveTarget(target);
    let outcome;
    try {
      if (jack && this.graph.canDrop(cableId, end, jack)) {
        this.graph.attach(cableId, end, jack);
        outcome = target.cable != null ? 'stacked' : 'patched';
      } else if (cancelled && prevJack) {
        this.graph.attach(cableId, end, prevJack);
        outcome = 'restored';
      } else {
        this.graph.removeCable(cableId);
        outcome = 'removed';
      }
    } catch (err) {
      console.error('patch drop failed', err);
      this.graph.removeCable(cableId);
      outcome = 'removed';
    }
    const v = this.views.get(cableId);
    if (v) {
      v.g.classList.remove('dragging');
      v.plugs.forEach((pl) => pl.classList.remove('dragging'));
    }
    this.highlight(null);
    document.body.classList.remove('patching');
    this.drag = null;
    this.refresh();
    this.emit();
    if (outcome === 'stacked') this.announce(`Plug stacked on ${this.jackName(jack)}`);
    else if (outcome === 'patched') this.announce(`Patched to ${this.jackName(jack)}`);
    else if (outcome === 'removed') this.announce('Cable removed');
  }

  targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const plug = el.closest('.plug');
    if (plug && !plug.classList.contains('dragging')) return { cable: Number(plug.dataset.cable), end: Number(plug.dataset.end), el: plug };
    const jack = el.closest('.jack');
    if (jack) return { jack: jack.dataset.jack, el: jack };
    return null;
  }

  highlight(target) {
    const el = target?.el || null;
    if (this.hoverTarget === el) return;
    this.hoverTarget?.classList.remove('drop-target', 'drop-refused');
    this.hoverTarget = el;
    if (!el || !this.drag) return;
    const jack = this.graph.resolveTarget(target);
    el.classList.add(this.graph.canDrop(this.drag.cableId, this.drag.end, jack) ? 'drop-target' : 'drop-refused');
  }

  toLocal(x, y) {
    const o = this.origin();
    return { x: (x - o.left) / o.scale, y: (y - o.top) / o.scale };
  }

  // ------------------------------------------------------------ click-to-patch
  tapJack(id) {
    if (this.pending) {
      const from = this.pending;
      this.cancelPending();
      if (from !== id) this.connect(from, id);
      return;
    }
    this.pending = id;
    this.jacks.get(id)?.classList.add('pending');
    document.body.classList.add('pending-patch');
    this.announce(`Patching from ${this.jackName(id)}. Choose another jack, or press Escape.`);
  }

  cancelPending() {
    if (!this.pending) return;
    this.jacks.get(this.pending)?.classList.remove('pending');
    document.body.classList.remove('pending-patch');
    this.pending = null;
  }
}
