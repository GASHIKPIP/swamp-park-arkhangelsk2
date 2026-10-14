/* 3D-модель без WebGL: заранее отрисованные кадры облёта. Перетаскивание вращает, этапы и режимы переключаются
   с плавным переходом, метки ставятся по заранее вычисленным экранным координатам. */
(function (global) {
'use strict';
class TurnViewer {
  constructor(el, meta, opts) {
    this.el = el; this.meta = meta; this.opts = opts = opts || {}; this.base = opts.base || 'turn/';
    this.angle = opts.angle || 0; this.set = null; this.cache = {}; this.vel = 0; this.zoomK = 1; this.ox = 50; this.oy = 50; this.showPins = true; this.stage = 7;
    const st = this.stageEl = document.createElement('div'); st.className = 'tv-stage'; el.appendChild(st);
    this.imgA = new Image(); this.imgB = new Image(); for (const im of [this.imgA, this.imgB]) { im.className = 'tv-img'; im.alt = ''; im.draggable = false; st.appendChild(im); }
    this.imgB.style.opacity = '0';
    this.pinHost = document.createElement('div'); this.pinHost.className = 'p3-labels'; el.appendChild(this.pinHost);
    this.pins = {};
    for (const p of meta.pois) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'p3-pin' + (p.kind === 'view' ? ' view' : '');
      b.innerHTML = p.kind === 'view' ? '<i>' + (p.pano === 6 ? '5' : p.pano) + '</i>' : '<i></i><span>' + p.title + '</span>'; b.title = p.title;
      b.addEventListener('click', (e) => { e.stopPropagation(); if (opts.onPOI) opts.onPOI(p); });
      this.pinHost.appendChild(b); this.pins[p.id] = { p, el: b };
    }
    this._bind();
  }
  frameUrl(set, i) { return this.base + (set === 'plan' ? 'plan_' : set + '_') + String(i).padStart(2, '0') + '.jpg'; }
  setStage(k) { this.stage = k; }
  preload(set) {
    const s = this.meta.sets[set]; if (!s) return; const c = this.cache[set] || (this.cache[set] = []);
    const start = this.idx(set);
    for (let d = 0; d < s.n; d++) { const i = (start + d) % s.n; if (c[i]) continue; const im = new Image(); im.decoding = 'async'; im.src = this.frameUrl(set, i); c[i] = im; im.onload = () => { if (this.set === set && this.idx(set) === i) this.show(); }; }
  }
  idx(set) { const s = this.meta.sets[set]; if (set === 'plan') return Math.max(0, Math.min(7, this.stage)); const n = s.n; return ((Math.round(this.angle / (360 / n)) % n) + n) % n; }
  setSet(set, fade) {
    if (!this.meta.sets[set]) return;
    const prev = this.set; this.set = set; this.preload(set);
    if (fade && prev) {
      this.imgB.src = this.imgA.src; this.imgB.style.transition = 'none'; this.imgB.style.opacity = '1'; void this.imgB.offsetWidth;
      this.imgB.style.transition = 'opacity .55s ease'; this.show(); requestAnimationFrame(() => { this.imgB.style.opacity = '0'; });
    } else this.show();
  }
  show() {
    const set = this.set, s = this.meta.sets[set]; if (!s) return; const i = this.idx(set), c = this.cache[set] || [];
    let im = c[i]; if (!im || !im.complete || !im.naturalWidth) { // nearest loaded frame
      for (let d = 1; d < s.n; d++) { const a = c[(i + d) % s.n], b = c[(i - d + s.n) % s.n]; if (a && a.complete && a.naturalWidth) { im = a; break; } if (b && b.complete && b.naturalWidth) { im = b; break; } }
    }
    const src = im && im.complete && im.naturalWidth ? im.src : this.frameUrl(set, i);
    if (this.imgA.getAttribute('src') !== src) this.imgA.src = src;
    this.curFrame = s.frames[im && im.src.endsWith(String(i).padStart(2, '0') + '.jpg') ? i : i];
    this.placePins(s.frames[i]);
    if (this.opts.onFrame) this.opts.onFrame(s.frames[i], set, i);
  }
  placePins(fr) {
    const W = this.el.clientWidth, H = this.el.clientHeight, placed = [[0, 0, 220, 62], [W - 64, 0, W, 64], [W - 290, H - 40, W, H]];
    const hit = (r) => placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    // image is object-fit: cover inside the box; compute the mapping 1280×800 → box
    const ia = 1.6, ba = W / H; let iw, ih, ox, oy; if (ba > ia) { iw = W; ih = W / ia; ox = 0; oy = (H - ih) / 2; } else { ih = H; iw = H * ia; oy = 0; ox = (W - iw) / 2; }
    const z = this.zoomK, zx = this.ox / 100 * W, zy = this.oy / 100 * H;
    const order = Object.values(this.pins).sort((a, b) => (a.p.kind === 'view' ? 0 : 1) - (b.p.kind === 'view' ? 0 : 1));
    for (const { p, el } of order) {
      const pos = fr && fr.pins[p.id];
      const vis = this.showPins && pos && this.stage >= (p.from_ || 0) - 0.01 && (this.set !== 'plan' || true);
      if (!vis) { el.hidden = true; continue; }
      let sx = ox + pos[0] / 100 * iw, sy = oy + pos[1] / 100 * ih; sx = zx + (sx - zx) * z; sy = zy + (sy - zy) * z;
      if (sx < 4 || sy < 20 || sx > W - 4 || sy > H) { el.hidden = true; continue; }
      let mini = false;
      if (p.kind === 'view') placed.push([sx - 12, sy - 26, sx + 12, sy]);
      else { const lw = p.title.length * 6.3 + 28, r = [sx - lw / 2, sy - 24, sx + lw / 2, sy]; if (!hit(r)) placed.push(r); else { const r2 = [sx - 8, sy - 16, sx + 8, sy]; if (hit(r2)) { el.hidden = true; continue; } placed.push(r2); mini = true; } }
      el.hidden = false; el.classList.toggle('mini', mini); el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-100%)';
    }
  }
  setZoom(k, ox, oy) {
    this.zoomK = Math.max(1, Math.min(2.6, k)); if (ox != null) { this.ox = ox; this.oy = oy; }
    this.stageEl.style.setProperty('--z', this.zoomK); this.stageEl.style.setProperty('--ox', this.ox + '%'); this.stageEl.style.setProperty('--oy', this.oy + '%');
    this.show();
  }
  rotate(deg) { if (this.set === 'plan') return; this.angle = (this.angle + deg) % 360; if (this.angle < 0) this.angle += 360; this.show(); }
  _bind() {
    const el = this.el; let down = null, lastX = 0, lastT = 0, moved = 0;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('.p3-pin')) return; down = e.pointerId; lastX = e.clientX; lastT = performance.now(); moved = 0; this.vel = 0; el.setPointerCapture(e.pointerId); el.classList.add('grab'); if (this.opts.onUser) this.opts.onUser(); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId !== down) return; const dx = e.clientX - lastX, now = performance.now(); lastX = e.clientX; moved += Math.abs(dx); const d = -dx * 0.45; this.vel = d / Math.max(8, now - lastT) * 16; lastT = now; this.rotate(d); });
    const up = (e) => { if (e.pointerId !== down) return; down = null; el.classList.remove('grab'); const spin = () => { if (Math.abs(this.vel) < 0.3 || down !== null) return; this.rotate(this.vel); this.vel *= 0.9; requestAnimationFrame(spin); }; requestAnimationFrame(spin); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); this.setZoom(this.zoomK * (e.deltaY < 0 ? 1.12 : 1 / 1.12), (e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100); }, { passive: false });
    el.tabIndex = 0;
    el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') this.rotate(-15); else if (e.key === 'ArrowRight') this.rotate(15); else if (e.key === '+' || e.key === '=') this.setZoom(this.zoomK * 1.2); else if (e.key === '-') this.setZoom(this.zoomK / 1.2); else return; e.preventDefault(); });
    new ResizeObserver(() => this.show()).observe(el);
  }
}
global.TurnViewer = TurnViewer;
})(window);
