// 24-bit WAV recorder.
//
// The worklet copies the chosen tap (master out or monitor) sample-for-sample
// and posts Float32 chunks here. Each chunk is converted to 24-bit PCM straight
// away and kept as a Blob part, so long takes live in the browser's blob store
// rather than in a growing JS array. Stopping writes the WAV header in front.

import { encodePCM24, wavHeader, wavPad, MAX_DATA_BYTES, BYTES_PER_SAMPLE } from './wav.js';

let nextId = 1;

export class Recorder {
  /** @param {import('./host.js').AudioHost} host */
  constructor(host) {
    this.host = host;
    this.take = null;
    this.onProgress = null; // (take) => void
    this.onLimit = null; // () => void, called when the file-size limit is reached
    host.onRecChunk = (id, samples) => this.chunk(id, samples);
    host.onRecEnd = (id) => this.ended(id);
  }

  get recording() {
    return !!this.take && !this.take.stopping;
  }

  /**
   * @param {{source?: 'master'|'monitor', name?: string}} opts
   */
  start({ source = 'master', name = 'patch' } = {}) {
    if (!this.host.node || !this.host.ctx) throw new Error('Turn the power on to record.');
    if (this.take) throw new Error('Already recording.');
    const id = nextId++;
    this.take = {
      id,
      source,
      name,
      sampleRate: this.host.ctx.sampleRate,
      parts: [],
      frames: 0,
      bytes: 0,
      peak: 0,
      startedAt: new Date(),
      stopping: false,
      resolve: null,
    };
    this.host.send({ type: 'rec-start', id, source });
    return this.take;
  }

  chunk(id, samples) {
    const t = this.take;
    if (!t || t.id !== id) return;
    let peak = t.peak;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i] < 0 ? -samples[i] : samples[i];
      if (a > peak) peak = a;
    }
    t.peak = peak;
    const bytes = encodePCM24(samples);
    t.parts.push(new Blob([bytes]));
    t.frames += samples.length;
    t.bytes += bytes.length;
    this.onProgress?.(t);
    if (!t.stopping && t.bytes + 16 * 1024 * BYTES_PER_SAMPLE > MAX_DATA_BYTES) this.onLimit?.();
  }

  ended(id) {
    const t = this.take;
    if (!t || t.id !== id || !t.resolve) return;
    t.resolve();
  }

  /**
   * Stop, flush the worklet's last partial chunk and build the file.
   * @returns {Promise<{blob: Blob, filename: string, frames: number, seconds: number, sampleRate: number, peak: number, source: string}>}
   */
  async stop() {
    const t = this.take;
    if (!t) throw new Error('Not recording.');
    if (t.stopping) return t.done;
    t.stopping = true;
    t.done = (async () => {
      await new Promise((resolve) => {
        t.resolve = resolve;
        this.host.send({ type: 'rec-stop', id: t.id });
        // if the audio thread is gone (context closed), don't hang
        setTimeout(resolve, 1500);
      });
      this.take = null;
      const header = wavHeader({
        sampleRate: t.sampleRate,
        channels: 1,
        dataBytes: t.bytes,
        info: {
          INAM: t.name,
          ISFT: 'the easel (no-input 208C, browser)',
          ICRD: t.startedAt.toISOString().slice(0, 10),
          ICMT: `recorded from ${t.source === 'monitor' ? 'the monitor output' : 'master out'}, 24-bit PCM, TPDF dither`,
        },
      });
      const blob = new Blob([header, ...t.parts, wavPad(t.bytes)], { type: 'audio/wav' });
      return {
        blob,
        filename: takeFilename(t.name, t.startedAt),
        frames: t.frames,
        seconds: t.frames / t.sampleRate,
        sampleRate: t.sampleRate,
        peak: t.peak,
        source: t.source,
      };
    })();
    return t.done;
  }
}

/** easel-bell-garden-20261111-213045.wav */
export function takeFilename(name, date = new Date()) {
  const slug =
    String(name || 'patch')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'patch';
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `easel-${slug}-${stamp}.wav`;
}

export function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function formatBytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatPeak(peak) {
  if (!(peak > 0)) return '−∞ dBFS';
  const db = 20 * Math.log10(peak);
  return `${db >= -0.05 ? '0.0' : db.toFixed(1).replace('-', '−')} dBFS`;
}
