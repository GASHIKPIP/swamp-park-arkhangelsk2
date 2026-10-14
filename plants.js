/* Каталог растений проекта: данные и 3D-просмотр одного растения (WebGL), с запасным изображением. */
(function (global) {
'use strict';
const PLANTS = [
  // ---- деревья
  { id: 'b', g: 'Деревья', name: 'Берёза повислая и пушистая', lat: 'Betula pendula, B. pubescens', h: '9–10 м', zone: '1–2', role: 'Основа посадок: у воды, вдоль троп, на полянах.', why: 'Местный вид, выдерживает морозы ниже −45 °C и переувлажнение.', season: 'Золотая осень, белые стволы зимой.', model: 'tree', code: 'b' },
  { id: 'a', g: 'Деревья', name: 'Ольха серая', lat: 'Alnus incana', h: '8–9 м', zone: '1', role: 'Береговые группы у обоих прудов.', why: 'Растёт на сырых торфяных почвах, корнями закрепляет откосы, обогащает почву азотом.', season: 'Ранние серёжки в апреле, листва держится до заморозков.', model: 'tree', code: 'a' },
  { id: 'w', g: 'Деревья', name: 'Ива козья и пятитычинковая', lat: 'Salix caprea, S. pentandra', h: '7–8 м', zone: '1–2', role: 'Мокрые низины и берег у каскада.', why: 'Выносливые северные ивы, первый весенний медонос для пчёл и шмелей.', season: 'Пушистые серёжки в конце апреля, блестящая листва летом.', model: 'tree', code: 'w' },
  { id: 'j', g: 'Деревья', name: 'Яблоня ягодная', lat: 'Malus baccata', h: '5–6 м', zone: '2', role: 'Входная аллея и площадь у главного входа.', why: 'Самая зимостойкая яблоня, заменяет липу. Мелкие плоды держатся зимой и кормят птиц.', season: 'Белое цветение в июне, красные плоды до снега.', model: 'tree', code: 'j' },
  { id: 'h', g: 'Деревья', name: 'Черёмуха обыкновенная', lat: 'Prunus padus', h: '6–7 м', zone: '1', role: 'Опушки, тихая зона, вдоль южной тропы.', why: 'Местный вид, заменяет клён. Растёт в тени и на влажных почвах.', season: 'Душистое цветение в начале июня, тёмные ягоды для птиц.', model: 'tree', code: 'h' },
  { id: 'k', g: 'Деревья', name: 'Сосна кедровая сибирская', lat: 'Pinus sibirica', h: '5–6 м за 10 лет', zone: '1', role: 'Культурная зона, холм с башней, у «Поморской ладьи».', why: 'Заменяет дуб: вечнозелёная, долговечная, переносит северные зимы. Растёт медленно, орехи через 25–30 лет.', season: 'Тёмная хвоя круглый год.', model: 'tree', code: 'k' },
  { id: 's', g: 'Деревья', name: 'Ель европейская и сибирская', lat: 'Picea abies, P. obovata', h: '7–8 м', zone: '1', role: 'Берма вдоль проспекта, ветрозащита северной стороны.', why: 'Гасит шум и ветер, задерживает снег, зелёная зимой.', season: 'Зелёная стена и снежные лапы зимой.', model: 'tree', code: 's' },
  { id: 'p', g: 'Деревья', name: 'Сосна обыкновенная', lat: 'Pinus sylvestris', h: '9–10 м', zone: '1', role: 'Сухие повышения, холм, берма.', why: 'Местный вид, растёт на бедных и песчаных почвах насыпей.', season: 'Медные стволы, хвоя круглый год.', model: 'tree', code: 'p' },
  { id: 'l', g: 'Деревья', name: 'Лиственница сибирская', lat: 'Larix sibirica', h: '10–11 м', zone: '1', role: 'Акценты у башни и вдоль культурной аллеи.', why: 'Одно из самых морозостойких деревьев, древесина для настилов того же вида.', season: 'Ярко-жёлтая осень, зимой сбрасывает хвою.', model: 'tree', code: 'l' },
  { id: 'r', g: 'Деревья', name: 'Рябина обыкновенная', lat: 'Sorbus aucuparia', h: '5–6 м', zone: '1', role: 'Детская зона, опушки, у галерей.', why: 'Местный вид, ягоды держатся до зимы и привлекают свиристелей и дроздов.', season: 'Белое цветение, красные ягоды и багряная листва осенью.', model: 'tree', code: 'r' },
  // ---- стланики и кустарники
  { id: 'n', g: 'Стланики и кустарники', name: 'Берёза карликовая (ерник)', lat: 'Betula nana', h: '0,5–0,8 м, стелется до 2 м', zone: '1', role: 'Группы на берме, склонах холма и у станции «Следы леса».', why: 'Тундровая берёза растёт горизонтально, низкие плети прячутся под снег и не ломаются.', season: 'Мелкие круглые листья летом, ярко-красная осень.', model: 'dwarf' },
  { id: 'c', g: 'Стланики и кустарники', name: 'Стланиковая берёза пушистая', lat: 'Betula pubescens subsp. czerepanovii', h: 'ствол стелется 3–6 м, высота 1–1,5 м', zone: '1', role: 'Одиночные скульптурные деревья у воды, фигур и станции.', why: 'Северная горная форма берёзы с лежачими изогнутыми стволами. Формируется при посадке.', season: 'Белые извилистые стволы особенно видны зимой.', model: 'creep' },
  { id: 'cornus', g: 'Стланики и кустарники', name: 'Дёрен белый', lat: 'Cornus alba', h: '2–2,5 м', zone: '1', role: 'Живая изгородь 420 м и куртины у дорожек.', why: 'Выдерживает −40 °C, переносит подтопление.', season: 'Красные побеги зимой на снегу.', model: 'shrub', col: [0.24, 0.42, 0.18], aut: [0.62, 0.20, 0.18], stems: [0.62, 0.12, 0.10] },
  { id: 'spiraea', g: 'Стланики и кустарники', name: 'Спирея иволистная', lat: 'Spiraea salicifolia', h: '1,2–1,5 м', zone: '1', role: 'Куртины вдоль аллей и у площадок.', why: 'Местный вид, нетребовательна к почвам.', season: 'Розовые метёлки в июле.', model: 'shrub', col: [0.30, 0.46, 0.18], aut: [0.72, 0.52, 0.18], flowers: [0.92, 0.55, 0.72] },
  { id: 'rosa', g: 'Стланики и кустарники', name: 'Шиповник иглистый', lat: 'Rosa acicularis', h: '1–1,5 м', zone: '1', role: 'Солнечные опушки и колючий барьер у служебной зоны.', why: 'Самый северный шиповник, местный вид.', season: 'Розовые цветы в июне, красные плоды осенью.', model: 'shrub', col: [0.27, 0.44, 0.17], aut: [0.75, 0.30, 0.14], flowers: [0.95, 0.50, 0.62] },
  { id: 'juniper', g: 'Стланики и кустарники', name: 'Можжевельник обыкновенный', lat: 'Juniperus communis', h: '1,5–3 м', zone: '1', role: 'Склоны холма, у фигур «Северных историй».', why: 'Вечнозелёный, переносит ветер и бедные почвы.', season: 'Сизая хвоя круглый год, тёмные шишкоягоды.', model: 'juniper' },
  // ---- прибрежные и водные
  { id: 'phr', g: 'Прибрежные и водные', name: 'Тростник обыкновенный', lat: 'Phragmites australis', h: '2–2,5 м', zone: '1', role: 'Литораль: пояс на шельфе 0,45 м.', why: 'Очищает воду, укрепляет берег, укрытие для птиц. Не скашивается на зиму.', season: 'Золотистые метёлки осенью и зимой.', model: 'reed' },
  { id: 'typha', g: 'Прибрежные и водные', name: 'Рогоз широколистный', lat: 'Typha latifolia', h: '1,5–2 м', zone: '1', role: 'Группы на мелководье у настилов.', why: 'Быстро разрастается на мелководье и забирает из воды биогенные вещества.', season: 'Бархатные коричневые початки с июля до весны.', model: 'typha' },
  { id: 'caltha', g: 'Прибрежные и водные', name: 'Калужница болотная', lat: 'Caltha palustris', h: '0,3–0,4 м', zone: '1', role: 'Урез воды у каскада и прибрежная полоса.', why: 'Местный вид болот, цветёт одним из первых.', season: 'Жёлтые цветы в мае–июне.', model: 'caltha' },
  { id: 'iris', g: 'Прибрежные и водные', name: 'Ирис аировидный', lat: 'Iris pseudacorus', h: '0,8–1 м', zone: '3', role: 'Защищённые заливы у павильона и входной площади.', why: 'Самый крайний для Архангельска вид в списке, сажается только в тёплых местах у воды.', season: 'Крупные жёлтые цветы в конце июня.', model: 'iris' },
  { id: 'nymph', g: 'Прибрежные и водные', name: 'Кувшинка четырёхгранная и кубышка жёлтая', lat: 'Nymphaea tetragona, Nuphar lutea', h: 'листья на воде', zone: '1', role: 'Глубокая вода 0,8–1,5 м, около 400 растений.', why: 'Северная кувшинка и местная кубышка зимуют подо льдом в донном иле.', season: 'Цветение в июле–августе.', model: 'lily' },
  { id: 'meadow', g: 'Прибрежные и водные', name: 'Северный луг', lat: 'Chamaenerion, Achillea, Trifolium, Geranium, Campanula', h: '0,4–1,2 м', zone: '1', role: 'Луга 3,8 га вместо газона на большей части суши.', why: 'Местное разнотравье, косится 1–2 раза в лето, кормит опылителей.', season: 'Иван-чай в июле, герань и колокольчики в июне.', model: 'meadow' },
];

class PlantViewer {
  constructor(el) {
    this.el = el; this.season = 0; this.ok = false;
    try {
      const T = global.THREE; if (!T) throw new Error('no three');
      const R = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      R.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2)); R.outputColorSpace = T.SRGBColorSpace; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
      R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
      R.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab'; el.appendChild(R.domElement);
      this.scene = new T.Scene(); this.camera = new T.PerspectiveCamera(32, 1, 0.1, 400);
      this.controls = new T.OrbitControls(this.camera, R.domElement); this.controls.enableDamping = true; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 1.2; this.controls.enablePan = false; this.controls.maxPolarAngle = 1.5;
      this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });
      const sun = this.sun = new T.DirectionalLight(0xfff1dc, 2.6); sun.position.set(12, 18, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); const sc = sun.shadow.camera; sc.left = sc.bottom = -8; sc.right = sc.top = 8; sc.near = 1; sc.far = 60; this.scene.add(sun);
      this.hemi = new T.HemisphereLight(0xc9dcf5, 0x5d6b4a, 1.15); this.scene.add(this.hemi);
      this.ground = new T.Mesh(new T.CircleGeometry(7, 48), new T.MeshStandardMaterial({ color: 0x6f8a4c, roughness: 1 })); this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; this.scene.add(this.ground);
      this.water = new T.Mesh(new T.CircleGeometry(4.2, 48), new T.MeshStandardMaterial({ color: 0x2d5a6a, roughness: 0.15, metalness: 0.1 })); this.water.rotation.x = -Math.PI / 2; this.water.position.y = 0.02; this.water.visible = false; this.scene.add(this.water);
      this.group = new T.Group(); this.scene.add(this.group);
      new ResizeObserver(() => this.resize()).observe(el); this.resize();
      const loop = () => { requestAnimationFrame(loop); if (!this.visible) return; this.controls.update(); R.render(this.scene, this.camera); };
      this.visible = true; requestAnimationFrame(loop);
      this.ok = true;
    } catch (e) { this.ok = false; }
  }
  resize() { if (!this.ok && !this.renderer) return; const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  setSeason(s) { this.season = s; if (this.cur) this.show(this.cur); }
  show(p) {
    if (!this.ok) return; this.cur = p; const T = global.THREE, P3 = global.P3, g = this.group, s = this.season, win = s === 2, aut = s === 1;
    while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); }
    this.scene.background = new T.Color(win ? 0xdfe6ee : aut ? 0xd9d2bd : 0xcfe0ef);
    this.ground.material.color.set(win ? 0xeef2f6 : aut ? 0x8a7d4a : 0x6f8a4c); this.water.visible = false;
    const mat = (c) => new T.MeshStandardMaterial({ color: new T.Color(c[0], c[1], c[2]), roughness: 0.9, flatShading: true });
    const vmat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const add = (geo, m, sc, pos) => { const me = new T.Mesh(geo, m); me.castShadow = me.receiveShadow = true; if (sc) me.scale.setScalar(sc); if (pos) me.position.set(pos[0], pos[1], pos[2]); g.add(me); return me; };
    let H = 3;
    if (p.model === 'tree') {
      const sp = P3.SP[p.code], geo = P3.treeGeos(p.code, 11), h = sp.h10; H = h;
      add(geo.trunk, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, color: new T.Color(win ? 0.7 : 1, win ? 0.7 : 1, win ? 0.7 : 1) }), h);
      const conif = sp.kind === 'spruce' || sp.kind === 'pine';
      if (!(win && !conif)) { let c = aut ? sp.aut : sp.col; if (win) c = [c[0] * 0.8 + 0.15, c[1] * 0.8 + 0.18, c[2] * 0.8 + 0.18]; add(geo.crown, mat(c), h); }
      if ((p.code === 'r' || p.code === 'j') && !win) { const b = new P3.Builder(), rg = P3.rng32(5); for (let i = 0; i < 40; i++) { const a = rg() * 6.28, r = sp.cr * h * (0.6 + 0.35 * rg()); b.ell(Math.cos(a) * r, h * (0.55 + 0.25 * rg()), Math.sin(a) * r, 0.07, 0.07, 0.07, aut || p.code === 'r' ? [0.85, 0.18, 0.1] : [0.98, 0.95, 0.95]); } add(b.build(), vmat); }
    } else if (p.model === 'dwarf') {
      H = 1.2; const b = new P3.Builder(), rg = P3.rng32(9);
      for (let i = 0; i < 9; i++) { const a = rg() * 6.28, r = Math.sqrt(rg()) * 2.2; b.ell(Math.cos(a) * r, 0.25, Math.sin(a) * r, 0.8 + 0.4 * rg(), 0.3 + 0.2 * rg() * (win ? 0.4 : 1), 0.7 + 0.3 * rg(), [1, 1, 1]); for (let j = 0; j < 2; j++) { const q = rg() * 6.28; b.beam([Math.cos(a) * r, 0.05, Math.sin(a) * r], [Math.cos(a) * r + Math.cos(q), 0.15, Math.sin(a) * r + Math.sin(q)], 0.04, [0.4, 0.25, 0.18]); } }
      const geo = P3.jitterGeo(b.build(), 0.12, 3); add(geo, mat(win ? [0.86, 0.88, 0.9] : aut ? [0.85, 0.28, 0.1] : [0.30, 0.46, 0.16]));
    } else if (p.model === 'creep') {
      H = 2; const tb = new P3.Builder(), cb = new P3.Builder(), L = 5.5; let prev = [-L / 2, 0, 0];
      for (let k = 1; k <= 7; k++) { const t = k / 7, pnt = [-L / 2 + L * t, 0.25 + 0.5 * Math.sin(t * 2.4), Math.sin(t * Math.PI) * 0.7]; tb.beam(prev, pnt, 0.18 - 0.015 * k, [0.92, 0.91, 0.86]); prev = pnt; if (k % 2 === 0) tb.beam(pnt, [pnt[0] + 0.2, pnt[1] + 1.0, pnt[2] - 0.2], 0.06, [0.92, 0.91, 0.86]); cb.ell(pnt[0], pnt[1] + 0.6, pnt[2], 1.0, 0.45, 0.85, [1, 1, 1]); }
      add(tb.build(), vmat); if (!win) add(P3.jitterGeo(cb.build(), 0.15, 4), mat(aut ? [0.86, 0.66, 0.18] : [0.36, 0.52, 0.18]));
    } else if (p.model === 'shrub' || p.model === 'juniper') {
      H = p.model === 'juniper' ? 2.6 : 2; const b = new P3.Builder(), rg = P3.rng32(p.id.length * 7);
      if (p.model === 'juniper') { for (let i = 0; i < 6; i++) { const a = i * 1.1, r = i ? 0.55 : 0, hh = 1.4 + rg() * 1.2; b.cone(Math.cos(a) * r, hh / 2, Math.sin(a) * r, 0.32 + rg() * 0.15, hh, [1, 1, 1], 8, 0); } add(P3.jitterGeo(b.build(), 0.1, 6), mat(win ? [0.32, 0.42, 0.40] : [0.20, 0.36, 0.30])); }
      else {
        for (let i = 0; i < 7; i++) { const a = rg() * 6.28, r = rg() * 0.9; b.ell(Math.cos(a) * r, 0.8 + rg() * 0.4, Math.sin(a) * r, 0.7, 0.6, 0.7, [1, 1, 1]); }
        if (!win) add(P3.jitterGeo(b.build(), 0.12, 7), mat(aut ? p.aut : p.col));
        const sb = new P3.Builder(); for (let i = 0; i < 14; i++) { const a = rg() * 6.28; sb.beam([Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a) * 1.1, 1.6 + rg() * 0.5, Math.sin(a) * 1.1], 0.04, p.stems || [0.40, 0.30, 0.22]); }
        if (p.flowers && s === 0) for (let i = 0; i < 26; i++) { const a = rg() * 6.28, r = 0.4 + rg() * 0.7; sb.ell(Math.cos(a) * r, 1.1 + rg() * 0.5, Math.sin(a) * r, 0.1, 0.1, 0.1, p.flowers); }
        if (p.id === 'rosa' && aut) for (let i = 0; i < 20; i++) { const a = rg() * 6.28, r = 0.4 + rg() * 0.7; sb.ell(Math.cos(a) * r, 1.0 + rg() * 0.5, Math.sin(a) * r, 0.08, 0.1, 0.08, [0.8, 0.15, 0.1]); }
        add(sb.build(), vmat);
      }
    } else if (p.model === 'reed' || p.model === 'typha' || p.model === 'iris' || p.model === 'caltha' || p.model === 'lily') {
      this.water.visible = true; this.water.material.color.set(win ? 0xcfdbe4 : 0x2d5a6a); H = p.model === 'lily' ? 0.6 : 2.2;
      const b = new P3.Builder(), rg = P3.rng32(p.model.length * 13);
      if (p.model === 'lily') { for (let i = 0; i < 12; i++) { const a = rg() * 6.28, r = rg() * 3; b.cyl(Math.cos(a) * r, 0.05, Math.sin(a) * r, 0.25 + rg() * 0.15, 0.02, win ? [0.85, 0.9, 0.95] : [0.16, 0.36, 0.12]); if (!win && i % 3 === 0) b.ell(Math.cos(a) * r, 0.1, Math.sin(a) * r, 0.09, 0.07, 0.09, i % 2 ? [0.97, 0.95, 0.92] : [0.95, 0.8, 0.15]); } }
      else if (p.model === 'caltha') { for (let i = 0; i < 9; i++) { const a = rg() * 6.28, r = rg() * 1.4; b.ell(Math.cos(a) * r, 0.15, Math.sin(a) * r, 0.3, 0.15, 0.3, [0.2, 0.42, 0.14]); if (s === 0) for (let j = 0; j < 3; j++) b.ell(Math.cos(a) * r + (rg() - 0.5) * 0.4, 0.32, Math.sin(a) * r + (rg() - 0.5) * 0.4, 0.06, 0.03, 0.06, [0.98, 0.82, 0.12]); } }
      else { const n = p.model === 'iris' ? 40 : 60;
        for (let i = 0; i < n; i++) { const a = rg() * 6.28, r = Math.sqrt(rg()) * 1.6, hh = (p.model === 'iris' ? 0.9 : p.model === 'typha' ? 1.8 : 2.3) * (0.7 + 0.4 * rg()), tx = (rg() - 0.5) * 0.4, tz = (rg() - 0.5) * 0.4;
          const col = win || aut ? [0.72, 0.62, 0.36] : [0.34, 0.52, 0.18];
          b.beam([Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a) * r + tx, hh, Math.sin(a) * r + tz], p.model === 'phr' ? 0.03 : 0.05, col, 0.012);
          if (p.model === 'typha' && i % 4 === 0) b.cyl(Math.cos(a) * r + tx * 0.9, hh * 0.85, Math.sin(a) * r + tz * 0.9, 0.06, 0.3, [0.35, 0.2, 0.1]);
          if (p.model === 'reed' && i % 3 === 0) b.ell(Math.cos(a) * r + tx, hh + 0.1, Math.sin(a) * r + tz, 0.08, 0.22, 0.08, aut || win ? [0.82, 0.72, 0.5] : [0.5, 0.38, 0.32]);
          if (p.model === 'iris' && i % 6 === 0 && s === 0) b.ell(Math.cos(a) * r + tx, hh + 0.05, Math.sin(a) * r + tz, 0.1, 0.08, 0.1, [0.98, 0.85, 0.12]); } }
      add(b.build(), vmat);
    } else if (p.model === 'meadow') {
      H = 1; const b = new P3.Builder(), rg = P3.rng32(31), pal = [[0.85, 0.4, 0.7], [0.97, 0.97, 0.94], [0.55, 0.45, 0.88], [0.92, 0.82, 0.2], [0.6, 0.38, 0.85]];
      for (let i = 0; i < 260; i++) { const a = rg() * 6.28, r = Math.sqrt(rg()) * 4.5, hh = 0.3 + rg() * 0.8; b.beam([Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a) * r + (rg() - 0.5) * 0.2, hh, Math.sin(a) * r + (rg() - 0.5) * 0.2], 0.02, win ? [0.8, 0.75, 0.6] : aut ? [0.62, 0.55, 0.28] : [0.32, 0.5, 0.18]); if (s === 0 && i % 2) b.ell(Math.cos(a) * r, hh, Math.sin(a) * r, 0.05, i % 9 === 0 ? 0.18 : 0.05, 0.05, pal[i % 5]); }
      add(b.build(), vmat);
    }
    const D0 = { dwarf: 9, creep: 10.5, shrub: 6.5, juniper: 7.5, reed: 7, typha: 7, iris: 6.5, caltha: 6, lily: 8.5, meadow: 9.5 };
    const d = p.model === 'tree' ? Math.max(4.5, H * 1.6 + 3, P3.SP[p.code].cr * H * 3.3) : D0[p.model] || 7;
    this.controls.target.set(0, H * 0.45, 0); this.camera.position.set(d * 0.75, H * 0.6 + 1.2, d * 0.75); this.controls.update();
  }
}
global.PLANTS = PLANTS; global.PlantViewer = PlantViewer;
})(window);
