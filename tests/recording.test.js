import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePCM24, decodePCM24, wavHeader, wavPad, parseWav } from '../src/audio/wav.js';
import { Recorder, takeFilename, formatPeak, formatDuration } from '../src/audio/recorder.js';
import { EaselEngine } from '../src/dsp/engine.js';
import { defaultParams } from '../src/spec.js';

test('24-bit encoding: full scale, zero, sign, little endian', () => {
  const bytes = encodePCM24(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2]), { dither: false });
  assert.equal(bytes.length, 7 * 3);
  assert.deepEqual(Array.from(bytes.subarray(3, 6)), [0xff, 0xff, 0x7f], '+1.0 -> 0x7FFFFF, little endian');
  // +/-0.5 land exactly on a half step (4194303.5); Math.round takes halves toward +inf
  assert.deepEqual(Array.from(decodePCM24(bytes)), [0, 8388607, -8388607, 4194304, -4194303, 8388607, -8388608]);
});

test('24-bit encoding never writes NaN/Inf and clamps overs', () => {
  const v = decodePCM24(encodePCM24([NaN, Infinity, -Infinity, 1.5, -1.5], { dither: false }));
  assert.deepEqual(Array.from(v), [0, 0, 0, 8388607, -8388608]);
});

test('TPDF dither stays within +/-1 LSB and averages out', () => {
  const n = 20000;
  const v = decodePCM24(encodePCM24(new Float32Array(n)));
  let sum = 0;
  for (const x of v) {
    assert.ok(x >= -1 && x <= 1, `dither of ${x} LSB`);
    sum += x;
  }
  assert.ok(Math.abs(sum / n) < 0.05, 'dither should have zero mean');
  // a tiny signal (0.3 LSB) survives as an average instead of rounding away
  const tiny = 0.3 / 8388607;
  const w = decodePCM24(encodePCM24(new Float32Array(n).fill(tiny)));
  const mean = w.reduce((a, b) => a + b, 0) / n;
  assert.ok(Math.abs(mean - 0.3) < 0.05, `mean ${mean.toFixed(3)} LSB`);
});

test('WAV header: PCM, 24-bit, mono, sizes consistent, INFO chunk readable', () => {
  const pcm = encodePCM24(new Float32Array(1001), { dither: false }); // odd byte count -> pad
  const header = wavHeader({ sampleRate: 48000, dataBytes: pcm.length, info: { INAM: 'Howl Box', ISFT: 'the easel' } });
  const file = new Uint8Array(header.length + pcm.length + 1);
  file.set(header, 0);
  file.set(pcm, header.length);
  file.set(wavPad(pcm.length), header.length + pcm.length);
  const w = parseWav(file);
  assert.equal(w.format, 1);
  assert.equal(w.bits, 24);
  assert.equal(w.channels, 1);
  assert.equal(w.sampleRate, 48000);
  assert.equal(w.byteRate, 48000 * 3);
  assert.equal(w.blockAlign, 3);
  assert.equal(w.data.length, 1001 * 3);
  assert.equal(w.riffSize, file.length - 8, 'RIFF size covers everything after the first 8 bytes');
  assert.equal(w.info.INAM, 'Howl Box');
  assert.equal(w.info.ISFT, 'the easel');
});

/** A stand-in for AudioHost: plays the worklet's side of the recording protocol. */
function fakeHost(sampleRate = 44100) {
  const host = {
    ctx: { sampleRate },
    node: {},
    sent: [],
    send(msg) {
      this.sent.push(msg);
      if (msg.type === 'rec-stop') queueMicrotask(() => host.onRecEnd(msg.id));
    },
  };
  return host;
}

test('recorder: chunks in, a valid 24-bit WAV out', async () => {
  const host = fakeHost(44100);
  const rec = new Recorder(host);
  rec.start({ source: 'master', name: 'Bell Garden' });
  const id = host.sent[0].id;
  assert.equal(host.sent[0].type, 'rec-start');
  assert.equal(host.sent[0].source, 'master');
  // 1.5 s of a 441 Hz sine at -6 dBFS, delivered in uneven chunks
  const total = 66150;
  const sine = Float32Array.from({ length: total }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 441 * i) / 44100));
  for (let i = 0; i < total; i += 4096) host.onRecChunk(id, sine.slice(i, i + 4096));
  host.onRecChunk(id + 99, new Float32Array(10)); // a stale take's chunk is ignored
  const take = await rec.stop();
  assert.equal(take.frames, total);
  assert.equal(take.sampleRate, 44100);
  assert.ok(Math.abs(take.peak - 0.5) < 1e-6);
  assert.match(take.filename, /^easel-bell-garden-\d{8}-\d{6}\.wav$/);

  const bytes = new Uint8Array(await take.blob.arrayBuffer());
  const w = parseWav(bytes);
  assert.equal(w.bits, 24);
  assert.equal(w.sampleRate, 44100);
  assert.equal(w.data.length, total * 3);
  assert.equal(w.info.INAM, 'Bell Garden');
  const v = decodePCM24(w.data);
  for (let i = 0; i < total; i += 997) assert.ok(Math.abs(v[i] / 8388607 - sine[i]) < 2 / 8388607, `sample ${i}`);
  assert.equal(rec.recording, false);
});

test('recorder refuses to start without audio, or twice', () => {
  const rec = new Recorder({ ctx: null, node: null, send() {} });
  assert.throws(() => rec.start(), /power/);
  const host = fakeHost();
  const r2 = new Recorder(host);
  r2.start();
  assert.throws(() => r2.start(), /Already/);
});

test('engine master tap: DC-blocked master out, independent of the monitor knob', () => {
  const e = new EaselEngine(48000, 2);
  e.setParams({ ...defaultParams(), 'out.monitor': 0, 'co.timbre': 0.3 });
  e.settleParams();
  e.reset();
  const N = 128;
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const tap = new Float32Array(N);
  let tapSum = 0;
  let tapPeak = 0;
  let outPeak = 0;
  let count = 0;
  for (let b = 0; b < 48000 / N; b++) {
    e.process(L, R, N, tap);
    for (let i = 0; i < N; i++) {
      assert.ok(Number.isFinite(tap[i]));
      tapSum += tap[i];
      tapPeak = Math.max(tapPeak, Math.abs(tap[i]));
      outPeak = Math.max(outPeak, Math.abs(L[i]));
      count++;
    }
  }
  assert.equal(outPeak, 0, 'monitor at 0 is silent');
  assert.ok(tapPeak > 0.05 && tapPeak <= 1.0001, `master tap peak ${tapPeak}`);
  assert.ok(Math.abs(tapSum / count) < 0.01, 'tap is DC-blocked');
});

test('formatting helpers', () => {
  assert.equal(formatDuration(3725.9), '01:02:05');
  assert.equal(formatPeak(1), '0.0 dBFS');
  assert.equal(formatPeak(0.5), '−6.0 dBFS');
  assert.equal(formatPeak(0), '−∞ dBFS');
  assert.equal(takeFilename('Quick Start Patch A (modified)', new Date(2026, 10, 11, 9, 5, 7)), 'easel-quick-start-patch-a-modified-20261111-090507.wav');
});
