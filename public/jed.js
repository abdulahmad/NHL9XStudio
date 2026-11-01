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
    S.sources = { kind: 'local', map };
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
    S.sources = { kind: 'server', id };
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
    applyGameRink();
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
    Shared.loaded.forEach((fn) => fn());
    loadCrests();
  }
  function crestBankName() { return S.game === '94' ? 'CRESTS4.QPP' : 'CRESTS4.PPV'; }
  function openCrestBank(bytes) {
    try { return NhlPcCrests.parse(bytes); } catch (err) {
      const opened = Nhl95Pc.openBytes(bytes);
      if (opened && NhlPcCrests.fromShapes) return NhlPcCrests.fromShapes(opened);
      throw err;
    }
  }
  async function loadCrests() {
    S.crests = null; let b = null;
    try {
      b = await Shared.file(crestBankName());
      if (!b) b = await Shared.file(S.game === '94' ? 'CRESTS4.PPV' : 'CRESTS4.QPP');
    } catch (err) { b = null; }
    if (b) {
      try { S.crests = openCrestBank(b); } catch (err) { S.crests = null; }
    }
    if (cur()) renderZones();
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
    const away = S.side === 'away';
    const jSlots = J.jerseySlots(cur().file, S.team), cSlots = J.crestSlots(cur().file, S.team);
    colors.forEach((c, i) => {
      const b = document.createElement('button');
      const rinkOwned = J.awayOverwritten(S.game, S.side, i);
      b.type = 'button'; b.className = 'jed-sw' + (used.has(i) ? '' : ' unused') + (c.join() !== orig[i].join() ? ' edited' : '') + (rinkOwned ? ' rinkfixed' : '');
      const k = (192 + i) * 3, rc = rinkOwned && S.base && S.base.rinkPlain ? [S.base.rinkPlain[k], S.base.rinkPlain[k + 1], S.base.rinkPlain[k + 2]] : null;
      b.style.background = rc ? 'rgb(' + rc.join(',') + ')' : rgb8(c); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === S.color));
      b.dataset.tip = 'Colour ' + i + ' (game ' + ((away ? 192 : 128) + i) + ') · 6-bit ' + c.join(', ') + ' · 8-bit ' + hex8(c).toUpperCase() +
        (used.has(i) ? ' · used by ' + [jSlots.has(i) && 'jersey', cSlots.has(i) && 'scoreboard crest'].filter(Boolean).join(' + ') : ' — not used by any spot') +
        (rinkOwned ? ' — in NHL 95 PC the rink palette overwrites game ' + (192 + i) + ' (shown: rink colour ' + (rc ? rc.join(', ') : '?') + '); this value never shows' : '');
      b.addEventListener('click', () => { S.color = i; renderSwatches(); renderColor(); });
      box.appendChild(b);
    });
  }

  function renderColor() {
    const c = J.getColors(cur().file, S.team)[S.color];
    $('jed-big').style.background = rgb8(c);
    $('jed-color-name').textContent = 'Colour ' + S.color + ' · game index ' + ((S.side === 'away' ? 192 : 128) + S.color) +
      (J.awayOverwritten(S.game, S.side, S.color) ? ' · overwritten by the rink palette in NHL 95 PC (never shows)' : '');
    $('jed-hex').textContent = '6-bit ' + c.join(', ') + ' · 8-bit ' + c.map(J.to8).join(', ');
    if (document.activeElement !== $('jed-hex-in')) { $('jed-hex-in').value = hex8(c).toUpperCase(); $('jed-hex-in').classList.remove('bad'); }
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
      clickSpot(z.sprite);
    });
    b.addEventListener('mouseenter', () => { if ($('jed-hover-outline').checked) { S.hover = z.sprite; drawOverlay(); } });
    b.addEventListener('mouseleave', () => { if (S.hover === z.sprite) { S.hover = null; drawOverlay(); } });
    return b;
  }
  /** Zones grouped: "waist 2 light/medium/dark" share one row (dark, medium, light); others are single rows. */
  function zoneGroups() {
    const SHADES = ['dark', 'medium', 'light'];
    const groups = []; const byBase = new Map();
    // Rows without dark/medium/light in their names: columns are dark, medium, light.
    const FIXED = [['yoke', ['yoke 3', 'yoke 2', 'yoke 1']], ['upper body', ['goalie mask', 'yoke corner', 'shoulder patch']],
      ['waist 1', ['waist 1 hidden', 'waist 1 even', 'waist 1 odd']]];
    const fixedOf = new Map(); for (const [base, names] of FIXED) names.forEach((n, i) => fixedOf.set(n, { base, short: n === base ? n : n.replace(/^waist 1 /, ''), i }));
    for (const z of J.ZONES) {
      const f = fixedOf.get(z.name);
      if (f) {
        let g = byBase.get(f.base);
        if (!g) { g = { base: f.base, zones: [], fixed: true }; byBase.set(f.base, g); groups.push(g); }
        g.zones[f.i] = Object.assign({}, z, { short: f.short }); continue;
      }
      const words = z.name.split(' '); const last = words[words.length - 1];
      const base = SHADES.includes(last) ? words.slice(0, -1).join(' ') : z.name;
      let g = byBase.get(base);
      if (!g) { g = { base, zones: [] }; byBase.set(base, g); groups.push(g); }
      g.zones.push(Object.assign({ short: SHADES.includes(last) ? last : '' }, z));
    }
    for (const g of groups) if (!g.fixed) g.zones.sort((x, y) => SHADES.indexOf(x.short) - SHADES.indexOf(y.short));
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
    crestLogo(box); scoreboardCrest(box);
    for (const g of zoneGroups()) {
      if (g.zones.length === 1 && !g.zones[0].short) { box.appendChild(zoneButton(Object.assign({}, g.zones[0], { short: g.base }), map, colors)); continue; }
      const row = document.createElement('div'); row.className = 'jed-zgroup';
      const name = document.createElement('b'); name.textContent = g.base; row.appendChild(name);
      for (const z of g.zones) row.appendChild(zoneButton(Object.assign({}, z, { short: z.short || z.name.slice(g.base.length + 1), shade: g.fixed ? ['dark', 'medium', 'light'][g.zones.indexOf(z)] : null }), map, colors));
      box.appendChild(row);
    }
  }
  /** The team crest as the game draws it on the jersey front: a 5 × 4 picture whose pixels are sprite colours
   *  192+row*16+col (every player frame uses exactly these), shown in the current palette. Click a pixel to paint it. */
  const CREST_PX = 20;
  function crestLogo(box) {
    const h = document.createElement('div'); h.className = 'jed-grid-title'; h.textContent = 'Jersey crest (5 × 4, sprite colours 192–196, 208–212, 224–228, 240–244)'; box.appendChild(h);
    const c = document.createElement('canvas'); c.id = 'jed-crest'; c.className = 'jed-crest'; c.width = 5 * CREST_PX; c.height = 4 * CREST_PX;
    const pal = teamPalette(); const ctx = c.getContext('2d');
    J.CREST.forEach((z, i) => { const rgb = pal[z.sprite]; ctx.fillStyle = 'rgb(' + rgb.join(',') + ')'; ctx.fillRect((i % 5) * CREST_PX, Math.floor(i / 5) * CREST_PX, CREST_PX, CREST_PX); });
    const at = (e) => { const r = c.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * 5); const y = Math.floor((e.clientY - r.top) / r.height * 4); return x >= 0 && x < 5 && y >= 0 && y < 4 ? J.CREST[y * 5 + x].sprite : null; };
    c.addEventListener('mousemove', (e) => { const p = at(e); c.title = p == null ? '' : spotName(p) + ' (sprite ' + p + ')'; if ($('jed-hover-outline').checked && p !== S.hover) { S.hover = p; drawOverlay(); } });
    c.addEventListener('mouseleave', () => { S.hover = null; drawOverlay(); });
    c.addEventListener('click', (e) => { const p = at(e); if (p != null) clickSpot(p); });
    box.appendChild(c);
  }
  // ---- scoreboard crest import / export (JED 3.01: F5 import PCX, F6 export PCX; here also PNG/BMP/GIF and SPIT) ----
  const CREST_OPTS = [['team', 'Team colour slots', true], ['rink', 'Rink colours (home only)', true], ['overwrite', 'Overwrite team palette', false],
    ['jersey', 'Keep jersey colours', true], ['crest', 'Keep current crest colours', false], ['tiles', 'Keep centre ice colours', true], ['free', 'Only free slots', false], ['both', 'Home and away records', true]];
  S.crestOpts = S.crestOpts || Object.fromEntries(CREST_OPTS.map(([k, , v]) => [k, v]));
  function crestTools(box, shape) {
    const bar = document.createElement('div'); bar.className = 'jed-crest-tools'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Scoreboard crest files');
    const btn = (id, label, tip, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost-btn'; b.id = id; b.textContent = label; b.dataset.tip = tip; b.addEventListener('click', guard(fn)); bar.appendChild(b); };
    btn('jed-crest-import', 'Import crest…', 'PNG, BMP, GIF, JED .PCX (32 × 24, transparent = see-through) or a game-format .SPT shape', () => importCrest(shape));
    btn('jed-crest-png', 'PNG', 'Export this crest as PNG (transparent background)', () => exportCrest(shape, 'png'));
    btn('jed-crest-pcx', 'PCX', 'Export as 8-bit PCX like JED (F6): pixel values are the sprite colours', () => exportCrest(shape, 'pcx'));
    btn('jed-crest-spt', 'SPT', 'Export the game-format shape (SPIT header + RLE, as stored in CRESTS4.PPV)', () => exportCrest(shape, 'spt'));
    btn('jed-crest-revert', 'Revert', 'Put back this crest\'s pixels from ' + crestBankName() + ' as opened', () => { shape.pixels = Uint8Array.from(shape.orig); renderZones(); status(teamCode() + ' crest pixels reverted (colours: use Undo)'); });
    btn('jed-crests-in', 'Open ' + crestBankName() + '…', 'Replace the whole crests file', async () => { const f = await readFile($('jed-import-ppv')); if (!f) return; S.crests = openCrestBank(f.bytes); renderZones(); status(f.name + ': ' + S.crests.entries.length + ' crests'); });
    btn('jed-crests-out', 'Save ' + crestBankName(), 'Export the whole crests file with your edits', () => { download(NhlPcCrests.write(S.crests), crestBankName()); status(crestBankName() + ' saved' + (NhlPcCrests.edited(S.crests) ? ' (edited crests re-encoded)' : ' (unchanged)')); });
    if (S.crests && S.crests.planar) {
      const save = bar.querySelector('#jed-crests-out');
      if (save) { save.disabled = true; save.dataset.tip = 'NHL 94 PC CRESTS4.QPP cannot be saved yet (view / paint only)'; }
    }
    box.appendChild(bar);
    const fs = document.createElement('fieldset'); fs.className = 'jed-crest-opts'; fs.id = 'jed-crest-opts';
    const lg = document.createElement('legend'); lg.textContent = 'Crest import colours'; fs.appendChild(lg);
    const raw = { team: S.crestOpts.team, rink: S.crestOpts.rink, overwrite: S.crestOpts.overwrite, jersey: S.crestOpts.jersey, crest: S.crestOpts.crest, tiles: S.crestOpts.tiles, freeOnly: S.crestOpts.free };
    const bad = NhlPcPalette.conflicts(raw);
    for (const [k, label] of CREST_OPTS) {
      const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.id = 'jed-co-' + k; i.checked = S.crestOpts[k];
      const why = bad[k === 'free' ? 'freeOnly' : k] || (S.crestOpts.free && ['jersey', 'crest', 'tiles'].includes(k) ? '"Only free slots" already keeps every used colour' : '');
      i.disabled = Boolean(why); l.title = why; i.addEventListener('change', () => { S.crestOpts[k] = i.checked; renderZones(); });
      l.append(i, ' ' + label); fs.appendChild(l);
    }
    box.appendChild(fs);
  }
  function crestOptions() { const o = {}; const raw = { team: S.crestOpts.team, rink: S.crestOpts.rink, overwrite: S.crestOpts.overwrite, jersey: S.crestOpts.jersey, crest: S.crestOpts.crest, tiles: S.crestOpts.tiles, freeOnly: S.crestOpts.free };
    const bad = NhlPcPalette.conflicts(raw); for (const k of Object.keys(raw)) o[k] = raw[k] && !bad[k]; if (o.freeOnly) { o.jersey = o.crest = o.tiles = true; } return o; }
  function crestPalette8(shape) { // 256 x RGB of how the crest shows now (index 67 = game colour 103)
    const p = teamPalette(); const out = new Uint8Array(768);
    for (let i = 0; i < 256; i++) { const c = (i === J.CREST_OUTLINE ? p.game && p.game[J.CREST_OUTLINE_GAME] : (p.sprite || p)[i]) || [0, 0, 0]; out.set(c.slice(0, 3), i * 3); }
    return out;
  }
  async function exportCrest(shape, kind) {
    const name = teamCode();
    if (kind === 'spt') { download(NhlPcCrests.exportSpit(shape), name + '-crest.spt'); return; }
    if (kind === 'pcx') { download(NhlPcCrests.writePcx(shape.pixels, shape.width, shape.height, crestPalette8(shape)), name + '-crest.pcx'); return; }
    const c = document.createElement('canvas'); c.width = shape.width; c.height = shape.height; c.getContext('2d').putImageData(new ImageData(J.crestRgb(shape, teamPalette()), shape.width, shape.height), 0, 0);
    download(await new Promise((ok) => c.toBlob((b) => b.arrayBuffer().then((a) => ok(new Uint8Array(a))), 'image/png')), name + '-crest.png');
  }
  async function decodeImage(f) {
    const url = URL.createObjectURL(new Blob([f.bytes]));
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not read ' + f.name + ' as an image')); i.src = url; });
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, rgba: x.getImageData(0, 0, c.width, c.height).data };
    } finally { URL.revokeObjectURL(url); }
  }
  async function importCrest(shape) {
    const f = await readFile($('jed-import-crest')); if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'spt') { const sp = NhlPcCrests.importSpit(f.bytes); if (sp.width !== shape.width || sp.height !== shape.height) throw new Error(f.name + ' is ' + sp.width + '×' + sp.height + '; ' + teamCode() + ' is ' + shape.width + '×' + shape.height);
      shape.pixels = sp.pixels; renderZones(); status(f.name + ': crest pixels replaced (sprite colours kept as in the file)'); return; }
    let im = ext === 'pcx' ? NhlPcCrests.readPcx(f.bytes) : await decodeImage(f);
    if (ext === 'pcx' && f.bytes.length) { const r = im.rgba; for (let i = 0; i < im.idx.length; i++) if (im.idx[i] === 255) r[i * 4 + 3] = 0; } // JED: colour 255 = see-through
    if (im.w > shape.width || im.h > shape.height) throw new Error(f.name + ' is ' + im.w + '×' + im.h + '; scoreboard crests are ' + shape.width + '×' + shape.height);
    const w = shape.width, h = shape.height, ox = Math.floor((w - im.w) / 2), oy = Math.floor((h - im.h) / 2);
    const rgba = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < im.h; y++) rgba.set(im.rgba.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((y + oy) * w + ox) * 4);
    const o = crestOptions(); if (!o.team && !o.rink) throw new Error('Turn on team colour slots and/or rink colours');
    const sides = S.crestOpts.both ? ['home', 'away'].filter((sd) => S.files[sd]) : [S.side];
    remember(); const report = []; let pixels = null; const keepSide = S.side;
    for (const side of sides) { // like JED: home and away records each get their own colours and map
      S.side = side; const file = S.files[side].file; const away = side === 'away';
      const colors = J.getColors(file, S.team); const p = teamPalette(); const rink = [];
      if (o.rink && !away) for (let i = 0; i < 128; i++) if (p.game && p.game[i] && i !== 0) rink.push({ index: i, rgb6: p.game[i].map(NhlPcPalette.to6) });
      const exclude = new Set(); if (away) for (let k = J.AWAY_RINK_FIRST; k < 64; k++) exclude.add(k);
      const used = { jersey: J.jerseySlots(file, S.team), crest: J.crestSlots(file, S.team), tiles: window.JedIce ? window.JedIce.tileSlots(S.team) : new Set() };
      const alloc = NhlPcPalette.allocate(rgba, colors, rink, Object.assign({}, o, { rink: o.rink && !away, maxColors: J.SCOREBOARD.length, exclude }), used);
      const idx = NhlPcPalette.indexImage(rgba, alloc); const games = [...new Set(idx)].filter((v) => v !== 255);
      if (games.length > J.SCOREBOARD.length) throw new Error(f.name + ' needs ' + games.length + ' colours; a crest has ' + J.SCOREBOARD.length);
      alloc.colors.forEach((c, k) => { if (alloc.written.includes(k)) J.setColor(file, S.team, k, c); });
      const spriteOf = new Map(); games.forEach((g, k) => { spriteOf.set(g, J.SCOREBOARD[k].sprite); J.setMap(file, S.team, J.SCOREBOARD[k].sprite, g); });
      const px = Uint8Array.from(idx, (v) => (v === 255 ? 255 : spriteOf.get(v)));
      if (!pixels) pixels = px; else if (px.some((v, i) => v !== pixels[i])) report.push('away pixel layout differs; home layout kept');
      report.push(side + ': ' + games.length + ' colours, slots rewritten ' + (alloc.written.length ? alloc.written.join(', ') : 'none'));
    }
    S.side = keepSide; shape.pixels = pixels; renderAll();
    status(f.name + ' → ' + teamCode() + ' scoreboard crest (' + im.w + '×' + im.h + '); ' + report.join('; ') + '. Save HOMEPALS/AWAYPALS and ' + crestBankName() + ' (or Export all).');
  }
  /** Scoreboard crest (CRESTS4.QPP on 94 PC, CRESTS4.PPV on 95 PC), tagged with the team code. */
  function scoreboardCrest(box) {
    const shape = S.crests && NhlPcCrests.find(S.crests, teamCode());
    const h = document.createElement('div'); h.className = 'jed-grid-title';
    const bank = crestBankName();
    h.textContent = shape ? 'Scoreboard crest (' + bank + ' ' + shape.width + ' × ' + shape.height + ', sprite colours 197–202, 213–218, 229–234, 245–250)'
      : 'Scoreboard crest: ' + (S.crests ? 'no ' + teamCode() + ' shape in ' + bank : bank + ' not found in the game files');
    box.appendChild(h); if (!shape) return;
    const k = 6; const c = document.createElement('canvas'); c.id = 'jed-sbcrest'; c.className = 'jed-crest'; c.width = shape.width * k; c.height = shape.height * k;
    const img = new ImageData(J.crestRgb(shape, teamPalette()), shape.width, shape.height);
    const t = document.createElement('canvas'); t.width = shape.width; t.height = shape.height; t.getContext('2d').putImageData(img, 0, 0);
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(t, 0, 0, c.width, c.height);
    const at = (e) => { const r = c.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * shape.width); const y = Math.floor((e.clientY - r.top) / r.height * shape.height);
      const p = x >= 0 && x < shape.width && y >= 0 && y < shape.height ? shape.pixels[y * shape.width + x] : null; return p != null && p >= 128 && p !== 255 ? p : null; };
    c.addEventListener('mousemove', (e) => { const p = at(e); c.title = p == null ? '' : spotName(p) + ' (sprite ' + p + ')'; if ($('jed-hover-outline').checked && p !== S.hover) { S.hover = p; drawOverlay(); } });
    c.addEventListener('mouseleave', () => { S.hover = null; drawOverlay(); });
    c.addEventListener('click', (e) => { const p = at(e); if (p != null) clickSpot(p); });
    box.appendChild(c);
    crestTools(box, shape);
  }
  /** Click on a spot (list, crest, scoreboard crest or the big sprite): paint it with the selected colour when
   *  "Click paints" is on, otherwise select the colour it uses. */
  function clickSpot(sprite) {
    if ($('jed-paint').checked) { assignSpot(sprite); status(spotName(sprite) + ' now uses colour ' + S.color); return; }
    const t = J.getMap(cur().file, S.team)[sprite];
    if (t >= 128 && t < 192) { S.color = t - 128; renderSwatches(); renderColor(); status(spotName(sprite) + ' uses colour ' + S.color); }
    else status(spotName(sprite) + ' uses rink colour ' + t + ' (not a team colour)');
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
    if (S.base) return J.spritePalette(cur().file, S.team, S.base, S.side);
    return Nhl95Pc.buildTeamPalette(J.getRecord(cur().file, S.team), S.rink);
  }
  let bundledBase = null;
  function applyGameRink() {
    if (!S.base || !bundledBase) return;
    if (S.game === '94' && S.rink) {
      const act = Nhl95Pc.colorsToAct(S.rink);
      S.base.rinkPlain = act;
      S.base.rink = J.overlayRink(bundledBase.rink, act);
    } else {
      S.base.rink = Uint8Array.from(bundledBase.rink);
      S.base.rinkPlain = bundledBase.rinkPlain ? Uint8Array.from(bundledBase.rinkPlain) : bundledBase.rinkPlain;
    }
  }
  async function loadBase() {
    const get = async (n) => { try { return await fetchBytes('jed-pals/' + n); } catch (err) { return null; } };
    const [rink, jersey, rinkPlain] = await Promise.all(['rinkpalShadowfixed.act', 'createjerseyShadowfixed.act', 'rinkpal.act'].map(get));
    S.base = rink && jersey ? { rink, jersey, rinkPlain } : null;
    bundledBase = S.base ? {
      rink: Uint8Array.from(S.base.rink),
      jersey: S.base.jersey,
      rinkPlain: S.base.rinkPlain ? Uint8Array.from(S.base.rinkPlain) : S.base.rinkPlain
    } : null;
    if (!S.base) status('Could not load jed-pals/*.act; the preview falls back to the Studio palette and .ACT export is off', true);
    applyGameRink();
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
  function spotName(p) { const z = J.ZONES.concat(J.CREST, J.SCOREBOARD).find((q) => q.sprite === p); return z ? z.name : 'sprite colour ' + p; }

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
  /** Export all: a store-only zip of the files that differ from what was opened. */
  function exportAll() {
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]); const enc = new TextEncoder(); const entries = [];
    for (const side of ['home', 'away']) { const f = S.files[side]; if (f && !same(f.file.bytes, f.original)) entries.push({ name: side === 'home' ? 'HOMEPALS.BIN' : 'AWAYPALS.BIN', data: J.exportFile(f.file) }); }
    if (S.crests && !S.crests.planar && NhlPcCrests.edited(S.crests)) entries.push({ name: crestBankName(), data: NhlPcCrests.write(S.crests) });
    for (const a of (window.JedIce ? window.JedIce.editedArenas() : [])) entries.push({ name: a.name + '.MAP', data: a.map }, { name: a.name + '.TIL', data: a.til }, { name: a.name + '-placement.json', data: enc.encode(JSON.stringify(a.json, null, 2) + '\n') });
    if (!entries.length) { status('Nothing edited yet: no file differs from what you opened', true); return; }
    download(NhlZipStore.zipStore(entries), 'nhl95pc-edits.zip');
    status('nhl95pc-edits.zip: ' + entries.map((e) => e.name).join(', '));
    return entries.map((e) => e.name);
  }
  function guard(fn) { return async (...a) => { try { await fn(...a); } catch (err) { status(err.message, true); } }; }
  function wire() {
    $('jed-open-folder').onclick = () => $('jed-folder').click();
    $('jed-open-files').onclick = () => $('jed-files').click();
    $('jed-export-all').addEventListener('click', guard(exportAll));
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
    $('jed-hex-in').oninput = (e) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(e.target.value.trim()); e.target.classList.toggle('bad', !m);
      if (!m || !cur()) return;
      const c = [0, 2, 4].map((o) => J.to6(parseInt(m[1].substr(o, 2), 16)));
      remember('c' + S.side + S.team + ':' + S.color); J.setColor(cur().file, S.team, S.color, c); edited();
    };
    $('jed-hex-in').onblur = () => { if (cur()) renderColor(); };
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
    canvas.addEventListener('mousemove', (e) => { const p = spriteAt(e); if (p !== S.hover) { S.hover = p; drawOverlay(); } canvas.title = p == null ? '' : spotName(p) + ' (sprite ' + p + ')' + ($('jed-paint').checked ? ' → click to give it colour ' + S.color : ' → click to select its colour'); });
    canvas.addEventListener('mouseleave', () => { S.hover = null; drawOverlay(); });
    canvas.addEventListener('click', (e) => { const p = spriteAt(e); if (p != null) { clickSpot(p); S.hover = p; drawOverlay(); } });
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
    // Auto-load the server's PC game (NHL 94 PC first, same order as the Game list). With both, the switch picks.
    const pick = (id) => pcs.find((g) => g.id === id);
    const want = new URLSearchParams(location.hash.slice(1)).get('game');
    const first = pick(want) || pcs.find((g) => g.kind === 'pc94') || pcs[0];
    const group = $('jed-game');
    const mark = (id) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.game === id)));
    group.querySelectorAll('button').forEach((b) => {
      const g = pick(b.dataset.game); b.hidden = !g;
      if (g) b.addEventListener('click', guard(async () => { mark(g.id); await loadServer(g.id); }));
    });
    group.hidden = pcs.length < 2;
    mark(first.id);
    const before = $('jed-status').textContent;
    try { await loadServer(first.id); } catch (err) { status(before); group.hidden = true; } // nothing usable: open a folder instead
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

  /** For the Centre ice tab (ice.js): the loaded game, its files by name, the base palettes. */
  const Shared = window.JedShared = {
    state: S, loaded: [], status, download, guard,
    async file(name) {
      const src = S.sources; if (!src) return null;
      if (src.kind === 'server') return fetchBytes('api/games/' + src.id + '/file?path=' + encodeURIComponent(name));
      const want = name.toLowerCase();
      for (const [rel, bytes] of src.map) if (rel.split('/').pop().toLowerCase() === want) return bytes;
      return null;
    },
    homeColors(team) { const f = S.files.home || S.files.away; return f && team < J.teamCount(f.file) ? J.getColors(f.file, team) : null; },
    awayColors(team) { const f = S.files.away || S.files.home; return f && team < J.teamCount(f.file) ? J.getColors(f.file, team) : null; },
    /** Write a team's home colours (HOMEPALS); AWAYPALS is left alone (the rink only shows home colours). */
    setHomeColors(team, colors) {
      const f = S.files.home; if (!f || team >= J.teamCount(f.file)) throw new Error('Open HOMEPALS.BIN to change team colours');
      const old = J.getColors(f.file, team); let n = 0;
      colors.forEach((c, i) => { if (c.join() !== old[i].join()) { J.setColor(f.file, team, i, c); n++; } });
      if (n && cur()) renderAll(); return n;
    },
    /** Team slots (0..63) the home jersey and the scoreboard crest point at. */
    usage(team) { const f = S.files.home; if (!f || team >= J.teamCount(f.file)) return { jersey: new Set(), crest: new Set() }; return { jersey: J.jerseySlots(f.file, team), crest: J.crestSlots(f.file, team) }; }
  };

  // Instant tooltips for anything with data-tip (swatches here and on the Centre ice tab).
  function wireTips() {
    const tip = document.createElement('div'); tip.id = 'jed-tip'; tip.className = 'jed-tip'; tip.hidden = true; document.body.appendChild(tip);
    const place = (e) => { const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 4); const y = e.clientY + 18 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 8 : e.clientY + 18; tip.style.left = x + 'px'; tip.style.top = y + 'px'; };
    document.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; place(e); });
    document.addEventListener('mousemove', (e) => { if (!tip.hidden) place(e); });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]'))) tip.hidden = true; });
  }
  wire();
  wireSplit();
  wireTips();
  loadBase();
  Shared.serverReady = detectServer();
  Shared.exportAll = exportAll;
  window.addEventListener('resize', () => { if (cur()) renderPreview(false); });
})();
