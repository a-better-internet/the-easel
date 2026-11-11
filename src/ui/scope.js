// Small oscilloscope for the header, triggered on a rising zero crossing.

export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyser = null;
    this.data = null;
    this.raf = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(40, Math.round(r.width));
    this.h = Math.max(20, Math.round(r.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  attach(analyser) {
    this.analyser = analyser;
    this.data = new Float32Array(analyser.fftSize);
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    const a = this.analyser;
    if (!a) return;
    const d = this.data;
    a.getFloatTimeDomainData(d);
    const span = Math.min(d.length - 1, 1024);
    let start = 0;
    for (let i = 1; i < d.length - span; i++) {
      if (d[i - 1] <= 0 && d[i] > 0) {
        start = i;
        break;
      }
    }
    let peak = 0.02;
    for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(d[i]));
    const scale = (h / 2 - 3) / Math.max(peak, 0.25);
    ctx.strokeStyle = '#f0c54a';
    ctx.lineWidth = 1.4;
    ctx.shadowColor = 'rgba(240,197,74,0.6)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const v = d[start + Math.floor((x / w) * span)];
      const y = h / 2 - v * scale;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
