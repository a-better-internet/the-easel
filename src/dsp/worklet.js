// AudioWorklet wrapper around EaselEngine. Everything that crosses the
// message port is wrapped in try/catch: a bad message or a runaway patch must
// never take the audio thread down.

import { EaselEngine } from './engine.js';

class EaselProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const os = options?.processorOptions?.oversample ?? 2;
    this.engine = new EaselEngine(sampleRate, os);
    this.meterEvery = Math.round(sampleRate / 30);
    this.meterCount = 0;
    this.errors = 0;
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

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    try {
      this.engine.process(L, R, L.length);
    } catch (err) {
      L.fill(0);
      if (R !== L) R.fill(0);
      this.engine.reset();
      if (this.errors++ < 5) this.port.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    this.meterCount += L.length;
    if (this.meterCount >= this.meterEvery) {
      this.meterCount = 0;
      this.port.postMessage({ type: 'meters', m: this.engine.takeMeters() });
    }
    return true;
  }
}

registerProcessor('easel-processor', EaselProcessor);
