/* JED-style jersey palette editor for NHL 94 PC and NHL 95 PC (HOMEPALS.BIN / AWAYPALS.BIN). Format: lib/pc-jersey.js.
 * Preview: the Studio's PC sprite decoder (lib/pc95.js openSpriteBundle), coloured with J.spritePalette: the same
 * createPal merge EA-NHL-Tools binToAct writes for PPV-To-BMP (rinkpalShadowfixed + team colours through the record's
 * map, createjerseyShadowfixed 0..143 and 251..255). Export .ACT writes exactly that palette. */
(function () {
  'use strict';
  const J = NhlPcJersey;
  const $ = (id) => document.getElementById(id);
  const S = {
    game: null, // '94' | '95'
    files: { home: null, away: null }, // { file, original: Uint8Array, name }
    side: 'home', team: 0, color: 0,
    sprites: null, rink: null, base: null, frame: 0, frames: [], spriteNote: '',
    history: { undo: [], redo: [] }, hover: null,
    sources: null // { kind: 'local', map } | { kind: 'server', id }
  };
  const SIDE_FILE = { home: 'HOMEPALS.BIN', away: 'AWAYPALS.BIN' };

  function status(text, error) { const p = $('jed-status'); p.textContent = text; p.classList.toggle('error', Boolean(error)); }
  function cur() { return S.files[S.side]; }
  function rgb8(c) { return 'rgb(' + J.to8(c[0]) + ',' + J.to8(c[1]) + ',' + J.to8(c[2]) + ')'; }
  function hex8(c) { return '#' + c.map((v) => J.to8(v).toString(16).padStart(2, '0')).join(''); }
  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function teamCode() { return (S.files.home || S.files.away).file.teams[S.team].code.toUpperCase(); }

  // ---- loading -------------------------------------------------------------------------------------------------
  function setPalFile(side, bytes, name) {
    const file = J.openFile(bytes, side);
    const other = S.files[side === 'home' ? 'away' : 'home'];
    if (other && other.file.game !== file.game) throw new Error(name + ' is NHL ' + file.game + ' PC but the other side is NHL ' + other.file.game + ' PC');
    S.files[side] = { file, original: new Uint8Array(bytes), name };
    S.game = file.game;
  }
  function sideOf(name) {
    const base = name.split('/').pop();
    if (/^homepals\.(bin|o9\d)$/i.test(base)) return 'home';
    if (/^awaypals\.(bin|o9\d)$/i.test(base)) return 'away';
    return null;
  }

  async function loadLocal(entries) {
    S.files = { home: null, away: null }; S.sprites = null; S.rink = null; S.side = 'home'; S.color = 0;
    const map = new Map(entries.map((e) => [e.rel, e.bytes]));
    for (const e of entries) {
      const side = sideOf(e.rel);
      if (side && /\.bin$/i.test(e.rel)) setPalFile(side, e.bytes, e.rel.split('/').pop());
    }
    for (const e of entries) { // originals (JED's .O95) only when there is no .BIN
      const side = sideOf(e.rel);
      if (side && !S.files[side]) setPalFile(side, e.bytes, e.rel.split('/').pop());
    }
    if (!S.files.home && !S.files.away) throw new Error('No HOMEPALS.BIN or AWAYPALS.BIN in what you opened');
    const paths = [...map.keys()];
    const catalog = Nhl95Pc.catalogFromPaths(paths, (rel) => map.get(rel));
    const parts = catalog.spriteFiles.map((rel) => ({ name: rel, data: map.get(rel) })).filter((p) => p.data);
    S.rink = catalog.rinkFile ? rinkPalette(map.get(catalog.rinkFile)) : null;
    S.sprites = parts.length ? Nhl95Pc.openSpriteBundle(Nhl95Pc.encodeBundle(parts), gameId()) : null;
    S.spriteNote = S.sprites ? parts.length + ' sprite sheet(s)' : 'No PPV sprite sheets loaded — open the game folder for a preview';
    afterLoad();
  }

  async function fetchBytes(url) {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  async function loadServer(id) {
    status('Loading ' + id + ' from the server…');
    S.files = { home: null, away: null }; S.sprites = null; S.rink = null; S.side = 'home'; S.color = 0;
    for (const side of ['home', 'away']) {
      const bytes = await fetchBytes('api/games/' + id + '/file?path=' + SIDE_FILE[side]);
      if (bytes) setPalFile(side, bytes, SIDE_FILE[side]);
    }
    if (!S.files.home && !S.files.away) throw new Error('The server has no HOMEPALS.BIN / AWAYPALS.BIN for ' + id);
    for (const name of ['RINKPAL.QPP', 'RINKPAL.QFS', 'RINKPAL.ACT', 'rinkpal.act']) {
      const bytes = await fetchBytes('api/games/' + id + '/file?path=' + name);
      if (bytes) { S.rink = rinkPalette(bytes); if (S.rink) break; }
    }
    const bundle = await fetchBytes('api/games/' + id + '/sprites?bank=sprites');
    S.sprites = bundle ? Nhl95Pc.openSpriteBundle(bundle, id) : null;
    S.spriteNote = S.sprites ? 'sprites from the server (' + id + ')' : 'The server has no sprites for ' + id;
    afterLoad();
  }

  /** Rink palette for the preview. NHL 94 PC RINKPAL.QPP unpacks (RefPack 30 FB) to a small directory: u32 size,
   *  u16 count, count 4-char names (!bck !err !pal), count u32 offsets from the end of the table; !pal is an EA
   *  palette (16-byte header, 6-bit RGB). Anything else goes through the Studio's own palette readers. */
  function rinkPalette(bytes) {
    if (!bytes) return null;
    try {
      const d = Nhl95Pc.decompressEaContainer(bytes);
      if (d && d.length > 6) {
        const count = d[4] | (d[5] << 8);
        const base = 6 + count * 8;
        for (let i = 0; i < count && base < d.length; i++) {
          if (String.fromCharCode(d[6 + i * 4], d[7 + i * 4], d[8 + i * 4], d[9 + i * 4]) !== '!pal') continue;
          const o = 6 + count * 4 + i * 4;
          const at = base + (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16));
          const pal = at < d.length ? Nhl95Pc.decodeEaPalette(d.subarray(at)) : null;
          if (pal) return pal;
        }
      }
    } catch (err) { /* fall through */ }
    return Nhl95Pc.paletteFrom(bytes) || Nhl95Pc.decodeRinkFile(bytes);
  }

  function gameId() { return S.game === '94' ? 'nhl94pc' : 'nhl95pc'; }

  function afterLoad() {
    if (!S.files[S.side]) S.side = S.files.home ? 'home' : 'away';
    S.team = Math.min(S.team, J.teamCount(cur().file) - 1);
    S.frames = [];
    if (S.sprites) for (let n = 1; n <= S.sprites.numFrames; n++) S.frames.push(n);
    const sides = ['home', 'away'].filter((s) => S.files[s]).map((s) => S.files[s].name).join(' + ');
    status('NHL ' + S.game + ' PC · ' + sides + ' · ' + J.teamCount(cur().file) + ' teams × 448 bytes');
    S.frame = defaultFrame();
    resetHistory();
    buildStrip();
    renderAll();
  }

  // ---- undo / redo: whole-file snapshots of the side being edited (a 12 KB copy each) ----------------------------
  const UNDO_MAX = 200;
  let lastKey = null, lastAt = 0;
  /** Call before any change. `key` coalesces a run of the same edit (slider drags) into one undo step. */
  function remember(key) {
    const now = Date.now();
    if (key && key === lastKey && now - lastAt < 1500) { lastAt = now; return; }
    lastKey = key || null; lastAt = now;
    S.history.undo.push({ side: S.side, team: S.team, bytes: new Uint8Array(cur().file.bytes) });
    if (S.history.undo.length > UNDO_MAX) S.history.undo.shift();
    S.history.redo = [];
    renderUndo();
  }
  function swap(from, to) {
    const step = from.pop(); if (!step) return;
    const f = S.files[step.side]; if (!f) return;
    to.push({ side: step.side, team: step.team, bytes: new Uint8Array(f.file.bytes) });
    f.file.bytes.set(step.bytes);
    S.side = step.side; S.team = step.team; lastKey = null;
    renderAll(); renderUndo();
  }
  function undo() { swap(S.history.undo, S.history.redo); }
  function redo() { swap(S.history.redo, S.history.undo); }
  function renderUndo() {
    $('jed-undo').disabled = !S.history.undo.length; $('jed-redo').disabled = !S.history.redo.length;
    $('jed-undo').title = 'Undo the last edit (Ctrl+Z) · ' + S.history.undo.length + ' step(s)';
  }
  function resetHistory() { S.history = { undo: [], redo: [] }; lastKey = null; renderUndo(); }
  function sideName() { return S.side === 'home' ? 'homepals' : 'awaypals'; }
  function renderLabels() {
    const n = sideName();
    $('jed-export-file').textContent = 'Export ' + n + '.bin';
    $('jed-export-file').title = 'The whole ' + n.toUpperCase() + '.BIN (every team) with your edits';
    $('jed-import-file-btn').textContent = 'Import ' + n + '.bin';
    $('jed-import-file-btn').title = 'Replace the whole ' + n.toUpperCase() + '.BIN (every team); NHL 94 PC 11,648 or NHL 95 PC 12,544 bytes';
  }

  // ---- editing UI ----------------------------------------------------------------------------------------------
  function renderTeams() {
    const list = $('jed-team-list');
    const teams = cur().file.teams;
    list.innerHTML = '';
    teams.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'item'; item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === S.team));
      item.textContent = (i + 1) + '. ' + t.name;
      item.addEventListener('click', () => { S.team = i; renderAll(); });
      list.appendChild(item);
    });
    const sel = list.children[S.team]; if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    $('jed-home').setAttribute('aria-pressed', String(S.side === 'home'));
    $('jed-away').setAttribute('aria-pressed', String(S.side === 'away'));
    $('jed-home').disabled = !S.files.home; $('jed-away').disabled = !S.files.away;
  }

  function originalColors() {
    const o = J.openFile(cur().original); return J.getColors(o, S.team);
  }

  function renderSwatches() {
    const box = $('jed-swatches'); box.innerHTML = '';
    const colors = J.getColors(cur().file, S.team);
    const orig = originalColors();
    const used = new Set(J.usedColors(cur().file, S.team));
    colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'jed-sw' + (used.has(i) ? '' : ' unused') + (c.join() !== orig[i].join() ? ' edited' : '');
      b.style.background = rgb8(c); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === S.color));
      b.title = 'Colour ' + i + ' (game ' + (128 + i) + '): ' + c.join(', ') + (used.has(i) ? '' : ' — not used by any spot');
      b.addEventListener('click', () => { S.color = i; renderSwatches(); renderColor(); });
      box.appendChild(b);
    });
  }

  function renderColor() {
    const c = J.getColors(cur().file, S.team)[S.color];
    $('jed-big').style.background = rgb8(c);
    $('jed-color-name').textContent = 'Colour ' + S.color + ' · game index ' + (128 + S.color);
    $('jed-hex').textContent = 'VGA ' + c.join(',') + ' · 8-bit ' + hex8(c);
    ['r', 'g', 'b'].forEach((k, i) => { $('jed-' + k).value = c[i]; $('jed-' + k + 'n').value = c[i]; });
    $('jed-picker').value = hex8(c);
  }

  function zoneColor(target, colors) {
    if (target >= 128 && target < 192) return colors[target - 128];
    if (S.base && target < 256) { const k = target * 3; return [S.base.rink[k] / 4, S.base.rink[k + 1] / 4, S.base.rink[k + 2] / 4]; }
    if (S.rink && S.rink[target]) return S.rink[target].map((v) => v / 4);
    return null;
  }
  function zoneButton(z, map, colors) {
    const t = map[z.sprite];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'jed-zone'; b.dataset.sprite = String(z.sprite);
    const sw = document.createElement('i'); const c = zoneColor(t, colors);
    sw.style.background = c ? rgb8(c) : 'repeating-linear-gradient(45deg,#555 0 3px,#333 3px 6px)';
    const label = document.createElement('span'); label.textContent = z.short || z.name;
    const idx = document.createElement('small'); idx.textContent = t >= 128 && t < 192 ? '#' + (t - 128) : 'rink ' + t;
    b.title = z.name + ' · sprite index ' + z.sprite + ' → game palette ' + t;
    b.append(sw, label, idx);
    b.addEventListener('click', () => {
      if ($('jed-paint').checked) { assignSpot(z.sprite); }
      else if (t >= 128 && t < 192) { S.color = t - 128; renderSwatches(); renderColor(); }
    });
    b.addEventListener('mouseenter', () => { if ($('jed-hover-outline').checked) { S.hover = z.sprite; drawOverlay(); } });
    b.addEventListener('mouseleave', () => { if (S.hover === z.sprite) { S.hover = null; drawOverlay(); } });
    return b;
  }
  /** Zones grouped: "waist 2 light/medium/dark" share one row (dark, medium, light); others are single rows. */
  function zoneGroups() {
    const SHADES = ['dark', 'medium', 'light'];
    const groups = []; const byBase = new Map();
    for (const z of J.ZONES) {
      const words = z.name.split(' '); const last = words[words.length - 1];
      const base = SHADES.includes(last) ? words.slice(0, -1).join(' ') : z.name;
      let g = byBase.get(base);
      if (!g) { g = { base, zones: [] }; byBase.set(base, g); groups.push(g); }
      g.zones.push(Object.assign({ short: SHADES.includes(last) ? last : '' }, z));
    }
    for (const g of groups) g.zones.sort((x, y) => SHADES.indexOf(x.short) - SHADES.indexOf(y.short));
    return groups;
  }
  function pixelGrid(box, title, list, cols, map, colors) {
    const h = document.createElement('div'); h.className = 'jed-grid-title'; h.textContent = title; box.appendChild(h);
    const g = document.createElement('div'); g.className = 'jed-pixgrid'; g.style.gridTemplateColumns = 'repeat(' + cols + ', 28px)';
    for (const z of list) g.appendChild(zoneButton(z, map, colors));
    box.appendChild(g);
  }
  function renderZones() {
    const box = $('jed-zones'); box.innerHTML = '';
    const map = J.getMap(cur().file, S.team);
    const colors = J.getColors(cur().file, S.team);
    for (const g of zoneGroups()) {
      if (g.zones.length === 1 && !g.zones[0].short) { box.appendChild(zoneButton(Object.assign({}, g.zones[0], { short: g.base }), map, colors)); continue; }
      const row = document.createElement('div'); row.className = 'jed-zgroup';
      const name = document.createElement('b'); name.textContent = g.base; row.appendChild(name);
      for (const z of g.zones) row.appendChild(zoneButton(Object.assign({}, z, { short: z.short || z.name.slice(g.base.length + 1) }), map, colors));
      box.appendChild(row);
    }
    pixelGrid(box, 'Crest (4 × 5, sprite 192–196, 208–212, 224–228, 240–244)', J.CREST, 5, map, colors);
    pixelGrid(box, 'Centre-ice logo colours (4 × 6, sprite 197–202 … 245–250)', J.ICE, 6, map, colors);
  }
  /** Point sprite colour `sprite` at the selected team colour (JED painting). */
  function assignSpot(sprite) {
    if (J.getMap(cur().file, S.team)[sprite] === 128 + S.color) return;
    remember(); J.setMap(cur().file, S.team, sprite, 128 + S.color); edited();
  }

  function setChannel(i, v) {
    const c = J.getColors(cur().file, S.team)[S.color]; c[i] = Number(v);
    remember('c' + S.side + S.team + ':' + S.color);
    J.setColor(cur().file, S.team, S.color, c); edited();
  }
  function edited() { renderSwatches(); renderColor(); renderZones(); renderPreview(true); }

  function renderAll() {
    if (!cur()) return;
    renderTeams(); renderLabels(); renderSwatches(); renderColor(); renderZones(); renderPreview(true); renderUndo();
  }

  // ---- preview -------------------------------------------------------------------------------------------------
  function teamPalette() {
    if (S.base) return J.spritePalette(cur().file, S.team, S.base);
    return Nhl95Pc.buildTeamPalette(J.getRecord(cur().file, S.team), S.rink);
  }
  async function loadBase() {
    const get = async (n) => { try { return await fetchBytes('jed-pals/' + n); } catch (err) { return null; } };
    const [rink, jersey, rinkPlain] = await Promise.all(['rinkpalShadowfixed.act', 'createjerseyShadowfixed.act', 'rinkpal.act'].map(get));
    S.base = rink && jersey ? { rink, jersey, rinkPlain } : null;
    if (!S.base) status('Could not load jed-pals/*.act; the preview falls back to the Studio palette and .ACT export is off', true);
    if (cur()) renderAll();
  }
  function hasPixels(n) { const f = S.sprites && S.sprites.renderFrame(n); return Boolean(f && f.width && f.height); }
  function visibleFrames() { return $('jed-skip-empty').checked ? S.frames.filter(hasPixels) : S.frames; }
  const DEFAULT_FRAME = 369; // as shown in the Frame box (0-based); S.frame is 1-based
  function defaultFrame() { const v = visibleFrames(); return v.includes(DEFAULT_FRAME + 1) ? DEFAULT_FRAME + 1 : firstFrame(); }
  function firstFrame() { const v = visibleFrames(); return v.length ? v[0] : 0; }

  function drawFrame(canvas, n, pal, scale) {
    const f = S.sprites && S.sprites.renderFrame(n);
    if (!f || !f.width) { canvas.width = 1; canvas.height = 1; return; }
    const colors = f.dynamic === false ? (pal.game || pal) : pal;
    canvas.width = f.width; canvas.height = f.height;
    if (scale) { canvas.style.width = f.width * scale + 'px'; canvas.style.height = f.height * scale + 'px'; }
    const ctx = canvas.getContext('2d'); const img = ctx.createImageData(f.width, f.height);
    const skip = f.transparent == null ? 255 : f.transparent;
    for (let i = 0; i < f.pixels.length; i++) {
      const p = f.pixels[i]; if (p === skip) continue;
      const c = colors[p] || [0, 0, 0];
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  let thumbObserver = null;
  function buildStrip() {
    const strip = $('jed-strip'); strip.innerHTML = '';
    if (thumbObserver) thumbObserver.disconnect();
    const frames = visibleFrames();
    const slider = $('jed-frame-slider');
    slider.max = String(Math.max(0, frames.length - 1)); slider.disabled = !frames.length;
    document.querySelector('.jed-preview').classList.toggle('no-sprites', !S.sprites);
    $('jed-preview-note').textContent = S.sprites ? frames.length + ' frames · ' + S.spriteNote : S.spriteNote || 'No sprites loaded';
    thumbObserver = new IntersectionObserver((list) => {
      const pal = list.some((e) => e.isIntersecting) ? teamPalette() : null;
      for (const e of list) { e.target.dataset.visible = e.isIntersecting ? '1' : ''; if (e.isIntersecting) paintThumb(e.target, pal); }
    }, { root: strip, rootMargin: '200px' });
    for (const n of frames) {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'jed-thumb'; t.dataset.frame = String(n);
      t.setAttribute('aria-selected', String(n === S.frame)); t.title = 'Frame ' + (n - 1);
      const c = document.createElement('canvas'); c.width = 1; c.height = 1;
      const cap = document.createElement('span'); cap.textContent = String(n - 1);
      t.append(c, cap);
      t.addEventListener('click', () => { S.frame = n; renderPreview(false); });
      strip.appendChild(t); thumbObserver.observe(t);
    }
  }
  function paintThumb(t, pal) { drawFrame(t.querySelector('canvas'), Number(t.dataset.frame), pal || teamPalette(), 0); t.dataset.painted = S.team + S.side; }

  let pending = 0;
  function renderPreview(recolor) {
    const canvas = $('jed-canvas');
    if (!S.sprites || !S.frame || !cur()) { canvas.width = 1; canvas.height = 1; return; }
    const pal = teamPalette();
    const scale = Number($('jed-scale').value);
    drawFrame(canvas, S.frame, pal, scale);
    $('jed-scale-val').textContent = scale + '×';
    drawOverlay();
    const frames = visibleFrames();
    const at = frames.indexOf(S.frame);
    renderNeighbours(frames, at, pal, scale);
    $('jed-frame').value = String(S.frame - 1); $('jed-frame').max = String(S.frames.length - 1);
    if (at >= 0) $('jed-frame-slider').value = String(at);
    const strip = $('jed-strip');
    for (const t of strip.children) {
      const on = Number(t.dataset.frame) === S.frame;
      t.setAttribute('aria-selected', String(on));
      if (on && !recolor && t.scrollIntoView) t.scrollIntoView({ block: 'nearest' });
    }
    if (recolor) {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { for (const t of strip.children) if (t.dataset.visible) paintThumb(t, pal); });
    }
  }
  /** Outline, on the big frame, every pixel whose sprite colour is S.hover (spot hover or sprite hover). */
  function drawOverlay() {
    const o = $('jed-overlay'); const scale = Number($('jed-scale').value);
    const f = S.sprites && S.frame && S.sprites.renderFrame(S.frame);
    if (!f || !f.width) { o.width = 1; o.height = 1; return; }
    o.width = f.width * scale; o.height = f.height * scale;
    o.style.width = o.width + 'px'; o.style.height = o.height + 'px';
    const ctx = o.getContext('2d'); ctx.clearRect(0, 0, o.width, o.height);
    if (S.hover == null) return;
    const on = (x, y) => x >= 0 && y >= 0 && x < f.width && y < f.height && f.pixels[y * f.width + x] === S.hover;
    ctx.fillStyle = 'rgba(255,0,255,0.25)';
    ctx.beginPath();
    let count = 0;
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      if (!on(x, y)) continue; count++;
      const X = x * scale, Y = y * scale;
      ctx.fillRect(X, Y, scale, scale);
      if (!on(x, y - 1)) { ctx.moveTo(X, Y); ctx.lineTo(X + scale, Y); }
      if (!on(x, y + 1)) { ctx.moveTo(X, Y + scale); ctx.lineTo(X + scale, Y + scale); }
      if (!on(x - 1, y)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + scale); }
      if (!on(x + 1, y)) { ctx.moveTo(X + scale, Y); ctx.lineTo(X + scale, Y + scale); }
    }
    ctx.lineWidth = Math.max(2, scale / 5); ctx.strokeStyle = '#ff00ff'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    o.dataset.outlined = String(count);
  }
  /** Sprite colour under the mouse on the big frame if it is a team-mapped spot (144..250), else null. */
  function spriteAt(e) {
    const f = S.sprites && S.frame && S.sprites.renderFrame(S.frame);
    if (!f || !f.width || f.dynamic === false) return null;
    const c = $('jed-canvas'); const r = c.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * f.width), y = Math.floor((e.clientY - r.top) / r.height * f.height);
    if (x < 0 || y < 0 || x >= f.width || y >= f.height) return null;
    const p = f.pixels[y * f.width + x];
    return p >= J.SPRITE_FIRST && p < J.SPRITE_END ? p : null;
  }
  function spotName(p) { const z = J.ZONES.concat(J.CREST, J.ICE).find((q) => q.sprite === p); return z ? z.name : 'sprite colour ' + p; }

  /** Neighbouring frames either side of the selected one, as many as fit the stage width. Click to select. */
  function renderNeighbours(frames, at, pal, scale) {
    const left = $('jed-left'), right = $('jed-right'); left.innerHTML = ''; right.innerHTML = '';
    if (at < 0) return;
    const nbScale = Math.max(1, Math.min(4, Math.round(scale / 3)));
    const stage = $('jed-stage').clientWidth || 0;
    const main = $('jed-canvas').width * scale;
    const slot = 40 * nbScale + 12; // a typical player frame is ~32-40 px wide
    const each = Math.max(0, Math.min(8, Math.floor((stage - main - 24) / 2 / slot)));
    const add = (box, n, front) => {
      const c = document.createElement('canvas'); c.className = 'jed-nb'; c.dataset.frame = String(n); c.title = 'Frame ' + (n - 1);
      drawFrame(c, n, pal, nbScale); c.addEventListener('click', () => { S.frame = n; renderPreview(false); });
      if (front) box.prepend(c); else box.append(c);
    };
    for (let k = 1; k <= each; k++) {
      if (at - k >= 0) add(left, frames[at - k], true);
      if (at + k < frames.length) add(right, frames[at + k], false);
    }
  }
  function stepFrame(d) {
    const frames = visibleFrames(); if (!frames.length) return;
    const at = Math.max(0, frames.indexOf(S.frame));
    S.frame = frames[Math.max(0, Math.min(frames.length - 1, at + d))]; renderPreview(false);
  }

  // ---- import / export -----------------------------------------------------------------------------------------
  function readFile(input) {
    return new Promise((resolve) => {
      input.onchange = async () => { const f = input.files[0]; input.value = ''; resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null); };
      input.click();
    });
  }
  function guard(fn) { return async (...a) => { try { await fn(...a); } catch (err) { status(err.message, true); } }; }
  function wire() {
    $('jed-open-folder').onclick = () => $('jed-folder').click();
    $('jed-open-files').onclick = () => $('jed-files').click();
    const pick = guard(async (input) => {
      const files = Array.from(input.files || []); input.value = '';
      if (!files.length) return;
      const entries = await Promise.all(files.map(async (f) => ({ rel: (f.webkitRelativePath || f.name), bytes: new Uint8Array(await f.arrayBuffer()) })));
      await loadLocal(entries);
    });
    $('jed-folder').onchange = () => pick($('jed-folder'));
    $('jed-files').onchange = () => pick($('jed-files'));
    $('jed-home').onclick = () => { if (S.files.home) { S.side = 'home'; renderAll(); } };
    $('jed-away').onclick = () => { if (S.files.away) { S.side = 'away'; renderAll(); } };
    ['r', 'g', 'b'].forEach((k, i) => {
      $('jed-' + k).oninput = (e) => cur() && setChannel(i, e.target.value);
      $('jed-' + k + 'n').onchange = (e) => cur() && setChannel(i, Math.max(0, Math.min(63, Number(e.target.value) || 0)));
    });
    $('jed-picker').oninput = (e) => {
      if (!cur()) return;
      const v = e.target.value; const c = [1, 3, 5].map((o) => J.to6(parseInt(v.substr(o, 2), 16)));
      remember('c' + S.side + S.team + ':' + S.color); J.setColor(cur().file, S.team, S.color, c); edited();
    };
    $('jed-export-file').onclick = guard(() => { if (cur()) download(J.exportFile(cur().file), sideName().toUpperCase() + '.BIN'); });
    $('jed-import-file-btn').onclick = guard(async () => {
      if (!cur()) return; const f = await readFile($('jed-import-file')); if (!f) return;
      const file = J.openFile(f.bytes, S.side);
      if (file.game !== S.game) throw new Error(f.name + ' is NHL ' + file.game + ' PC; the open files are NHL ' + S.game + ' PC');
      remember(); cur().file.bytes.set(file.bytes); status('Imported ' + f.name + ' as ' + sideName().toUpperCase() + '.BIN'); renderAll();
    });
    $('jed-export-bin').onclick = guard(() => { if (cur()) download(J.getRecord(cur().file, S.team), teamCode() + '_' + S.side + '.bin'); });
    $('jed-undo').onclick = undo; $('jed-redo').onclick = redo;
    const canvas = $('jed-canvas');
    canvas.addEventListener('mousemove', (e) => { const p = spriteAt(e); if (p !== S.hover) { S.hover = p; drawOverlay(); } canvas.title = p == null ? '' : spotName(p) + ' (sprite ' + p + ') → click to set colour ' + S.color; });
    canvas.addEventListener('mouseleave', () => { S.hover = null; drawOverlay(); });
    canvas.addEventListener('click', (e) => { const p = spriteAt(e); if (p != null) { assignSpot(p); S.hover = p; drawOverlay(); status(spotName(p) + ' now uses colour ' + S.color); } });
    $('jed-export-act').onclick = guard(() => {
      if (!cur()) return; if (!S.base) throw new Error('The base palettes (jed-pals/*.act) did not load');
      download(J.toAct(cur().file, S.team, S.base, false), teamCode() + (S.side === 'home' ? 'H' : 'V') + '.ACT');
    });
    $('jed-import-bin-btn').onclick = guard(async () => {
      if (!cur()) return; const f = await readFile($('jed-import-bin')); if (!f) return;
      J.setRecord(J.openFile(cur().file.bytes), S.team, f.bytes); remember(); J.setRecord(cur().file, S.team, f.bytes); status('Imported ' + f.name + ' into ' + teamCode() + ' ' + S.side); edited();
    });
    $('jed-import-act-btn').onclick = guard(async () => {
      if (!cur()) return; const f = await readFile($('jed-import-act')); if (!f) return;
      J.fromAct(J.openFile(cur().file.bytes), S.team, f.bytes); // validate first
      remember(); const r = J.fromAct(cur().file, S.team, f.bytes);
      let msg = 'Imported ' + f.name + ' (sprite colours 144–250) into ' + teamCode() + ' ' + S.side + ': ' + r.set.length + ' team colours set';
      if (r.conflicts.length) {
        msg += '; ' + r.conflicts.length + ' conflict(s), the lowest sprite index wins: ' + r.conflicts.map((c) => 'colour ' + c.slot + ' from ' +
          c.used + ' (also ' + c.sources.filter((x) => x.index !== c.used).map((x) => x.index + '=' + x.rgb.join('/')).join(', ') + ')').join('; ');
      }
      status(msg, r.conflicts.length > 0); edited();
    });
    $('jed-revert').onclick = () => { if (!cur()) return; remember(); J.setRecord(cur().file, S.team, J.getRecord(J.openFile(cur().original), S.team)); edited(); };
    $('jed-prev').onclick = () => stepFrame(-1);
    $('jed-next').onclick = () => stepFrame(1);
    $('jed-frame-slider').oninput = (e) => { const v = visibleFrames(); S.frame = v[Number(e.target.value)] || S.frame; renderPreview(false); };
    $('jed-frame').onchange = (e) => { const n = Number(e.target.value) + 1; if (S.frames.includes(n)) { S.frame = n; renderPreview(false); } };
    $('jed-scale').oninput = () => renderPreview(false);
    $('jed-skip-empty').onchange = () => { buildStrip(); if (!visibleFrames().includes(S.frame)) S.frame = firstFrame(); renderPreview(false); };
    document.addEventListener('keydown', (e) => {
      if (cur() && (e.ctrlKey || e.metaKey) && !/textarea/i.test(e.target.tagName)) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); return; }
        if ((k === 'z' && e.shiftKey) || k === 'y') { redo(); e.preventDefault(); return; }
      }
      if (!cur() || /input|select|textarea/i.test(e.target.tagName)) return;
      const n = J.teamCount(cur().file);
      if (e.key === 'ArrowUp') { S.team = (S.team + n - 1) % n; renderAll(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { S.team = (S.team + 1) % n; renderAll(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && S.files.home) { S.side = 'home'; renderAll(); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && S.files.away) { S.side = 'away'; renderAll(); e.preventDefault(); }
      else if (e.key === 'PageDown' || e.key === '.') stepFrame(1);
      else if (e.key === 'PageUp' || e.key === ',') stepFrame(-1);
    });
  }

  async function detectServer() {
    let list;
    try { const r = await fetch('api/games'); if (!r.ok) return; list = await r.json(); } catch (err) { return; }
    const pcs = (list || []).filter((g) => (g.kind === 'pc94' || g.kind === 'pc95') && g.pixels);
    if (!pcs.length) return;
    const sel = $('jed-server'); sel.hidden = false;
    sel.innerHTML = '<option value="">Game on this server…</option>' + pcs.map((g) => '<option value="' + g.id + '">' + g.title + '</option>').join('');
    sel.onchange = guard(async () => { if (sel.value) await loadServer(sel.value); });
    const want = new URLSearchParams(location.hash.slice(1)).get('game');
    if (want && pcs.some((g) => g.id === want)) { sel.value = want; await guard(loadServer)(want); }
  }

  /** Splitter between the big preview and the frame grid; default 4 rows of thumbnails, size kept in localStorage. */
  function wireSplit() {
    const KEY = 'jed.stripHeight', strip = $('jed-strip'), bar = $('jed-split');
    const set = (h) => { strip.style.setProperty('--strip-h', Math.round(h) + 'px'); };
    const saved = Number(localStorage.getItem(KEY)); if (saved > 40) set(saved);
    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId); bar.classList.add('drag');
      const y0 = e.clientY, h0 = strip.getBoundingClientRect().height;
      const col = strip.parentElement.getBoundingClientRect().height;
      const move = (m) => set(Math.max(90, Math.min(col - 220, h0 - (m.clientY - y0))));
      const up = () => { bar.classList.remove('drag'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
        localStorage.setItem(KEY, String(Math.round(strip.getBoundingClientRect().height))); if (cur()) renderPreview(false); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
  }

  wire();
  wireSplit();
  loadBase();
  detectServer();
  window.addEventListener('resize', () => { if (cur()) renderPreview(false); });
})();
