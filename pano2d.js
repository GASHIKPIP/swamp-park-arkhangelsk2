/* Панорама 360° без WebGL: перспективная проекция equirectangular-изображения на <canvas> 2D.
   yaw 0 = центр изображения, положительный — вправо. */
(function (global) {
'use strict';
const PI = Math.PI;
class Pano2D {
  constructor(el, opts) {
    this.opts = opts = opts || {}; this.el = el;
    this.yaw = 0; this.pitch = 0; this.fov = 75; this.vy = 0; this.vp = 0; this.auto = opts.autorotate !== false; this.speed = 0.0035;
    this.src = null; this.dirty = true; this.moving = 0; this.ready = false; this.onMove = opts.onMove || null; this.failed = false;
    const cv = this.canvas = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none'; cv.tabIndex = 0; el.appendChild(cv);
    this.ctx = cv.getContext('2d', { alpha: false });
    if (!this.ctx) { this.failed = true; return; }
    this.fadeEl = document.createElement('canvas'); this.fadeEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .45s ease'; el.appendChild(this.fadeEl);
    this._resize(); new ResizeObserver(() => this._resize()).observe(el);
    this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
  }
  _resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
    this.cw = w; this.ch = h; this.asp = w / h; this.base = null; this.dirty = true;
  }
  _setup(scale) {                       // per-pixel camera-space directions for the current size and fov
    const dpr = Math.min(global.devicePixelRatio || 1, 1.5), W = Math.max(64, Math.round(this.cw * dpr * scale)), H = Math.max(36, Math.round(this.ch * dpr * scale));
    const key = W + 'x' + H + '@' + this.fov.toFixed(2);
    if (this.base && this.base.key === key) return this.base;
    const tf = Math.tan(this.fov * PI / 360), asp = W / H, n = W * H, bx = new Float32Array(n), by = new Float32Array(n), bz = new Float32Array(n);
    for (let j = 0; j < H; j++) { const y = (1 - 2 * (j + 0.5) / H) * tf; for (let i = 0; i < W; i++) { const x = (2 * (i + 0.5) / W - 1) * tf * asp, l = 1 / Math.sqrt(x * x + y * y + 1), k = j * W + i; bx[k] = x * l; by[k] = y * l; bz[k] = l; } }
    const img = this.ctx.createImageData(W, H);
    return (this.base = { key, W, H, bx, by, bz, img });
  }
  load(url, o) {
    o = o || {};
    return new Promise((res, rej) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => {
        try {
          const c = document.createElement('canvas'); let w = im.naturalWidth, h = im.naturalHeight;
          const maxW = this.opts.maxSrc || 4096; if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          c.width = w; c.height = h; const cx = c.getContext('2d'); cx.drawImage(im, 0, 0, w, h);
          if (o.fade && this.ready) { this.fadeEl.width = this.canvas.width; this.fadeEl.height = this.canvas.height; this.fadeEl.getContext('2d').drawImage(this.canvas, 0, 0); this.fadeEl.style.transition = 'none'; this.fadeEl.style.opacity = '1'; void this.fadeEl.offsetWidth; this.fadeEl.style.transition = 'opacity .5s ease'; requestAnimationFrame(() => { this.fadeEl.style.opacity = '0'; }); }
          this.src = { w, h, d: new Uint32Array(cx.getImageData(0, 0, w, h).data.buffer) };
          if (o.yaw != null) this.yaw = o.yaw * PI / 180; if (o.pitch != null) this.pitch = o.pitch * PI / 180; if (o.fov) this.fov = o.fov;
          this.ready = true; this.dirty = true; this.base = null; res();
        } catch (e) { rej(e); }
      };
      im.onerror = () => rej(new Error('pano load failed ' + url)); im.src = url;
    });
  }
  draw(scale, smooth) {
    if (!this.src) return;
    const B = this._setup(scale), W = B.W, H = B.H, out = new Uint32Array(B.img.data.buffer), S = this.src, sw = S.w, sh = S.h, sd = S.d;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const Fx = cp * sy, Fy = sp, Fz = cp * cy, Rx = cy, Rz = -sy, Ux = -sp * sy, Uy = cp, Uz = -sp * cy;
    const ku = sw / (2 * PI), kv = sh / PI, bx = B.bx, by = B.by, bz = B.bz, n = W * H;
    if (!smooth) {
      for (let k = 0; k < n; k++) {
        const x = bx[k], y = by[k], z = bz[k];
        const dx = Rx * x + Ux * y + Fx * z, dy = Uy * y + Fy * z, dz = Rz * x + Uz * y + Fz * z;
        let u = (Math.atan2(dx, dz) + PI) * ku | 0, v = (PI / 2 - Math.asin(dy > 1 ? 1 : dy < -1 ? -1 : dy)) * kv | 0;
        if (u >= sw) u -= sw; if (v >= sh) v = sh - 1;
        out[k] = sd[v * sw + u];
      }
    } else {
      for (let k = 0; k < n; k++) {
        const x = bx[k], y = by[k], z = bz[k];
        const dx = Rx * x + Ux * y + Fx * z, dy = Uy * y + Fy * z, dz = Rz * x + Uz * y + Fz * z;
        const fu = (Math.atan2(dx, dz) + PI) * ku - 0.5, fv = (PI / 2 - Math.asin(dy > 1 ? 1 : dy < -1 ? -1 : dy)) * kv - 0.5;
        let u0 = Math.floor(fu), v0 = Math.floor(fv); const tu = fu - u0, tv = fv - v0;
        if (u0 < 0) u0 += sw; let u1 = u0 + 1; if (u1 >= sw) u1 -= sw; if (u0 >= sw) u0 -= sw;
        if (v0 < 0) v0 = 0; let v1 = v0 + 1; if (v1 >= sh) v1 = sh - 1;
        const a = sd[v0 * sw + u0], b = sd[v0 * sw + u1], c = sd[v1 * sw + u0], d = sd[v1 * sw + u1];
        const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
        const r = (a & 255) * w00 + (b & 255) * w10 + (c & 255) * w01 + (d & 255) * w11;
        const g = (a >> 8 & 255) * w00 + (b >> 8 & 255) * w10 + (c >> 8 & 255) * w01 + (d >> 8 & 255) * w11;
        const bl = (a >> 16 & 255) * w00 + (b >> 16 & 255) * w10 + (c >> 16 & 255) * w01 + (d >> 16 & 255) * w11;
        out[k] = 0xff000000 | (bl << 16) | (g << 8) | r;
      }
    }
    const cv = this.canvas; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this.ctx.putImageData(B.img, 0, 0);
  }
  attach() {
    const cv = this.canvas; const ptrs = new Map(); let last = null, pinch = 0;
    const stop = () => { this.auto = false; if (this.opts.onAuto) this.opts.onAuto(false); };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; cv.style.cursor = 'grabbing'; this.vy = this.vp = 0; stop(); if (ptrs.size === 2) { const a = [...ptrs.values()]; pinch = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); } });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { const a = [...ptrs.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); if (pinch) this.zoom((pinch - d) * 0.15); pinch = d; return; }
      const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
      const k = 2 * Math.tan(this.fov * PI / 360) / this.ch;
      this.vy = -dx * k; this.vp = dy * k; this.yaw += this.vy; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + this.vp)); this.moving = 6; this.dirty = true; this._emit();
    });
    const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; cv.style.cursor = 'grab'; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); stop(); this.zoom(e.deltaY * 0.04); }, { passive: false });
    cv.addEventListener('keydown', (e) => { const s = 0.06; if (e.key === 'ArrowLeft') this.yaw -= s; else if (e.key === 'ArrowRight') this.yaw += s; else if (e.key === 'ArrowUp') this.pitch = Math.min(1.3, this.pitch + s); else if (e.key === 'ArrowDown') this.pitch = Math.max(-1.3, this.pitch - s); else if (e.key === '+' || e.key === '=') this.zoom(-5); else if (e.key === '-') this.zoom(5); else return; stop(); this.moving = 6; this.dirty = true; this._emit(); e.preventDefault(); });
    return this;
  }
  zoom(d) { this.fov = Math.max(30, Math.min(100, this.fov + d)); this.moving = 6; this.dirty = true; this._emit(); }
  _emit() { if (this.onMove) this.onMove(((this.yaw * 180 / PI) % 360 + 360) % 360, this.pitch * 180 / PI, this.fov); }
  _loop() {
    requestAnimationFrame(this._loop); if (!this.ready) return;
    if (this.auto) { this.yaw += this.speed; this.moving = 2; this.dirty = true; this._emit(); }
    else if (Math.abs(this.vy) > 1e-5 || Math.abs(this.vp) > 1e-5) { this.vy *= 0.9; this.vp *= 0.9; this.yaw += this.vy; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + this.vp)); this.moving = 3; this.dirty = true; this._emit(); }
    if (this.dirty) { this.dirty = false; this.draw(this.auto ? 0.8 : this.moving > 0 ? 0.55 : 1, false); this.settle = 10; }
    else if (this.settle > 0 && --this.settle === 0) this.draw(1, true);
    if (this.moving > 0) this.moving--;
  }
}
global.Pano2D = Pano2D;
})(window);
