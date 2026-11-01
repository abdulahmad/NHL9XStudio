/* Centre ice editor (NHL 95 PC full, NHL 94 PC view only). Format and game rules: lib/pc-rink.js. Uses JedShared
 * from jed.js for the loaded game folder / server game and the home & away team palettes. */
(function () {
  'use strict';
  const R = NhlPcRink, J = NhlPcJersey, A = NhlPcPalette, X = window.JedShared;
  const $ = (id) => document.getElementById(id);
  const I = { cache: {}, srcRef: null, team: 0, away: 1, model: null, original: null, rink: null, rinkNote: '', tool: 'paint', tile: 0, color: 0,
    zoom: 2, grid: true, undo: [], redo: [], ro: false, pal: null, drag: null, loadedFor: '' };
  const st = () => X.state;
  const arenas = () => (st().game === '94' ? R.ARENAS.slice(0, 24) : R.ARENAS);
  const teamName = (i) => { const t = J.TEAMS[st().game || '95'][i]; return t ? t.name : R.ARENAS[i]; };
  const code = () => R.ARENAS[I.team];

  function palette() {
    const S = st(); const rink = S.base && S.base.rinkPlain;
    if (!rink) return null;
    return R.gamePalette(rink, I.float ? I.float.colors : X.homeColors(I.team), X.awayColors(I.away));
  }
  /** Undo steps hold the model and the home team colours (an image import can rewrite both). */
  function snap() { const m = R.cloneModel(I.model); const c = X.homeColors(I.team); m.colors = c && c.map((x) => x.slice()); return m; }
  function remember() { I.undo.push(snap()); if (I.undo.length > 100) I.undo.shift(); I.redo = []; }
  function swap(a, b) {
    if (!a.length) return; b.push(snap()); I.model = a.pop();
    if (I.model.colors) { try { X.setHomeColors(I.team, I.model.colors); } catch (e) { /* no HOMEPALS */ } }
    renderAll();
  }

  async function load() {
    const S = st(); if (!S.sources) return;
    const name = code(); I.ro = S.game === '94';
    if (I.srcRef !== S.sources) { I.cache = {}; I.model = null; I.loadedFor = null; I.srcRef = S.sources; }
    if (I.model && I.loadedFor && I.loadedFor !== S.game + name) I.cache[I.loadedFor] = { original: I.original, model: I.model, undo: I.undo, redo: I.redo, team: I.cacheTeam, raw: I.raw };
    $('ice-warn').hidden = !I.ro;
    const [tb, mb, rb] = await Promise.all([X.file(name + '.TIL'), X.file(name + '.MAP'), X.file(I.ro ? 'RINK.TIL' : 'RINK.QFS')]);
    I.rink = null;
    if (rb && !I.ro) { try { I.rink = Nhl95Pc.openBytes(rb, 'RINK.QFS').shapes[0].pixels; } catch (e) { I.rink = null; } }
    if (rb && I.ro) { try { const m = await X.file('RINK.MAP'); if (m) I.rink = R.composite(null, R.parseMap(m), R.parseTil(rb), [0, 0, -1, -1], 94); } catch (e) { I.rink = null; } }
    I.rinkNote = I.rink ? '' : (I.ro
      ? 'No rink picture (RINK.TIL / RINK.MAP) loaded — showing the logo on a plain background. '
      : 'No rink picture (RINK.QFS) loaded — showing the logo on a plain background. ');
    const place = (R.PLACEMENT[S.game] || R.PLACEMENT[95])[name] || [21, 37, -1, -1];
    I.raw = tb && mb ? { til: tb, map: mb } : null; I.cacheTeam = I.team;
    const hit = I.cache[S.game + name];
    if (hit && !I.ro) {
      Object.assign(I, { original: hit.original, model: hit.model, undo: hit.undo, redo: hit.redo, raw: hit.raw }); delete I.cache[S.game + name];
      I.sel = null; I.float = null; I.loadedFor = S.game + name; renderAll(); return;
    }
    if (tb && mb) {
      const map = R.parseMap(mb), tiles = R.parseTil(tb);
      I.original = { map, tiles, place: place.slice() };
      I.model = R.modelFrom(map, tiles, place);
    } else {
      I.original = null;
      I.model = { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [], place: place.slice(), flag: 16 };
      I.rinkNote += 'No ' + name + '.TIL / .MAP in what you opened. ';
    }
    I.undo = []; I.redo = []; I.sel = null; I.float = null; I.tile = Math.max(0, (I.model.cells.find((e) => e >= 0) || 0) & R.CELL); I.loadedFor = S.game + name;
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
    const out = b ? R.composite(I.rink, b.map, b.tiles, place, I.ro ? 94 : 95) : R.composite(I.rink, null);
    if (I.float) floatCells().forEach(({ col, row }) => { // the floating import, drawn on top
      const f = I.float;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const sx = col * 8 + px, sy = row * 8 + py; if (sx >= f.w || sy >= f.h) continue;
        const v = f.idx[sy * f.w + sx]; const X0 = (f.x + col) * 8 + px, Y0 = (f.y + row) * 8 + py;
        if (v !== R.CLEAR && X0 < R.PX_W && Y0 < R.PX_H) out[Y0 * R.PX_W + X0] = v;
      }
    });
    return out;
  }
  /** Cells of the floating import that will become tiles: { col, row, x, y, over } (over = a non-empty cell). */
  function floatCells() {
    const f = I.float, out = []; if (!f) return out;
    for (let row = 0; row < Math.ceil(f.h / 8); row++) for (let col = 0; col < Math.ceil(f.w / 8); col++) {
      const x = f.x + col, y = f.y + row; if (x < 0 || y < 0 || x >= R.W || y >= R.H) continue;
      if (f.pick && !f.pick(col, row)) continue;
      let any = false; for (let py = 0; py < 8 && !any; py++) for (let px = 0; px < 8; px++) { const sx = col * 8 + px, sy = row * 8 + py; if (sx < f.w && sy < f.h && f.idx[sy * f.w + sx] !== R.CLEAR) { any = true; break; } }
      if (!any) continue;
      const over = !f.replace && I.model.cells[y * R.W + x] >= 0;
      if (over && !$('ice-o-cells').checked) continue;
      out.push({ col, row, x, y, over });
    }
    return out;
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
    if (I.float) {
      ctx.fillStyle = 'rgba(255,80,80,.45)'; for (const c of floatCells()) if (c.over) ctx.fillRect(c.x * 8 * z, c.y * 8 * z, 8 * z, 8 * z);
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(I.float.x * 8 * z, I.float.y * 8 * z, Math.ceil(I.float.w / 8) * 8 * z, Math.ceil(I.float.h / 8) * 8 * z); ctx.setLineDash([]);
    }
    if (I.sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(I.sel.x * 8 * z + 1, I.sel.y * 8 * z + 1, I.sel.w * 8 * z - 2, I.sel.h * 8 * z - 2); ctx.setLineDash([]); }
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
      b.dataset.tip = i + ': ' + (i === R.CLEAR ? 'transparent' : c.join(', ')) + ' — ' + r.label;
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
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ice-tile'; b.dataset.tip = 'Tile ' + i;
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
  // ---- import colour options -------------------------------------------------------------------------------------
  const OPTS = ['team', 'rink', 'overwrite', 'jersey', 'crest', 'tiles', 'free'];
  function opts() { const o = {}; for (const k of OPTS) o[k === 'free' ? 'freeOnly' : k] = $('ice-o-' + k).checked && !$('ice-o-' + k).disabled; return o; }
  function tileSlots() { const s = new Set(); I.model.cells.forEach((e) => { if (e < 0) return; const t = I.model.tiles[e & R.CELL]; if (t) for (const v of t) if (v >= 128 && v < 192) s.add(v - 128); }); return s; }
  function usage() { const u = X.usage(I.team); return { jersey: u.jersey, crest: u.crest, tiles: tileSlots() }; }
  function renderOpts() {
    const raw = {}; for (const k of OPTS) raw[k === 'free' ? 'freeOnly' : k] = $('ice-o-' + k).checked;
    const bad = A.conflicts(raw);
    for (const k of OPTS) {
      const why = bad[k === 'free' ? 'freeOnly' : k]; const el = $('ice-o-' + k); el.disabled = I.ro || Boolean(why);
      el.parentElement.setAttribute('aria-disabled', String(Boolean(why))); el.parentElement.title = why || '';
    }
    if (raw.freeOnly) for (const k of ['jersey', 'crest', 'tiles']) { $('ice-o-' + k).disabled = true; $('ice-o-' + k).parentElement.setAttribute('aria-disabled', 'true'); $('ice-o-' + k).parentElement.title = '"Only free team slots" already keeps every used colour'; }
    if (!I.model) return;
    const u = usage(); const sets = A.slotSets(opts(), u);
    $('ice-slots').textContent = 'Team slots: jersey uses ' + u.jersey.size + ', crest ' + u.crest.size + ', tiles ' + u.tiles.size + ' · ' + sets.free.length + ' free · ' +
      (opts().team ? sets.writable.length + ' may be rewritten' : 'none rewritten');
  }
  function renderAll() {
    if (!I.model) return;
    I.pal = palette();
    document.querySelectorAll('.ice-edit').forEach((el) => { el.disabled = I.ro; });
    renderTeams(); renderSwatches(); renderTiles(); renderTileEdit(); renderPlace(); renderRink(); renderOpts();
    $('ice-float-bar').hidden = !I.float; if (I.float) $('ice-float-name').textContent = I.float.name + ' (' + I.float.w + '×' + I.float.h + ') at ' + I.float.x + ', ' + I.float.y;
    document.querySelectorAll('.ice-needsel').forEach((el) => { el.disabled = I.ro || !I.sel; });
    $('ice-paste').disabled = I.ro || !I.clip;
    $('ice-sel-info').textContent = I.sel ? 'Selection ' + I.sel.w + ' × ' + I.sel.h + ' at ' + I.sel.x + ', ' + I.sel.y : (I.clip ? 'Clipboard ' + I.clip.w + ' × ' + I.clip.h : '');
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
    if (I.float) { // while an import floats, the canvas drags it
      I.drag = { float: true, x: p.x, y: p.y }; $('ice-rink').setPointerCapture(e.pointerId); I.down = true; return;
    }
    if (I.tool === 'pick') { const v = rinkPixels()[p.py * R.PX_W + p.px]; if (R.usable(v)) I.color = v; X.status('Picked index ' + v + ' (' + R.rangeOf(v).label + ')'); renderSwatches(); return; }
    remember();
    if (I.tool === 'paint') paintAt(p);
    else if (I.tool === 'place') { if (!I.model.tiles[I.tile]) { I.model.tiles.push(new Uint8Array(64).fill(R.CLEAR)); I.tile = I.model.tiles.length - 1; } I.model.cells[k] = I.tile; }
    else if (I.tool === 'erase') I.model.cells[k] = -1;
    else if (I.tool === 'move') I.drag = { x: p.x, y: p.y };
    else if (I.tool === 'select') {
      const s = I.sel;
      if (s && p.x >= s.x && p.y >= s.y && p.x < s.x + s.w && p.y < s.y + s.h) { // move the block as a whole
        const b = R.grab(I.model, s); R.clearRect(I.model, s);
        I.drag = { block: b, under: R.cloneModel(I.model), x: p.x, y: p.y, sx: s.x, sy: s.y }; R.stamp(I.model, b, s.x, s.y);
      } else { I.undo.pop(); I.drag = { from: p }; I.sel = { x: p.x, y: p.y, w: 1, h: 1 }; }
    }
    $('ice-rink').setPointerCapture(e.pointerId); I.down = true; renderAll();
  }
  function onMove(e) {
    if (!I.down) return; const p = cellAt(e); if (!p) return;
    if (I.drag && I.drag.float) {
      if (p.x === I.drag.x && p.y === I.drag.y) return;
      I.float.x += p.x - I.drag.x; I.float.y += p.y - I.drag.y; I.drag.x = p.x; I.drag.y = p.y; renderRink();
      $('ice-float-name').textContent = I.float.name + ' (' + I.float.w + '×' + I.float.h + ') at ' + I.float.x + ', ' + I.float.y; return;
    }
    if (I.tool === 'paint') { paintAt(p); renderRink(); renderTileEdit(); }
    else if (I.tool === 'place') { I.model.cells[p.y * R.W + p.x] = I.tile; renderRink(); }
    else if (I.tool === 'erase') { I.model.cells[p.y * R.W + p.x] = -1; renderRink(); }
    else if (I.tool === 'select' && I.drag && I.drag.from) {
      const a = I.drag.from; I.sel = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(a.x - p.x) + 1, h: Math.abs(a.y - p.y) + 1 }; renderRink();
    } else if (I.tool === 'select' && I.drag && I.drag.block) {
      const d = I.drag, x = d.sx + p.x - d.x, y = d.sy + p.y - d.y; if (x === I.sel.x && y === I.sel.y) return;
      I.model = R.cloneModel(d.under); R.stamp(I.model, d.block, x, y); I.sel = { x, y, w: d.block.w, h: d.block.h }; renderPlace(); renderRink();
    } else if (I.tool === 'move' && I.drag && (p.x !== I.drag.x || p.y !== I.drag.y)) { moveBy(p.x - I.drag.x, p.y - I.drag.y); I.drag = { x: p.x, y: p.y }; renderPlace(); renderRink(); }
  }
  function onUp() {
    if (!I.down) return; I.down = false;
    if (I.drag && I.drag.block && I.sel.x === I.drag.sx && I.sel.y === I.drag.sy) I.undo.pop(); // clicked, did not move
    I.drag = null; renderAll();
  }
  // ---- blocks -------------------------------------------------------------------------------------------------
  function blockOp(op) {
    if (I.ro || !I.sel) return; remember();
    const b = R.grab(I.model, I.sel); R.clearRect(I.model, I.sel);
    const nb = R.transform(I.model, b, op); const x = Math.min(I.sel.x, R.W - nb.w), y = Math.min(I.sel.y, R.H - nb.h);
    R.stamp(I.model, nb, Math.max(0, x), Math.max(0, y)); I.sel = R.clipRect({ x: Math.max(0, x), y: Math.max(0, y), w: nb.w, h: nb.h });
    const added = I.model.tiles.length - I.undo[I.undo.length - 1].tiles.length;
    X.status({ h: 'Mirrored', v: 'Flipped', 180: 'Rotated 180°', 90: 'Rotated 90°', 270: 'Rotated 270°' }[op] + ' the ' + nb.w + ' × ' + nb.h + ' block' +
      (added ? ' (' + added + ' rotated tiles added)' : ' with the cells\' mirror / flip bits (tile pixels unchanged)'));
    renderAll();
  }
  function copySel(cut) {
    if (I.ro || !I.sel) return; I.clip = R.grab(I.model, I.sel);
    if (cut) { remember(); R.clearRect(I.model, I.sel); }
    X.status((cut ? 'Cut ' : 'Copied ') + I.clip.w + ' × ' + I.clip.h + ' cells'); renderAll();
  }
  function paste() {
    if (I.ro || !I.clip) return; remember();
    const x = I.sel ? I.sel.x : 0, y = I.sel ? I.sel.y : 0; R.stamp(I.model, I.clip, x, y);
    I.sel = R.clipRect({ x, y, w: I.clip.w, h: I.clip.h }); I.tool = 'select';
    document.querySelectorAll('[data-tool]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.tool === 'select')));
    X.status('Pasted ' + I.clip.w + ' × ' + I.clip.h + ' cells at ' + x + ', ' + y + '; drag inside the selection to move it'); renderAll();
  }
  function clearSel() { if (I.ro || !I.sel) return; remember(); R.clearRect(I.model, I.sel); renderAll(); }
  function editTile(e) {
    if (I.ro) return; const t = I.model.tiles[I.tile]; if (!t) return;
    const c = $('ice-tile-edit'), r = c.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * 8 / r.width), y = Math.floor((e.clientY - r.top) * 8 / r.height);
    if (x < 0 || y < 0 || x > 7 || y > 7) return;
    remember(); t[y * 8 + x] = e.button === 2 || e.altKey ? R.CLEAR : I.color; renderAll();
  }

  // ---- import / export ----------------------------------------------------------------------------------------
  /** Every centre ice edited this session (the open one plus arenas switched away from):
   *  [{ name, team, files: { til, map }, json }] for files that differ from the game's. */
  function editedArenas() {
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
    const list = []; const add = (name, team, model, original, raw) => {
      let o; try { o = R.exportFiles(model, original); } catch (e) { return; }
      if (raw && same(o.til, raw.til) && same(o.map, raw.map)) return;
      list.push({ name, team, til: o.til, map: o.map, json: placementJson(name, team, model) });
    };
    for (const k of Object.keys(I.cache)) { const c = I.cache[k]; if (k.startsWith('95')) add(k.slice(2), c.team, c.model, c.original, c.raw); }
    if (I.model && !I.ro && (I.model.tiles.length || I.raw)) add(code(), I.team, I.model, I.original, I.raw);
    return list;
  }
  function exportNow() {
    const out = R.exportFiles(I.model, I.original); return out;
  }
  function placementJson(name, team, model) {
    model = model || I.model; name = name || code(); team = team == null ? I.team : team;
    let b = null; try { b = R.build(model); } catch (e) { b = null; } const p = b ? b.place : model.place;
    return { game: 'nhl95pc', arena: name, team: teamName(team), x: p[0], y: p[1], x2: p[2], y2: p[3],
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
    const o = opts(); const colors = X.homeColors(I.team);
    if (o.team && !colors) throw new Error('Team colour slots need HOMEPALS.BIN: open it, or turn off "team colour slots"');
    const rink = []; for (let i = 0; i < 256; i++) { const r = R.rangeOf(i); if (r.usable && r.source !== 'home' && i !== R.CLEAR && I.pal && I.pal[i]) rink.push({ index: i, rgb6: I.pal[i].map(A.to6) }); }
    const alloc = A.allocate(im.rgba, colors || [], rink, o, usage());
    const idx = A.indexImage(im.rgba, alloc);
    const full = im.w === R.PX_W && im.h === R.PX_H;
    const tw = Math.ceil(im.w / 8), th = Math.ceil(im.h / 8);
    const x = full ? 0 : Math.max(0, Math.round((R.W - tw) / 2)), y = full ? 0 : Math.max(0, Math.round((R.H - th) / 2));
    const mode = $('ice-q-cells').value; let pick = null, how = 'every cell with a visible pixel';
    if (mode === 'diff') {
      if (!I.rink) throw new Error('"Differs from the rink" needs RINK.QFS (95) or RINK.TIL / RINK.MAP (94): open the game folder');
      pick = R.cellsDiffering(idx, im.w, im.h, x, y, I.rink); how = 'cells that differ from RINK.QFS';
    } else if (mode === 'mask') {
      if (!I.mask) throw new Error('Choose a mask image first (Mask…): white cells become tiles');
      if (I.mask.w !== im.w || I.mask.h !== im.h) throw new Error('The mask ' + I.mask.name + ' is ' + I.mask.w + '×' + I.mask.h + '; it must match the image (' + im.w + '×' + im.h + ')');
      pick = R.cellsFromMask(I.mask.rgba, I.mask.w, I.mask.h); how = 'white cells of ' + I.mask.name;
    }
    I.float = { name: file.name, idx, w: im.w, h: im.h, x, y, pick, colors: o.team ? alloc.colors : colors, written: alloc.written, replace: $('ice-q-replace').checked, how };
    renderAll();
    X.status('Floating ' + file.name + ' (' + im.w + '×' + im.h + '), ' + how + '; ' + alloc.written.length + ' team slot' + (alloc.written.length === 1 ? '' : 's') + ' rewritten' +
      (alloc.written.length ? ' (' + alloc.written.join(', ') + ')' : '') + '. Drag to place, then Apply or Cancel.');
  }
  function applyFloat() {
    const f = I.float; if (!f) return;
    const keep = new Set(floatCells().map((c) => c.row * 4096 + c.col));
    const base = f.replace ? { cells: new Int32Array(R.W * R.H).fill(-1), tiles: [], place: I.model.place.slice(), flag: I.model.flag } : I.model;
    let next;
    try { next = R.placeImage(base, f.idx, f.w, f.h, f.x, f.y, (col, row) => keep.has(row * 4096 + col)); } catch (e) { if (e.tiles) X.status(e.message, true); throw e; }
    remember();
    if (f.written.length) X.setHomeColors(I.team, f.colors);
    I.model = next; I.float = null; I.tile = Math.max(0, (I.model.cells.find((e) => e >= 0) || 0) & R.CELL); renderAll();
    X.status('Applied ' + f.name + ': ' + R.tileCount(I.model) + ' / ' + R.MAX_TILES + ' tiles after removing duplicates' + (f.written.length ? '; HOMEPALS team slots ' + f.written.join(', ') + ' rewritten' : ''));
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
    $('ice-zoom').addEventListener('input', () => { I.zoom = Number($('ice-zoom').value); $('ice-zoom-val').textContent = I.zoom + '×'; renderRink(); });
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
    $('ice-sel-logo').addEventListener('click', () => { const b = R.bounds(I.model); I.sel = b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null; I.tool = 'select';
      document.querySelectorAll('[data-tool]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.tool === 'select'))); renderAll(); });
    $('ice-copy').addEventListener('click', () => copySel(false)); $('ice-cut').addEventListener('click', () => copySel(true));
    $('ice-paste').addEventListener('click', paste); $('ice-clear').addEventListener('click', clearSel);
    document.querySelectorAll('[data-xf]').forEach((b) => b.addEventListener('click', () => blockOp(b.dataset.xf)));
    document.addEventListener('keydown', (e) => {
      if ($('ice-main').hidden || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'c') { copySel(false); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'x') { copySel(true); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'v') { paste(); e.preventDefault(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { clearSel(); e.preventDefault(); }
      else if (e.key === 'Escape') { I.sel = null; renderAll(); }
    });
    $('ice-del-tile').addEventListener('click', () => {
      if (I.ro || !I.model.tiles[I.tile]) return; const n = R.usersOf(I.model, I.tile);
      if (n && !window.confirm(n + ' cell' + (n > 1 ? 's use' : ' uses') + ' tile ' + I.tile + '; they will become empty. Delete it?')) return;
      remember(); const r = R.deleteTile(I.model, I.tile); I.model = r.model; const t = I.tile; I.tile = Math.min(I.tile, I.model.tiles.length - 1);
      X.status('Deleted tile ' + t + (r.cleared ? '; ' + r.cleared + ' cell' + (r.cleared > 1 ? 's' : '') + ' that used it are now empty' : '') + '; later tiles renumbered'); renderAll();
    });
    $('ice-unused').addEventListener('click', () => {
      if (I.ro) return; const r = R.removeUnused(I.model);
      if (!r.removed) { X.status('No unused tiles: every tile is used by a cell'); return; }
      remember(); I.model = r.model; I.tile = Math.max(0, (I.model.cells.find((e) => e >= 0) || 0) & R.CELL);
      X.status('Removed ' + r.removed + ' unused tile' + (r.removed > 1 ? 's' : '') + '; ' + I.model.tiles.length + ' left, map renumbered (Undo restores them)'); renderAll();
    });
    $('ice-float-apply').addEventListener('click', X.guard(applyFloat));
    $('ice-float-cancel').addEventListener('click', () => { I.float = null; renderAll(); X.status('Import cancelled'); });
    OPTS.concat(['cells']).forEach((k) => $('ice-o-' + k).addEventListener('change', () => { renderOpts(); if (I.float) renderRink(); }));
    $('ice-import-image').addEventListener('click', X.guard(async () => { const f = await file($('ice-image-file')); if (f) await importImage(f); }));
    $('ice-mask').addEventListener('click', X.guard(async () => {
      const f = await file($('ice-mask-file')); if (!f) return;
      I.mask = Object.assign(await readImage(f), { name: f.name }); $('ice-q-cells').value = 'mask';
      $('ice-mask').textContent = 'Mask: ' + f.name; X.status('Mask ' + f.name + ' (' + I.mask.w + '×' + I.mask.h + '): white cells become tiles on the next image import');
    }));
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
    if (ice && !st().sources) X.status('Open an NHL 95 PC game folder or its files to edit its centre ice logos');
  }
  wire();
  window.JedIce = { state: I, load, tab, editedArenas, tileSlots: (team) => (I.model && I.team === team && !I.ro ? tileSlots() : new Set()) };
}());
