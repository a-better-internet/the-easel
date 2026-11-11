import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatchGraph } from '../src/patch/graph.js';
import { JACK_BY_ID } from '../src/spec.js';

const graph = () => new PatchGraph(JACK_BY_ID);

test('a cable joins two jacks into one net', () => {
  const g = graph();
  g.addCable('co.out', 'mo.fmIn');
  assert.deepEqual(g.nets(), [{ jacks: ['co.out', 'mo.fmIn'], outs: ['co.out'], ins: ['mo.fmIn'] }]);
});

test('banana stacking: a plug dropped on a plug inherits its jack', () => {
  const g = graph();
  const a = g.addCable('env.out', 'lpg2.cv');
  // Cable B is dropped on the plug of cable A that sits in lpg2.cv
  const target = { cable: a, end: 1 };
  const jack = g.resolveTarget(target);
  assert.equal(jack, 'lpg2.cv');
  const b = g.addCable('seq.cv', jack);
  assert.equal(g.stackIndex(a, 1), 0);
  assert.equal(g.stackIndex(b, 1), 1, 'newest plug sits on top of the stack');
  const net = g.nets().find((n) => n.ins.includes('lpg2.cv'));
  assert.deepEqual(net.outs, ['env.out', 'seq.cv'], 'stacked outputs share one broadcast net');
});

test('three cables stacked on one output act as a single broadcast node', () => {
  const g = graph();
  g.addCable('co.out', 'mo.fmIn');
  g.addCable('co.out', 'lpg2.in');
  g.addCable('co.out', 'pre.in');
  const nets = g.nets();
  assert.equal(nets.length, 1);
  assert.deepEqual(nets[0].ins, ['lpg2.in', 'mo.fmIn', 'pre.in']);
  assert.equal(g.stack('co.out').length, 3);
});

test('nets merge transitively across chained cables', () => {
  const g = graph();
  g.addCable('pulser.ramp', 'inv.aIn');
  g.addCable('inv.aIn', 'co.timbreCv'); // input to input: allowed, just extends the net
  const net = g.nets()[0];
  assert.deepEqual(net.outs, ['pulser.ramp']);
  assert.deepEqual(net.ins, ['co.timbreCv', 'inv.aIn']);
});

test('pulling a lower plug drops the plugs above it down one level', () => {
  const g = graph();
  const a = g.addCable('env.out', 'lpg1.cv');
  const b = g.addCable('seq.cv', 'lpg1.cv');
  const c = g.addCable('rand.r1', 'lpg1.cv');
  g.detach(a, 1);
  assert.equal(g.stackIndex(b, 1), 0);
  assert.equal(g.stackIndex(c, 1), 1);
  assert.equal(g.stackIndex(a, 1), -1);
});

test('a cable may not loop back onto its own jack; anything else is legal', () => {
  const g = graph();
  const id = g.addCable('co.out', null);
  assert.equal(g.canDrop(id, 1, 'co.out'), false);
  assert.equal(g.canDrop(id, 1, 'mo.out'), true, 'out -> out is allowed (west-coast rules)');
  assert.equal(g.canDrop(id, 1, 'mo.fmIn'), true);
  assert.equal(g.canDrop(id, 1, 'nope'), false);
});

test('floating (dragged) ends are ignored by the net computation', () => {
  const g = graph();
  g.addCable('co.out', null);
  assert.deepEqual(g.nets(), []);
});

test('removeCable clears both ends from their stacks', () => {
  const g = graph();
  const id = g.addCable('co.out', 'mo.fmIn');
  g.removeCable(id);
  assert.equal(g.stack('co.out').length, 0);
  assert.equal(g.stack('mo.fmIn').length, 0);
  assert.equal(g.cables.size, 0);
});

test('serialize/load round-trips stack order exactly', () => {
  const g = graph();
  g.addCable('env.out', 'lpg2.cv');
  g.addCable('seq.cv', 'lpg2.cv');
  g.addCable('co.out', 'mo.fmIn');
  const saved = JSON.parse(JSON.stringify(g.serialize()));
  const h = graph();
  h.load(saved);
  const order = (gr) => gr.stack('lpg2.cv').map((p) => gr.cables.get(p.cable).ends[1 - p.end].jack);
  assert.deepEqual(order(h), ['env.out', 'seq.cv']);
  assert.deepEqual(h.nets(), g.nets());
});

test('load accepts simple pairs and skips junk', () => {
  const g = graph();
  g.load([['co.out', 'mo.fmIn'], ['bogus', 'mo.fmIn'], ['co.out', 'co.out'], 'garbage', null]);
  assert.equal(g.cables.size, 1);
});
