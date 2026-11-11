// 24-bit PCM WAV encoding. Pure functions, no DOM, so they run in Node tests.
//
// Format: RIFF/WAVE, WAVE_FORMAT_PCM (1), 24 bits per sample, little endian,
// an optional LIST/INFO chunk (title, software, date), then the data chunk.
// Floats are scaled to the 24-bit range with TPDF dither of +/-1 LSB.

export const BITS = 24;
export const BYTES_PER_SAMPLE = 3;
const FULL = 8388607; // 2^23 - 1
const MIN = -8388608; // -2^23

/** Largest data chunk we write: keeps the RIFF size field (uint32) valid. */
export const MAX_DATA_BYTES = 0xffffffff - 4096;

/**
 * Float samples (nominally -1..1) -> little-endian 24-bit PCM bytes.
 * @param {Float32Array|number[]} samples
 * @param {{dither?: boolean, rng?: () => number}} [opts]
 * @returns {Uint8Array}
 */
export function encodePCM24(samples, { dither = true, rng = Math.random } = {}) {
  const n = samples.length;
  const out = new Uint8Array(n * BYTES_PER_SAMPLE);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    let x = samples[i];
    if (!(x > -10 && x < 10)) x = 0; // NaN / Inf never reach the file
    let v = x * FULL;
    if (dither) v += rng() - rng(); // triangular PDF, +/-1 LSB peak
    v = Math.round(v);
    if (v > FULL) v = FULL;
    else if (v < MIN) v = MIN;
    out[j] = v & 0xff;
    out[j + 1] = (v >> 8) & 0xff;
    out[j + 2] = (v >> 16) & 0xff;
  }
  return out;
}

/** 24-bit little-endian PCM bytes -> integer samples (for tests and checks). */
export function decodePCM24(bytes) {
  const n = Math.floor(bytes.length / 3);
  const out = new Int32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    let v = bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16);
    if (v & 0x800000) v |= ~0xffffff; // sign-extend
    out[i] = v;
  }
  return out;
}

function ascii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i) & 0x7f);
}

/** One INFO sub-chunk: id + size + NUL-terminated text, padded to even length. */
function infoChunk(id, text) {
  const body = `${String(text).replace(/[^\x20-\x7e]/g, '?')}\0`;
  const padded = body.length + (body.length & 1);
  const buf = new ArrayBuffer(8 + padded);
  const v = new DataView(buf);
  ascii(v, 0, id);
  v.setUint32(4, body.length, true);
  ascii(v, 8, body);
  return new Uint8Array(buf);
}

/**
 * Everything before the sample data: RIFF header, fmt chunk, optional
 * LIST/INFO chunk and the data chunk header.
 * @param {{sampleRate: number, channels?: number, dataBytes: number, info?: Record<string,string>}} o
 *   info keys are RIFF INFO ids, e.g. { INAM: 'title', ISFT: 'software', ICRD: '2026-11-11' }
 * @returns {Uint8Array}
 */
export function wavHeader({ sampleRate, channels = 1, dataBytes, info = {} }) {
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const infoParts = Object.entries(info)
    .filter(([id, text]) => /^[A-Z0-9]{4}$/.test(id) && text)
    .map(([id, text]) => infoChunk(id, text));
  const infoBytes = infoParts.reduce((n, p) => n + p.length, 0);
  const listBytes = infoParts.length ? 12 + infoBytes : 0;
  const pad = dataBytes & 1;
  const headerBytes = 12 + 24 + listBytes + 8;

  const buf = new Uint8Array(headerBytes);
  const v = new DataView(buf.buffer);
  ascii(v, 0, 'RIFF');
  v.setUint32(4, headerBytes - 8 + dataBytes + pad, true);
  ascii(v, 8, 'WAVE');
  // fmt chunk
  ascii(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // WAVE_FORMAT_PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, BITS, true);
  let o = 36;
  if (listBytes) {
    ascii(v, o, 'LIST');
    v.setUint32(o + 4, listBytes - 8, true);
    ascii(v, o + 8, 'INFO');
    o += 12;
    for (const p of infoParts) {
      buf.set(p, o);
      o += p.length;
    }
  }
  ascii(v, o, 'data');
  v.setUint32(o + 4, dataBytes, true);
  return buf;
}

/** Trailing pad byte RIFF requires after an odd-length data chunk. */
export function wavPad(dataBytes) {
  return dataBytes & 1 ? new Uint8Array(1) : new Uint8Array(0);
}

/** Minimal parser for tests: returns { format, channels, sampleRate, bits, info, data }. */
export function parseWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  const out = { info: {}, riffSize: v.getUint32(4, true) };
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      out.format = v.getUint16(body, true);
      out.channels = v.getUint16(body + 2, true);
      out.sampleRate = v.getUint32(body + 4, true);
      out.byteRate = v.getUint32(body + 8, true);
      out.blockAlign = v.getUint16(body + 12, true);
      out.bits = v.getUint16(body + 14, true);
    } else if (id === 'LIST' && tag(body) === 'INFO') {
      let p = body + 4;
      while (p + 8 <= body + size) {
        const sid = tag(p);
        const ssize = v.getUint32(p + 4, true);
        out.info[sid] = String.fromCharCode(...bytes.subarray(p + 8, p + 8 + ssize)).replace(/\0+$/, '');
        p += 8 + ssize + (ssize & 1);
      }
    } else if (id === 'data') {
      out.data = bytes.subarray(body, body + size);
    }
    o = body + size + (size & 1);
  }
  return out;
}
