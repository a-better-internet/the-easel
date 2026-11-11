// Owns the AudioContext and the worklet node. All messages to the audio
// thread go through send(), which never throws.

export class AudioHost {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.out = null;
    this.onMeters = null;
    this.onError = null;
    this.oversample = 2;
    this.starting = null;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  /**
   * Start (or resume) audio. Must be called from a user gesture.
   * @param {() => {params: object, nets: any[]}} getState  current panel state
   */
  async start(getState) {
    if (this.ctx) {
      await this.ctx.resume();
      this.fadeTo(1);
      return;
    }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('This browser has no Web Audio support.');
      const ctx = new Ctx({ latencyHint: 'interactive' });
      if (!ctx.audioWorklet) throw new Error('This browser does not support AudioWorklet (try a current Chrome, Firefox or Safari over https).');
      await ctx.audioWorklet.addModule(new URL('../dsp/worklet.js', import.meta.url));
      const node = new AudioWorkletNode(ctx, 'easel-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { oversample: this.oversample },
      });
      node.port.onmessage = (e) => this.onMessage(e.data);
      node.onprocessorerror = () => this.onError?.('The audio engine stopped. Reload the page to restart it.');

      const out = ctx.createGain();
      out.gain.value = 0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      node.connect(out);
      out.connect(analyser);
      out.connect(ctx.destination);

      this.ctx = ctx;
      this.node = node;
      this.out = out;
      this.analyser = analyser;

      const { params, nets } = getState();
      this.send({ type: 'params', values: params });
      this.send({ type: 'patch', nets });
      this.send({ type: 'panic' });
      await ctx.resume();
      this.fadeTo(1, 0.6);
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop() {
    if (!this.ctx) return;
    this.fadeTo(0, 0.08);
    await new Promise((r) => setTimeout(r, 120));
    await this.ctx.suspend();
  }

  fadeTo(v, seconds = 0.15) {
    if (!this.out) return;
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v, t + seconds);
  }

  send(msg) {
    if (!this.node) return;
    try {
      this.node.port.postMessage(msg);
    } catch (err) {
      console.error('engine message failed', err);
    }
  }

  setParam(id, value) {
    this.send({ type: 'param', id, value });
  }

  setPatch(nets) {
    // strip to plain data
    this.send({ type: 'patch', nets: nets.map((n) => ({ outs: [...n.outs], ins: [...n.ins] })) });
  }

  setOversample(os) {
    this.oversample = os;
    this.send({ type: 'oversample', value: os });
  }

  onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'meters') this.onMeters?.(msg.m);
    else if (msg.type === 'error') this.onError?.(msg.message);
  }
}
