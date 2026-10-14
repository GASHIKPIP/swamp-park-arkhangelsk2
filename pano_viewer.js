/* Просмотрщик панорам 360° (equirectangular) на чистом WebGL.
   yaw: 0 = центр изображения, положительный — вправо (по часовой стрелке, если смотреть сверху). */
(function (global) {
'use strict';
const VS = 'attribute vec2 p; varying vec2 q; void main(){ q = p; gl_Position = vec4(p,0.,1.); }';
const FS = `precision highp float; varying vec2 q;
uniform sampler2D A, B; uniform float mixAB, yaw, pitch, tf, asp, exposure;
const float PI = 3.14159265359;
vec3 smp(sampler2D t, vec2 uv){ return texture2D(t, uv).rgb; }
void main(){
  float cp = cos(pitch), sp = sin(pitch), cy = cos(yaw), sy = sin(yaw);
  vec3 F = vec3(cp*sy, sp, cp*cy), R = vec3(cy, 0., -sy), U = vec3(-sp*sy, cp, -sp*cy);
  vec3 d = normalize(F + R*(q.x*tf*asp) + U*(q.y*tf));
  float lon = atan(d.x, d.z), lat = asin(clamp(d.y,-1.,1.));
  vec2 uv = vec2(0.5 + lon/(2.*PI), 0.5 + lat/PI);
  vec3 c = mix(smp(A, uv), smp(B, uv), mixAB) * exposure;
  gl_FragColor = vec4(c, 1.);
}`;
class PanoViewer {
  constructor(el, opts) {
    opts = this.opts = opts || {};
    this.el = el; this.yaw = 0; this.pitch = 0; this.fov = 75; this.vy = 0; this.vp = 0; this.auto = opts.autorotate !== false; this.autoSpeed = 0.035; this.mixTarget = 0; this.mix = 0; this.dirty = true; this.ready = false; this.onMove = opts.onMove || null; this.exposure = 1;
    const cv = this.canvas = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none'; cv.tabIndex = 0; el.appendChild(cv);
    const gl = this.gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: !!opts.preserve, alpha: false });
    if (!gl) { this.failed = true; return; }
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const pr = this.prog = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; for (const n of ['A', 'B', 'mixAB', 'yaw', 'pitch', 'tf', 'asp', 'exposure']) this.u[n] = gl.getUniformLocation(pr, n);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.texs = [this._tex(0), this._tex(1)]; gl.uniform1i(this.u.A, 0); gl.uniform1i(this.u.B, 1);
    this.cur = 0;
    this._bind(); this._resize(); this._loop = this._loop.bind(this); requestAnimationFrame(this._loop);
    new ResizeObserver(() => { this._resize(); }).observe(el);
  }
  _tex(unit) { const gl = this.gl, t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([40, 50, 60]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  _bind() { const gl = this.gl; for (let i = 0; i < 2; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.texs[i]); } }
  _upload(unit, img) {
    const gl = this.gl; let src = img;
    if (img.width > this.maxTex) { const c = document.createElement('canvas'); c.width = this.maxTex; c.height = Math.round(img.height * this.maxTex / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); src = c; }
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.texs[unit]); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
  }
  load(url, o) {                                   // o: {yaw, pitch, fov, fade}
    o = o || {}; return new Promise((res, rej) => {
      const im = new Image(); im.decoding = 'async'; im.onload = () => {
        if (this.failed) return res();
        if (o.fade && this.ready) { const nxt = 1 - this.cur; this._upload(nxt, im); this.cur = nxt; this.mixTarget = nxt; }
        else { this._upload(0, im); this._upload(1, im); this.cur = 0; this.mix = 0; this.mixTarget = 0; }
        this.ready = true; if (o.yaw != null) this.yaw = o.yaw * Math.PI / 180; if (o.pitch != null) this.pitch = o.pitch * Math.PI / 180; if (o.fov) this.fov = o.fov; this.dirty = true; res(); };
      im.onerror = () => rej(new Error('pano load failed ' + url)); im.src = url; });
  }
  setImagePair(urlA, urlB) { }
  _resize() { const dpr = Math.min(global.devicePixelRatio || 1, this.opts.maxDpr || 1.75), w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return; this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this.gl && this.gl.viewport(0, 0, this.canvas.width, this.canvas.height); this.asp = w / h; this.dirty = true; }
  attach() {
    const cv = this.canvas; let ptrs = new Map(), last = null, pinch = 0;
    const stop = () => { this.auto = false; };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; cv.style.cursor = 'grabbing'; this.vy = this.vp = 0; stop(); if (ptrs.size === 2) { const a = [...ptrs.values()]; pinch = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); } });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { const a = [...ptrs.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); if (pinch) this.zoom((pinch - d) * 0.15); pinch = d; return; }
      const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY]; const k = (this.fov * Math.PI / 180) / cv.clientHeight * 1.0;
      this.vy = -dx * k; this.vp = dy * k; this.yaw += this.vy; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + this.vp)); this.dirty = true; this._emit(); });
    const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; cv.style.cursor = 'grab'; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); stop(); this.zoom(e.deltaY * 0.04); }, { passive: false });
    cv.addEventListener('keydown', (e) => { const s = 0.06; if (e.key === 'ArrowLeft') this.yaw -= s; else if (e.key === 'ArrowRight') this.yaw += s; else if (e.key === 'ArrowUp') this.pitch = Math.min(1.45, this.pitch + s); else if (e.key === 'ArrowDown') this.pitch = Math.max(-1.45, this.pitch - s); else if (e.key === '+' || e.key === '=') this.zoom(-5); else if (e.key === '-') this.zoom(5); else return; stop(); this.dirty = true; this._emit(); e.preventDefault(); });
    return this;
  }
  zoom(d) { this.fov = Math.max(32, Math.min(105, this.fov + d)); this.dirty = true; }
  _emit() { if (this.onMove) this.onMove(((this.yaw * 180 / Math.PI) % 360 + 360) % 360, this.pitch * 180 / Math.PI, this.fov); }
  _loop() {
    requestAnimationFrame(this._loop); if (this.failed || !this.ready) return;
    if (this.auto) { this.yaw += this.autoSpeed * Math.PI / 180 * 1.0 * 6; this.dirty = true; this._emit(); }
    else if (Math.abs(this.vy) > 1e-5 || Math.abs(this.vp) > 1e-5) { this.vy *= 0.92; this.vp *= 0.92; this.yaw += this.vy; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + this.vp)); this.dirty = true; this._emit(); }
    if (Math.abs(this.mix - this.mixTarget) > 1e-3) { this.mix += (this.mixTarget - this.mix) * 0.14; if (Math.abs(this.mix - this.mixTarget) < 2e-3) this.mix = this.mixTarget; this.dirty = true; }
    if (!this.dirty) return; this.dirty = false; this.draw();
  }
  draw() { const gl = this.gl; gl.uniform1f(this.u.mixAB, this.mix); gl.uniform1f(this.u.yaw, this.yaw); gl.uniform1f(this.u.pitch, this.pitch); gl.uniform1f(this.u.tf, Math.tan(this.fov * Math.PI / 360)); gl.uniform1f(this.u.asp, this.asp || 1); gl.uniform1f(this.u.exposure, this.exposure); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
}
global.PanoViewer = PanoViewer;
})(window);
