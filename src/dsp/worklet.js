// AudioWorklet wrapper around EaselEngine. Everything that crosses the
// message port is wrapped in try/catch: a bad message or a runaway patch must
// never take the audio thread down.

import { EaselEngine } from './engine.js';

const REC_CHUNK = 4096; // samples per recording message (~85 ms at 48 kHz)

class EaselProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const os = options?.processorOptions?.oversample ?? 2;
    this.engine = new EaselEngine(sampleRate, os);
    this.meterEvery = Math.round(sampleRate / 30);
    this.meterCount = 0;
    this.errors = 0;
    this.rec = null; // { id, source, buf, n }
    this.tap = new Float32Array(128);
    this.port.onmessage = (e) => this.onMessage(e.data);
    this.port.postMessage({ type: 'ready', oversample: this.engine.os, sampleRate });
  }

  onMessage(msg) {
    try {
      switch (msg?.type) {
        case 'param':
          this.engine.setParam(msg.id, msg.value);
          break;
        case 'params':
          this.engine.setParams(msg.values || {});
          break;
        case 'patch':
          this.engine.setPatch(msg.nets || []);
          break;
        case 'one':
          this.engine.one();
          break;
        case 'rec-start':
          this.rec = { id: msg.id, source: msg.source === 'monitor' ? 'monitor' : 'master', buf: new Float32Array(REC_CHUNK), n: 0 };
          break;
        case 'rec-stop':
          if (this.rec && this.rec.id === msg.id) {
            this.flushRec();
            this.rec = null;
          }
          this.port.postMessage({ type: 'rec-end', id: msg.id });
          break;
        case 'panic':
          this.engine.reset();
          break;
        case 'oversample':
          this.engine.setOversampling(msg.value);
          this.engine.reset();
          this.port.postMessage({ type: 'oversample', value: this.engine.os });
          break;
        default:
          break;
      }
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err?.message || err) });
    }
  }

  /** Copy one render quantum into the recording buffer; post full chunks. */
  capture(src) {
    const rec = this.rec;
    let i = 0;
    while (i < src.length) {
      const take = Math.min(src.length - i, rec.buf.length - rec.n);
      rec.buf.set(src.subarray(i, i + take), rec.n);
      rec.n += take;
      i += take;
      if (rec.n === rec.buf.length) this.flushRec();
    }
  }

  flushRec() {
    const rec = this.rec;
    if (!rec || rec.n === 0) return;
    const samples = rec.n === rec.buf.length ? rec.buf : rec.buf.slice(0, rec.n);
    this.port.postMessage({ type: 'rec-chunk', id: rec.id, samples }, [samples.buffer]);
    rec.buf = new Float32Array(REC_CHUNK);
    rec.n = 0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const rec = this.rec;
    let tap = null;
    if (rec && rec.source === 'master') {
      if (this.tap.length !== L.length) this.tap = new Float32Array(L.length);
      tap = this.tap;
    }
    try {
      this.engine.process(L, R, L.length, tap);
    } catch (err) {
      L.fill(0);
      if (R !== L) R.fill(0);
      if (tap) tap.fill(0);
      this.engine.reset();
      if (this.errors++ < 5) this.port.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    if (rec) this.capture(tap || L);
    this.meterCount += L.length;
    if (this.meterCount >= this.meterEvery) {
      this.meterCount = 0;
      this.port.postMessage({ type: 'meters', m: this.engine.takeMeters() });
    }
    return true;
  }
}

registerProcessor('easel-processor', EaselProcessor);
