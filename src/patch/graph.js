// Patch graph: cables, banana-plug stacks and nets. DOM-free so it can be
// unit-tested and shared.
//
// Banana plugs stack: a plug can be pushed into the back of another plug that
// is already in a jack. The new plug *inherits* the jack underneath it, so
// for routing purposes it is simply one more plug on that jack. Each jack keeps
// an ordered stack (bottom -> top), and a plug's position in that stack is its
// `stackIndex`, which the UI uses to offset it visually.
//
// Because any jack can connect to any jack and stacks can grow without limit,
// a strict [source, destination] pair is not enough. Connected jacks are merged
// into *nets* (union-find over cables). Each net is one broadcast node: all of
// its outputs are mixed and every input on the net hears that mix.

export class PatchGraph {
  /** @param {Record<string, {dir: 'in'|'out'}>} jackDefs */
  constructor(jackDefs) {
    this.jackDefs = jackDefs;
    /** @type {Map<number, {id:number, ends:[End, End]}>} */
    this.cables = new Map();
    /** @type {Map<string, Array<{cable:number, end:number}>>} jack -> stack (bottom..top) */
    this.stacks = new Map();
    this.nextId = 1;
    this.attachCounter = 0;
  }

  hasJack(id) {
    return Object.prototype.hasOwnProperty.call(this.jackDefs, id);
  }

  /** Create a cable. Either end may be null (a floating end being dragged). */
  addCable(jackA = null, jackB = null) {
    const id = this.nextId++;
    const cable = { id, ends: [{ jack: null, order: 0 }, { jack: null, order: 0 }] };
    this.cables.set(id, cable);
    if (jackA) this.attach(id, 0, jackA);
    if (jackB) this.attach(id, 1, jackB);
    return id;
  }

  removeCable(id) {
    const cable = this.cables.get(id);
    if (!cable) return false;
    this.detach(id, 0);
    this.detach(id, 1);
    this.cables.delete(id);
    return true;
  }

  clear() {
    this.cables.clear();
    this.stacks.clear();
  }

  /** Push a cable end onto the top of a jack's stack. */
  attach(cableId, end, jackId) {
    const cable = this.cables.get(cableId);
    if (!cable) throw new Error(`no cable ${cableId}`);
    if (!this.hasJack(jackId)) throw new Error(`no jack ${jackId}`);
    this.detach(cableId, end);
    cable.ends[end].jack = jackId;
    cable.ends[end].order = ++this.attachCounter;
    if (!this.stacks.has(jackId)) this.stacks.set(jackId, []);
    this.stacks.get(jackId).push({ cable: cableId, end });
  }

  /** Pull a cable end out. Plugs stacked above it drop down one level. */
  detach(cableId, end) {
    const cable = this.cables.get(cableId);
    if (!cable) return;
    const jack = cable.ends[end].jack;
    if (!jack) return;
    const stack = this.stacks.get(jack);
    if (stack) {
      const i = stack.findIndex((p) => p.cable === cableId && p.end === end);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) this.stacks.delete(jack);
    }
    cable.ends[end].jack = null;
  }

  stack(jackId) {
    return this.stacks.get(jackId) || [];
  }

  stackIndex(cableId, end) {
    const cable = this.cables.get(cableId);
    const jack = cable?.ends[end].jack;
    if (!jack) return -1;
    return this.stack(jack).findIndex((p) => p.cable === cableId && p.end === end);
  }

  topPlug(jackId) {
    const s = this.stack(jackId);
    return s.length ? s[s.length - 1] : null;
  }

  otherEnd(cableId, end) {
    return this.cables.get(cableId)?.ends[1 - end] ?? null;
  }

  /**
   * Resolve a drop target to a jack id.
   * A target is either { jack } (a bare jack) or { cable, end } (a plug head),
   * in which case the plug's underlying jack is inherited.
   */
  resolveTarget(target) {
    if (!target) return null;
    if (target.jack) return this.hasJack(target.jack) ? target.jack : null;
    if (target.cable != null) {
      const jack = this.cables.get(target.cable)?.ends[target.end]?.jack;
      return jack || null;
    }
    return null;
  }

  /**
   * Validation for dropping one end of `cableId` onto `jackId`.
   * West-coast rules are unrestricted (out->in, out->out, in->in all fine);
   * the only illegal connection is a cable looping back to its own jack.
   */
  canDrop(cableId, end, jackId) {
    if (!jackId || !this.hasJack(jackId)) return false;
    const other = this.otherEnd(cableId, end);
    if (other && other.jack === jackId) return false;
    return true;
  }

  /** Union-find over every attached cable. Returns nets with >= 2 jacks. */
  nets() {
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) {
        const n = parent.get(x);
        parent.set(x, r);
        x = n;
      }
      return r;
    };
    const add = (x) => {
      if (!parent.has(x)) parent.set(x, x);
    };
    for (const cable of this.cables.values()) {
      const [a, b] = cable.ends;
      if (!a.jack || !b.jack) continue;
      add(a.jack);
      add(b.jack);
      const ra = find(a.jack);
      const rb = find(b.jack);
      if (ra !== rb) parent.set(ra, rb);
    }
    const groups = new Map();
    for (const jack of parent.keys()) {
      const r = find(jack);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(jack);
    }
    const nets = [];
    for (const jacks of groups.values()) {
      jacks.sort();
      const outs = jacks.filter((j) => this.jackDefs[j].dir === 'out');
      const ins = jacks.filter((j) => this.jackDefs[j].dir === 'in');
      nets.push({ jacks, outs, ins });
    }
    nets.sort((x, y) => (x.jacks[0] < y.jacks[0] ? -1 : 1));
    return nets;
  }

  /** Inputs that are driven by at least one output. */
  drivenInputs() {
    const set = new Set();
    for (const net of this.nets()) if (net.outs.length) for (const i of net.ins) set.add(i);
    return set;
  }

  /** Plain-data snapshot. Ends carry their attach order so stacks rebuild exactly. */
  serialize() {
    const cables = [];
    for (const c of this.cables.values()) {
      if (!c.ends[0].jack || !c.ends[1].jack) continue;
      cables.push([
        [c.ends[0].jack, c.ends[0].order],
        [c.ends[1].jack, c.ends[1].order],
      ]);
    }
    return cables;
  }

  /**
   * Load from serialize() output, or from simple [jackA, jackB] pairs
   * (the format used by the patch recipes). Unknown jacks are skipped.
   */
  load(list) {
    this.clear();
    if (!Array.isArray(list)) return;
    const pending = [];
    let fallbackOrder = 0;
    for (const item of list) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const ends = item.map((e) =>
        Array.isArray(e) ? { jack: e[0], order: Number(e[1]) || ++fallbackOrder } : { jack: e, order: ++fallbackOrder },
      );
      if (!ends.every((e) => typeof e.jack === 'string' && this.hasJack(e.jack))) continue;
      if (ends[0].jack === ends[1].jack) continue;
      const id = this.addCable();
      pending.push({ id, end: 0, ...ends[0] }, { id, end: 1, ...ends[1] });
    }
    pending.sort((a, b) => a.order - b.order);
    for (const p of pending) this.attach(p.id, p.end, p.jack);
  }
}
