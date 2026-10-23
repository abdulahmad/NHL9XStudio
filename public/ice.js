/* Centre ice editor (NHL 95 PC full, NHL 94 PC view only). Format and game rules: lib/pc-rink.js. Uses JedShared
 * from jed.js for the loaded game folder / server game and the home & away team palettes. */
(function () {
  'use strict';
  const R = NhlPcRink, J = NhlPcJersey, X = window.JedShared;
  const $ = (id) => document.getElementById(id);
  const I = { team: 0, away: 1, model: null, original: null, rink: null, rinkNote: '', tool: 'paint', tile: 0, color: 0,
    zoom: 2, grid: true, undo: [], redo: [], ro: false, pal: null, drag: null, loadedFor: '' };
  const st = () => X.state;
  const arenas = () => (st().game === '94' ? R.ARENAS.slice(0, 24) : R.ARENAS);
  const teamName = (i) => { const t = J.TEAMS[st().game || '95'][i]; return t ? t.name : R.ARENAS[i]; };
  const code = () => R.ARENAS[I.team];

  function palette() {
    const S = st(); const rink = S.base && S.base.rinkPlain;
    if (!rink) return null;
    return R.gamePalette(rink, X.homeColors(I.team), X.awayColors(I.away));
  }
  function remember() { I.undo.push(R.cloneModel(I.model)); if (I.undo.length > 100) I.undo.shift(); I.redo = []; }
  function swap(a, b) { if (!a.length) return; b.push(R.cloneModel(I.model)); I.model = a.pop(); renderAll(); }

  async function load() {
    const S = st(); if (!S.sources) return;
    const name = code(); I.ro = S.game === '94';
    $('ice-warn').hidden = !I.ro;
    const [tb, mb, rb] = await Promise.all([X.file(name + '.TIL'), X.file(name + '.MAP'), X.file(I.ro ? 'RINK.TIL' : 'RINK.QFS')]);
    I.rink = null;
    if (rb && !I.ro) { try { I.rink = Nhl95Pc.openBytes(rb, 'RINK.QFS').shapes[0].pixels; } catch (e) { I.rink = null; } }
    if (rb && I.ro) { try { const m = await X.file('RINK.MAP'); if (m) I.rink = R.composite(null, R.parseMap(m), R.parseTil(rb), [0, 0, -1, -1], 94); } catch (e) { I.rink = null; } }
    I.rinkNote = I.rink ? '' : 'No rink picture (RINK.QFS) loaded — showing the logo on a plain background. ';
    const place = (R.PLACEMENT[S.game] || R.PLACEMENT[95])[name] || [21, 37, -1, -1];
    if (tb && mb) {
      const map = R.parseMap(mb), tiles = R.parseTil(tb);
      I.original = { map, tiles, place: place.slice() };
      I.model = R.modelFrom(map, tiles, place);
    } else {
      I.original = null;
      I.model = { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [], place: place.slice(), flag: 16 };
      I.rinkNote += 'No ' + name + '.TIL / .MAP in what you opened. ';
    }
    I.undo = []; I.redo = []; I.tile = Math.max(0, (I.model.cells.find((e) => e >= 0) || 0) & R.CELL); I.loadedFor = S.game + name;
    renderAll();
  }

  // ---- render --------------------------------------------------------------------------------------------------
  function built() { try { return R.build(I.model); } catch (e) { return null; } }
  function rgbOf(p) { return I.pal && I.pal[p] ? I.pal[p] : [255, 0, 255]; }
  function putPixels(ctx, pix, w, h) {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const c = rgbOf(pix[i]); img.data.set([c[0], c[1], c[2], pix[i] === R.CLEAR ? 0 : 255], i * 4); }
    return img;
  }
  function rinkPixels() {
    if (I.ro) return I.original ? R.composite(I.rink, I.original.map, I.original.tiles, I.original.place, 94) : R.composite(I.rink, null);
    const b = built(); const place = b ? b.place : I.model.place;
    return b ? R.composite(I.rink, b.map, b.tiles, place, I.ro ? 94 : 95) : R.composite(I.rink, null);
  }
  function renderRink() {
    const c = $('ice-rink'), z = I.zoom; c.width = R.PX_W * z; c.height = R.PX_H * z;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const tmp = document.createElement('canvas'); tmp.width = R.PX_W; tmp.height = R.PX_H;
    tmp.getContext('2d').putImageData(putPixels(tmp.getContext('2d'), rinkPixels(), R.PX_W, R.PX_H), 0, 0);
    ctx.fillStyle = '#334'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(tmp, 0, 0, c.width, c.height);
    const bb = R.bounds(I.model);
    if (I.grid) {
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= R.W; x++) { ctx.moveTo(x * 8 * z + 0.5, 0); ctx.lineTo(x * 8 * z + 0.5, c.height); }
      for (let y = 0; y <= R.H; y++) { ctx.moveTo(0, y * 8 * z + 0.5); ctx.lineTo(c.width, y * 8 * z + 0.5); }
      ctx.stroke();
    }
    if (bb) { ctx.strokeStyle = '#f5b301'; ctx.lineWidth = 2; ctx.strokeRect(bb.x * 8 * z, bb.y * 8 * z, bb.w * 8 * z, bb.h * 8 * z); }
    const p = I.model.place;
    if (bb && p[2] > 0) { ctx.strokeStyle = '#4cc3ff'; ctx.setLineDash([4, 3]); ctx.strokeRect((p[2] - bb.w + 1) * 8 * z, (p[3] - bb.h + 1) * 8 * z, bb.w * 8 * z, bb.h * 8 * z); ctx.setLineDash([]); }
  }
  function renderSwatches() {
    const box = $('ice-swatches'); box.innerHTML = '';
    for (let i = 0; i < 256; i++) {
      const r = R.rangeOf(i), b = document.createElement('button'); b.type = 'button';
      b.className = 'ice-sw src-' + r.source + (r.usable ? '' : ' blocked'); b.dataset.index = i;
      const c = rgbOf(i); b.style.background = i === R.CLEAR ? '' : 'rgb(' + c.join(',') + ')';
      b.title = i + ': ' + (i === R.CLEAR ? 'transparent' : c.join(', ')) + ' — ' + r.label;
      b.setAttribute('aria-selected', String(i === I.color)); b.disabled = !r.usable;
      b.addEventListener('click', () => { I.color = i; renderSwatches(); });
      box.appendChild(b);
    }
    const r = R.rangeOf(I.color);
    $('ice-color').textContent = 'Index ' + I.color + ' · ' + r.label + (r.varies ? ' — the preview shows ' + teamName(I.team) : '');
  }
  function tileCanvas(t, size) {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').putImageData(putPixels(c.getContext('2d'), t, 8, 8), 0, 0);
    c.style.width = c.style.height = size + 'px'; return c;
  }
  function renderTiles() {
    const used = new Set(); I.model.cells.forEach((e) => { if (e >= 0) used.add(e & R.CELL); });
    const box = $('ice-tiles'); box.innerHTML = '';
    I.model.tiles.forEach((t, i) => {
      if (!used.has(i) && i !== I.tile) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ice-tile'; b.title = 'Tile ' + i;
      b.setAttribute('aria-selected', String(i === I.tile)); b.appendChild(tileCanvas(t, 24));
      b.addEventListener('click', () => { I.tile = i; renderTiles(); renderTileEdit(); });
      box.appendChild(b);
    });
    const n = R.tileCount(I.model);
    $('ice-count').textContent = n + ' / ' + R.MAX_TILES + ' tiles after removing duplicates';
    $('ice-count').classList.toggle('error', n > R.MAX_TILES);
  }
  function renderTileEdit() {
    const c = $('ice-tile-edit'), t = I.model.tiles[I.tile]; const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height); if (!t) return;
    const s = c.width / 8;
    for (let i = 0; i < 64; i++) {
      const x = (i % 8) * s, y = Math.floor(i / 8) * s;
      if (t[i] === R.CLEAR) { ctx.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? '#777' : '#999'; } else ctx.fillStyle = 'rgb(' + rgbOf(t[i]).join(',') + ')';
      ctx.fillRect(x, y, s, s);
    }
  }
  function renderPlace() {
    const b = R.bounds(I.model) || { x: I.model.place[0], y: I.model.place[1] };
    $('ice-x').value = b.x; $('ice-y').value = b.y; $('ice-x2').value = I.model.place[2]; $('ice-y2').value = I.model.place[3];
  }
  function renderTeams() {
    const box = $('ice-team-list'); box.innerHTML = '';
    arenas().forEach((a, i) => {
      const d = document.createElement('div'); d.className = 'item'; d.setAttribute('role', 'option'); d.textContent = teamName(i) + ' · ' + a;
      d.setAttribute('aria-selected', String(i === I.team));
      d.addEventListener('click', X.guard(async () => { I.team = i; await load(); }));
      box.appendChild(d);
    });
    const sel = $('ice-away'); const cur = I.away; sel.innerHTML = '';
    arenas().forEach((a, i) => { const o = document.createElement('option'); o.value = i; o.textContent = teamName(i); sel.appendChild(o); });
    sel.value = cur;
  }
  function renderAll() {
    if (!I.model) return;
    I.pal = palette();
    document.querySelectorAll('.ice-edit').forEach((el) => { el.disabled = I.ro; });
    renderTeams(); renderSwatches(); renderTiles(); renderTileEdit(); renderPlace(); renderRink();
    $('ice-undo').disabled = I.ro || !I.undo.length; $('ice-redo').disabled = I.ro || !I.redo.length;
    $('ice-note').textContent = I.rinkNote + (I.ro ? '' : 'Arena ' + code() + ' (home team ' + teamName(I.team) + '), away preview ' + teamName(I.away) + '.');
  }

  // ---- editing -------------------------------------------------------------------------------------------------
  function cellAt(e) {
    const c = $('ice-rink'), r = c.getBoundingClientRect();
    const px = Math.floor((e.clientX - r.left) * R.PX_W / r.width), py = Math.floor((e.clientY - r.top) * R.PX_H / r.height);
    if (px < 0 || py < 0 || px >= R.PX_W || py >= R.PX_H) return null;
    return { px, py, x: px >> 3, y: py >> 3 };
  }
  function paintAt(p) {
    let e = I.model.cells[p.y * R.W + p.x];
    if (e < 0) { // painting an empty cell creates a new transparent tile there
      I.model.tiles.push(new Uint8Array(64).fill(R.CLEAR)); e = I.model.tiles.length - 1; I.model.cells[p.y * R.W + p.x] = e;
    } else if (sharedCount(e & R.CELL) > 1) { // copy on write: only this cell changes
      I.model.tiles.push(Uint8Array.from(I.model.tiles[e & R.CELL])); const n = I.model.tiles.length - 1;
      e = n | (e & (R.HFLIP | R.VFLIP)); I.model.cells[p.y * R.W + p.x] = e;
    }
    let lx = p.px & 7, ly = p.py & 7; if (e & R.HFLIP) lx = 7 - lx; if (e & R.VFLIP) ly = 7 - ly;
    I.model.tiles[e & R.CELL][ly * 8 + lx] = I.color; I.tile = e & R.CELL;
  }
  function sharedCount(t) { let n = 0; I.model.cells.forEach((e) => { if (e >= 0 && (e & R.CELL) === t) n++; }); return n; }
  function moveBy(dx, dy) {
    const next = new Int32Array(R.W * R.H).fill(-1);
    I.model.cells.forEach((e, i) => { if (e < 0) return; const x = i % R.W + dx, y = Math.floor(i / R.W) + dy; if (x >= 0 && y >= 0 && x < R.W && y < R.H) next[y * R.W + x] = e; });
    I.model.cells = next;
  }
  function onDown(e) {
    if (I.ro || !I.model) return; const p = cellAt(e); if (!p) return;
    const k = p.y * R.W + p.x;
    if (I.tool === 'pick') { const v = rinkPixels()[p.py * R.PX_W + p.px]; if (R.usable(v)) I.color = v; X.status('Picked index ' + v + ' (' + R.rangeOf(v).label + ')'); renderSwatches(); return; }
    remember();
    if (I.tool === 'paint') paintAt(p);
    else if (I.tool === 'place') { if (!I.model.tiles[I.tile]) { I.model.tiles.push(new Uint8Array(64).fill(R.CLEAR)); I.tile = I.model.tiles.length - 1; } I.model.cells[k] = I.tile; }
    else if (I.tool === 'erase') I.model.cells[k] = -1;
    else if (I.tool === 'move') I.drag = { x: p.x, y: p.y };
    $('ice-rink').setPointerCapture(e.pointerId); I.down = true; renderAll();
  }
  function onMove(e) {
    if (!I.down) return; const p = cellAt(e); if (!p) return;
    if (I.tool === 'paint') { paintAt(p); renderRink(); renderTileEdit(); }
    else if (I.tool === 'place') { I.model.cells[p.y * R.W + p.x] = I.tile; renderRink(); }
    else if (I.tool === 'erase') { I.model.cells[p.y * R.W + p.x] = -1; renderRink(); }
    else if (I.tool === 'move' && I.drag && (p.x !== I.drag.x || p.y !== I.drag.y)) { moveBy(p.x - I.drag.x, p.y - I.drag.y); I.drag = { x: p.x, y: p.y }; renderPlace(); renderRink(); }
  }
  function onUp() { if (!I.down) return; I.down = false; I.drag = null; renderAll(); }
  function editTile(e) {
    if (I.ro) return; const t = I.model.tiles[I.tile]; if (!t) return;
    const c = $('ice-tile-edit'), r = c.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * 8 / r.width), y = Math.floor((e.clientY - r.top) * 8 / r.height);
    if (x < 0 || y < 0 || x > 7 || y > 7) return;
    remember(); t[y * 8 + x] = e.button === 2 || e.altKey ? R.CLEAR : I.color; renderAll();
  }

  // ---- import / export ----------------------------------------------------------------------------------------
  function exportNow() {
    const out = R.exportFiles(I.model, I.original); return out;
  }
  function placementJson() {
    const b = built(); const p = b ? b.place : I.model.place;
    return { game: 'nhl95pc', arena: code(), team: teamName(I.team), x: p[0], y: p[1], x2: p[2], y2: p[3],
      note: 'Tiles, top-left of the .MAP on the 48x74 rink; x2 > 0 draws a second copy rotated 180 degrees, its bottom-right tile at (x2, y2). HOCKEY.EXE arena table, not patched by this editor.' };
  }
  function pngOf(pix, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(putPixels(c.getContext('2d'), pix, w, h), 0, 0);
    return new Promise((ok) => c.toBlob((b) => b.arrayBuffer().then((a) => ok(new Uint8Array(a))), 'image/png'));
  }
  async function readImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not read ' + file.name + ' as an image')); i.src = url; });
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, rgba: ctx.getImageData(0, 0, c.width, c.height).data };
    } finally { URL.revokeObjectURL(url); }
  }
  async function importImage(file) {
    const im = await readImage(file);
    if (im.w > R.PX_W || im.h > R.PX_H) throw new Error(file.name + ' is ' + im.w + '×' + im.h + '; the rink is ' + R.PX_W + '×' + R.PX_H + ' pixels');
    const allowed = []; for (let i = 0; i < 256; i++) if (R.usable(i) && i !== R.CLEAR && ($('ice-q-home').checked || R.rangeOf(i).source !== 'home')) allowed.push(i);
    const idx = R.quantize(im.rgba, I.pal, allowed);
    const tw = Math.ceil(im.w / 8), th = Math.ceil(im.h / 8);
    const keep = $('ice-q-replace').checked ? { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [], place: I.model.place.slice(), flag: I.model.flag } : I.model;
    const x = Math.max(0, Math.min(R.W - tw, Math.round((R.W - tw) / 2))), y = Math.max(0, Math.min(R.H - th, Math.round((R.H - th) / 2)));
    const next = R.placeImage(keep, idx, im.w, im.h, x, y);
    remember(); I.model = next; I.tile = Math.max(0, (I.model.cells.find((e) => e >= 0) || 0) & R.CELL); renderAll();
    X.status('Imported ' + file.name + ' (' + im.w + '×' + im.h + '): ' + R.tileCount(I.model) + ' tiles after removing duplicates; drag with Move to place it');
  }
  function file(input) { return new Promise((ok) => { input.value = ''; input.onchange = () => ok(input.files[0] || null); input.click(); }); }
  async function bytesOf(f) { return new Uint8Array(await f.arrayBuffer()); }

  function wire() {
    $('tab-jerseys').addEventListener('click', () => tab('jerseys'));
    $('tab-ice').addEventListener('click', () => tab('ice'));
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { I.tool = b.dataset.tool; document.querySelectorAll('[data-tool]').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); }));
    const c = $('ice-rink');
    c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp);
    $('ice-tile-edit').addEventListener('pointerdown', editTile); $('ice-tile-edit').addEventListener('contextmenu', (e) => e.preventDefault());
    $('ice-zoom').addEventListener('change', () => { I.zoom = Number($('ice-zoom').value); renderRink(); });
    $('ice-grid').addEventListener('change', () => { I.grid = $('ice-grid').checked; renderRink(); });
    $('ice-away').addEventListener('change', () => { I.away = Number($('ice-away').value); renderAll(); });
    $('ice-undo').addEventListener('click', () => swap(I.undo, I.redo)); $('ice-redo').addEventListener('click', () => swap(I.redo, I.undo));
    const setPlace = () => {
      const b = R.bounds(I.model); if (!b) return;
      const dx = Number($('ice-x').value) - b.x, dy = Number($('ice-y').value) - b.y, x2 = Number($('ice-x2').value), y2 = Number($('ice-y2').value);
      if (!dx && !dy && x2 === I.model.place[2] && y2 === I.model.place[3]) return;
      remember(); moveBy(dx, dy);
      I.model.place[2] = Number($('ice-x2').value); I.model.place[3] = Number($('ice-y2').value); renderAll();
    };
    ['ice-x', 'ice-y', 'ice-x2', 'ice-y2'].forEach((id) => $(id).addEventListener('change', setPlace));
    $('ice-retail').addEventListener('click', X.guard(load));
    $('ice-new-tile').addEventListener('click', () => { remember(); I.model.tiles.push(new Uint8Array(64).fill(R.CLEAR)); I.tile = I.model.tiles.length - 1; I.tool = 'place'; renderAll(); });
    $('ice-mirror').addEventListener('click', () => { const t = I.model.tiles[I.tile]; if (!t) return; remember(); I.model.tiles[I.tile] = R.flipped(t, true, false); renderAll(); });
    $('ice-flip').addEventListener('click', () => { const t = I.model.tiles[I.tile]; if (!t) return; remember(); I.model.tiles[I.tile] = R.flipped(t, false, true); renderAll(); });
    $('ice-import-image').addEventListener('click', X.guard(async () => { const f = await file($('ice-image-file')); if (f) await importImage(f); }));
    $('ice-import-til').addEventListener('click', X.guard(async () => {
      const f = await file($('ice-tilmap-file')); if (!f) return; const b = await bytesOf(f);
      remember();
      if (/\.map$/i.test(f.name)) { const b0 = R.bounds(I.model) || { x: I.model.place[0], y: I.model.place[1] }; I.model = R.modelFrom(R.parseMap(b), I.model.tiles, [b0.x, b0.y, I.model.place[2], I.model.place[3]]); }
      else I.model.tiles = R.parseTil(b);
      X.status('Imported ' + f.name); renderAll();
    }));
    $('ice-import-json').addEventListener('click', X.guard(async () => {
      const f = await file($('ice-json-file')); if (!f) return; const j = JSON.parse(new TextDecoder().decode(await bytesOf(f)));
      const b = R.bounds(I.model); remember(); if (b) moveBy(j.x - b.x, j.y - b.y);
      I.model.place = [j.x, j.y, j.x2 == null ? -1 : j.x2, j.y2 == null ? -1 : j.y2]; X.status('Placement from ' + f.name); renderAll();
    }));
    $('ice-export-til').addEventListener('click', X.guard(() => { const o = exportNow(); X.download(o.til, code() + '.TIL'); X.status(code() + '.TIL: ' + o.til.length / 64 + ' tiles'); }));
    $('ice-export-map').addEventListener('click', X.guard(() => { const o = exportNow(); X.download(o.map, code() + '.MAP'); X.status(code() + '.MAP written; use the placement JSON for x / y'); }));
    $('ice-export-json').addEventListener('click', X.guard(() => { X.download(new TextEncoder().encode(JSON.stringify(placementJson(), null, 2) + '\n'), code() + '-placement.json'); }));
    $('ice-export-logo').addEventListener('click', X.guard(async () => { const b = R.build(I.model); const r = R.renderMap(b.map, b.tiles); X.download(await pngOf(r.pixels, r.width, r.height), code() + '-logo.png'); }));
    $('ice-export-rink').addEventListener('click', X.guard(async () => { X.download(await pngOf(rinkPixels(), R.PX_W, R.PX_H), code() + '-rink.png'); }));
    X.loaded.push(() => { if (I.loadedFor || !$('ice-main').hidden) X.guard(load)(); });
  }
  function tab(which) {
    const ice = which === 'ice';
    $('tab-jerseys').setAttribute('aria-selected', String(!ice)); $('tab-ice').setAttribute('aria-selected', String(ice));
    document.querySelector('main.jed-main').hidden = ice; $('ice-main').hidden = !ice;
    if (ice && (!I.model || I.loadedFor !== st().game + code())) X.guard(load)();
    else if (ice) renderAll();
    if (ice && !st().sources) X.status('Open an NHL 95 PC folder (or pick the game on this server) to edit its centre ice logos');
  }
  wire();
  window.JedIce = { state: I, load, tab };
}());
