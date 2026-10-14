/* ============================================================================
   park3d — модель генплана на three.js
   Часть 1: данные, рельеф, вода, небо, свет
   ============================================================================ */
(function (global) {
'use strict';
const T = global.THREE;
const VE = global.P3_VE || 2.0;                       // вертикальное увеличение рельефа
const STAGES = [
  { id: 0, short: 'Сейчас', title: 'Болото сегодня' },
  { id: 1, short: 'Расчистка', title: 'Расчистка и подготовка' },
  { id: 2, short: 'Выемка', title: 'Выемка торфа' },
  { id: 3, short: 'Пруд', title: 'Пруд наполняется' },
  { id: 4, short: 'Рельеф', title: 'Берма, холм и отметки' },
  { id: 5, short: 'Постройки', title: 'Дороги и сооружения' },
  { id: 6, short: 'Посадки', title: 'Посадки: день открытия' },
  { id: 7, short: '+10 лет', title: 'Через 10 лет' },
];

function b64ToI16(s) { const b = atob(s), n = b.length / 2, a = new Int16Array(n); for (let i = 0; i < n; i++) { let v = b.charCodeAt(2 * i) | (b.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; a[i] = v; } return a; }
function b64ToU8(s) { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function rng32(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// простой value-noise для оттенков рельефа
function hash2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; }
function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < (o || 3); i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; }

function mergeGeoms(parts) {              // parts: [{geo, color:[r,g,b], m:Matrix4}]
  let nV = 0, nI = 0;
  for (const p of parts) { nV += p.geo.attributes.position.count; nI += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), idx = new Uint32Array(nI);
  let vo = 0, io = 0; const v = new T.Vector3(), nm = new T.Matrix3();
  for (const p of parts) {
    const g = p.geo, P = g.attributes.position, N = g.attributes.normal; nm.getNormalMatrix(p.m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(p.m); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
      col[(vo + i) * 3] = p.color[0]; col[(vo + i) * 3 + 1] = p.color[1]; col[(vo + i) * 3 + 2] = p.color[2];
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < P.count; i++) idx[io + i] = vo + i; io += P.count; }
    vo += P.count;
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3)); out.setAttribute('color', new T.BufferAttribute(col, 3)); out.setIndex(new T.BufferAttribute(idx, 1));
  return out;
}
function jitterGeo(geo, amt, seed) {      // «лоскутная» крона: слегка смещаем вершины
  const r = rng32(seed), P = geo.attributes.position; const map = new Map();
  for (let i = 0; i < P.count; i++) {
    const k = P.getX(i).toFixed(3) + '|' + P.getY(i).toFixed(3) + '|' + P.getZ(i).toFixed(3);
    let o = map.get(k); if (!o) { o = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]; map.set(k, o); }
    P.setXYZ(i, P.getX(i) + o[0], P.getY(i) + o[1], P.getZ(i) + o[2]);
  }
  geo.computeVertexNormals(); return geo;
}

/* ------------------------------------------------------------------ рельеф */
class Terrain {
  constructor(M) {
    this.M = M; this.nx = M.nx; this.ny = M.ny; this.G = M.G;
    this.H0 = b64ToI16(M.H0), this.H2 = b64ToI16(M.H2), this.H4 = b64ToI16(M.H4);
    this.cls = b64ToU8(M.cls); this.lab = b64ToU8(M.lab); this.site = b64ToU8(M.site_g);
    this.w = [1, 0, 0];                       // веса H0,H2,H4
    this.h = new Float32Array(this.nx * this.ny);   // текущие высоты, м
    this.col = new Float32Array(this.nx * this.ny * 3);
    this.palW = 0; this.zoneMix = 0; this.season = 0; this.stagePal = 0;
    // индекс только для ячеек, где хотя бы одна вершина внутри участка
    const idx = [], nx = this.nx, ny = this.ny, S = this.site;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (!(S[a] || S[b] || S[c] || S[d])) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry(); this.geo = g;
    this.pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; this.pos[k * 3] = i * this.G; this.pos[k * 3 + 2] = j * this.G; }
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(nx * ny * 3), 3));
    g.setAttribute('color', new T.BufferAttribute(this.col, 3));
    g.setIndex(idx);
    this.mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    this.mat.onBeforeCompile = (sh) => {      // мелкая шумовая детализация в пикселе
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }`).replace('#include <color_fragment>', `#include <color_fragment>
{ float n = vn(vWP.xz*0.9)*0.5 + vn(vWP.xz*3.7)*0.3 + vn(vWP.xz*14.0)*0.2; diffuseColor.rgb *= 0.80 + 0.40*n; }`);
    };
    this.mesh = new T.Mesh(g, this.mat); this.mesh.receiveShadow = true; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.setWeights(1, 0, 0, true);
  }
  idx(x, z) { const fx = clamp(x / this.G, 0, this.nx - 1.001), fz = clamp(z / this.G, 0, this.ny - 1.001); return [fx, fz]; }
  sample(arr, x, z, scale) {                 // билинейно из int16 (см) или float
    const [fx, fz] = this.idx(x, z), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, nx = this.nx;
    const a = arr[j * nx + i], b = arr[j * nx + i + 1], c = arr[(j + 1) * nx + i], d = arr[(j + 1) * nx + i + 1];
    return (a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz) * scale;
  }
  hFinal(x, z) { return this.sample(this.H4, x, z, 0.01); }
  hNow(x, z) { return this.sample(this.h, x, z, 1); }
  hStage0(x, z) { return this.sample(this.H0, x, z, 0.01); }
  clsAt(x, z) { const i = clamp(Math.round(x / this.G), 0, this.nx - 1), j = clamp(Math.round(z / this.G), 0, this.ny - 1); return this.cls[j * this.nx + i]; }
  labAt(x, z) { const i = clamp(Math.round(x / this.G), 0, this.nx - 1), j = clamp(Math.round(z / this.G), 0, this.ny - 1); return this.lab[j * this.nx + i]; }
  setWeights(w0, w2, w4, force) {
    this.w = [w0, w2, w4];
    const n = this.h.length, H0 = this.H0, H2 = this.H2, H4 = this.H4, h = this.h, P = this.pos;
    for (let k = 0; k < n; k++) { const v = (H0[k] * w0 + H2[k] * w2 + H4[k] * w4) * 0.01; h[k] = v; P[k * 3 + 1] = v * VE; }
    this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals();
  }
}

/* ------------------------------------------------------------------ вода */
class Water {
  constructor(terrain) {
    this.t = terrain; const M = terrain.M;
    this.tex = new T.DataTexture(new Uint8Array(terrain.nx * terrain.ny * 4), terrain.nx, terrain.ny, T.RGBAFormat);
    this.tex.magFilter = T.LinearFilter; this.tex.minFilter = T.LinearFilter; this.tex.wrapS = this.tex.wrapT = T.ClampToEdgeWrapping; this.tex.needsUpdate = true;
    this.uniforms = {
      uDepth: { value: this.tex }, uTime: { value: 0 }, uLevel: { value: 0 }, uMurk: { value: 1 }, uSun: { value: new T.Vector3(0.5, 0.7, 0.3) },
      uSky: { value: new T.Color(0x8fb6e8) }, uSkyHi: { value: new T.Color(0x3f7fd0) }, uFog: { value: new T.Color(0xcfe0f0) }, uFogD: { value: 0.0006 }, uDim: { value: new T.Vector2(terrain.nx * terrain.G, terrain.ny * terrain.G) },
      uSunCol: { value: new T.Color(1, 0.95, 0.85) }, uIce: { value: 0 }, uAlpha: { value: 1 },
    };
    this.mat = new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `
        varying vec3 vW; uniform sampler2D uDepth; uniform float uTime, uLevel, uMurk, uFogD, uIce, uAlpha; uniform vec3 uSun, uSky, uSkyHi, uFog, uSunCol; uniform vec2 uDim;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
        float wave(vec2 p){ return vn(p*0.35+vec2(uTime*0.05,uTime*0.03))*0.6 + vn(p*1.3+vec2(-uTime*0.12,uTime*0.08))*0.3 + vn(p*4.7+vec2(uTime*0.25,uTime*0.2))*0.1; }
        void main(){
          vec2 uv = vec2(vW.x/uDim.x, vW.z/uDim.y);
          float depth = texture2D(uDepth, uv).r * 3.0;
          if (depth < 0.004) discard;
          vec3 V = normalize(cameraPosition - vW);
          float e = 0.35; vec2 p = vW.xz;
          vec3 N = normalize(vec3(-(wave(p+vec2(e,0.))-wave(p))/e*0.45, 1.0, -(wave(p+vec2(0.,e))-wave(p))/e*0.45));
          float fr = pow(1.0 - clamp(dot(N,V),0.0,1.0), 3.0)*0.85 + 0.10;
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSky, uSkyHi, clamp(R.y*1.4,0.,1.));
          float sp = pow(clamp(dot(R, normalize(uSun)),0.,1.), 220.0) * 2.2 + pow(clamp(dot(R, normalize(uSun)),0.,1.), 18.0)*0.12;
          vec3 shallow = mix(vec3(0.16,0.34,0.33), vec3(0.20,0.15,0.07), uMurk);
          vec3 deep = mix(vec3(0.04,0.20,0.27), vec3(0.06,0.05,0.025), uMurk);
          vec3 body = mix(shallow, deep, smoothstep(0.1, 1.7, depth));
          float duck = smoothstep(0.52,0.7, vn(p*0.45+3.0)) * (1.0 - smoothstep(0.0,0.9,depth)) * (0.35+0.65*uMurk);
          body = mix(body, vec3(0.20,0.30,0.07), duck*0.8);
          vec3 col = body*(1.0-fr) + sky*fr*(1.0-0.45*uMurk) + sp*uSunCol*fr;
          float foam = smoothstep(0.16, 0.0, depth) * 0.35;
          col = mix(col, vec3(0.95,0.97,1.0), foam*(0.6+0.4*vn(p*3.0+uTime*0.3)));
          col = mix(col, vec3(0.78,0.88,0.95)*0.9, uIce);   // лёд
          float a = smoothstep(0.004, 0.10, depth) * mix(0.82, 0.96, smoothstep(0.1,1.0,depth));
          a = mix(a, 1.0, uIce) * uAlpha;
          float dist = length(cameraPosition - vW); float f = 1.0 - exp(-uFogD*uFogD*dist*dist);
          col = mix(col, uFog, f);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const W = terrain.nx * terrain.G, H = terrain.ny * terrain.G;
    this.geo = new T.PlaneGeometry(W, H, 1, 1); this.geo.rotateX(-Math.PI / 2); this.geo.translate(W / 2, 0, H / 2);
    this.mesh = new T.Mesh(this.geo, this.mat); this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
    this.level = 0;
    { const nx = terrain.nx, ny = terrain.ny, c = terrain.cls, m = new Uint8Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let on = 0; for (let dj = -1; dj <= 1 && !on; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && c[b * nx + a] === 1) { on = 1; break; } } m[j * nx + i] = on; } this.wmask = m; }
  }
  update(level, murk, visible) {            // level в метрах относительно НУВ
    this.level = level; this.mesh.visible = visible; this.uniforms.uMurk.value = murk;
    this.mesh.position.y = level * VE;
    const t = this.t, n = t.nx * t.ny, d = this.tex.image.data, h = t.h;
    const wm = this.wmask; for (let k = 0; k < n; k++) { const dep = wm[k] ? level - h[k] : 0; d[k * 4] = clamp(dep / 3.0, 0, 1) * 255; d[k * 4 + 1] = 0; d[k * 4 + 2] = 0; d[k * 4 + 3] = 255; }
    this.tex.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ небо */
class Sky {
  constructor() {
    this.uniforms = { uTop: { value: new T.Color(0x2f6fd0) }, uMid: { value: new T.Color(0x7eb2ee) }, uHor: { value: new T.Color(0xcfe3f4) }, uSun: { value: new T.Vector3(0.5, 0.7, 0.3) }, uSunCol: { value: new T.Color(1, 0.9, 0.7) }, uCloud: { value: 1 }, uTime: { value: 0 } };
    this.mat = new T.ShaderMaterial({
      uniforms: this.uniforms, side: T.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uTop,uMid,uHor,uSun,uSunCol; uniform float uCloud,uTime;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
        void main(){ vec3 d = normalize(vD); float y = clamp(d.y,0.,1.);
          vec3 c = mix(uHor, uMid, smoothstep(0.0,0.35,y)); c = mix(c, uTop, smoothstep(0.25,0.9,y));
          float cs = clamp(dot(d, normalize(uSun)),0.,1.);
          c += uSunCol*(pow(cs,64.)*0.5 + pow(cs,8.)*0.18) + vec3(1.,.95,.85)*smoothstep(0.99975,0.99993,cs)*14.;
          vec2 u = d.xz/max(d.y,0.05)*0.9 + vec2(uTime*0.004, 3.1);
          float den = fbm(u*0.5), cov = smoothstep(0.50,0.70,den)*smoothstep(0.02,0.25,d.y)*uCloud;
          float den2 = fbm((u+normalize(uSun).xz*0.08)*0.5); float lit = clamp(0.6+(den-den2)*7.,0.3,1.2);
          vec3 cc = mix(vec3(0.55,0.60,0.72), vec3(1.05,1.02,0.98), lit); cc = mix(cc, cc*uSunCol*1.1, 0.25);
          c = mix(c, cc, cov*0.92);
          if (d.y < 0.0) c = mix(uHor, uHor*0.8, clamp(-d.y*3.,0.,1.));
          gl_FragColor = vec4(c,1.0); }`,
    });
    this.mesh = new T.Mesh(new T.SphereGeometry(4000, 32, 16), this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
  }
}

global.P3 = { T, VE, STAGES, b64ToI16, b64ToU8, rng32, clamp, lerp, smooth, hash2, vnoise, fbm, mergeGeoms, jitterGeo, Terrain, Water, Sky };
})(window);
/* Часть 2: деревья, камыш, кусты, дорожки, постройки, мебель, техника */
(function (global) {
'use strict';
const P3 = global.P3, T = P3.T, VE = P3.VE, rng32 = P3.rng32, clamp = P3.clamp, lerp = P3.lerp, smooth = P3.smooth;

/* ------------------------------------------------------------ Builder: статичная геометрия с цветом вершин */
class Builder {
  constructor() { this.parts = []; this.box1 = new T.BoxGeometry(1, 1, 1); this.cyl1 = new T.CylinderGeometry(1, 1, 1, 10, 1); this.cyl1o = new T.CylinderGeometry(1, 1, 1, 10, 1, true); this.cone1 = new T.ConeGeometry(1, 1, 12, 1); this.cone4 = new T.ConeGeometry(1, 1, 4, 1); this.cone8 = new T.ConeGeometry(1, 1, 8, 1); this.sph = new T.IcosahedronGeometry(1, 1); }
  _m(x, y, z, sx, sy, sz, ry, rx, rz) { const m = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')); return m.compose(new T.Vector3(x, y, z), q, new T.Vector3(sx, sy, sz)); }
  box(x, y, z, sx, sy, sz, c, ry, rx, rz) { this.parts.push({ geo: this.box1, color: c, m: this._m(x, y, z, sx, sy, sz, ry, rx, rz) }); }
  cyl(x, y, z, r, h, c, seg) { this.parts.push({ geo: this.cyl1, color: c, m: this._m(x, y, z, r, h, r, 0, 0, 0) }); }
  cone(x, y, z, r, h, c, kind, ry) { const g = kind === 4 ? this.cone4 : kind === 8 ? this.cone8 : this.cone1; this.parts.push({ geo: g, color: c, m: this._m(x, y, z, r, h, r, ry || 0, 0, 0) }); }
  ell(x, y, z, rx, ry_, rz, c) { this.parts.push({ geo: this.sph, color: c, m: this._m(x, y, z, rx, ry_, rz, 0, 0, 0) }); }
  beam(a, b, w, c, w2) {                  // брус от точки a до b, сечение w × w2
    const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), L = d.length(); if (L < 1e-6) return;
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), d.clone().normalize());
    const m = new T.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new T.Vector3(w, w2 || w, L)); this.parts.push({ geo: this.box1, color: c, m });
  }
  tri(a, b, c, col) {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3)); g.computeVertexNormals();
    this.parts.push({ geo: g, color: col, m: new T.Matrix4() });
  }
  poly(pts, y, col) {                     // плоский многоугольник в плане
    const sh = new T.Shape(pts.map(p => new T.Vector2(p[0], -p[1]))); const g = new T.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);   // (x, -y)->(x, 0, y), нормаль вверх
    this.parts.push({ geo: g, color: col, m: new T.Matrix4().makeTranslation(0, y, 0) });
  }
  build() { return P3.mergeGeoms(this.parts); }
}
const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const C = { wood: rgb(0x9a6a3c), woodD: rgb(0x6f4a2a), larch: rgb(0xb98a54), steel: rgb(0x4d5559), steelL: rgb(0xb8bfc4), white: rgb(0xeeeeea), red: rgb(0xc8432e), blue: rgb(0x2a68b8), yellow: rgb(0xe3b324), green: rgb(0x2f8a50), granite: rgb(0x6b6e72), roof: rgb(0x5a3d2c), roofG: rgb(0x3e5a48), sand: rgb(0xdcc790), rubberR: rgb(0xb2523a), rubberB: rgb(0x34609c), rubberG: rgb(0x3c8a52), rubberY: rgb(0xd7a937), beige: rgb(0xc9bfa8), teal: rgb(0x2b7a6a), rope: rgb(0xb89c6a), plaza: rgb(0x9a968c), service: rgb(0x8a8e92), bench: rgb(0xa8763f), lampHead: rgb(0xfff2c9), bin: rgb(0x2c5b3e), pit: rgb(0x2a7ab5), concrete: rgb(0x8f9194), orange: rgb(0xe0701d) };

/* ------------------------------------------------------------ виды деревьев */
const SP = {
  b: { n: 'Берёза', h10: 9.5, h0: 3.6, kind: 'broad', trunk: [0.90, 0.89, 0.84], cr: 0.30, col: [0.40, 0.60, 0.20], aut: [0.86, 0.72, 0.18], cnt: 5 },
  a: { n: 'Ольха', h10: 9.0, h0: 3.2, kind: 'broad', trunk: [0.28, 0.22, 0.17], cr: 0.34, col: [0.16, 0.34, 0.14], aut: [0.36, 0.40, 0.14], cnt: 6 },
  w: { n: 'Ива', h10: 8.5, h0: 3.0, kind: 'willow', trunk: [0.32, 0.26, 0.19], cr: 0.52, col: [0.50, 0.63, 0.28], aut: [0.82, 0.70, 0.22], cnt: 6 },
  t: { n: 'Липа', h10: 8.0, h0: 3.6, kind: 'broad', trunk: [0.26, 0.21, 0.16], cr: 0.36, col: [0.20, 0.42, 0.16], aut: [0.90, 0.76, 0.20], cnt: 6 },
  o: { n: 'Дуб', h10: 6.5, h0: 3.4, kind: 'broad', trunk: [0.30, 0.24, 0.17], cr: 0.52, col: [0.19, 0.36, 0.12], aut: [0.66, 0.44, 0.14], cnt: 7 },
  m: { n: 'Клён', h10: 8.0, h0: 3.6, kind: 'broad', trunk: [0.32, 0.26, 0.20], cr: 0.40, col: [0.28, 0.48, 0.14], aut: [0.86, 0.38, 0.12], cnt: 6 },
  j: { n: 'Яблоня ягодная', h10: 6.0, h0: 2.6, kind: 'broad', trunk: [0.30, 0.24, 0.19], cr: 0.44, col: [0.30, 0.50, 0.17], aut: [0.88, 0.52, 0.16], cnt: 6 },
  h: { n: 'Черёмуха', h10: 7.0, h0: 3.0, kind: 'broad', trunk: [0.26, 0.21, 0.18], cr: 0.40, col: [0.20, 0.40, 0.15], aut: [0.84, 0.62, 0.20], cnt: 6 },
  k: { n: 'Кедр сибирский', h10: 5.5, h0: 2.4, kind: 'spruce', trunk: [0.32, 0.24, 0.17], cr: 0.30, col: [0.08, 0.27, 0.19], aut: [0.08, 0.27, 0.19], cnt: 8 },
  r: { n: 'Рябина', h10: 5.5, h0: 2.6, kind: 'broad', trunk: [0.34, 0.28, 0.22], cr: 0.42, col: [0.32, 0.52, 0.16], aut: [0.82, 0.26, 0.14], cnt: 5 },
  s: { n: 'Ель', h10: 8.0, h0: 3.3, kind: 'spruce', trunk: [0.25, 0.19, 0.14], cr: 0.22, col: [0.07, 0.24, 0.14], aut: [0.07, 0.24, 0.14], cnt: 7 },
  p: { n: 'Сосна', h10: 10.0, h0: 3.0, kind: 'pine', trunk: [0.46, 0.32, 0.20], cr: 0.20, col: [0.12, 0.32, 0.17], aut: [0.12, 0.32, 0.17], cnt: 4 },
  l: { n: 'Лиственница', h10: 11.0, h0: 3.6, kind: 'larch', trunk: [0.30, 0.22, 0.15], cr: 0.18, col: [0.34, 0.54, 0.16], aut: [0.90, 0.66, 0.16], cnt: 6 },
};
function treeGeos(k, seed) {
  const s = SP[k], r = rng32(seed), trunk = new Builder(), crown = new Builder();
  const tc = s.trunk;
  if (s.kind === 'spruce' || s.kind === 'larch') {
    trunk.cyl(0, 0.2, 0, 0.012, 0.4, tc);
    const n = s.kind === 'spruce' ? 7 : 6;
    for (let i = 0; i < n; i++) { const f = i / n, rr = s.cr * (1 - f * 0.9) * (0.9 + r() * 0.2); crown.cone(0, 0.10 + f * 0.82 + 0.09, 0, rr, 0.22, [1, 1, 1], 8, r() * 3); }
    crown.cone(0, 0.97, 0, 0.03, 0.12, [1, 1, 1], 8, 0);
  } else if (s.kind === 'pine') {
    trunk.cyl(0, 0.36, 0, 0.012, 0.72, tc);
    trunk.beam([0, 0.55, 0], [0.06, 0.72, 0.04], 0.012, tc);
    for (let i = 0; i < 4; i++) { const a = r() * 6.28, f = i / 4; crown.ell(Math.cos(a) * 0.07, 0.78 + f * 0.2, Math.sin(a) * 0.07, 0.17 - f * 0.05, 0.065, 0.17 - f * 0.05, [1, 1, 1]); }
  } else {
    const th = s.kind === 'willow' ? 0.4 : 0.48; trunk.cyl(0, th / 2, 0, 0.014 + (s.cr - 0.3) * 0.02, th, tc);
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + r(), d = s.kind === 'willow' ? 0.22 : 0.16; trunk.beam([0, th * 0.8, 0], [Math.cos(a) * d, th + 0.16 + r() * 0.1, Math.sin(a) * d], 0.007, tc); }
    const cy = s.kind === 'willow' ? 0.62 : 0.68, cr = s.cr;
    for (let i = 0; i < s.cnt; i++) {
      const a = i * 2.4 + r(), d = i === 0 ? 0 : cr * (0.35 + r() * 0.35), yy = cy + (i === 0 ? 0.08 : (r() - 0.4) * cr * 0.8);
      const rad = cr * (i === 0 ? 0.78 : 0.55 + r() * 0.2);
      if (s.kind === 'willow') crown.ell(Math.cos(a) * d, yy - (i === 0 ? 0 : 0.06), Math.sin(a) * d, rad, rad * 0.85, rad, [1, 1, 1]); else crown.ell(Math.cos(a) * d, yy, Math.sin(a) * d, rad, rad * 0.85, rad, [1, 1, 1]);
    }
  }
  return { trunk: trunk.build(), crown: P3.jitterGeo(crown.build(), 0.12 * 0.5, seed + 11) };
}

/* ------------------------------------------------------------ камыш */
function reedGeo(seed) {
  const r = rng32(seed), b = new Builder();
  for (let i = 0; i < 7; i++) {
    const a = r() * 6.28, d = r() * 0.25, hh = 0.55 + r() * 0.6, tx = (r() - 0.5) * 0.5, tz = (r() - 0.5) * 0.5;
    b.beam([Math.cos(a) * d, 0, Math.sin(a) * d], [Math.cos(a) * d + tx, hh, Math.sin(a) * d + tz], 0.03, [1, 1, 1], 0.012);
    if (i < 2) b.cyl(Math.cos(a) * d + tx * 0.95, hh * 0.9, Math.sin(a) * d + tz * 0.95, 0.03, 0.2, [0.3, 0.2, 0.12]);
  }
  return b.build();
}

/* ------------------------------------------------------------ ленты дорожек */
function resample(pts, step, closed) {
  const out = []; const n = pts.length; const segs = closed ? n : n - 1; let carry = 0;
  out.push(pts[0].slice());
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = step - carry;
    while (t <= L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; }
    carry = L - (t - step);
  }
  if (!closed) out.push(pts[n - 1].slice());
  return out;
}
function ribbon(pts, width, yfn, closed) {
  const n = pts.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx, hw = width / 2;
    const x0 = pts[i][0] + nx * hw, z0 = pts[i][1] + nz * hw, x1 = pts[i][0] - nx * hw, z1 = pts[i][1] - nz * hw;
    pos.push(x0, yfn(x0, z0), z0, x1, yfn(x1, z1), z1);
  }
  const segN = closed ? n : n - 1;
  for (let i = 0; i < segN; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);
  return g;
}

global.P3.Builder = Builder; global.P3.C = C; global.P3.SP = SP; global.P3.treeGeos = treeGeos; global.P3.reedGeo = reedGeo; global.P3.resample = resample; global.P3.ribbon = ribbon; global.P3.rgb = rgb;
})(window);
/* Часть 3: сцена парка, стадии, свет, подписи */
(function (global) {
'use strict';
const P3 = global.P3, T = P3.T, VE = P3.VE, STAGES = P3.STAGES, SP = P3.SP, C = P3.C, Builder = P3.Builder, rng32 = P3.rng32, clamp = P3.clamp, lerp = P3.lerp, smooth = P3.smooth;
const ZONE_COL = { 1: [0.36, 0.62, 0.38], 2: [0.62, 0.45, 0.78], 3: [0.95, 0.62, 0.25], 4: [0.30, 0.55, 0.85], 5: [0.72, 0.52, 0.34], 6: [0.90, 0.35, 0.35], 7: [0.62, 0.64, 0.66], 8: [0.30, 0.50, 0.30], 9: [0.25, 0.65, 0.62], 10: [0.9, 0.5, 0.65], 11: [0.2, 0.5, 0.7] };
const ZONE_NAMES = { 1: 'Тихая зона', 2: 'Культурная зона', 3: 'Массовый отдых', 4: 'Спорт и воркаут', 5: 'Собаки', 6: 'Детская зона', 7: 'Служебная', 8: 'Берма', 9: 'Полуостров', 10: 'Входная площадь' };

class Park3D {
  constructor(el, M, opts) {
    this.el = el; this.M = M; this.opts = opts || {}; this.sv = 0; this.target = 0; this.tw = null;
    this.env = { season: 0, tod: 0 }; this.show = { trees: true, water: true, paths: true, labels: true, zones: false };
    this.dirty = true; this.shadowDirty = true; this.labels = [];
    const W = el.clientWidth || 800, H = el.clientHeight || 500;
    const R = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!this.opts.preserve });
    R.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.75)); R.setSize(W, H, false);
    R.outputColorSpace = T.SRGBColorSpace; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 0.95;
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFShadowMap; R.shadowMap.autoUpdate = false;
    R.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline:none'; el.appendChild(R.domElement);
    this.scene = new T.Scene(); this.scene.fog = new T.FogExp2(0xcfe0f0, 0.0009);
    this.camera = new T.PerspectiveCamera(38, W / H, 2, 9000);
    this.controls = new T.OrbitControls(this.camera, R.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08; this.controls.maxPolarAngle = 1.52; this.controls.minDistance = 3; this.controls.maxDistance = 1500; this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    // свет
    this.sun = new T.DirectionalLight(0xfff0d8, 3.0); this.sun.castShadow = true;
    const ms = (W < 700 || (global.devicePixelRatio || 1) > 2.2) ? 2048 : 4096; this.sun.shadow.mapSize.set(ms, ms);
    const sc = this.sun.shadow.camera; sc.left = -380; sc.right = 380; sc.top = 380; sc.bottom = -380; sc.near = 50; sc.far = 2200; this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.9;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new T.HemisphereLight(0xbcd6ff, 0x6b7a55, 1.05); this.scene.add(this.hemi);
    this.sky = new P3.Sky(); this.scene.add(this.sky.mesh);
    // рельеф и вода
    this.terrain = new P3.Terrain(M); this.scene.add(this.terrain.mesh);
    this.water = new P3.Water(this.terrain); this.scene.add(this.water.mesh);
    { const sh = new T.Shape(); sh.moveTo(-6000, -6000); sh.lineTo(6000, -6000); sh.lineTo(6000, 6000); sh.lineTo(-6000, 6000); sh.closePath(); const hole = new T.Path(); M.site.slice().reverse().forEach((p, i) => i ? hole.lineTo(p[0], p[1]) : hole.moveTo(p[0], p[1])); hole.closePath(); sh.holes.push(hole);
      const cg = new T.ShapeGeometry(sh); cg.rotateX(Math.PI / 2); this.ctx = new T.Mesh(cg, new T.MeshStandardMaterial({ color: 0x6b7a58, roughness: 1, side: T.DoubleSide })); }
    this.ctx.material.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position,1.0)).xyz;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nfloat h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }\nfloat vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }').replace('#include <color_fragment>', '#include <color_fragment>\n{ float n = vn(vWP.xz*0.02)*0.5 + vn(vWP.xz*0.11)*0.3 + vn(vWP.xz*0.7)*0.2; diffuseColor.rgb *= 0.72 + 0.56*n; }'); };
    this.ctx.position.set(0, 0.35, 0); this.ctx.receiveShadow = true; this.scene.add(this.ctx);
    const rg = rng32(7); this.rg = rg;
    this.nz = new Float32Array(this.terrain.nx * this.terrain.ny); this.nz2 = new Float32Array(this.nz.length);
    for (let j = 0; j < this.terrain.ny; j++) for (let i = 0; i < this.terrain.nx; i++) { this.nz[j * this.terrain.nx + i] = P3.fbm(i * 0.12, j * 0.12, 3); this.nz2[j * this.terrain.nx + i] = P3.fbm(i * 0.5 + 40, j * 0.5, 2); }
    this.buildContext(); this.buildVegetation(); if (this.buildNorthVeg) this.buildNorthVeg(); this.buildPaths(); this.buildStructures(); this.buildTemporary(); this.buildPOIs();
    this.applyEnv(); this.setCameraPreset('iso', false); this.applyState(true);
    this.resizeObs = new ResizeObserver(() => this.resize()); this.resizeObs.observe(el);
    this.clock = new T.Clock(); this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    // клик по метке/панораме
    this._ray = new T.Raycaster();
  }
  gY(x, z) { return this.terrain.hFinal(x, z) * VE; }
  gY0(x, z) { return this.terrain.hStage0(x, z) * VE; }


  /* ---------------------------------------------------------- окружение: деревья и дома вокруг участка */
  buildContext() {
    const M = this.M, rg = rng32(555), poly = M.site, cx = M.W / 2, cz = M.H / 2;
    const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const dist = (x, z) => { let d = 1e9; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz, t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / L2, 0, 1), dx = x - (a[0] + t * vx), dz = z - (a[1] + t * vz); d = Math.min(d, Math.hypot(dx, dz)); } return d; };
    const mk = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; this.scene.add(m); return m; };
    this._roads();
    const list = [];
    let guard = 0; while (list.length < 900 && guard++ < 80000) {
      const x = cx + (rg() - 0.5) * 900, z = cz + (rg() - 0.5) * 750; if (inside(x, z)) continue; const d = dist(x, z); if (d < 8) continue;
      const dens = d < 22 ? 0.95 : d < 55 ? 0.35 : d < 75 ? 0 : 0.05; if (rg() > dens) continue;
      if (this._onRoad && this._onRoad(x, z)) continue;
      list.push([x, z, rg() < 0.28 ? 1 : 0, 7 + rg() * 8, rg() * 6.28, rg()]);
    }
    const gb = P3.treeGeos('b', 401), gs = P3.treeGeos('s', 402), tm = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), cm = new T.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const nb = list.filter(t => t[2] === 0).length, ns = list.length - nb;
    this.ctxTrees = { b: { crown: mk(gb.crown, cm, nb), trunk: mk(gb.trunk, tm, nb), n: nb }, s: { crown: mk(gs.crown, cm.clone(), ns), trunk: mk(gs.trunk, tm, ns), n: ns }, list };
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v3 = new T.Vector3(), s3 = new T.Vector3(); let ib = 0, is = 0;
    for (const t of list) { const set = t[2] === 0 ? this.ctxTrees.b : this.ctxTrees.s, i = t[2] === 0 ? ib++ : is++; e.set(0, t[4], 0); q.setFromEuler(e); v3.set(t[0], 0.3, t[1]); s3.set(t[3], t[3], t[3]); m4.compose(v3, q, s3); set.crown.setMatrixAt(i, m4); set.trunk.setMatrixAt(i, m4); t._i = i; }
    // жилые кварталы вокруг: ряды домов вдоль проспекта
    const b = new Builder(), ang = this._roadAng; let guard2 = 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let u = -900; u <= 900; u += 95) for (let v = -800; v <= 800; v += 70) {
      const x = cx + u * ca - v * sa, z = cz + u * sa + v * ca; const d = dist(x, z);
      if (inside(x, z) || d < 95 || (this._onRoad && this._onRoad(x, z, 25))) continue; if (rg() < 0.35) continue;
      const w = 55 + rg() * 30, dd = 13 + rg() * 4, h = 27 + Math.floor(rg() * 5) * 6, tone = 0.80 + rg() * 0.16, ry = -ang + (rg() < 0.25 ? Math.PI / 2 : 0);
      b.box(x, 0.3 + h / 2, z, w, h, dd, [tone, tone * 0.93, tone * 0.82], ry);
    }
    this.skyline = new T.Mesh(b.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, emissive: 0x2a2620, emissiveIntensity: 0.6 })); this.skyline.frustumCulled = false; this.scene.add(this.skyline);
    this.paintContext();
  }
  _roads() {
    const M = this.M, P = M.site, A = P[2], B = P[3], C = P[1];       // A–B: длинная юго-западная сторона (проспект), C–A: юго-восточная (улица)
    const mkRoad = (p, q, off, w) => { const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L; // наружная нормаль
      const ext = 700, a = [p[0] - dx / L * ext + nx * off, p[1] - dz / L * ext + nz * off], b2 = [q[0] + dx / L * ext + nx * off, q[1] + dz / L * ext + nz * off];
      return { a, b: b2, w, nx, nz }; };
    const cen = [M.W / 2, M.H / 2], test = (r) => { const mx = (r.a[0] + r.b[0]) / 2, mz = (r.a[1] + r.b[1]) / 2; if ((mx - cen[0]) * r.nx + (mz - cen[1]) * r.nz < 0) { r.nx = -r.nx; r.nz = -r.nz; } return r; };
    const r1 = test(mkRoad(A, B, 0, 0)), r2 = test(mkRoad(C, A, 0, 0));
    const road = (p, q, off, w) => { const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); let nx = dz / L, nz = -dx / L; const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2; if ((mx - cen[0]) * nx + (mz - cen[1]) * nz < 0) { nx = -nx; nz = -nz; } const ext = 900; return { a: [p[0] - dx / L * ext + nx * off, p[1] - dz / L * ext + nz * off], b: [q[0] + dx / L * ext + nx * off, q[1] + dz / L * ext + nz * off], w }; };
    const R = [road(A, B, 38, 26), road(C, A, 28, 14)]; this._roadAng = Math.atan2(B[1] - A[1], B[0] - A[0]);
    const segd = (x, z, r) => { const vx = r.b[0] - r.a[0], vz = r.b[1] - r.a[1], t = clamp(((x - r.a[0]) * vx + (z - r.a[1]) * vz) / (vx * vx + vz * vz), 0, 1); return Math.hypot(x - r.a[0] - t * vx, z - r.a[1] - t * vz); };
    this._onRoad = (x, z, pad) => R.some(r => segd(x, z, r) < r.w / 2 + (pad || 6));
    const mat = new T.MeshStandardMaterial({ color: 0x74777a, roughness: 0.92, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const r of R) { const g = P3.ribbon([r.a, r.b], r.w, () => 0.38, false); const m = new T.Mesh(g, mat); m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m);
      const g2 = P3.ribbon([r.a, r.b], 0.4, () => 0.42, false); this.scene.add(new T.Mesh(g2, new T.MeshBasicMaterial({ color: 0xd8d8d0, side: T.DoubleSide }))); }
  }
  paintContext() {
    const c = new T.Color(), season = this.env.season, rg = rng32(9);
    for (const key of ['b', 's']) { const set = this.ctxTrees[key]; if (!set.n) continue; const spr = key === 's';
      set.crown.visible = !(season === 2 && !spr); set.trunk.visible = true;
      for (let i = 0; i < set.n; i++) { const k = 0.75 + 0.5 * rg(); let col = spr ? [0.07, 0.24, 0.14] : season === 1 ? [0.80, 0.55, 0.18] : [0.24, 0.42, 0.16]; if (season === 2 && spr) col = [0.70, 0.78, 0.76]; set.crown.setColorAt(i, c.setRGB(col[0] * k, col[1] * k, col[2] * k)); set.trunk.setColorAt(i, c.setRGB(season === 2 ? 0.55 : 1, season === 2 ? 0.55 : 1, season === 2 ? 0.55 : 1)); }
      set.crown.instanceColor.needsUpdate = true; set.trunk.instanceColor.needsUpdate = true; }
  }
  /* ---------------------------------------------------------- растительность */
  buildVegetation() {
    const M = this.M, rg = this.rg, mk = (geo, mat, n, cast) => { const m = new T.InstancedMesh(geo, mat, n); m.castShadow = cast !== false; m.receiveShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(T.DynamicDrawUsage); this.scene.add(m); return m; };
    const trunkMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.treeSets = []; const by = {};
    for (const t of M.trees) (by[t[2]] = by[t[2]] || []).push(t);
    let seed = 100;
    for (const k of Object.keys(SP)) {
      const list = by[k] || []; if (!list.length) continue;
      const g = P3.treeGeos(k, seed++); const crownMat = new T.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
      const crown = mk(g.crown, crownMat, list.length), trunk = mk(g.trunk, trunkMat, list.length);
      const var_ = list.map(() => ({ s: 0.85 + rg() * 0.34, r: rg() * 6.28, c: rg(), c2: rg() }));
      this.treeSets.push({ k, sp: SP[k], list, crown, trunk, v: var_, mat: crownMat });
    }
    // существующая растительность (болото сейчас)
    const rg2 = rng32(33);
    const reedG = P3.reedGeo(5), reedMat = new T.MeshStandardMaterial({ roughness: 0.95, vertexColors: true });
    this.reed0 = mk(reedG, reedMat, M.reeds0.length); this.reed0.castShadow = false;
    this.reed0v = M.reeds0.map(() => ({ s: 0.8 + rg2() * 1.1, r: rg2() * 6.28, c: rg2() }));
    this.reedL = mk(reedG, new T.MeshStandardMaterial({ roughness: 0.95, vertexColors: true }), M.lit.length); this.reedL.castShadow = false;
    this.reedLv = M.lit.map(() => ({ s: 0.8 + rg2() * 1.0, r: rg2() * 6.28, c: rg2() }));
    const gb = P3.treeGeos('b', 301), gw = P3.treeGeos('w', 302);
    this.exTrees = M.ex_trees; const nb = M.ex_trees.filter(t => t[2] === 0).length, nw = M.ex_trees.filter(t => t[2] === 1).length, ns = M.ex_trees.filter(t => t[2] === 2).length;
    this.exB = { crown: mk(gb.crown, new T.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), nb), trunk: mk(gb.trunk, trunkMat, nb) };
    this.exW = { crown: mk(gw.crown, new T.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), nw), trunk: mk(gw.trunk, trunkMat, nw) };
    this.exS = mk(gb.trunk, new T.MeshStandardMaterial({ roughness: 1, color: 0x4a3f36, vertexColors: false }), ns);
    const dg = new T.BoxGeometry(1, 1, 1); this.debris = mk(dg, new T.MeshStandardMaterial({ color: 0x8a8c8e, roughness: 1 }), M.debris.length);
    // кусты
    const sh = new T.IcosahedronGeometry(1, 1); P3.jitterGeo(sh, 0.18, 9);
    this.shrubN = M.shrubs.length * 3; this.shrubs = mk(sh, new T.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), this.shrubN);
    this.shrubV = []; for (let i = 0; i < this.shrubN; i++) this.shrubV.push({ dx: (rg() - 0.5) * 2.4, dz: (rg() - 0.5) * 2.4, s: 0.7 + rg() * 0.8, c: rg() });
    // цветы луга
    const fp = [], fc = [], rg3 = rng32(77), pal = [[0.98, 0.98, 0.94], [0.98, 0.82, 0.18], [0.66, 0.44, 0.88], [0.94, 0.42, 0.58], [0.48, 0.62, 0.95], [0.99, 0.62, 0.2]];
    let guard = 0; const T_ = this.terrain;
    while (fp.length < 26000 && guard++ < 400000) {
      const x = rg3() * M.W, z = rg3() * M.H, c = T_.clsAt(x, z);
      if (!(c === 16 || c === 14 || c === 17 || c === 13 || c === 15 && rg3() < 0.15)) continue;
      if (!T_.site[Math.round(z / T_.G) * T_.nx + Math.round(x / T_.G)]) continue;
      if (P3.fbm(x * 0.05, z * 0.05, 2) < 0.42 && rg3() < 0.6) continue;
      fp.push(x, this.gY(x, z) + 0.35, z); const q = pal[(rg3() * 6) | 0]; fc.push(q[0], q[1], q[2]);
    }
    const fg = new T.BufferGeometry(); fg.setAttribute('position', new T.Float32BufferAttribute(fp, 3)); fg.setAttribute('color', new T.Float32BufferAttribute(fc, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32; { const g = dot.getContext('2d'); g.fillStyle = '#fff'; for (let i = 0; i < 5; i++) { const an = i / 5 * 6.283; g.beginPath(); g.ellipse(16 + Math.cos(an) * 7, 16 + Math.sin(an) * 7, 6.5, 6.5, 0, 0, 6.3); g.fill(); } }
    this.flowers = new T.Points(fg, new T.PointsMaterial({ size: 0.9, vertexColors: true, sizeAttenuation: true, fog: true, map: new T.CanvasTexture(dot), alphaTest: 0.5 })); this.flowers.frustumCulled = false; this.scene.add(this.flowers);
    this.flowerN = fp.length / 3;
  }

  /* ---------------------------------------------------------- дорожки и настилы */
  buildPaths() {
    const M = this.M, T_ = this.terrain; this.pathMeshes = [];
    const mats = {
      main: new T.MeshStandardMaterial({ color: 0xa5877a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      sec: new T.MeshStandardMaterial({ color: 0xcdbd9c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      track: new T.MeshStandardMaterial({ color: 0xb04a36, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      deck: new T.MeshStandardMaterial({ color: 0xa06c3a, roughness: 0.85 }),
      rail: new T.MeshStandardMaterial({ color: 0x6f4a2a, roughness: 0.9 }),
      plate: new T.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    this.pathMats = mats;
    const yG = (off) => (x, z) => this.gY(x, z) + off;
    for (const p of M.paths) {
      const pts = P3.resample(p.pts, 1.6, p.closed);
      if (p.kind === 'deck') {
        const yy = 0.5 * VE;
        const m = new T.Mesh(P3.ribbon(pts, p.width, () => yy, false), mats.deck); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
        const b = new Builder();
        for (let i = 0; i < pts.length; i += 3) { const a = pts[i], q = pts[Math.min(i + 1, pts.length - 1)]; const dx = q[0] - a[0], dz = q[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
          for (const sg of [-1, 1]) { const x = a[0] + nx * sg * (p.width / 2 - 0.1), z = a[1] + nz * sg * (p.width / 2 - 0.1); b.cyl(x, yy + 0.5, z, 0.06, 1.0, C.woodD); b.cyl(x, yy - 1.2, z, 0.1, 2.4, C.woodD); } }
        for (const sg of [-1, 1]) for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], q = pts[i + 1]; const dx = q[0] - a[0], dz = q[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L; const o = sg * (p.width / 2 - 0.1);
          b.beam([a[0] + nx * o, yy + 1.0, a[1] + nz * o], [q[0] + nx * o, yy + 1.0, q[1] + nz * o], 0.1, C.larch, 0.07); }
        const rm = new T.Mesh(b.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); rm.castShadow = true; this.scene.add(rm);
        this.pathMeshes.push({ kind: 'deck', meshes: [m, rm], p });
        continue;
      }
      const w = p.kind === 'main' ? p.width : p.kind === 'track' ? p.width : p.width;
      const m = new T.Mesh(P3.ribbon(pts, w, yG(0.11), p.closed), mats[p.kind] || mats.sec); m.receiveShadow = true; this.scene.add(m);
      this.pathMeshes.push({ kind: p.kind, meshes: [m], p });
      if (p.kind === 'main' && p.name.indexOf('восточное') >= 0) {      // временные дорожные плиты на стадиях 1–4
        const pm = new T.Mesh(P3.ribbon(pts, 3.8, yG(0.12), p.closed), mats.plate); pm.receiveShadow = true; pm.frustumCulled = false; this.scene.add(pm); this.plates = pm;
      }
    }
  }

  /* ---------------------------------------------------------- постройки, площадки, мебель */
  buildStructures() {
    const M = this.M, b = new Builder(), gY = (x, z) => this.gY(x, z);
    const loc = (o, lx, lz) => { const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0); return [o.x + lx * c - lz * s, o.y + lx * s + lz * c]; };
    const bx = (o, lx, lz, y, sx, sy, sz, col) => { const p = loc(o, lx, lz); b.box(p[0], y + sy / 2, p[1], sx, sy, sz, col, -(o.rot || 0)); };
    const yB = (o) => gY(o.x, o.y);
    for (const o of M.buildings) {
      const y0 = yB(o);
      if (o.kind === 'gate') {
        for (const s of [-1, 1]) { bx(o, s * 9.2, 0, y0, 1.5, 4.2, 1.5, C.granite); bx(o, s * 9.2, 0, y0 + 4.2, 1.9, 0.25, 1.9, C.steel); }
        bx(o, 0, 0, y0 + 4.2, 20.6, 0.4, 6.6, C.woodD); bx(o, 0, 3.2, y0 + 3.0, 12.0, 1.1, 0.2, C.teal);
        for (const s of [-3.5, 3.5]) bx(o, s, -2.2, y0, 0.3, 4.2, 0.3, C.larch);
        bx(o, 0, -1.5, y0, 3.2, 2.6, 2.2, C.wood); bx(o, 0, -1.5, y0 + 2.6, 3.6, 0.2, 2.6, C.roof);
      } else if (o.kind === 'kiosk') {
        bx(o, 0, 0, y0, o.w, 2.7, o.d, C.woodD); const p = loc(o, 0, 0); b.cone(p[0], y0 + 2.7 + 0.65, p[1], Math.max(o.w, o.d) * 0.78, 1.3, C.roof, 4, -(o.rot || 0) + Math.PI / 4);
        bx(o, 0, o.d / 2 + 0.05, y0 + 1.0, o.w * 0.7, 1.0, 0.1, [0.32, 0.55, 0.62]);
      } else if (o.kind === 'wc') {
        bx(o, 0, 0, y0, o.w, 2.6, o.d, C.beige); bx(o, 0, 0, y0 + 2.6, o.w + 0.5, 0.2, o.d + 0.5, C.steel);
      } else if (o.kind === 'pavilion') {
        const p = loc(o, 0, 0); b.cyl(p[0], y0 + 0.15, p[1], 3.9, 0.3, C.wood);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8, x = p[0] + Math.cos(a) * 3.2, z = p[1] + Math.sin(a) * 3.2; b.cyl(x, y0 + 0.3 + 1.3, z, 0.1, 2.6, C.larch);
          const a2 = a + Math.PI / 4, x2 = p[0] + Math.cos(a2) * 3.2, z2 = p[1] + Math.sin(a2) * 3.2; if (i !== 5) b.beam([x, y0 + 1.4, z], [x2, y0 + 1.4, z2], 0.08, C.larch, 0.06); }
        b.cone(p[0], y0 + 2.9 + 1.05, p[1], 4.7, 2.1, C.roof, 8, 0); b.cyl(p[0], y0 + 5.2, p[1], 0.05, 0.6, C.steel); b.box(p[0], y0 + 0.6, p[1], 1.4, 0.1, 1.4, C.larch);
      } else if (o.kind === 'service') {
        bx(o, 0, 0, y0, o.w, 3.2, o.d, C.service); bx(o, 0, 0, y0 + 3.2, o.w + 0.4, 0.2, o.d + 0.4, C.steel);
      } else if (o.kind === 'tower') {
        const cx = o.x, cz = o.y, Ht = 18, wb = 2.7, wt = 1.1, y = y0 - 0.3; const w = k => wb + (wt - wb) * k;
        const lv = [0, 0.25, 0.5, 0.75, 1.0];
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam([cx + sx * wb, y, cz + sz * wb], [cx + sx * wt, y + Ht, cz + sz * wt], 0.34, C.larch);
        const sides = [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]];
        for (const k of lv) { const ww = w(k), yy = y + Ht * k; for (const s of sides) b.beam([cx + s[0] * ww, yy, cz + s[1] * ww], [cx + s[2] * ww, yy, cz + s[3] * ww], 0.2, C.woodD); }
        for (let i = 0; i < 4; i++) { const w0 = w(lv[i]), w1 = w(lv[i + 1]), ya = y + Ht * lv[i], yb = y + Ht * lv[i + 1]; for (const s of sides) { b.beam([cx + s[0] * w0, ya, cz + s[1] * w0], [cx + s[2] * w1, yb, cz + s[3] * w1], 0.12, C.larch); b.beam([cx + s[2] * w0, ya, cz + s[3] * w0], [cx + s[0] * w1, yb, cz + s[1] * w1], 0.12, C.larch); } }
        for (const [k, ex] of [[0.5, 0], [1.0, 0.6]]) { const ww = w(k) + ex, yy = y + Ht * k; b.box(cx, yy + 0.05, cz, ww * 2 + 0.3, 0.16, ww * 2 + 0.3, C.wood);
          for (const s of sides) { b.beam([cx + s[0] * (ww + 0.1), yy + 1.1, cz + s[1] * (ww + 0.1)], [cx + s[2] * (ww + 0.1), yy + 1.1, cz + s[3] * (ww + 0.1)], 0.1, C.larch); b.beam([cx + s[0] * (ww + 0.1), yy + 0.1, cz + s[1] * (ww + 0.1)], [cx + s[0] * (ww + 0.1), yy + 1.1, cz + s[1] * (ww + 0.1)], 0.08, C.larch); } }
        const yt = y + Ht; for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(cx + sx * (wt + 0.3), yt + 1.5, cz + sz * (wt + 0.3), 0.1, 2.9, C.larch);
        b.cone(cx, yt + 3.7, cz, 3.2, 1.9, C.roof, 4, Math.PI / 4);
      }
    }
    // пирсы, причал
    for (const o of M.platforms) { const yy = 0.5 * VE; bx(o, 0, 0, yy - 0.12, o.w, 0.2, o.d, C.wood); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = loc(o, sx * (o.w / 2 - 0.3), sz * (o.d / 2 - 0.3)); b.cyl(p[0], yy - 1.7, p[1], 0.1, 3.2, C.woodD); b.cyl(p[0], yy + 0.5, p[1], 0.06, 1.0, C.woodD); }
      for (const sz of [-1, 1]) bx(o, 0, sz * (o.d / 2 - 0.3), yy + 0.95, o.w, 0.08, 0.08, C.larch); bx(o, 0, 0, yy + 0.05, 1.5, 0.45, 0.4, C.bench); }
    // игровые площадки
    const surf = (o, col, ex) => { const p = loc(o, 0, 0); b.box(p[0], gY(o.x, o.y) + 0.12, p[1], o.w + (ex || 0), 0.1, o.d + (ex || 0), col, -(o.rot || 0)); };
    for (const o of M.pg) {
      const y0 = gY(o.x, o.y);
      if (o.kind === 'complex') {
        surf(o, C.rubberR); const t1 = loc(o, -3, 0), t2 = loc(o, 3.2, 0);
        for (const [t, col, h] of [[t1, C.red, 3.0], [t2, C.blue, 2.6]]) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(t[0] + sx * 1.1, y0 + h / 2, t[1] + sz * 1.1, 0.09, h, C.larch); b.box(t[0], y0 + 1.4, t[1], 2.5, 0.12, 2.5, C.wood); b.cone(t[0], y0 + h + 0.6, t[1], 2.1, 1.25, col, 12, 0); }
        b.box((t1[0] + t2[0]) / 2, y0 + 1.3, (t1[1] + t2[1]) / 2, 3.6, 0.1, 1.0, C.wood);
        b.beam([t1[0] + 0.4, y0 + 1.5, t1[1] + 1.1], [t1[0] + 0.4, y0 + 0.15, t1[1] + 4.6], 0.7, C.steelL, 0.05); b.beam([t1[0] + 0.4, y0 + 1.5, t1[1] + 1.1], [t1[0] + 0.4, y0 + 0.15, t1[1] + 4.6], 0.1, C.yellow, 0.3);
      } else if (o.kind === 'rope') {
        surf(o, C.rubberB); const p = loc(o, 0, 0);
        for (const sx of [-1, 1]) b.cyl(p[0] + sx * 3.5, y0 + 1.8, p[1], 0.12, 3.6, C.larch); b.beam([p[0] - 3.5, y0 + 3.5, p[1]], [p[0] + 3.5, y0 + 3.5, p[1]], 0.14, C.larch);
        for (let i = 0; i < 6; i++) b.beam([p[0] - 3.5 + i * 1.4, y0 + 3.5, p[1]], [p[0] - 2.0 + i * 1.0, y0 + 0.4, p[1] + 2.5], 0.035, C.rope);
        for (let i = 0; i < 5; i++) b.beam([p[0] - 3.0 + i * 1.5, y0 + 0.5 + i * 0.1, p[1] + 1.5], [p[0] - 2.5 + i * 1.5, y0 + 1.5, p[1] - 1.0], 0.035, C.rope);
      } else if (o.kind === 'swing') {
        surf(o, C.rubberG); const p = loc(o, 0, 0);
        for (const sx of [-4.5, 4.5]) { b.beam([p[0] + sx, y0, p[1] - 1.1], [p[0] + sx, y0 + 2.7, p[1]], 0.12, C.larch); b.beam([p[0] + sx, y0, p[1] + 1.1], [p[0] + sx, y0 + 2.7, p[1]], 0.12, C.larch); }
        b.beam([p[0] - 4.7, y0 + 2.72, p[1]], [p[0] + 4.7, y0 + 2.72, p[1]], 0.16, C.larch);
        for (const sx of [-2.2, 0, 2.2]) { b.beam([p[0] + sx, y0 + 2.7, p[1]], [p[0] + sx, y0 + 0.55, p[1]], 0.02, C.steel); b.box(p[0] + sx, y0 + 0.5, p[1], 0.5, 0.05, 0.2, [0.12, 0.12, 0.14]); }
      } else if (o.kind === 'sand') {
        const p = loc(o, 0, 0); b.box(p[0], y0 + 0.2, p[1], o.w, 0.4, o.d, C.woodD, -(o.rot || 0)); b.box(p[0], y0 + 0.28, p[1], o.w - 0.5, 0.3, o.d - 0.5, C.sand, -(o.rot || 0));
      } else if (o.kind === 'splash') {
        const p = loc(o, 0, 0); b.cyl(p[0], y0 + 0.1, p[1], 5.6, 0.1, [0.52, 0.72, 0.86]);
        for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 1 + (i % 3) * 1.5; b.cyl(p[0] + Math.cos(a) * r, y0 + 0.5, p[1] + Math.sin(a) * r, 0.05, 0.8, [0.85, 0.93, 0.98]); }
      }
    }
    // парус
    { const s = M.sail, y0 = gY(s.x, s.y), r = s.r, pts = [[s.x - r, s.y + r * 0.2, 4.1], [s.x + r * 0.9, s.y - r * 0.5, 3.4], [s.x + r * 0.2, s.y + r, 4.0]];
      for (const q of pts) b.cyl(q[0], y0 + q[2] / 2, q[1], 0.08, q[2], C.steel); b.tri([pts[0][0], y0 + 4.0, pts[0][1]], [pts[1][0], y0 + 3.3, pts[1][1]], [pts[2][0], y0 + 3.9, pts[2][1]], [0.24, 0.55, 0.78]); }
    // спорт
    { const y = gY(M.yoga.x, M.yoga.y); b.cyl(M.yoga.x, y + 0.2, M.yoga.y, 6.0, 0.3, C.wood); b.cyl(M.yoga.x, y + 0.36, M.yoga.y, 0.6, 0.06, C.green); }
    { const o = M.vol, y = gY(o.x, o.y); surf(o, C.sand, 0); for (const s of [-1, 1]) { const p = loc(o, s * 4.5, 0); b.cyl(p[0], y + 1.2, p[1], 0.06, 2.4, C.steel); } const p1 = loc(o, -4.5, 0), p2 = loc(o, 4.5, 0); b.beam([p1[0], y + 2.2, p1[1]], [p2[0], y + 2.2, p2[1]], 0.02, C.white, 0.9); }
    { const o = M.work, y = gY(o.x, o.y); surf(o, C.rubberR); for (let i = -1; i <= 1; i++) { const p = loc(o, i * 4.0, 0); b.beam([p[0], y, p[1] - 1.2], [p[0], y + 2.4, p[1] - 1.2], 0.1, C.steel); b.beam([p[0], y, p[1] + 1.2], [p[0], y + 2.4, p[1] + 1.2], 0.1, C.steel); b.beam([p[0], y + 2.4, p[1] - 1.2], [p[0], y + 2.4, p[1] + 1.2], 0.08, C.steelL); } }
    // входная площадь
    { const pl = M.plaza, cy = pl.reduce((s, p) => s + gY(p[0], p[1]), 0) / pl.length; b.poly(pl, cy + 0.14, C.plaza); }
    // клумбы и дождевые сады
    for (const bd of M.beds) { const cy = bd.reduce((s, p) => s + gY(p[0], p[1]), 0) / bd.length; b.poly(bd, cy + 0.16, [0.50, 0.45, 0.36]); }
    for (const d of M.drips) { const y = gY(d.x, d.y); b.parts.push({ geo: new T.CylinderGeometry(1, 1, 1, 20), color: [0.20, 0.42, 0.34], m: b._m(d.x, y + 0.14, d.y, d.a, 0.1, d.b, 0, 0, 0) }); }
    // мебель
    for (const q of M.benches) { const x = q[0], z = q[1], yw = q[2], y = gY(x, z); const c = Math.cos(yw), s = Math.sin(yw);
      b.box(x, y + 0.45, z, 1.7, 0.07, 0.42, C.bench, -yw); b.box(x - s * 0.2, y + 0.78, z + c * 0.2, 1.7, 0.4, 0.05, C.bench, -yw);
      for (const sg of [-0.75, 0.75]) b.box(x + c * sg, y + 0.22, z + s * sg, 0.07, 0.44, 0.4, C.steel, -yw); }
    this.lampPos = [];
    for (const q of M.lights) { const y = gY(q[0], q[1]); b.cyl(q[0], y + 2.1, q[1], 0.05, 4.2, C.steel); b.box(q[0] + 0.3, y + 4.2, q[1], 0.7, 0.07, 0.24, C.steel); this.lampPos.push(q[0] + 0.3, y + 4.12, q[1]); }
    for (const q of M.bins) { const y = gY(q[0], q[1]); b.cyl(q[0], y + 0.42, q[1], 0.25, 0.85, C.bin); }
    if (this.buildNorthStructures) this.buildNorthStructures(b);
    const geo = b.build(); this.structMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, transparent: false });
    this.structures = new T.Mesh(geo, this.structMat); this.structures.castShadow = true; this.structures.receiveShadow = true; this.structures.frustumCulled = false; this.scene.add(this.structures);
    // фонари вечером
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(this.lampPos, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'); const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,190,1)'); gr.addColorStop(0.25, 'rgba(255,214,130,0.7)'); gr.addColorStop(1, 'rgba(255,190,90,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    this.lampGlow = new T.Points(lg, new T.PointsMaterial({ size: 15, sizeAttenuation: false, map: new T.CanvasTexture(cv), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); this.lampGlow.visible = false; this.lampGlow.frustumCulled = false; this.scene.add(this.lampGlow);
    // забор участка
    const fb = new Builder(); const site = M.site, pan = [0.34, 0.45, 0.55];
    for (let i = 0; i < site.length; i++) { const a = site[i], q = site[(i + 1) % site.length], L = Math.hypot(q[0] - a[0], q[1] - a[1]), n = Math.ceil(L / 6);
      for (let k = 0; k < n; k++) { const x0 = a[0] + (q[0] - a[0]) * k / n, z0 = a[1] + (q[1] - a[1]) * k / n, x1 = a[0] + (q[0] - a[0]) * (k + 1) / n, z1 = a[1] + (q[1] - a[1]) * (k + 1) / n;
        const yb = Math.min(this.gY(x0, z0), this.gY0(x0, z0)) - 0.4; fb.beam([x0, yb + 1.4, z0], [x1, yb + 1.4, z1], 0.08, pan, 2.8); } }
    this.fence = new T.Mesh(fb.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 })); this.fence.castShadow = true; this.fence.frustumCulled = false; this.scene.add(this.fence);
  }

  /* ---------------------------------------------------------- техника и временные сооружения */
  buildTemporary() {
    const M = this.M, mk = () => new Builder();
    const ex = (b, x, z, y, ry, col) => {
      const c = Math.cos(ry), s = Math.sin(ry), L = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
      for (const sx of [-1, 1]) { const p = L(sx * 1.05, 0); b.box(p[0], y + 0.45, p[1], 0.9, 0.9, 3.8, [0.15, 0.15, 0.16], -ry); }
      const p = L(0, 0); b.box(p[0], y + 1.3, p[1], 2.7, 0.9, 3.0, col, -ry); const cb = L(0.7, 0.9); b.box(cb[0], y + 2.2, cb[1], 1.2, 1.2, 1.3, [0.25, 0.3, 0.35], -ry);
      const a = L(0, -1.6), m = L(0, -5.2), k = L(0, -7.0); b.beam([a[0], y + 1.8, a[1]], [m[0], y + 4.2, m[1]], 0.35, col); b.beam([m[0], y + 4.2, m[1]], [k[0], y + 1.2, k[1]], 0.28, col); b.box(k[0], y + 0.9, k[1], 0.9, 0.8, 1.0, [0.2, 0.2, 0.2], -ry);
    };
    const truck = (b, x, z, y, ry) => { const c = Math.cos(ry), s = Math.sin(ry), L = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c]; const a = L(0, 2.2); b.box(a[0], y + 1.5, a[1], 2.5, 1.6, 2.0, [0.9, 0.55, 0.12], -ry); const d = L(0, -1.2); b.box(d[0], y + 1.6, d[1], 2.6, 1.5, 4.8, [0.55, 0.57, 0.6], -ry); for (const sx of [-1.1, 1.1]) for (const sz of [-2.4, 0.6, 2.4]) { const w = L(sx, sz); b.cyl(w[0], y + 0.5, w[1], 0.5, 0.4, [0.1, 0.1, 0.1]); } };
    const dozer = (b, x, z, y, ry) => { const c = Math.cos(ry), s = Math.sin(ry), L = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c]; for (const sx of [-1, 1]) { const p = L(sx * 1.1, 0); b.box(p[0], y + 0.5, p[1], 0.9, 1.0, 3.8, [0.15, 0.15, 0.16], -ry); } const p = L(0, 0); b.box(p[0], y + 1.4, p[1], 2.2, 1.1, 3.2, [0.9, 0.7, 0.1], -ry); const q = L(0, 0.4); b.box(q[0], y + 2.4, q[1], 1.6, 1.2, 1.5, [0.25, 0.3, 0.35], -ry); const bl = L(0, 2.6); b.box(bl[0], y + 0.9, bl[1], 3.8, 1.1, 0.3, [0.9, 0.7, 0.1], -ry); };
    const out = {};
    const p0 = M.ponds[0], p1 = M.ponds[1], cen = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    const c0 = cen(p0), c1 = cen(p1);
    const shore = (p, c, i, off) => { const q = p[i % p.length], dx = q[0] - c[0], dz = q[1] - c[1], L = Math.hypot(dx, dz); return [q[0] + dx / L * off, q[1] + dz / L * off, Math.atan2(-dx, -dz)]; };
    // стадия 1: расчистка
    { const b = mk(); const q = [[335, 282, 0.6], [345, 262, 1.2], [310, 290, 2.0]]; ex(b, q[0][0], q[0][1], this.gY0(q[0][0], q[0][1]), q[0][2], [0.9, 0.7, 0.1]); truck(b, q[1][0], q[1][1], this.gY0(q[1][0], q[1][1]), q[1][2]); truck(b, q[2][0], q[2][1], this.gY0(q[2][0], q[2][1]), q[2][2]); out[1] = b; }
    // стадия 2: выемка торфа
    { const b = mk(); for (const [p, c, idx, off] of [[p0, c0, 6, 7], [p0, c0, 18, 7], [p0, c0, 30, 7], [p1, c1, 5, 7], [p1, c1, 14, 7]]) { const s = shore(p, c, idx, off); ex(b, s[0], s[1], this.gY0(s[0], s[1]), s[2], [0.9, 0.7, 0.1]); }
      for (const [p, c, idx] of [[p0, c0, 10], [p0, c0, 24], [p1, c1, 9], [p1, c1, 20]]) { const s = shore(p, c, idx, 14); truck(b, s[0], s[1], this.gY0(s[0], s[1]), s[2] + 1.5); } out[2] = b; }
    // стадия 3: насосы и трубы
    { const b = mk(); const s = shore(p0, c0, 12, 6); ex(b, s[0], s[1], this.gY(s[0], s[1]), s[2], [0.9, 0.7, 0.1]);
      const a = M.rec.a, z = M.rec.b; const L = Math.hypot(z[0] - a[0], z[1] - a[1]); b.beam([a[0], this.gY(a[0], a[1]) + 0.5, a[1]], [z[0], this.gY(z[0], z[1]) + 0.5, z[1]], 0.5, [0.15, 0.4, 0.75], 0.5);
      b.box(a[0], this.gY(a[0], a[1]) + 1.2, a[1], 4, 2.4, 3, [0.5, 0.55, 0.6]); out[3] = b; }
    // стадия 4: бульдозеры на берме и холме
    { const b = mk(); const h = M.hill; dozer(b, h.x - 6, h.y + 4, this.gY(h.x - 6, h.y + 4), 0.8); dozer(b, h.x + 8, h.y - 3, this.gY(h.x + 8, h.y - 3), 3.6);
      const pb = M.berm[0], mx = (pb[0][0] + pb[1][0]) / 2, mz = (pb[0][1] + pb[1][1]) / 2; dozer(b, mx, mz, this.gY(mx, mz), 0.45); truck(b, mx + 12, mz - 6, this.gY(mx + 12, mz - 6), 0.45); out[4] = b; }
    this.machinery = {};
    for (const k of Object.keys(out)) { const m = new T.Mesh(out[k].build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.visible = false; this.scene.add(m); this.machinery[k] = m; }
  }

  /* ---------------------------------------------------------- точки интереса */
  buildPOIs() {
    const M = this.M, S = M.stats, fmt = (n, d) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d || 0 }), gY = (x, z) => this.gY(x, z);
    const P = [];
    const add = (id, title, x, z, from, text, dy, kind) => P.push({ id, title, x, z, y: gY(x, z) + (dy || 6), from, text, kind: kind || 'poi' });
    const find = (k) => M.buildings.find(b => b.kind === k);
    const gate = find('gate'), tower = find('tower'), pav = find('pavilion');
    add('gate', 'Главный вход', gate.x, gate.y, 5, 'Входной павильон-навес с кассой и информацией, 120 м². Входная площадь из гранитной плитки 710 м² и радиальная аллея к воде.', 7);
    add('kids', 'Детская зона', M.pg[0].x, M.pg[0].y, 5, 'Игровой комплекс «Башни–мост», канатный городок, качели-гнёзда, песочный двор и сплэш-пад. Резиновое покрытие EPDM 384 м², всё из лиственницы.', 7);
    add('tower', 'Смотровая башня', tower.x, tower.y, 5, 'Башня высотой 18 м на искусственном холме 7 м (объём холма ' + fmt(S.V_hill) + ' м³ из торфогрунта). Две площадки, обзор на оба пруда.', 28);
    add('pav', 'Павильон у воды', pav.x, pav.y, 5, 'Восьмигранный павильон 64 м² на берегу первого пруда. Тихая точка для чтения и летних лекций.', 8);
    const ch = M.channel; add('cascade', 'Каскад из 3 ступеней', (ch.a[0] + ch.b[0]) / 2, (ch.a[1] + ch.b[1]) / 2, 3, 'Перепад 0,9 м между прудами: ЖБ-ступени с облицовкой из природного камня. Рециркуляция 30 л/с питает каскад и держит воду живой.', 8);
    const cen = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    const c0 = cen(M.ponds[0]), c1 = cen(M.ponds[1]);
    add('pond1', 'Пруд 1', c0[0], c0[1], 3, 'Водоём делается из существующего болота: торф выбираем до проектных глубин. Всего воды ' + fmt(S.V_water) + ' м³ на ' + fmt(S.water_area / 10000, 2) + ' га, средняя глубина ' + fmt(S.mean_depth, 2) + ' м; шельф 0,45 м и откосы 1:4.', 5);
    add('pond2', 'Пруд 2', c1[0], c1[1], 3, 'Второй водоём ниже каскада. Мелководье с литоралью (около 15 тыс. растений) очищает воду и кормит птиц.', 5);
    const bm = M.berm[0]; add('berm', 'Берма вдоль проспекта', (bm[0][0] + bm[1][0]) / 2, (bm[0][1] + bm[1][1]) / 2, 4, 'Земляной вал 2 м высотой и 10 м шириной, около 376 м: защита от шума и пыли. Насыпана из торфа, вынутого из пруда, и засажена хвойными.', 9);
    add('fit', 'Спорт и воркаут', M.work.x, M.work.y, 5, 'Воркаут-площадка, йога-настил 12×12 и волейбольная площадка. Покрытия EPDM и песок.', 7);
    const dz = M.zones.dog; const dc = cen(dz); add('dog', 'Площадка для собак', dc[0], dc[1], 5, 'Ограждение 2 м (242 м), поилки и оборудование. Отдельный вход, чтобы не пересекаться с детской зоной.', 6);
    const sv = M.buildings.find(b => b.kind === 'service'); add('svc', 'Служебная зона', sv.x, sv.y, 5, 'Хоз. блок и склад 84 м², щебёночный двор. Отделена зелёным буфером от основной территории.', 7);
    const tr = M.paths.find(p => p.kind === 'track'); add('track', 'Беговая дорожка', tr.pts[20][0], tr.pts[20][1], 5, 'Кольцо 3 м с EPDM-покрытием по асфальту, около ' + fmt(S.len_track) + ' м по периметру восточной части.', 6);
    for (const v of M.views) { const e = this.gY(v.x, v.y) + 7; P.push({ id: 'view' + v.n, view: v.n, title: v.n + '. ' + v.name, x: v.x, z: v.y, y: e, from: 0, text: 'Точка съёмки панорамы 360°. Нажмите, чтобы открыть вид.', kind: 'view' }); }
    if (this.northPOIs) this.northPOIs(P);
    this.pois = P; const pr = { gate: 0, tower: 1, pond1: 2, pond2: 3, kids: 4, cascade: 5, berm: 6 }; P.forEach(q => { q.pr = pr[q.id] != null ? pr[q.id] : 9; });
    const host = document.createElement('div'); host.className = 'p3-labels'; this.el.appendChild(host); this.labelHost = host;
    for (const p of P) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'p3-pin ' + (p.kind === 'view' ? 'view' : ''); b.innerHTML = p.kind === 'view' ? '<i>' + p.view + '</i>' : '<i></i><span>' + p.title + '</span>'; b.title = p.title;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.pickPOI(p); }); host.appendChild(b); p.el = b; p.v = new T.Vector3(p.x, p.y, p.z);
    }
    this.zoneHost = document.createElement('div'); this.zoneHost.className = 'p3-zonelabels'; this.zoneHost.style.display = 'none'; this.el.appendChild(this.zoneHost); this.zoneEls = [];
    for (const k of Object.keys(M.zones)) { const zi = { kids: 6, culture: 2, mass: 3, dog: 5, fit: 4, service: 7, peninsula: 9, plaza: 10 }[k]; if (!zi) continue; const c = cen(M.zones[k]); const e = document.createElement('div'); e.className = 'p3-zl'; e.textContent = ZONE_NAMES[zi]; e.style.color = '#' + ZONE_COL[zi].map(v => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join(''); this.zoneHost.appendChild(e); this.zoneEls.push({ e, v: new T.Vector3(c[0], this.gY(c[0], c[1]) + 3, c[1]) }); }
    { const e = document.createElement('div'); e.className = 'p3-zl'; e.textContent = ZONE_NAMES[1]; e.style.color = '#' + ZONE_COL[1].map(v => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join(''); this.zoneHost.appendChild(e); this.zoneEls.push({ e, v: new T.Vector3(200, 8, 240) }); }
  }
  pickPOI(p) { if (this.opts.onPOI) this.opts.onPOI(p); }

  /* ---------------------------------------------------------- состояние по стадии */
  derived(sv) {
    const d = {};
    d.w0 = sv <= 1 ? 1 : sv < 2 ? 2 - sv : 0; d.w2 = sv <= 1 ? 0 : sv < 2 ? sv - 1 : sv <= 3 ? 1 : sv < 4 ? 4 - sv : 0; d.w4 = sv <= 3 ? 0 : sv < 4 ? sv - 3 : 1;
    d.level = sv <= 1.2 ? -0.02 : sv < 2 ? lerp(-0.02, -2.0, (sv - 1.2) / 0.8) : sv <= 2.3 ? -2.0 : sv < 3 ? lerp(-2.0, 0, (sv - 2.3) / 0.7) : 0;
    d.murk = sv <= 2.3 ? 1 : sv < 3 ? lerp(1, 0.55, (sv - 2.3) / 0.7) : sv < 4 ? lerp(0.55, 0.12, sv - 3) : 0.1;
    d.waterVis = !(sv > 1.95 && sv < 2.35);
    d.exist = 1 - smooth(0.55, 1.0, sv);
    d.reed0 = d.exist;
    d.lit = smooth(2.8, 3.2, sv) * (sv < 6 ? (0.35 + 0.15 * clamp(sv - 3, 0, 3)) : lerp(0.65, 1.0, clamp(sv - 6, 0, 1)));
    d.tree = sv < 5.75 ? 0 : sv < 6 ? smooth(5.75, 6, sv) : 1; d.grow = clamp(sv - 6, 0, 1);
    d.struct = smooth(4.55, 4.95, sv);
    d.fence = (sv >= 0.8 && sv <= 5.9) ? smooth(0.8, 1.1, sv) * (1 - smooth(5.5, 5.8, sv)) : 0;
    d.green = smooth(5.0, 6.2, sv) * 0.9 + smooth(6, 7, sv) * 0.1;
    d.flowers = smooth(6, 6.4, sv) * (0.6 + 0.4 * clamp(sv - 6, 0, 1));
    return d;
  }
  applyState(force) {
    const sv = this.sv, d = this.derived(sv), prev = this._d || {}; this._d = d;
    const tchg = force || prev.w0 !== d.w0 || prev.w2 !== d.w2 || prev.w4 !== d.w4;
    if (tchg) { this.terrain.setWeights(d.w0, d.w2, d.w4); this.paintTerrain(); this.updatePlates(); this.shadowDirty = true; }
    else if (force || Math.abs((prev.green || 0) - d.green) > 1e-3 || prev._pal !== this.palKey()) { this.paintTerrain(); }
    d._pal = this.palKey();
    if (tchg || force || prev.level !== d.level || prev.murk !== d.murk) this.water.update(d.level, d.murk, this.show.water && d.waterVis);
    this.water.mesh.visible = this.show.water && d.waterVis;
    // структуры
    const sv5 = d.struct > 0.01 && this.show.paths;
    this.structures.visible = d.struct > 0.5; this.structMat.transparent = d.struct < 0.999; this.structMat.opacity = d.struct;
    for (const pm of this.pathMeshes) for (const m of pm.meshes) { m.visible = sv5 && this.show.paths; if (m.material && m.material.transparent !== undefined) { } }
    for (const m of Object.values(this.pathMats)) { m.transparent = d.struct < 0.999; m.opacity = d.struct; }
    this.plates.visible = sv >= 1.2 && sv <= 4.75; this.fence.visible = d.fence > 0.5;
    for (const k of Object.keys(this.machinery)) { const kk = +k; this.machinery[k].visible = sv > kk - 0.45 && sv < kk + 0.55; }
    this.updateInstances(d, tchg || force);
    this.lampGlow.visible = this.env.tod === 1 && d.struct > 0.5;
    this.shadowDirty = true; this.dirty = true;
  }
  palKey() { return this.env.season * 10 + (this.show.zones ? 1 : 0); }
  updateInstances(d, terrainChanged) {
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v3 = new T.Vector3(), s3 = new T.Vector3(), tmpC = new T.Color();
    const showTrees = this.show.trees;
    // посаженные деревья
    for (const ts of this.treeSets) {
      const sp = ts.sp, h = lerp(sp.h0, sp.h10, d.grow) * d.tree + 0.001;
      const winterDecid = this.env.season === 2 && sp.kind !== 'spruce' && sp.kind !== 'pine';
      ts.crown.visible = ts.trunk.visible = showTrees && d.tree > 0.01;
      ts.crown.visible = ts.crown.visible && !winterDecid;
      if (ts._h === h && !terrainChanged && ts._built) { continue; }
      ts._h = h; ts._built = true;
      for (let i = 0; i < ts.list.length; i++) { const t = ts.list[i], vv = ts.v[i], sc = h * vv.s; e.set(0, vv.r, 0); q.setFromEuler(e); v3.set(t[0], this.gY(t[0], t[1]) - 0.05, t[1]); s3.set(sc, sc, sc); m4.compose(v3, q, s3); ts.crown.setMatrixAt(i, m4); ts.trunk.setMatrixAt(i, m4); }
      ts.crown.instanceMatrix.needsUpdate = true; ts.trunk.instanceMatrix.needsUpdate = true;
    }
    this.paintTreeColors();
    // существующие
    const exm = (mesh, list, scaleFn) => { for (let i = 0; i < list.length; i++) { const t = list[i]; e.set(0, i * 1.7, 0); q.setFromEuler(e); const sc = scaleFn(t) * d.exist + 0.0001; v3.set(t[0], this.gY0(t[0], t[1]) - 0.05, t[1]); s3.set(sc, sc, sc); m4.compose(v3, q, s3); mesh.setMatrixAt(i, m4); } mesh.instanceMatrix.needsUpdate = true; };
    if (terrainChanged || this._exd !== d.exist) {
      this._exd = d.exist;
      const eb = this.exTrees.filter(t => t[2] === 0), ew = this.exTrees.filter(t => t[2] === 1), es = this.exTrees.filter(t => t[2] === 2);
      exm(this.exB.crown, eb, t => t[3] * 0.9); exm(this.exB.trunk, eb, t => t[3] * 0.9); exm(this.exW.crown, ew, t => t[3] * 0.85); exm(this.exW.trunk, ew, t => t[3] * 0.85);
      for (let i = 0; i < es.length; i++) { const t = es[i]; e.set(0, i * 1.3, 0); q.setFromEuler(e); const sc = t[3] * 0.7 * d.exist + 0.0001; v3.set(t[0], this.gY0(t[0], t[1]), t[1]); s3.set(sc * 0.5, sc, sc * 0.5); m4.compose(v3, q, s3); this.exS.setMatrixAt(i, m4); } this.exS.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < this.M.debris.length; i++) { const t = this.M.debris[i]; e.set(0.1 * t[3], t[2], 0.08); q.setFromEuler(e); const k = d.exist; v3.set(t[0], this.gY0(t[0], t[1]) + 0.1, t[1]); s3.set((t[3] === 2 ? 0.8 : 2.4) * k + 0.001, 0.25 * k + 0.001, (t[3] === 2 ? 0.8 : 1.2) * k + 0.001); m4.compose(v3, q, s3); this.debris.setMatrixAt(i, m4); } this.debris.instanceMatrix.needsUpdate = true;
      const rs = this.M.reeds0; for (let i = 0; i < rs.length; i++) { const t = rs[i], vv = this.reed0v[i]; e.set(0, vv.r, 0); q.setFromEuler(e); const sc = vv.s * d.reed0 + 0.0001; v3.set(t[0], this.terrain.hNow(t[0], t[1]) * VE, t[1]); s3.set(sc, sc, sc); m4.compose(v3, q, s3); this.reed0.setMatrixAt(i, m4); this.reed0.setColorAt(i, tmpC.setRGB(0.55 + 0.2 * vv.c, 0.48 + 0.15 * vv.c, 0.22)); } this.reed0.instanceMatrix.needsUpdate = true; if (this.reed0.instanceColor) this.reed0.instanceColor.needsUpdate = true;
    }
    this.reed0.visible = d.exist > 0.01 && showTrees; this.exB.crown.visible = this.exB.trunk.visible = this.exW.crown.visible = this.exW.trunk.visible = this.exS.visible = this.debris.visible = d.exist > 0.01 && showTrees;
    // камыш литорали
    if (this._lit !== d.lit || terrainChanged) { this._lit = d.lit; const ls = this.M.lit; for (let i = 0; i < ls.length; i++) { const t = ls[i], vv = this.reedLv[i]; e.set(0, vv.r, 0); q.setFromEuler(e); const sc = vv.s * d.lit * (this.env.season === 2 ? 0.7 : 1) + 0.0001; v3.set(t[0], this.gY(t[0], t[1]), t[1]); s3.set(sc, sc, sc); m4.compose(v3, q, s3); this.reedL.setMatrixAt(i, m4); } this.reedL.instanceMatrix.needsUpdate = true; this.paintReedL(); }
    this.reedL.visible = d.lit > 0.01 && showTrees;
    // кусты
    if (this._sh !== d.tree * (0.45 + 0.55 * d.grow) || terrainChanged) { const k = d.tree * (0.45 + 0.55 * d.grow); this._sh = k; let n = 0; for (let g = 0; g < this.M.shrubs.length; g++) for (let j = 0; j < 3; j++) { const s = this.M.shrubs[g], vv = this.shrubV[n]; e.set(0, g + j, 0); q.setFromEuler(e); const sc = vv.s * k + 0.0001; v3.set(s[0] + vv.dx, this.gY(s[0], s[1]) + 0.5 * sc, s[1] + vv.dz); s3.set(sc, sc * 0.75, sc); m4.compose(v3, q, s3); this.shrubs.setMatrixAt(n, m4); n++; } this.shrubs.instanceMatrix.needsUpdate = true; this.paintShrubs(); }
    this.shrubs.visible = d.tree > 0.01 && showTrees;
    this.flowers.visible = d.flowers > 0.05 && this.env.season !== 2 && showTrees; this.flowers.material.size = (0.5 + 0.5 * d.flowers) * (this.flowerScale || 1);
    if (this.updateNorthVeg) this.updateNorthVeg(d, terrainChanged);
  }
  paintTreeColors() {
    const c = new T.Color(), season = this.env.season;
    for (const ts of this.treeSets) {
      const sp = ts.sp; for (let i = 0; i < ts.list.length; i++) { const vv = ts.v[i]; let col = sp.col, k = 0.82 + 0.36 * vv.c;
        if (season === 1) { col = sp.aut; k = 0.8 + 0.4 * vv.c; if (sp.kind === 'broad' || sp.kind === 'willow') { if (vv.c2 < 0.25) col = [0.82, 0.30, 0.12]; } }
        if (season === 2) { col = (sp.kind === 'spruce' || sp.kind === 'pine') ? [0.78, 0.86, 0.84] : sp.col; k = 1.0; }
        ts.crown.setColorAt(i, c.setRGB(col[0] * k, col[1] * k, col[2] * k)); }
      ts.crown.instanceColor.needsUpdate = true;
      for (let i = 0; i < ts.list.length; i++) { const f2 = season === 2 ? 0.55 : 1; ts.trunk.setColorAt(i, c.setRGB(f2, f2, f2)); } ts.trunk.instanceColor && (ts.trunk.instanceColor.needsUpdate = true);
    }
    const season1 = this.env.season, cc = new T.Color();
    for (const [mesh, base] of [[this.exB.crown, [0.45, 0.55, 0.2]], [this.exW.crown, [0.5, 0.58, 0.28]]]) { for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, cc.setRGB(base[0] * (0.7 + 0.4 * ((i * 37) % 10) / 10), base[1] * (0.7 + 0.4 * ((i * 53) % 10) / 10), base[2])); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    for (const mesh of [this.exB.trunk, this.exW.trunk]) { for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, cc.setRGB(1, 1, 1)); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }
  paintReedL() { const c = new T.Color(), win = this.env.season === 2, aut = this.env.season === 1; for (let i = 0; i < this.reedLv.length; i++) { const vv = this.reedLv[i]; const col = win ? [0.62, 0.56, 0.4] : aut ? [0.66, 0.55, 0.28] : [0.30 + 0.12 * vv.c, 0.50 + 0.1 * vv.c, 0.18]; this.reedL.setColorAt(i, c.setRGB(col[0], col[1], col[2])); } if (this.reedL.instanceColor) this.reedL.instanceColor.needsUpdate = true; }
  paintShrubs() { const c = new T.Color(), win = this.env.season === 2, aut = this.env.season === 1; for (let i = 0; i < this.shrubN; i++) { const vv = this.shrubV[i]; const col = win ? [0.7, 0.74, 0.72] : aut ? [0.55, 0.42, 0.16] : [0.18 + 0.1 * vv.c, 0.36 + 0.1 * vv.c, 0.15]; this.shrubs.setColorAt(i, c.setRGB(col[0], col[1], col[2])); } if (this.shrubs.instanceColor) this.shrubs.instanceColor.needsUpdate = true; }

  updatePlates() { if (!this.plates) return; const a = this.plates.geometry.attributes.position; for (let i = 0; i < a.count; i++) a.setY(i, this.terrain.hNow(a.getX(i), a.getZ(i)) * VE + 0.22); a.needsUpdate = true; }
  paintTerrain() {
    const t = this.terrain, n = t.nx * t.ny, G = t.G, nx = t.nx, sv = this.sv, season = this.env.season, zmix = this.show.zones ? 0.55 : 0;
    const col = t.col, h = t.h, cls = t.cls, lab = t.lab;
    const mix3 = (a, b, k, out) => { out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k; };
    const c1 = [0, 0, 0], c2 = [0, 0, 0], c3 = [0, 0, 0];
    const greenOf = (c, nz, nz2) => { switch (c) {
      case 15: return [0.28 + 0.05 * nz, 0.46 + 0.05 * nz, 0.15];
      case 16: return [0.42 + 0.12 * nz2, 0.50 + 0.05 * nz, 0.20];
      case 17: return [0.26, 0.42 + 0.06 * nz, 0.18];
      case 13: return [0.27 + 0.04 * nz, 0.43 + 0.05 * nz, 0.17];
      case 14: return [0.34 + 0.08 * nz2, 0.48, 0.20];
      case 12: return [0.22, 0.38, 0.17]; case 11: return [0.20, 0.38, 0.22]; case 10: return [0.46, 0.5, 0.26];
      case 4: return [0.60, 0.58, 0.54]; case 8: return [0.56, 0.55, 0.5]; case 9: return [0.62, 0.34, 0.26]; case 18: return [0.82, 0.74, 0.5];
      case 5: case 6: case 7: case 3: return [0.46, 0.46, 0.42]; case 2: return [0.5, 0.5, 0.48]; case 1: return [0.2, 0.2, 0.14];
      default: return [0.30, 0.46, 0.16]; } };
    const snow = [0.80, 0.84, 0.89], autC = [0.52, 0.46, 0.2];
    for (let k = 0; k < n; k++) {
      const nz = this.nz[k], nz2 = this.nz2[k], hh = h[k], c = cls[k], wet = c === 1;
      // фазы цвета
      let a;
      const straw = smooth(0.42, 0.64, nz), bog = wet ? [0.10 + 0.06 * nz2, 0.12 + 0.07 * nz2, 0.06] : [0.20 + 0.28 * straw * (0.7 + 0.5 * nz2), 0.27 + 0.17 * straw, 0.11 + 0.05 * straw];
      const clear = wet ? [0.13, 0.12, 0.08] : [0.34 + 0.06 * nz, 0.28 + 0.05 * nz, 0.17];
      const soil = wet ? [0.13, 0.11, 0.08] : [0.24 + 0.05 * nz, 0.18 + 0.04 * nz, 0.12];
      const soil2 = wet ? [0.15, 0.13, 0.09] : [0.27 + 0.04 * nz, 0.20 + 0.04 * nz, 0.13];
      const gr = greenOf(c, nz, nz2);
      const bed = [0.22, 0.19, 0.13];
      if (sv <= 1) mix3(bog, clear, sv, c1);
      else if (sv <= 2) mix3(clear, soil, sv - 1, c1);
      else if (sv <= 4) mix3(soil, soil2, (sv - 2) / 2, c1);
      else if (sv <= 5) mix3(soil2, soil2, 0, c1);
      else if (sv <= 6) { mix3(soil2, [gr[0] * 1.1 + 0.05, gr[1] * 1.05 + 0.05, gr[2] * 1.1], smooth(0.05, 0.95, sv - 5) , c1); }
      else mix3([gr[0] * 1.1 + 0.05, gr[1] * 1.05 + 0.05, gr[2] * 1.1], gr, sv - 6, c1);
      if (c === 4 || c === 8 || c === 9 || c === 18 || c === 5 || c === 6 || c === 7) { if (sv >= 4.6) mix3(c1, gr, smooth(4.6, 5, sv), c1); }
      if (hh < -0.1 && sv >= 2) { mix3(c1, bed, 0.6, c1); }
      if (season === 1 && sv >= 5.5 && !wet) mix3(c1, autC, 0.55, c1);
      if (season === 2 && hh > 0.0) mix3(c1, snow, 0.92, c1);
      if (zmix && lab[k] && ZONE_COL[lab[k]] && lab[k] !== 11) mix3(c1, ZONE_COL[lab[k]], zmix, c1);
      col[k * 3] = c1[0] * 0.86; col[k * 3 + 1] = c1[1] * 0.86; col[k * 3 + 2] = c1[2] * 0.86;
    }
    t.geo.attributes.color.needsUpdate = true;
  }

  /* ---------------------------------------------------------- среда: сезон / время суток */
  applyEnv() {
    const e = this.env, evening = e.tod === 1, winter = e.season === 2, autumn = e.season === 1;
    const sunEl = evening ? 8 : 40, sunAz = evening ? 250 : 215, el = sunEl * Math.PI / 180, az = sunAz * Math.PI / 180;
    const dir = new T.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const ctr = new T.Vector3(this.M.W / 2, 0, this.M.H / 2); this.sun.position.copy(ctr).addScaledVector(dir, 900); this.sun.target.position.copy(ctr);
    this.sun.color.set(evening ? 0xffa766 : winter ? 0xe8f0ff : 0xfff0d8); this.sun.intensity = evening ? 2.6 : winter ? 2.3 : 3.0;
    this.hemi.color.set(evening ? 0x8a8fc4 : 0xbcd6ff); this.hemi.groundColor.set(evening ? 0x4a3d3a : winter ? 0xb4bcc4 : 0x6b7a55); this.hemi.intensity = evening ? 1.0 : winter ? 1.0 : 1.05;
    const U = this.sky.uniforms;
    U.uTop.value.set(evening ? 0x263a6e : winter ? 0x7d95b8 : 0x2f6fd0); U.uMid.value.set(evening ? 0x9b6f9a : winter ? 0xb7c6d8 : 0x7eb2ee); U.uHor.value.set(evening ? 0xf2a870 : winter ? 0xdfe6ee : 0xcfe3f4);
    U.uSun.value.copy(dir); U.uSunCol.value.set(evening ? 0xff9a50 : 0xffe6b3); U.uCloud.value = winter ? 1.2 : 1;
    this.scene.fog.color.set(evening ? 0xd6a58a : winter ? 0xdfe6ee : 0xcfe0f0); this.scene.fog.density = evening ? 0.0010 : winter ? 0.0009 : 0.0009;
    this.renderer.toneMappingExposure = evening ? 1.05 : winter ? 0.9 : 0.95;
    this.ctx.material.color.set(winter ? 0xb9c4cf : autumn ? 0x6e6a40 : 0x6b7a58);
    const W = this.water.uniforms; W.uSun.value.copy(dir); W.uFog.value.copy(this.scene.fog.color); W.uFogD.value = this.scene.fog.density; W.uSky.value.set(evening ? 0xd9a07a : winter ? 0xc7d3e2 : 0x8fb6e8); W.uSkyHi.value.set(evening ? 0x4a5a98 : winter ? 0x8aa0c0 : 0x3f7fd0); W.uSunCol.value.set(evening ? 0xff9448 : 0xfff2d8); W.uIce.value = winter ? 0.88 : 0;
    this.lampGlow && (this.lampGlow.visible = evening && this._d && this._d.struct > 0.5);
    this.shadowDirty = true; this.dirty = true; if (this.ctxTrees) this.paintContext();
    if (this._d) { this.paintTerrain(); this.updateInstances(this._d, true); }
  }
  setEnv(o) { Object.assign(this.env, o); this.applyEnv(); }
  setShow(o) { Object.assign(this.show, o); this.applyState(true); this.labelHost.style.display = this.show.labels ? '' : 'none'; this.zoneHost.style.display = this.show.zones ? '' : 'none'; }

  /* ---------------------------------------------------------- стадии и анимация */
  setStage(s, animate) {
    s = clamp(s, 0, STAGES.length - 1); this.target = s;
    if (!animate) { this.sv = s; this.tw = null; this.applyState(true); if (this.opts.onStage) this.opts.onStage(s, this.sv); return; }
    this.tw = { from: this.sv, to: s, t0: performance.now(), dur: Math.min(2400, 700 + Math.abs(s - this.sv) * 450) };
    if (this.opts.onStage) this.opts.onStage(s, this.sv);
  }
  setStageFloat(v) { this.sv = clamp(v, 0, STAGES.length - 1); this.tw = null; this.applyState(false); }

  /* ---------------------------------------------------------- камера */
  flyTo(pos, tgt, ms) {
    const c = this.camera, ctl = this.controls; this.fly = { p0: c.position.clone(), t0: ctl.target.clone(), p1: new T.Vector3(...pos), t1: new T.Vector3(...tgt), s: performance.now(), d: ms == null ? 1200 : ms };
    if (!this.fly.d) { c.position.copy(this.fly.p1); ctl.target.copy(this.fly.t1); ctl.update(); this.fly = null; this.dirty = true; }
  }
  setCameraPreset(name, animate) {
    const M = this.M, cx = M.W * 0.5, cz = M.H * 0.5; this.eyeMode = false; this.camera.fov = 38; this.camera.updateProjectionMatrix(); this.controls.minDistance = 3; this.controls.maxPolarAngle = 1.52;
    if (name === 'iso') this.flyTo([cx + 30, 280, cz + 372], [cx, 0, cz - 4], animate === false ? 0 : 1400);
    else if (name === 'plan') { this.controls.maxPolarAngle = 1.52; this.flyTo([cx, 880, cz + 0.5], [cx, 0, cz], animate === false ? 0 : 1400); }
    else if (name === 'low') this.flyTo([cx + 120, 38, cz + 215], [cx - 40, 4, cz - 40], animate === false ? 0 : 1400);
  }
  viewFromPoint(n) {
    const v = this.M.views.find(q => q.n === n); if (!v) return; const gy = this.gY(v.x, v.y), dir = [Math.cos(v.az), 0, Math.sin(v.az)];
    this.eyeMode = true; this.camera.fov = 58; this.camera.updateProjectionMatrix(); this.controls.minDistance = 0.5; this.controls.maxPolarAngle = 1.75;
    this.flyTo([v.x, gy + 1.8, v.y], [v.x + dir[0] * 4, gy + 1.8, v.y + dir[2] * 4], 1500);
  }
  viewFromTower() { const t = this.M.buildings.find(b => b.kind === 'tower'), gy = this.gY(t.x, t.y); this.eyeMode = true; this.camera.fov = 58; this.camera.updateProjectionMatrix(); this.controls.minDistance = 0.5; this.controls.maxPolarAngle = 1.75; this.flyTo([t.x + 0.1, gy + 20.6, t.y], [t.x - 35, gy + 15.5, t.y + 110], 1800); }
  focusPOI(p) { const y = p.y - 5; this.eyeMode = false; this.camera.fov = 38; this.camera.updateProjectionMatrix(); this.controls.minDistance = 3; this.flyTo([p.x + 70, y + 60, p.z + 90], [p.x, y - 4, p.z], 1300); }

  renderNow() { if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; } this.sky.mesh.position.copy(this.camera.position); this.controls.update(); this.renderer.render(this.scene, this.camera); this.updateLabels(); this.dirty = false; if (this.opts.onFrame) this.opts.onFrame(this.camera, this.controls); }
  resize() { const W = this.el.clientWidth, H = this.el.clientHeight; if (!W || !H) return; this.renderer.setSize(W, H, false); this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); this.dirty = true; }
  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.paused) return;
    const tNow = performance.now();
    if (this.tw) { const k = clamp((tNow - this.tw.t0) / this.tw.dur, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; this.sv = lerp(this.tw.from, this.tw.to, e); this.applyState(false); if (k >= 1) { this.sv = this.tw.to; this.tw = null; this.applyState(false); if (this.opts.onStageEnd) this.opts.onStageEnd(this.sv); } }
    if (this.fly) { const k = clamp((tNow - this.fly.s) / this.fly.d, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; this.camera.position.lerpVectors(this.fly.p0, this.fly.p1, e); this.controls.target.lerpVectors(this.fly.t0, this.fly.t1, e); this.controls.update(); this.dirty = true; if (k >= 1) this.fly = null; }
    const upd = this.controls.update(); if (upd) this.dirty = true;
    this.water.uniforms.uTime.value = tNow * 0.001; this.sky.uniforms.uTime.value = tNow * 0.001; if (!this.opts.still && this.show.water && this._d && this._d.waterVis) this.dirty = true;
    if (this.dirty) {
      if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
      this.sky.mesh.position.copy(this.camera.position);
      this.renderer.render(this.scene, this.camera); this.dirty = false; this.updateLabels(); if (this.opts.onFrame) this.opts.onFrame(this.camera, this.controls);
    }
  }
  updateLabels() {
    const w = this.el.clientWidth, h = this.el.clientHeight, v = new T.Vector3(), sv = this.sv, placed = [];
    const hit = (r) => { for (const q of placed) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true; return false; };
    const order = this._order || (this._order = this.pois.slice().sort((a, b) => (a.kind === 'view' ? 0 : 1) - (b.kind === 'view' ? 0 : 1) || a.pr - b.pr));
    for (const p of order) {
      const vis = this.show.labels && sv >= p.from - 0.05; if (!vis) { p.el.style.display = 'none'; continue; }
      v.copy(p.v).project(this.camera); const behind = v.z > 1 || v.z < -1;
      const dist = this.camera.position.distanceTo(p.v); if (behind || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 || (p.kind === 'poi' && dist < 18)) { p.el.style.display = 'none'; continue; }
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h; let mini = false;
      if (p.kind === 'view') placed.push([sx - 12, sy - 26, sx + 12, sy]);
      else { const lw = p.title.length * 6.3 + 28, r = [sx - lw / 2, sy - 24, sx + lw / 2, sy];
        if (!hit(r)) placed.push(r); else { const r2 = [sx - 8, sy - 16, sx + 8, sy]; if (hit(r2)) { p.el.style.display = 'none'; continue; } placed.push(r2); mini = true; } }
      p.el.style.display = ''; p.el.classList.toggle('mini', mini); p.el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-100%)';
    }
    if (this.show.zones) for (const z of this.zoneEls) { v.copy(z.v).project(this.camera); if (v.z > 1) { z.e.style.display = 'none'; continue; } z.e.style.display = ''; z.e.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px) translate(-50%,-50%)'; }
  }
  dispose() { this.resizeObs && this.resizeObs.disconnect(); this.renderer.dispose(); }
}
global.Park3D = Park3D; global.P3.ZONE_NAMES = ZONE_NAMES;
})(window);
/* Часть 4: Архангельск. Окружение по карте, северная архитектура (ладья, галереи, фигуры, станция),
   берёза карликовая и стланиковые берёзы. */
(function (global) {
'use strict';
const P3 = global.P3, T = P3.T, VE = P3.VE, Builder = P3.Builder, rng32 = P3.rng32, clamp = P3.clamp;
const Park3D = global.Park3D;
const GOLD = [0.78, 0.63, 0.34], CONIFER = [0.13, 0.24, 0.18], WOOD = [0.58, 0.40, 0.23], WOODD = [0.40, 0.27, 0.16], WOODL = [0.74, 0.56, 0.34];
const TEAL = [0.12, 0.30, 0.30], RED = [0.62, 0.18, 0.12], BARK = [0.90, 0.89, 0.84];

function upRibbon(pts, w, y, closed) {
  const g = P3.ribbon(pts, w, () => y, closed), P = g.attributes.position, I = g.index.array;
  const ax = P.getX(I[1]) - P.getX(I[0]), az = P.getZ(I[1]) - P.getZ(I[0]), bx = P.getX(I[2]) - P.getX(I[0]), bz = P.getZ(I[2]) - P.getZ(I[0]);
  if (az * bx - ax * bz < 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } g.index.needsUpdate = true; }
  return g;
}
/* ---------------------------------------------------------- окружение по карте */
Park3D.prototype.buildContext = function () {
  const M = this.M, C = M.ctx; if (!C) return;
  const mk = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; this.scene.add(m); return m; };
  // дороги, разметка, тротуары
  const asph = new T.MeshStandardMaterial({ color: 0x6d7073, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const walk = new T.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.95, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const line = new T.MeshBasicMaterial({ color: 0xe8e6dc, side: T.DoubleSide });
  for (const r of C.roads) {
    const a = r.a, b = r.b, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
    const m = new T.Mesh(upRibbon([a, b], r.w, 0.40, false), asph); m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m);
    if (r.kind !== 'drive') for (const s of [-1, 1]) { const o = s * (r.w / 2 + 2.2); const g = upRibbon([[a[0] + nx * o, a[1] + nz * o], [b[0] + nx * o, b[1] + nz * o]], 2.6, 0.42, false); const w = new T.Mesh(g, walk); w.frustumCulled = false; this.scene.add(w); }
    const lanes = r.kind === 'prospect' ? [0, -r.w / 4, r.w / 4] : r.kind === 'street' ? [0] : [];
    for (const o of lanes) { const g = upRibbon([[a[0] + nx * o, a[1] + nz * o], [b[0] + nx * o, b[1] + nz * o]], o === 0 && r.kind === 'prospect' ? 0.5 : 0.18, 0.44, false); const lm = new T.Mesh(g, line); lm.frustumCulled = false; this.scene.add(lm); }
  }
  // железная дорога: балласт и рельсы
  const ball = new T.MeshStandardMaterial({ color: 0x8a8078, roughness: 1, side: T.DoubleSide }), railm = new T.MeshStandardMaterial({ color: 0x4a4a4c, roughness: 0.5, metalness: 0.6 });
  for (const r of C.rail) {
    const g = upRibbon([r.a, r.b], 4.2, 0.55, false); const m = new T.Mesh(g, ball); m.frustumCulled = false; this.scene.add(m);
    const b = new Builder(); for (const o of [-0.76, 0.76]) { const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L; b.beam([r.a[0] + nx * o, 0.75, r.a[1] + nz * o], [r.b[0] + nx * o, 0.75, r.b[1] + nz * o], 0.12, [0.3, 0.3, 0.32], 0.16); }
    const rm = new T.Mesh(b.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })); rm.frustumCulled = false; this.scene.add(rm);
  }
  // ручей
  if (C.stream) { const g = upRibbon(P3.resample(C.stream, 4, false), 3.2, 0.43, false); const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x45708a, roughness: 0.3, metalness: 0.1, side: T.DoubleSide })); m.frustumCulled = false; this.scene.add(m); }
  // здания
  const b = new Builder(), rg = rng32(77);
  for (const o of C.buildings) {
    const tone = o.kind === 'res' ? 0.82 + rg() * 0.1 : o.kind === 'school' ? 0.86 : o.kind === 'house' ? 0.80 : 0.74 + rg() * 0.08;
    const col = o.kind === 'school' ? [0.84, 0.80, 0.86] : o.kind === 'house' ? [0.86, 0.76, 0.62] : o.kind === 'ind' ? [tone, tone, tone * 0.98] : [tone, tone * 0.95, tone * 0.88];
    b.box(o.x, 0.3 + o.h / 2, o.y, o.w, o.h, o.d, col, -o.rot);
    if (o.kind === 'house') { const c = Math.cos(o.rot), s = Math.sin(o.rot); b.parts.push({ geo: new T.CylinderGeometry(0.01, 1, 1, 4, 1), color: [0.42, 0.30, 0.24], m: b._m(o.x, 0.3 + o.h + 1.4, o.y, o.w * 0.72, 2.8, o.d * 0.72, -o.rot + Math.PI / 4, 0, 0) }); }
    if (o.kind === 'res' || o.kind === 'school') {      // ленты окон
      const floors = Math.floor(o.h / 3), c = Math.cos(o.rot), s = Math.sin(o.rot);
      for (let f = 1; f < floors; f += 1) for (const sg of [-1, 1]) { const ox = -s * sg * (o.d / 2 + 0.03), oz = c * sg * (o.d / 2 + 0.03); b.box(o.x + ox, 0.3 + f * 3 + 1.4, o.y + oz, o.w * 0.92, 1.2, 0.08, [0.26, 0.32, 0.38], -o.rot); }
    }
  }
  for (const t of C.tanks || []) { b.cyl(t[0], 0.3 + 4.5, t[1], 4.2, 9, [0.82, 0.82, 0.80]); b.cone(t[0], 9.3 + 0.6, t[1], 4.3, 1.2, [0.7, 0.7, 0.68], 12, 0); }
  this.skyline = new T.Mesh(b.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x23201b, emissiveIntensity: 0.5 })); this.skyline.castShadow = true; this.skyline.frustumCulled = false; this.scene.add(this.skyline);
  // деревья окружения
  const list = C.trees, gb = P3.treeGeos('b', 401), gs = P3.treeGeos('s', 402), tm = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), cm = new T.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const isCon = (k) => k === 's' || k === 'p';
  const nb = list.filter(t => !isCon(t[2])).length, ns = list.length - nb;
  this.ctxTrees = { b: { crown: mk(gb.crown, cm, nb), trunk: mk(gb.trunk, tm, nb), n: nb }, s: { crown: mk(gs.crown, cm.clone(), ns), trunk: mk(gs.trunk, tm, ns), n: ns }, list };
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v3 = new T.Vector3(), s3 = new T.Vector3(); let ib = 0, is = 0;
  for (const t of list) { const set = isCon(t[2]) ? this.ctxTrees.s : this.ctxTrees.b, i = isCon(t[2]) ? is++ : ib++; e.set(0, (t[0] * 13.7) % 6.28, 0); q.setFromEuler(e); v3.set(t[0], 0.3, t[1]); s3.set(t[3], t[3], t[3]); m4.compose(v3, q, s3); set.crown.setMatrixAt(i, m4); set.trunk.setMatrixAt(i, m4); }
  this.paintContext();
};

/* ---------------------------------------------------------- северная архитектура */
function gallery(b, pts, y0fn) {
  const n = pts.length, W = 1.95, eave = 2.75, ridge = 4.55;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], q = pts[i + 1], dx = q[0] - a[0], dz = q[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
    const ya = y0fn(a[0], a[1]), yb = y0fn(q[0], q[1]);
    const P = (p, o, y, yy) => [p[0] + nx * o, yy + y, p[1] + nz * o];
    // кровля: два ската, тёмно-зелёная
    for (const s of [-1, 1]) { const e1 = P(a, s * (W + 0.55), eave - 0.15, ya), e2 = P(q, s * (W + 0.55), eave - 0.15, yb), r1 = P(a, 0, ridge, ya), r2 = P(q, 0, ridge, yb); b.tri(e1, e2, r2, CONIFER); b.tri(e1, r2, r1, CONIFER); }
    b.beam(P(a, 0, ridge + 0.05, ya), P(q, 0, ridge + 0.05, yb), 0.16, GOLD, 0.1);
    for (const s of [-1, 1]) { b.beam(P(a, s * (W + 0.55), eave - 0.2, ya), P(q, s * (W + 0.55), eave - 0.2, yb), 0.08, GOLD, 0.12); b.beam(P(a, s * W, eave - 0.35, ya), P(q, s * W, eave - 0.35, yb), 0.2, WOODD, 0.24); }
    // резной подзор: треугольные зубцы под свесом
    for (let k = 0; k < Math.floor(L / 0.9); k++) { const t0 = k * 0.9 / L, t1 = (k * 0.9 + 0.45) / L, t2 = (k * 0.9 + 0.9) / L;
      for (const s of [-1, 1]) { const o = s * (W + 0.5); const pa = [a[0] + dx * t0 + nx * o, ya + eave - 0.22, a[1] + dz * t0 + nz * o], pb = [a[0] + dx * t2 + nx * o, ya + eave - 0.22, a[1] + dz * t2 + nz * o], pc = [a[0] + dx * t1 + nx * o, ya + eave - 0.55, a[1] + dz * t1 + nz * o]; b.tri(pa, pb, pc, WOODL); } }
    // стойки и подкосы через пролёт
    if (i % 2 === 0) for (const s of [-1, 1]) { const p = P(a, s * W, 0, ya); b.box(p[0], ya + eave / 2 - 0.15, p[2], 0.2, eave - 0.3, 0.2, WOOD, -Math.atan2(dz, dx)); b.box(p[0], ya + 0.25, p[2], 0.34, 0.5, 0.34, [0.45, 0.45, 0.43], 0);
      b.beam([p[0], ya + 1.85, p[2]], [p[0] + dx / L * 0.8, ya + eave - 0.4, p[2] + dz / L * 0.8], 0.12, WOOD); b.beam([p[0], ya + 1.85, p[2]], [p[0] - dx / L * 0.8, ya + eave - 0.4, p[2] - dz / L * 0.8], 0.12, WOOD);
      b.beam([p[0], ya + 2.1, p[2]], [a[0], ya + ridge - 0.5, a[1]], 0.1, WOODD); }
  }
  // фронтоны на концах: золотой «конёк»
  for (const [p, nb] of [[pts[0], pts[1]], [pts[n - 1], pts[n - 2]]]) { const y = y0fn(p[0], p[1]); const dx = p[0] - nb[0], dz = p[1] - nb[1], L = Math.hypot(dx, dz) || 1;
    b.beam([p[0], y + ridge, p[1]], [p[0] + dx / L * 0.9, y + ridge + 0.7, p[1] + dz / L * 0.9], 0.14, GOLD); b.ell(p[0] + dx / L * 1.0, y + ridge + 0.85, p[1] + dz / L * 1.0, 0.25, 0.25, 0.25, GOLD); }
}
function ladya(b, o, y0) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot), L = (lx, lz, y) => [o.x + lx * c - lz * s, y0 + y, o.y + lx * s + lz * c];
  const HL = o.w / 2, HW = o.d / 2, H = o.h, N = 11;
  const prof = (t, u) => { const w = HW * Math.pow(Math.max(0, 1 - t * t), 0.55), hk = H * (1 - 0.18 * t * t); return [w * Math.cos(u), hk * Math.sin(u)]; }; // u: 0..π
  // рёбра (шпангоуты)
  for (let i = 0; i <= N; i++) { const t = -0.92 + 1.84 * i / N, x = t * HL; let prev = null;
    for (let k = 0; k <= 8; k++) { const u = Math.PI * k / 8, pr = prof(t, u), p = L(x, pr[0], pr[1]); if (prev) b.beam(prev, p, 0.16, WOOD, 0.22); prev = p; }
    for (const z of [-1, 1]) { const pr = prof(t, z < 0 ? Math.PI : 0); const p = L(x, pr[0], 0); b.box(p[0], y0 + 0.15, p[2], 0.3, 0.3, 0.3, [0.4, 0.4, 0.38], 0); } }
  // обшивка верхней части (пояса), тёмно-зелёная
  for (let k = 2; k <= 6; k++) for (let i = 0; i < 24; i++) { const t0 = -0.95 + 1.9 * i / 24, t1 = -0.95 + 1.9 * (i + 1) / 24;
    const u0 = Math.PI * k / 8 - 0.18, u1 = Math.PI * k / 8 + 0.18; const a0 = prof(t0, u0), a1 = prof(t1, u0), b0 = prof(t0, u1), b1 = prof(t1, u1);
    const p00 = L(t0 * HL, a0[0], a0[1]), p10 = L(t1 * HL, a1[0], a1[1]), p01 = L(t0 * HL, b0[0], b0[1]), p11 = L(t1 * HL, b1[0], b1[1]); b.tri(p00, p10, p11, CONIFER); b.tri(p00, p11, p01, CONIFER); }
  // киль, форштевень и ахтерштевень с золотыми навершиями
  let pk = null; for (let i = 0; i <= 16; i++) { const t = -1 + 2 * i / 16, p = L(t * HL * 0.98, 0, H * (1 - 0.18 * t * t) + 0.08); if (pk) b.beam(pk, p, 0.22, WOODD, 0.2); pk = p; }
  for (const e of [-1, 1]) { const a = L(e * HL * 0.98, 0, H * 0.82), q = L(e * (HL + 0.9), 0, H + 0.9); b.beam(a, q, 0.24, WOODD); b.ell(q[0], q[1] + 0.1, q[2], 0.22, 0.22, 0.22, GOLD); }
  for (let i = 0; i <= N; i += 2) { const t = -0.92 + 1.84 * i / N, pr = prof(t, Math.PI / 2 - 0.4), p = L(t * HL, pr[0], pr[1]); b.box(p[0], p[1], p[2], 0.12, 0.12, 0.12, GOLD, 0); }
  // внутри: скамья вдоль оси и пол
  { const p = L(0, 0, 0); b.box(p[0], y0 + 0.08, p[2], o.w * 0.9, 0.12, o.d * 0.75, [0.62, 0.45, 0.28], -o.rot); }
  for (const z of [-1.4, 1.4]) { const a = L(-3, z, 0.45), q = L(3, z, 0.45); b.beam(a, q, 0.45, WOODL, 0.08); }
}
function bird(b, f, y0) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot), L = (lx, y, lz) => [f.x + lx * c - lz * s, y0 + y, f.y + lx * s + lz * c];
  let p = L(0, 0, 0); b.cyl(p[0], y0 + 0.9, p[2], 0.12, 1.8, WOODD); b.box(p[0], y0 + 0.15, p[2], 1.0, 0.3, 1.0, WOODD, -f.rot);
  p = L(0, 2.1, 0); b.ell(p[0], p[1], p[2], 0.9, 0.45, 0.4, WOOD);
  const hd = L(0.85, 2.75, 0); b.beam(L(0.55, 2.25, 0), hd, 0.16, WOOD); b.ell(hd[0], hd[1], hd[2], 0.2, 0.18, 0.16, WOOD); const bk = L(1.2, 2.72, 0); b.beam(hd, bk, 0.07, GOLD);
  for (let i = 0; i < 7; i++) { const a = -0.5 + i * 0.25; for (const sg of [-1, 1]) b.beam(L(0, 2.25, sg * 0.3), L(-0.2 + Math.cos(a) * 0.6, 2.4 + Math.sin(a) * 0.9 + 0.3, sg * 1.25), 0.06, i % 2 ? GOLD : WOODL, 0.2); }
  for (let i = 0; i < 5; i++) { const a = -0.5 + i * 0.25; b.beam(L(-0.8, 2.15, 0), L(-1.6, 2.4 + Math.sin(a) * 0.8, Math.cos(a) * 0.2 - 0.1 + i * 0.05), 0.06, i % 2 ? RED : WOODL, 0.18); }
}
function horse(b, f, y0) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot), L = (lx, y, lz) => [f.x + lx * c - lz * s, y0 + y, f.y + lx * s + lz * c];
  let p = L(0, 0, 0); b.box(p[0], y0 + 0.12, p[2], 2.6, 0.24, 1.0, WOODD, -f.rot);
  for (const lx of [-0.8, 0.8]) for (const lz of [-0.28, 0.28]) { const q = L(lx, 0, lz); b.cyl(q[0], y0 + 0.75, q[2], 0.1, 1.3, WOOD); }
  p = L(0, 1.65, 0); b.box(p[0], p[1], p[2], 2.2, 0.75, 0.7, WOOD, -f.rot);
  const n0 = L(0.9, 1.9, 0), n1 = L(1.35, 2.85, 0); b.beam(n0, n1, 0.42, WOOD, 0.36);
  const hd = L(1.6, 2.85, 0); b.box(hd[0], hd[1], hd[2], 0.7, 0.32, 0.3, WOOD, -f.rot);
  for (let i = 0; i < 6; i++) { const q = L(0.95 + i * 0.08, 2.05 + i * 0.17, 0); b.box(q[0], q[1], q[2], 0.08, 0.16, 0.46, GOLD, -f.rot); }      // грива
  const t0 = L(-1.1, 1.8, 0), t1 = L(-1.6, 1.2, 0); b.beam(t0, t1, 0.14, GOLD);
  for (const sg of [-1, 1]) { const a = L(-0.6, 1.5, sg * 0.36), q = L(0.6, 1.5, sg * 0.36); b.beam(a, q, 0.08, RED, 0.25); }                     // мезенская полоса
}
function beast(b, f, y0) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot), L = (lx, y, lz) => [f.x + lx * c - lz * s, y0 + y, f.y + lx * s + lz * c];
  let p = L(0, 0, 0); b.box(p[0], y0 + 0.1, p[2], 4.6, 0.2, 1.4, WOODD, -f.rot);
  for (let i = 0; i < 4; i++) { const x = -1.8 + i * 1.1, h = 0.8 + 0.25 * (i % 2); for (let k = 0; k <= 6; k++) { const u = Math.PI * k / 6, q = L(x - 0.45 * Math.cos(u), h * Math.sin(u) + 0.2, 0); b.ell(q[0], q[1], q[2], 0.28, 0.28, 0.24, i % 2 ? TEAL : [0.18, 0.38, 0.36]); } }
  const hd = L(2.4, 2.6, 0); b.beam(L(1.6, 0.4, 0), L(2.2, 2.3, 0), 0.42, TEAL, 0.36); b.ell(hd[0], hd[1], hd[2], 0.6, 0.4, 0.34, TEAL); b.beam(L(2.6, 2.75, 0), L(3.15, 2.6, 0), 0.12, GOLD, 0.24);
  for (let i = 0; i < 5; i++) { const q = L(1.9 + i * 0.12, 2.85 + i * 0.07, 0); b.box(q[0], q[1], q[2], 0.06, 0.4, 0.06, GOLD, -f.rot); }
  const tl = L(-2.6, 0.6, 0); b.beam(L(-2.2, 0.3, 0), tl, 0.2, TEAL); b.tri(L(-2.6, 0.6, 0), L(-3.2, 1.3, 0.3), L(-3.2, 0.2, -0.3), GOLD);
}
function tablet(b, x, z, rot, y0) { const c = Math.cos(rot), s = Math.sin(rot); for (const sg of [-0.45, 0.45]) b.cyl(x + c * sg, y0 + 0.6, z + s * sg, 0.06, 1.2, WOODD); b.box(x, y0 + 1.15, z, 1.0, 0.6, 0.06, WOODL, -rot); b.box(x, y0 + 1.47, z, 1.08, 0.06, 0.1, GOLD, -rot); }
function station(b, o, y0) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot), L = (lx, lz) => [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
  let p = L(0, 0); b.box(p[0], y0 + 0.12, p[1], o.w, 0.24, o.d, [0.62, 0.45, 0.28], -o.rot);
  for (const [lx, lz, w, d] of [[0, -o.d / 2 + 0.1, o.w * 0.8, 0.14], [-o.w / 2 + 0.1, 0, 0.14, o.d * 0.6]]) { p = L(lx, lz); b.box(p[0], y0 + 0.24 + 0.55, p[1], w, 1.1, d, WOOD, -o.rot); }
  for (let i = 0; i < 6; i++) { p = L(-2.2 + i * 0.8, -o.d / 2 + 0.2); b.ell(p[0], y0 + 0.75 + (i % 2) * 0.2, p[1], 0.14, 0.18, 0.05, WOODD); }  // рельефные следы
  p = L(o.w / 2 - 0.8, o.d / 2 - 0.8); b.box(p[0], y0 + 0.24 + 1.1, p[1], 0.36, 2.2, 0.36, WOODD, -o.rot); b.box(p[0], y0 + 0.24 + 2.25, p[1], 0.44, 0.1, 0.44, GOLD, -o.rot);
  for (let i = 0; i < 3; i++) { p = L(-0.6 + i * 0.7, 0.8); b.parts.push({ geo: new T.CylinderGeometry(1, 1, 1, 18), color: i === 1 ? GOLD : WOODL, m: b._m(p[0], y0 + 1.0, p[1], 0.28, 0.1, 0.28, -o.rot, Math.PI / 2, 0) }); }
  p = L(-0.2, 0.8); b.beam([L(-1.0, 0.8)[0], y0 + 1.0, L(-1.0, 0.8)[1]], [L(1.0, 0.8)[0], y0 + 1.0, L(1.0, 0.8)[1]], 0.05, [0.3, 0.3, 0.32]);
  for (const lx of [-1.0, 1.0]) { p = L(lx, 0.8); b.cyl(p[0], y0 + 0.62, p[1], 0.05, 0.76, WOODD); }
}
Park3D.prototype.buildNorthStructures = function (b) {
  const N = this.M.north; if (!N) return; const gY = (x, z) => this.gY(x, z);
  for (const g of N.galleries) gallery(b, g.pts, (x, z) => gY(x, z) + 0.05);
  ladya(b, N.ladya, gY(N.ladya.x, N.ladya.y) + 0.05);
  const F = { bird, horse, beast };
  for (const f of N.figures) { F[f.kind](b, f, gY(f.x, f.y)); tablet(b, f.tx, f.ty, f.rot + Math.PI / 2, gY(f.tx, f.ty)); const t2x = f.tx + Math.cos(f.rot) * 1.6, t2z = f.ty + Math.sin(f.rot) * 1.6; tablet(b, t2x, t2z, f.rot + Math.PI / 2, gY(t2x, t2z)); }
  station(b, N.station, gY(N.station.x, N.station.y));
};

/* ---------------------------------------------------------- берёза карликовая и стланиковые берёзы */
Park3D.prototype.buildNorthVeg = function () {
  const N = this.M.north; if (!N) return; const rg = rng32(91);
  const g = new T.IcosahedronGeometry(1, 1); P3.jitterGeo(g, 0.3, 17);
  this.dwarfList = [];
  for (const d of N.dwarf) for (let i = 0; i < d[2]; i++) { const a = rg() * 6.28, r = Math.sqrt(rg()) * 2.2; this.dwarfList.push([d[0] + Math.cos(a) * r, d[1] + Math.sin(a) * r, 0.5 + rg() * 0.5, rg()]); }
  this.dwarf = new T.InstancedMesh(g, new T.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), this.dwarfList.length);
  this.dwarf.castShadow = true; this.dwarf.receiveShadow = true; this.dwarf.frustumCulled = false; this.scene.add(this.dwarf);
  // стланиковые берёзы: изогнутые лежачие стволы и низкие кроны
  const tb = new Builder(), cb = new Builder();
  for (const c of N.creep) { const [x, z, a, L] = c, y = this.gY(x, z), dx = Math.cos(a), dz = Math.sin(a); let prev = [x - dx * L * 0.5, y, z - dz * L * 0.5];
    for (let k = 1; k <= 6; k++) { const t = k / 6, bend = Math.sin(t * Math.PI) * 0.6, p = [x - dx * L * 0.5 + dx * L * t - dz * bend, y + 0.25 + 0.5 * Math.sin(t * 2.4) , z - dz * L * 0.5 + dz * L * t + dx * bend]; tb.beam(prev, p, 0.16 - 0.015 * k, BARK); prev = p;
      if (k % 2 === 0) { tb.beam(p, [p[0] + (rg() - 0.5) * 0.6, p[1] + 0.9, p[2] + (rg() - 0.5) * 0.6], 0.06, BARK); }
      cb.ell(p[0], p[1] + 0.55 + rg() * 0.3, p[2], 0.9 + rg() * 0.4, 0.45, 0.8 + rg() * 0.3, [1, 1, 1]); } }
  this.creepTrunk = new T.Mesh(tb.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); this.creepTrunk.castShadow = true; this.creepTrunk.frustumCulled = false; this.scene.add(this.creepTrunk);
  const cg = P3.jitterGeo(cb.build(), 0.15, 23); this.creepCrown = new T.Mesh(cg, new T.MeshStandardMaterial({ roughness: 0.95, flatShading: true, color: 0x5f8a2e })); this.creepCrown.castShadow = true; this.creepCrown.frustumCulled = false; this.scene.add(this.creepCrown);
};
Park3D.prototype.updateNorthVeg = function (d, terrainChanged) {
  if (!this.dwarf) return;
  const k = d.tree * (0.55 + 0.45 * d.grow), win = this.env.season === 2, aut = this.env.season === 1;
  if (this._dk !== k || terrainChanged || this._dws !== this.env.season) {
    this._dk = k; this._dws = this.env.season;
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), s3 = new T.Vector3(), c = new T.Color();
    this.dwarfList.forEach((t, i) => { e.set(0, t[3] * 6.28, 0); q.setFromEuler(e); const r = (0.8 + 0.5 * t[3]) * k * (win ? 0.6 : 1) + 0.0001; v.set(t[0], this.gY(t[0], t[1]) + 0.15 * r, t[1]); s3.set(r, t[2] * k * (win ? 0.4 : 1) + 0.0001, r * 0.9); m4.compose(v, q, s3); this.dwarf.setMatrixAt(i, m4);
      const col = win ? [0.86, 0.88, 0.9] : aut ? [0.78 + 0.12 * t[3], 0.26 + 0.12 * t[3], 0.10] : [0.28 + 0.08 * t[3], 0.44 + 0.06 * t[3], 0.16]; this.dwarf.setColorAt(i, c.setRGB(col[0], col[1], col[2])); });
    this.dwarf.instanceMatrix.needsUpdate = true; if (this.dwarf.instanceColor) this.dwarf.instanceColor.needsUpdate = true;
    this.creepCrown.material.color.setRGB(aut ? 0.85 : 0.33, aut ? 0.62 : 0.50, aut ? 0.18 : 0.17);
    const sc = Math.max(0.0001, k); this.creepCrown.scale.set(1, 1, 1);
  }
  const vis = d.tree > 0.01 && this.show.trees;
  this.dwarf.visible = vis; this.creepTrunk.visible = vis; this.creepCrown.visible = vis && !win;
};

/* ---------------------------------------------------------- метки */
Park3D.prototype.northPOIs = function (P) {
  const N = this.M.north; if (!N) return; const gY = (x, z) => this.gY(x, z);
  const add = (id, title, x, z, dy, text) => P.push({ id, title, x, z, y: gY(x, z) + dy, from: 5, text, kind: 'poi' });
  add('ladya', 'Поморская ладья', N.ladya.x, N.ladya.y, 6, 'Мастерская-павильон 10 × 6 м, верх до 3,2 м: перевёрнутая деревянная лодка как образ. Место встреч, небольших выставок и рассказов о поморском мореходстве.');
  const g = N.galleries[0], m = g.pts[Math.floor(g.pts.length / 2)];
  add('gallery', 'Крытые галереи', m[0], m[1], 7, `Четыре галереи общей длиной около ${Math.round(N.galleries.reduce((a, q) => a + q.len, 0))} м: высокая двускатная кровля, подкосы, резной подзор и золотистые кромки.`);
  const f = N.figures[1];
  add('tales', 'Северные истории', f.x, f.y, 6, 'Сказочный маршрут: деревянные птица, конь и морской зверь до 3,2 м и таблички о северных рассказах. Фигуры не игровое оборудование.');
  add('tracks', 'Следы леса', N.station.x, N.station.y, 5, 'Станция 7 × 5 м со стелой 2,2 м: рельефные следы животных, поворотная карта сезонов и механический счётчик наблюдений.');
};
global.P3.north = { ladya, gallery };
})(window);
/* Часть 5: сервис. Павильоны-туалеты «Северная летопись» и ресторан «Тоня» (дом-кошель),
   хозяйственный проезд, вечерний свет в окнах, препятствия и площадки для прогулки. */
(function (global) {
'use strict';
const P3 = global.P3, T = P3.T, VE = P3.VE, Builder = P3.Builder;
const Park3D = global.Park3D;
const GOLD = [0.78, 0.63, 0.34], CONIFER = [0.13, 0.24, 0.18], CONIFER2 = [0.10, 0.20, 0.15], WOOD = [0.58, 0.40, 0.23], WOODD = [0.40, 0.27, 0.16], WOODL = [0.74, 0.56, 0.34];
const LOG = [0.52, 0.36, 0.21], LOG2 = [0.60, 0.43, 0.26], STONE = [0.50, 0.51, 0.50], GLASS = [0.10, 0.14, 0.16], BRICK = [0.55, 0.27, 0.19], ASPH = [0.36, 0.37, 0.38];

function frame(o, y0) {             // локальные координаты: lx — вдоль, ly — поперёк (+ly — фасад к дорожке / двор), h — высота
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return (lx, ly, h) => [o.x + lx * c - ly * s, y0 + h, o.y + lx * s + ly * c];
}
function bxL(b, L, o, lx, ly, h0, sx, sh, sy, col) { const p = L(lx, ly, h0 + sh / 2); b.box(p[0], p[1], p[2], sx, sh, sy, col, -o.rot); }
function discL(b, L, o, lx, ly, h, r, t, col, axis) {     // диск, ось вдоль lx ('x') или ly ('y')
  const p = L(lx, ly, h); b.parts.push({ geo: b.cyl1, color: col, m: axis === 'x' ? b._m(p[0], p[1], p[2], r, t, r, -o.rot, 0, Math.PI / 2) : b._m(p[0], p[1], p[2], r, t, r, -o.rot, Math.PI / 2, 0) });
}
function horseHead(b, a, dir, col) {        // резной «конёк» на торце охлупня
  const q = [a[0] + dir[0] * 0.9, a[1] + 0.75, a[2] + dir[2] * 0.9]; b.beam(a, q, 0.16, col, 0.22);
  b.ell(q[0] + dir[0] * 0.18, q[1] + 0.12, q[2] + dir[2] * 0.18, 0.32, 0.2, 0.14, col);
  b.beam([q[0], q[1] + 0.18, q[2]], [q[0] - dir[0] * 0.25, q[1] + 0.45, q[2] - dir[2] * 0.25], 0.06, col, 0.1);
}

/* ---------------------------------------------------------- павильон-туалет: клеть с повалом */
function wcPavilion(b, g, o, y0) {
  const L = frame(o, y0), W = o.w, D = o.d, hw = W / 2, hd = D / 2;
  const top = 3.25, ridge = top + 2.95, slope = (ridge - top) / hd;
  bxL(b, L, o, 0, 0, -0.5, W + 0.5, 0.82, D + 0.5, STONE);                                      // цоколь
  bxL(b, L, o, 0, hd + 1.0, -0.3, W + 0.6, 0.48, 1.9, [0.46, 0.33, 0.20]);                      // настил-крыльцо вдоль фасада
  // венцы: брёвна с выпуском «в обло» и повал (верхние венцы выдвинуты наружу)
  for (let k = 0; k < 10; k++) {
    const h = 0.32 + k * 0.29, out = k >= 8 ? (k - 7) * 0.11 : 0, col = k % 2 ? LOG : LOG2;
    for (const s of [-1, 1]) {
      const a = L(-hw - 0.32 - out, s * (hd + out), h), q = L(hw + 0.32 + out, s * (hd + out), h); b.beam(a, q, 0.3, col, 0.29);
      const a2 = L(s * (hw + out), -hd - 0.32 - out, h + 0.145), q2 = L(s * (hw + out), hd + 0.32 + out, h + 0.145); b.beam(a2, q2, 0.3, col, 0.29);
    }
  }
  bxL(b, L, o, 0, 0, 0.3, W - 0.2, top - 0.3, D - 0.2, LOG);                                    // сплошное тело под венцами
  // фронтоны (тёсом) и медальоны
  for (const s of [-1, 1]) {
    const e = s * (hw + 0.36);
    b.tri(L(e, -hd - 0.3, top + 0.1), L(e, hd + 0.3, top + 0.1), L(e, 0, ridge - 0.05), WOODL);
    for (let i = -3; i <= 3; i++) { const ly = i * 0.6; const hh = ridge - 0.05 - Math.abs(ly) * slope; if (hh > top + 0.3) b.beam(L(e + s * 0.02, ly, top + 0.1), L(e + s * 0.02, ly, hh), 0.05, WOOD, 0.04); }
    discL(b, L, o, e + s * 0.05, 0, top + 1.05, 0.78, 0.08, GOLD, 'x');
    discL(b, L, o, e + s * 0.1, 0, top + 1.05, 0.62, 0.06, CONIFER, 'x');
    motif(b, L, o, e + s * 0.14, top + 1.05, g.key, s);
    // полотенце под коньком
    bxL(b, L, o, e + s * 0.05, 0, ridge - 1.1, 0.06, 0.9, 0.3, GOLD);
  }
  // кровля: высокие скаты, тёмная хвоя, золотые кромки
  const ex = hw + 0.75, oh = 0.55, he = top - oh * slope;
  for (const s of [-1, 1]) {
    const e1 = L(-ex, s * (hd + oh), he), e2 = L(ex, s * (hd + oh), he), r1 = L(-ex, 0, ridge), r2 = L(ex, 0, ridge);
    b.tri(e1, e2, r2, CONIFER); b.tri(e1, r2, r1, CONIFER);
    const u1 = L(-ex, s * (hd + oh), he + 0.12), u2 = L(ex, s * (hd + oh), he + 0.12), v1 = L(-ex, 0, ridge + 0.12), v2 = L(ex, 0, ridge + 0.12);
    b.tri(u1, u2, v2, CONIFER2); b.tri(u1, v2, v1, CONIFER2);
    b.beam(L(-ex, s * (hd + oh), he + 0.04), L(ex, s * (hd + oh), he + 0.04), 0.09, GOLD, 0.12);
    for (const t of [-1, 1]) { b.beam(L(t * ex, s * (hd + oh), he - 0.05), L(t * ex, 0, ridge - 0.05), 0.07, WOODL, 0.34); b.beam(L(t * (ex + 0.04), s * (hd + oh), he + 0.1), L(t * (ex + 0.04), 0, ridge + 0.1), 0.05, GOLD, 0.07); }
    // резной подзор вдоль свеса
    for (let k = 0; k < Math.floor(2 * ex / 0.6); k++) { const x0 = -ex + k * 0.6; b.tri(L(x0, s * (hd + oh - 0.02), he - 0.04), L(x0 + 0.6, s * (hd + oh - 0.02), he - 0.04), L(x0 + 0.3, s * (hd + oh - 0.02), he - 0.32), WOODL); }
  }
  // охлупень и коньки
  b.beam(L(-ex - 0.1, 0, ridge + 0.12), L(ex + 0.1, 0, ridge + 0.12), 0.34, WOODD, 0.3);
  for (const t of [-1, 1]) { const a = L(t * (ex + 0.1), 0, ridge + 0.14), c = Math.cos(o.rot), s2 = Math.sin(o.rot); horseHead(b, a, [t * c, 0, t * s2], GOLD); }
  // навес-крыльцо по фасаду на столбах с подкосами
  const ny = hd + 1.85, hl = 2.55;
  for (const lx of [-hw + 0.2, -hw / 3, hw / 3, hw - 0.2]) { b.beam(L(lx, ny - 0.1, -0.05), L(lx, ny - 0.1, hl), 0.18, WOOD); b.beam(L(lx, ny - 0.1, hl - 0.75), L(lx + 0.6, ny - 0.1, hl - 0.05), 0.09, WOOD); b.beam(L(lx, ny - 0.1, hl - 0.75), L(lx - 0.6, ny - 0.1, hl - 0.05), 0.09, WOOD); }
  b.beam(L(-hw - 0.3, ny - 0.1, hl), L(hw + 0.3, ny - 0.1, hl), 0.2, WOODD, 0.2);
  const lt1 = L(-hw - 0.4, hd + 0.05, he - 0.15), lt2 = L(hw + 0.4, hd + 0.05, he - 0.15), lt3 = L(hw + 0.4, ny + 0.3, hl + 0.05), lt4 = L(-hw - 0.4, ny + 0.3, hl + 0.05);
  b.tri(lt1, lt2, lt3, CONIFER); b.tri(lt1, lt3, lt4, CONIFER); b.beam(L(-hw - 0.4, ny + 0.3, hl + 0.05), L(hw + 0.4, ny + 0.3, hl + 0.05), 0.08, GOLD, 0.12);
  // двери: три обычные и одна универсальная (шире), золотые наличники
  const doors = [[-2.85, 0.95], [-0.95, 0.95], [0.95, 0.95], [2.85, 1.25]];
  for (const [lx, w] of doors) { bxL(b, L, o, lx, hd + 0.17, 0.32, w, 2.1, 0.06, WOODD); bxL(b, L, o, lx, hd + 0.21, 2.42, w + 0.32, 0.12, 0.06, GOLD); for (const t of [-1, 1]) bxL(b, L, o, lx + t * (w / 2 + 0.1), hd + 0.21, 0.32, 0.1, 2.1, 0.06, WOODL);
    const k = L(lx, hd + 0.22, 2.62); b.tri(L(lx - w / 2 - 0.16, hd + 0.22, 2.48), L(lx + w / 2 + 0.16, hd + 0.22, 2.48), L(lx, hd + 0.22, 2.85), GOLD); }
  // световые окна-«волоковые» сзади
  for (const lx of [-2.85, -0.95, 0.95, 2.85]) bxL(b, L, o, lx, -hd - 0.17, 2.2, 0.7, 0.36, 0.06, GLASS);
  // стенд «летописи» у торца
  const sx = -hw - 2.0, sy = hd + 1.2; for (const t of [-0.75, 0.75]) b.beam(L(sx + t, sy, -0.1), L(sx + t, sy, 2.0), 0.12, WOODD);
  bxL(b, L, o, sx, sy, 0.75, 1.6, 1.05, 0.08, WOODL); bxL(b, L, o, sx, sy + 0.02, 1.85, 1.75, 0.1, 0.12, GOLD); bxL(b, L, o, sx, sy + 0.02, 0.68, 1.75, 0.07, 0.12, GOLD);
  b.tri(L(sx - 0.95, sy, 1.93), L(sx + 0.95, sy, 1.93), L(sx, sy, 2.35), CONIFER);
}
function motif(b, L, o, e, hc, key, s) {      // знак эпизода на медальоне
  const P = (ly, h) => L(e, ly, hc + h), bm = (a, q, w) => b.beam(P(a[0], a[1]), P(q[0], q[1]), w || 0.07, GOLD, 0.05);
  if (key === 'wc_city') {             // острожная башня и архангел-крест
    bm([-0.12, -0.42], [-0.12, 0.12], 0.08); bm([0.12, -0.42], [0.12, 0.12], 0.08); bm([-0.16, 0.12], [0.16, 0.12]); bm([-0.2, 0.12], [0, 0.42]); bm([0.2, 0.12], [0, 0.42]); bm([0, 0.42], [0, 0.55], 0.04); bm([-0.07, 0.5], [0.07, 0.5], 0.03);
    bm([-0.36, -0.42], [-0.36, -0.12], 0.06); bm([0.36, -0.42], [0.36, -0.12], 0.06); bm([-0.42, -0.42], [0.42, -0.42], 0.05);
  } else if (key === 'wc_trade') {     // корабль у причала
    bm([-0.4, -0.18], [0.4, -0.18], 0.1); bm([-0.4, -0.18], [-0.48, -0.04]); bm([0.4, -0.18], [0.5, -0.02]); bm([0, -0.15], [0, 0.45], 0.04); bm([0.18, -0.15], [0.18, 0.3], 0.03);
    b.tri(P(0.02, 0.42), P(0.02, -0.05), P(0.3, 0.02), GOLD); b.tri(P(-0.02, 0.4), P(-0.02, -0.05), P(-0.28, 0.0), GOLD); bm([-0.5, -0.38], [0.5, -0.38], 0.04);
  } else if (key === 'wc_yard') {      // шпангоуты на стапеле
    for (let i = -2; i <= 2; i++) { const x = i * 0.16, hh = 0.35 - Math.abs(i) * 0.06; bm([x - 0.05, -0.22], [x, hh], 0.05); }
    bm([-0.46, -0.22], [0.46, -0.22], 0.08); bm([-0.4, -0.4], [0.4, -0.4], 0.05); bm([-0.3, -0.4], [-0.25, -0.22], 0.04); bm([0.3, -0.4], [0.25, -0.22], 0.04);
  } else {                             // коч под парусом и «матка»-компас
    b.ell(...P(0, -0.25), 0.06, 0.12, 0.36, GOLD); bm([0, -0.18], [0, 0.4], 0.04); b.tri(P(0.02, 0.38), P(0.02, -0.1), P(0.3, -0.08), GOLD);
    bm([-0.3, 0.32], [-0.3, 0.52], 0.03); bm([-0.4, 0.42], [-0.2, 0.42], 0.03);
  }
}

/* ---------------------------------------------------------- ресторан «Тоня»: дом-кошель */
function restaurant(b, gw, r, y0) {
  const L = frame(r, y0), W = r.w, D = r.d, hw = W / 2, hd = D / 2;
  const fl = 0.55, fTop = 5.6, rTop = 3.3, ridgeY = -2.0, ridge = 11.0;
  const sF = (ridge - fTop) / (hd + ridgeY), sR = (ridge - rTop) / (hd - ridgeY);       // уклоны: к воде круче, к двору длиннее и положе
  bxL(b, L, r, 0, 0, -0.6, W + 0.6, fl + 0.6, D + 0.6, STONE);
  // стены: брусовые с «венцами» (горизонтальные тени)
  bxL(b, L, r, 0, 0, fl, W, rTop - fl, D, LOG);
  bxL(b, L, r, 0, -hd + 0.35, rTop, W, fTop - rTop, 0.7, LOG);                                  // высокая часть фасада к воде
  for (let k = 0; k < 15; k++) { const h = fl + 0.18 + k * 0.34; if (h > fTop) break;
    b.beam(L(-hw - 0.25, -hd - 0.02, h), L(hw + 0.25, -hd - 0.02, h), 0.06, LOG2, 0.06);
    if (h < rTop) { b.beam(L(-hw - 0.25, hd + 0.02, h), L(hw + 0.25, hd + 0.02, h), 0.06, LOG2, 0.06); for (const s of [-1, 1]) b.beam(L(s * (hw + 0.02), -hd - 0.25, h), L(s * (hw + 0.02), hd + 0.25, h), 0.06, LOG2, 0.06); }
    else for (const s of [-1, 1]) b.beam(L(s * (hw + 0.02), -hd - 0.25, h), L(s * (hw + 0.02), -hd + (fTop - h) / sF * 0 + 0.7, h), 0.06, LOG2, 0.06); }
  // торцы-фронтоны (пятиугольник кошеля)
  for (const s of [-1, 1]) { const e = s * (hw + 0.01);
    b.tri(L(e, -hd, rTop), L(e, hd, rTop), L(e, ridgeY, ridge - 0.1), LOG); b.tri(L(e, -hd, rTop), L(e, ridgeY, ridge - 0.1), L(e, -hd, fTop), LOG);
    for (let i = -6; i <= 8; i++) { const ly = i * 0.85; const hh = ly < ridgeY ? fTop + (ly + hd) * sF : ridge - (ly - ridgeY) * sR; const h0 = ly < -hd + 0.01 ? fTop : rTop; if (ly > -hd && ly < hd && hh - 0.15 > rTop) b.beam(L(e + s * 0.03, ly, Math.max(rTop, ly < ridgeY ? rTop : rTop)), L(e + s * 0.03, ly, hh - 0.15), 0.06, WOOD, 0.05); }
    discL(gw, L, r, e + s * 0.04, ridgeY, 8.0, 0.75, 0.08, GLASS, 'x'); discL(b, L, r, e + s * 0.02, ridgeY, 8.0, 0.92, 0.06, GOLD, 'x');
    bxL(b, L, r, e + s * 0.06, ridgeY, ridge - 1.6, 0.06, 1.3, 0.36, GOLD);                       // полотенце
    // окна торцов
    for (const ly of [-4.5, -1.5]) { win(gw, b, L, r, e, ly, 1.1, 1.0, 2.2, 'x', s); }
    win(gw, b, L, r, e, -3.0, 5.2, 0.9, 1.1, 'x', s);
  }
  // окна фасада к воде: высокие в зале и ряд мансардных
  for (let i = 0; i < 7; i++) { const lx = -hw + 2.6 + i * (W - 5.2) / 6; win(gw, b, L, r, lx, -hd, 1.05, 1.5, 2.5, 'y', -1); win(gw, b, L, r, lx, -hd, 4.15, 0.95, 1.05, 'y', -1); }
  // двор: служебные двери, вытяжки
  for (const lx of [-6, 4]) { bxL(b, L, r, lx, hd + 0.04, fl, 1.4, 2.2, 0.08, WOODD); bxL(b, L, r, lx, hd + 0.08, fl + 2.25, 1.6, 0.12, 0.1, GOLD); }
  for (const lx of [-1, 8, 10]) win(gw, b, L, r, lx, hd, 1.4, 1.1, 1.0, 'y', 1);
  // кровля
  const ex = hw + 0.9, ohF = 0.9, ohR = 0.85, heF = fTop - ohF * sF, heR = rTop - ohR * sR;
  const slopes = [[-hd - ohF, heF], [hd + ohR, heR]];
  for (const [ly, he] of slopes) {
    const e1 = L(-ex, ly, he), e2 = L(ex, ly, he), r1 = L(-ex, ridgeY, ridge), r2 = L(ex, ridgeY, ridge);
    b.tri(e1, e2, r2, CONIFER); b.tri(e1, r2, r1, CONIFER);
    const u1 = L(-ex, ly, he + 0.18), u2 = L(ex, ly, he + 0.18), v1 = L(-ex, ridgeY, ridge + 0.18), v2 = L(ex, ridgeY, ridge + 0.18); b.tri(u1, u2, v2, CONIFER2); b.tri(u1, v2, v1, CONIFER2);
    b.beam(L(-ex, ly, he + 0.06), L(ex, ly, he + 0.06), 0.1, GOLD, 0.14);
    for (const t of [-1, 1]) { b.beam(L(t * ex, ly, he - 0.06), L(t * ex, ridgeY, ridge - 0.06), 0.08, WOODL, 0.45); b.beam(L(t * (ex + 0.05), ly, he + 0.14), L(t * (ex + 0.05), ridgeY, ridge + 0.14), 0.06, GOLD, 0.08); }
    for (let k = 0; k < Math.floor(2 * ex / 0.7); k++) { const x0 = -ex + k * 0.7, sg = Math.sign(ly); b.tri(L(x0, ly - sg * 0.02, he - 0.05), L(x0 + 0.7, ly - sg * 0.02, he - 0.05), L(x0 + 0.35, ly - sg * 0.02, he - 0.4), WOODL); }
  }
  b.beam(L(-ex - 0.1, ridgeY, ridge + 0.2), L(ex + 0.1, ridgeY, ridge + 0.2), 0.42, WOODD, 0.36);
  { const c = Math.cos(r.rot), s = Math.sin(r.rot); for (const t of [-1, 1]) horseHead(b, L(t * (ex + 0.1), ridgeY, ridge + 0.22), [t * c, 0, t * s], GOLD); }
  // флюгер-треска на коньке
  { const m = L(3, ridgeY, ridge + 0.4); b.cyl(m[0], m[1] + 0.9, m[2], 0.04, 1.8, WOODD); const f = L(3, ridgeY, ridge + 2.1); const c = Math.cos(r.rot), s = Math.sin(r.rot);
    b.parts.push({ geo: b.sph, color: GOLD, m: b._m(f[0], f[1], f[2], 0.75, 0.24, 0.12, -r.rot, 0, 0) }); b.tri([f[0] - c * 0.7, f[1], f[2] - s * 0.7], [f[0] - c * 1.15, f[1] + 0.3, f[2] - s * 1.15], [f[0] - c * 1.15, f[1] - 0.3, f[2] - s * 1.15], GOLD); }
  // труба русской печи
  { const p = L(6.5, 2.2, 0); b.box(p[0], y0 + 9.0, p[2], 1.0, 4.4, 1.0, BRICK, -r.rot); b.box(p[0], y0 + 11.3, p[2], 1.25, 0.25, 1.25, [0.3, 0.3, 0.3], -r.rot); }
  // летняя терраса к воде
  const tD = r.terrace.d, tY = -hd - tD / 2, tH = fl;
  bxL(b, L, r, 0, tY, tH - 0.18, W + 1.2, 0.18, tD, [0.62, 0.45, 0.28]);
  for (let i = 0; i <= 8; i++) for (const ly of [-hd - 0.4, -hd - tD + 0.3]) { const p = L(-hw - 0.4 + i * (W + 0.8) / 8, ly, 0); b.cyl(p[0], y0 - 0.6 + (tH - 0.1) / 2 + 0.3, p[2], 0.1, tH + 0.6, WOODD); }
  for (const [a, q] of [[[-hw - 0.55, -hd - tD + 0.05], [hw + 0.55, -hd - tD + 0.05]], [[-hw - 0.55, -hd - tD + 0.05], [-hw - 0.55, -hd - 0.2]], [[hw + 0.55, -hd - tD + 0.05], [hw + 0.55, -hd - 0.2]]]) {
    b.beam(L(a[0], a[1], tH + 1.0), L(q[0], q[1], tH + 1.0), 0.1, WOODL, 0.08);
    const n = Math.max(2, Math.round(Math.hypot(q[0] - a[0], q[1] - a[1]) / 0.6)); for (let k = 0; k <= n; k++) { const x = a[0] + (q[0] - a[0]) * k / n, y = a[1] + (q[1] - a[1]) * k / n; if (a[1] === q[1] && x < -hw + 3.6 && x > -hw + 1.2) continue; b.beam(L(x, y, tH), L(x, y, tH + 1.0), 0.05, WOOD); }
  }
  // навес над половиной террасы
  { const x0 = 0.5, x1 = hw - 0.2, yA = -hd - 0.1, yB = -hd - tD + 0.15, hA = fTop - 1.2, hB = tH + 2.75;
    for (const lx of [x0, (x0 + x1) / 2, x1]) b.beam(L(lx, yB + 0.15, tH), L(lx, yB + 0.15, hB), 0.16, WOOD);
    b.tri(L(x0 - 0.3, yA, hA), L(x1 + 0.3, yA, hA), L(x1 + 0.3, yB - 0.3, hB - 0.12), CONIFER); b.tri(L(x0 - 0.3, yA, hA), L(x1 + 0.3, yB - 0.3, hB - 0.12), L(x0 - 0.3, yB - 0.3, hB - 0.12), CONIFER);
    b.beam(L(x0 - 0.3, yB - 0.3, hB - 0.1), L(x1 + 0.3, yB - 0.3, hB - 0.1), 0.08, GOLD, 0.12); }
  // столы на террасе
  for (let i = 0; i < 7; i++) { const lx = -hw + 4.2 + i * 3.3, ly = tY + (i % 2 ? 0.4 : -0.4); const p = L(lx, ly, tH); b.cyl(p[0], p[1] + 0.37, p[2], 0.45, 0.06, WOODL); b.cyl(p[0], p[1] + 0.18, p[2], 0.06, 0.36, WOODD);
    for (const t of [-1, 1]) bxL(b, L, r, lx, ly + t * 0.75, tH, 1.1, 0.42, 0.32, WOOD); }
  // крыльцо-вход: лестница с террасы и навес на столбах
  { const lx = -hw + 2.4, ly0 = -hd - tD; for (let k = 0; k < 3; k++) bxL(b, L, r, lx, ly0 - 0.3 - k * 0.32, -0.1, 2.4, tH - k * 0.17, 0.32, [0.55, 0.40, 0.25]);
    const yP = ly0 - 0.9; for (const t of [-1.25, 1.25]) for (const yy of [ly0 + 0.4, yP - 0.4]) b.beam(L(lx + t, yy, -0.1), L(lx + t, yy, 3.0), 0.16, WOOD);
    const hP = 3.0, rP = 4.1; for (const t of [-1, 1]) { b.tri(L(lx + t * 1.6, ly0 + 0.7, hP), L(lx + t * 1.6, yP - 0.7, hP), L(lx, yP - 0.7, rP), CONIFER); b.tri(L(lx + t * 1.6, ly0 + 0.7, hP), L(lx, yP - 0.7, rP), L(lx, ly0 + 0.7, rP), CONIFER); b.beam(L(lx + t * 1.6, yP - 0.7, hP), L(lx, yP - 0.7, rP), 0.1, GOLD, 0.12); }
    b.tri(L(lx - 1.5, yP - 0.68, hP), L(lx + 1.5, yP - 0.68, hP), L(lx, yP - 0.68, rP - 0.05), WOODL); bxL(b, L, r, lx, yP - 0.7, hP - 0.45, 2.8, 0.42, 0.08, GOLD); }   // вывеска «Тоня»
}
function win(gw, b, L, o, a, ly, h, w, hh, axis, s) {     // окно с резным наличником и «кокошником»
  if (axis === 'y') { const y = ly + s * 0.06; bxL(gw, L, o, a, y, h, w, hh, 0.06, GLASS); bxL(b, L, o, a, y + s * 0.03, h - 0.12, w + 0.4, 0.12, 0.08, WOODL); for (const t of [-1, 1]) bxL(b, L, o, a + t * (w / 2 + 0.1), y + s * 0.03, h, 0.14, hh, 0.08, WOODL);
    b.tri(L(a - w / 2 - 0.22, y + s * 0.05, h + hh), L(a + w / 2 + 0.22, y + s * 0.05, h + hh), L(a, y + s * 0.05, h + hh + 0.42), GOLD); }
  else { const x = a + s * 0.06; bxL(gw, L, o, x, ly, h, 0.06, hh, w, GLASS); bxL(b, L, o, x + s * 0.03, ly, h - 0.12, 0.08, 0.12, w + 0.4, WOODL); for (const t of [-1, 1]) bxL(b, L, o, x + s * 0.03, ly + t * (w / 2 + 0.1), h, 0.08, hh, 0.14, WOODL);
    b.tri(L(x + s * 0.05, ly - w / 2 - 0.22, h + hh), L(x + s * 0.05, ly + w / 2 + 0.22, h + hh), L(x + s * 0.05, ly, h + hh + 0.42), GOLD); }
}
function yard(b, r, y0) {
  const L = frame(r, y0), hd = r.d / 2, yd = r.yard.d, hw = r.w / 2;
  bxL(b, L, r, 0, hd + yd / 2, -0.25, r.w, 0.32, yd, ASPH);
  for (const s of [-1, 1]) b.beam(L(s * hw, hd + 0.4, 0), L(s * hw, hd + yd, 0), 0.06, WOODD, 1.6);
  b.beam(L(-hw, hd + yd, 0.8), L(hw - 6, hd + yd, 0.8), 0.06, WOODD, 1.6);
  bxL(b, L, r, hw - 2.5, hd + yd - 1.6, 0, 3.6, 1.7, 2.2, WOOD); bxL(b, L, r, hw - 2.5, hd + yd - 1.6, 1.7, 4.0, 0.12, 2.6, CONIFER);
}

Park3D.prototype.buildInfra = function (b) {
  const I = this.M.infra; if (!I) return;
  const gw = new Builder(), gY = (x, z) => this.gY(x, z);
  const baseY = (o, pad) => { const c = Math.cos(o.rot), s = Math.sin(o.rot); let m = -1e9; for (const [lx, ly] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const x = o.x + lx * o.w / 2 * c - ly * o.d / 2 * s, z = o.y + lx * o.w / 2 * s + ly * o.d / 2 * c; m = Math.max(m, gY(x, z)); } return m + (pad || 0.05); };
  this.walkObstacles = this.walkObstacles || []; this.walkPlatforms = this.walkPlatforms || [];
  for (const o of I.wc) { const y0 = baseY(o, 0.08); wcPavilion(b, o, o, y0); this.walkObstacles.push({ x: o.x, y: o.y, w: o.w + 0.7, d: o.d + 0.7, rot: o.rot }); o._y0 = y0; }
  const r = I.rest, ry0 = baseY(r, 0.05); r._y0 = ry0; restaurant(b, gw, r, ry0); yard(b, r, ry0);
  { const c = Math.cos(r.rot), s = Math.sin(r.rot); this.walkObstacles.push({ x: r.x, y: r.y, w: r.w + 0.9, d: r.d + 0.9, rot: r.rot });
    const ty = -r.d / 2 - r.terrace.d / 2; this.walkPlatforms.push({ x: r.x - ty * s, y: r.y + ty * c, w: r.w + 1.2, d: r.terrace.d, rot: r.rot, h: ry0 + 0.55 }); }
  // окна: отдельная сетка, вечером светятся тёплым
  this.infraWin = new T.Mesh(gw.build(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.2, emissive: 0xffb760, emissiveIntensity: 0 }));
  this.infraWin.castShadow = false; this.infraWin.frustumCulled = false; this.scene.add(this.infraWin);
  // проезд и подходы
  const asph = new T.MeshStandardMaterial({ color: 0x5f6266, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pav = new T.MeshStandardMaterial({ color: 0xb7aa92, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  this.infraFlat = [];
  const rib = (pts, w, mat) => { const g = P3.ribbon(P3.resample(pts, 1.5, false), w, (x, z) => this.gY(x, z) + 0.12, false); const m = new T.Mesh(g, mat); m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m); this.infraFlat.push(m); };
  rib(r.drive, r.drive_w, asph); rib(r.approach, 2.6, pav);
  for (const o of I.wc) if (o.front && o.link && Math.hypot(o.link[0] - o.front[0], o.link[1] - o.front[1]) > 1) rib([o.front, o.link], 2.2, pav);
};
// подключаем к общей сборке построек и меток
const _bns = Park3D.prototype.buildNorthStructures;
Park3D.prototype.buildNorthStructures = function (b) { if (_bns) _bns.call(this, b); this.buildInfra(b); };
const _npoi = Park3D.prototype.northPOIs;
Park3D.prototype.northPOIs = function (P) {
  if (_npoi) _npoi.call(this, P); const I = this.M.infra; if (!I) return; const gY = (x, z) => this.gY(x, z);
  const r = I.rest;
  P.push({ id: 'rest', title: 'Ресторан «Тоня»', x: r.x, z: r.y, y: gY(r.x, r.y) + 13, from: 5, kind: 'poi', text: 'Дом-кошель 26 × 15 м с мансардой и летней террасой к пруду: 80 мест в зале, 36 в мансарде, 56 на террасе. Поморская кухня: треска, палтус, рыбники, шаньги, морошка. В мансарде мастер-классы по росписи козуль.' });
  for (const o of I.wc) P.push({ id: o.key, title: 'Туалет · ' + o.title.split(' · ')[1], x: o.x, z: o.y, y: gY(o.x, o.y) + 8, from: 5, kind: 'poi', wc: true, text: o.story + ' Внутри четыре тёплые кабины, одна универсальная (для маломобильных, с пеленальным столом).' });
};
const _apply = Park3D.prototype.applyState;
Park3D.prototype.applyState = function (force) {
  _apply.call(this, force);
  const on = this.structures ? this.structures.visible : true;
  if (this.infraWin) { this.infraWin.visible = on; this.infraWin.material.emissiveIntensity = this.env.tod === 1 ? 1.6 : 0; }
  if (this.infraFlat) for (const m of this.infraFlat) m.visible = on && this.show.paths;
};
const _env = Park3D.prototype.applyEnv;
Park3D.prototype.applyEnv = function () { _env.call(this); if (this.infraWin) this.infraWin.material.emissiveIntensity = this.env.tod === 1 ? 1.6 : 0; };
})(window);
