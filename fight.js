/* Fight colours tab: the colours the NHL 95 PC port gives NHLPA 93's fight frames (NHL95PC port/fight/). The 93 frames
 * come from the player's own NHLPA 93 ROM (lib/rom93.js, the port's reader); the team colours of the default come from
 * the NHL 94 ROM (lib/rom94.js, port/rom94.c). The 95 PC skater frames and team palettes come from the opened game
 * folder (JedShared, jed.js). Each 93 colour the fight frames use is given a 95 PC sprite colour, separately for every
 * jersey (team, home or away); the port reads them all from one FIGHTPAL.TXT in its game folder. A jersey's default,
 * without a file, is that team's 94 colours for that side (both team lines), with the 95 PC stick, skin, eyes, skate
 * blade and shadow written back, each colour then matched to the nearest 95 PC sprite colour (port/fight/hooks.c
 * make_lut_for). Every 95 PC team is in 94, including Anaheim and Florida. A line in FIGHTPAL.TXT still wins. */
(function () {
  'use strict';
  const R = NhlRom93, R94 = NhlRom94, J = NhlPcJersey, X = window.JedShared;
  const $ = (id) => document.getElementById(id);
  const F = {
    rom: null, rom94: null, frames: [], frame: R.FRAMES.fight + 5, team: 0, side: 'home',
    maps: {}, all: new Array(64).fill(null), auto: null, used: new Set(), sel: null, undo: [], pcFrame: 1, hit: null, wired: false,
    tool: 'paint', brush: null, alt: false
  };
  const st = () => X.state;
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rgb = (c) => 'rgb(' + c.join(',') + ')';

  // ---- jerseys and palettes ----
  const blank = () => new Array(64).fill(null);
  function teams() { const f = st().files.home || st().files.away; return f ? f.file.teams : []; }
  function codeOf(i) { const t = teams()[i]; return t ? t.code.toLowerCase() : 'bos'; }
  function key(i = F.team, side = F.side) { return codeOf(i) + ' ' + side; }
  /** the edits of the jersey on screen (64 entries, null: the default) */
  Object.defineProperty(F, 'map', {
    get() { const k = key(); return F.maps[k] || (F.maps[k] = blank()); },
    set(m) { F.maps[key()] = m; }
  });
  function team93(i = F.team) { return R.teamFor(codeOf(i)); }
  function pcPalette(i = F.team, side = F.side) { return X.paletteFor(i, side); }
  /** the 93 jersey's own colours (Boston's for a team 93 did not have): the rink, and the base the 94 colours replace */
  function pal93(i = F.team, side = F.side) { const t = team93(i); return F.rom ? R.palette(F.rom, t < 0 ? 0 : t, side === 'home') : null; }
  /** the palette make_lut_for matches for this jersey, or null when either ROM is missing */
  function prepared(i = F.team, side = F.side) {
    if (!F.rom || !F.rom94) return null;
    const base = pal93(i, side);
    if (!base) return null;
    const c94 = R94.teamColours(F.rom94, codeOf(i), side === 'home');
    const got = R.fightBase(base, c94, team93(i) < 0);
    return { pal: got.pal, from94: Boolean(c94), teamOnly: got.teamOnly };
  }
  /** a jersey's default: what the port matches without a FIGHTPAL.TXT. No 94 ROM: no default. */
  function autoFor(i, side) {
    const pc = pcPalette(i, side), src = prepared(i, side);
    return pc && src ? R.autoMap(src.pal, pc, src.teamOnly) : null;
  }
  /** v (0-63) -> the 95 PC sprite colour in use: this jersey's FIGHTPAL choice, a choice for every jersey, else the default */
  function mappedIn(map, auto, v) { return R.resolveColour(map, F.all, auto, v); }
  function mapped(v) { return mappedIn(F.map, F.auto, v); }
  function refreshAuto() { F.auto = autoFor(F.team, F.side); }

  // ---- loading ----
  async function tryRom(bytes, name) {
    F.rom = R.open(bytes);
    F.frames = R.FIGHT_FRAMES.map((n) => ({ n, f: R.markEyes(R.decode(F.rom, n)) })).filter((x) => x.f);
    F.used = new Set();
    for (const x of F.frames) for (const p of x.f.pixels) if (p) F.used.add(p >= 48 ? p - 16 : p);
    $('fight-rom-note').textContent = 'Rev ' + F.rom.rev + (name ? ' · ' + name : '');
  }
  async function tryRom94(bytes, name) {
    F.rom94 = R94.open(bytes);
    $('fight-rom94-note').textContent = 'retail' + (name ? ' · ' + name : '');
  }
  async function findRom() {
    if (F.rom) return;
    const S = st();
    if (S.sources && S.sources.kind === 'local') {
      for (const [rel, bytes] of S.sources.map) {
        if (bytes.length !== 0x80000 && bytes.length !== 0x80200) continue;
        try { await tryRom(bytes, rel.split('/').pop()); return; } catch (e) { /* not it */ }
      }
    }
    try {
      const r = await fetch('api/games/nhlpa93/rom');
      if (r.ok) await tryRom(new Uint8Array(await r.arrayBuffer()), 'from the server');
    } catch (e) { /* none */ }
  }
  async function findRom94() {
    if (F.rom94) return;
    const S = st();
    if (S.sources && S.sources.kind === 'local') {
      for (const [rel, bytes] of S.sources.map) {
        if (bytes.length !== 0x100000 && bytes.length !== 0x100200) continue;
        try { await tryRom94(bytes, rel.split('/').pop()); return; } catch (e) { /* not it */ }
      }
    }
    try {
      const r = await fetch('api/games/nhl94/rom');
      if (r.ok) await tryRom94(new Uint8Array(await r.arrayBuffer()), 'from the server');
    } catch (e) { /* none */ }
  }
  async function findText() {
    const b = await X.file('FIGHTPAL.TXT');
    if (b) { setFile(R.readText(new TextDecoder().decode(b))); X.status('FIGHTPAL.TXT read from the game folder'); }
  }
  function setFile(t) { F.maps = t.jerseys; F.all = t.all; }
  async function load() {
    await findRom(); await findRom94(); await findText().catch(() => {});
    fillTeams(); refreshAuto(); renderAll();
  }

  // ---- UI ----
  function fillTeams() {
    const S = st(), f = S.files.home || S.files.away, sel = $('fight-team');
    sel.innerHTML = '';
    if (f) f.file.teams.forEach((t, i) => sel.add(new Option((i + 1) + '. ' + t.name, String(i))));
    F.team = Math.min(F.team, Math.max(0, sel.options.length - 1)); sel.value = String(F.team);
    $('fight-team94').textContent = jerseyLabel();
    $('fight-home').setAttribute('aria-pressed', String(F.side === 'home'));
    $('fight-away').setAttribute('aria-pressed', String(F.side === 'away'));
  }
  /** which 94 jersey this default uses, or why it cannot */
  function jerseyLabel() {
    if (!F.rom94) return 'NHL 94 ROM needed';
    const code = codeOf();
    if (!R94.teamColours(F.rom94, code, F.side === 'home')) {
      const t = team93();
      return t < 0 ? 'not in the 94 ROM: Boston\'s 93 colours, matched to this team\'s 95 PC colours' : 'not in the 94 ROM: ' + R.TEAMS[t] + '\'s 93 colours';
    }
    return R94.letters(code) + ' ' + F.side;
  }
  function drawIndexed(canvas, f, colourOf, scale) {
    canvas.width = f.width; canvas.height = f.height;
    canvas.style.width = f.width * scale + 'px'; canvas.style.height = f.height * scale + 'px';
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(f.width, f.height);
    for (let i = 0; i < f.pixels.length; i++) {
      const c = colourOf(f.pixels[i]); if (!c) continue;
      img.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }
  /** true when the frame can be drawn the way the port draws it (both ROMs, and a 95 PC palette) */
  function asPort() { return !$('fight-orig').checked && !!pcPalette() && !!F.rom && !!F.rom94; }
  function colour93(orig) {
    const pc = pcPalette(), p93 = pal93();
    return (v) => (!v ? null : orig || !pc ? (v === R.EYE && p93 ? R.pc95Colours(p93.slice())[v] : (p93 ? p93[v] : null)) : pc[mapped(v)]);
  }
  function renderStrip() {
    const box = $('fight-strip'); box.innerHTML = '';
    const draw = colour93(!asPort());
    for (const x of F.frames) {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'jed-thumb';
      t.setAttribute('aria-selected', String(x.n === F.frame));
      const c = document.createElement('canvas'); drawIndexed(c, x.f, draw, 0); c.style.width = ''; c.style.height = '';
      t.appendChild(c); t.appendChild(document.createTextNode(String(x.n)));
      t.title = x.n >= R.FRAMES.injury ? 'Check injury (bloody)' : x.n >= R.FRAMES.fightInjury ? 'Fight injury (bloody)' : x.n === R.FRAMES.gloves ? 'Gloves on the ice' : 'Fight';
      t.addEventListener('click', () => { F.frame = x.n; renderStrip(); renderView(); });
      box.appendChild(t);
    }
  }
  function name93(v) {
    if (v === R.EYE) return 'eye';
    const line = v >> 4, c = v & 15;
    return (line < 2 ? 'rink ' : 'team ') + line + '.' + c;
  }
  /** what the left swatch is: a 94 team colour, a 95 PC shared colour, or a 93 rink colour */
  function slotLabel(v, from94) {
    if (v === R.EYE) return '95 PC eye';
    const c = v & 15;
    if (v >= 32 && (c === 1 || c === 6 || c === 7 || c === 14 || c === 15)) {
      return '95 PC ' + (c === 1 ? 'stick' : (c === 6 || c === 7) ? 'skin' : c === 14 ? 'shadow' : 'blade');
    }
    if (v >= 32) return (from94 ? '94 ' : '93 ') + name93(v);
    return '93 ' + name93(v);
  }
  function renderMap() {
    const box = $('fight-map'); box.innerHTML = '';
    const pc = pcPalette();
    const gap = [];
    if (!F.rom) gap.push('Open your NHLPA 93 ROM to see its fight frames.');
    if (!F.rom94) gap.push('Open your NHL 94 ROM (or put it in the game folder you open) for the fight colours.');
    if (gap.length) { box.textContent = gap.join(' '); return; }
    const src = prepared();
    if (!src) { box.textContent = 'Open your NHL 94 ROM (or put it in the game folder you open) for the fight colours.'; return; }
    [...F.used].sort((a, b) => a - b).forEach((v) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fight-pairbtn';
      b.setAttribute('aria-selected', String(v === F.sel));
      if (F.map[v] != null || F.all[v] != null) b.classList.add('changed');
      const a = document.createElement('i'); a.style.background = rgb(src.pal[v]);
      const m = mapped(v), z = document.createElement('i'); z.style.background = pc ? rgb(pc[m]) : '#000';
      const lab = document.createElement('b'); lab.textContent = m;
      b.append(a, '→', z, lab);
      const def = F.map[v] == null && F.all[v] == null ? (src.from94 ? ' · default (94 jersey, nearest)' : ' · default (93 jersey, nearest)') : '';
      b.dataset.tip = slotLabel(v, src.from94) + ' ' + hex(src.pal[v]) + ' → 95 PC sprite colour ' + m + (pc ? ' ' + hex(pc[m]) : '') +
        (m >= 144 && m < 192 ? ' (team colour)' : '') + def;
      b.addEventListener('click', (e) => { F.sel = v; if (tool(e) === 'pick') setBrush(mapped(v)); else if (F.brush != null) assign(F.brush); renderAll(); });
      box.appendChild(b);
    });
  }
  function renderPc() {
    const box = $('fight-pc'); box.innerHTML = '';
    const pc = pcPalette(); if (!pc) { $('fight-pc-note').textContent = 'open an NHL 95 PC game folder'; return; }
    $('fight-pc-note').textContent = 'click to set the brush';
    const cur = F.brush != null ? F.brush : -1;
    for (let i = 0; i < 256; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ice-sw';
      if (i === 255) b.classList.add('src-clear'); else b.style.background = rgb(pc[i]);
      if (i >= 144 && i < 192) b.classList.add('src-home');
      if (i === cur) b.setAttribute('aria-selected', 'true');
      if (F.sel != null && i === mapped(F.sel)) b.classList.add('fight-hit');
      b.dataset.tip = 'Sprite colour ' + i + (i < 255 ? ' ' + hex(pc[i]) : ' (transparent)') + (i >= 144 && i < 192 ? ' · team colour' : '');
      if (i < 255) b.addEventListener('click', () => { setBrush(i); renderPc(); });
      box.appendChild(b);
    }
  }
  function renderSel() {
    const p = $('fight-sel');
    const pc = pcPalette();
    $('fight-brush-sw').style.background = F.brush != null && pc ? rgb(pc[F.brush]) : 'transparent';
    $('fight-brush-n').textContent = F.brush != null ? String(F.brush) : '—';
    if (F.sel == null) { p.textContent = 'Pick a brush colour (95 PC palette or Dropper), then Paint on the 93 frame.'; return; }
    const m = mapped(F.sel), src = prepared();
    const who = src ? slotLabel(F.sel, src.from94) : name93(F.sel);
    p.textContent = who + ' → 95 PC sprite colour ' + m + (F.map[F.sel] == null && F.all[F.sel] == null ? ' (default)' : '') + ' · jersey ' + key();
  }
  function renderView() {
    const scale = Number($('fight-scale').value);
    const x = F.frames.find((y) => y.n === F.frame);
    const c = $('fight-93');
    if (x) drawIndexed(c, x.f, colour93(!asPort()), scale); else { c.width = c.height = 1; }
    $('fight-93-cap').textContent = !x ? '' : '93 frame ' + x.n + ($('fight-orig').checked || !pcPalette() ? ' · 93 colours' : !F.rom94 ? ' · NHL 94 ROM needed' : ' · as 95 PC draws it');
    const S = st(), pc = pcPalette(), f = S.sprites && S.sprites.renderFrame(F.pcFrame), pcv = $('fight-pcf');
    if (f && f.width && pc) {
      const skip = f.transparent == null ? 255 : f.transparent, cols = f.dynamic === false ? (pc.game || pc) : pc;
      drawIndexed(pcv, f, (p) => (p === skip ? null : cols[p] || [0, 0, 0]), scale);
    } else { pcv.width = pcv.height = 1; }
    $('fight-pc-frame').value = String(F.pcFrame);
    const note = [];
    if (!S.sprites) note.push('Open an NHL 95 PC game folder for its skater frames and team colours.');
    if (!F.rom) note.push('Open your NHLPA 93 ROM (or put it in the game folder you open) for the fight frames.');
    if (!F.rom94) note.push('Open your NHL 94 ROM (or put it in the game folder you open) for the fight colours.');
    $('fight-note').textContent = note.join(' ');
  }
  function renderAll() { renderStrip(); renderMap(); renderPc(); renderSel(); renderView(); }

  // ---- editing ----
  function assign(i) {
    if (F.sel == null) { X.status('Select a 93 colour first'); return; }
    if (mapped(F.sel) === i && F.map[F.sel] === i) return;
    remember();
    F.map[F.sel] = i; renderAll();
  }
  function remember() { F.undo.push({ k: key(), m: F.map.slice() }); if (F.undo.length > 200) F.undo.shift(); }
  /** every jersey of the game folder, home and away, with its colours in full (choices and defaults) */
  function allJerseys() {
    const out = [];
    teams().forEach((t, i) => ['home', 'away'].forEach((side) => {
      const auto = autoFor(i, side), m = F.maps[key(i, side)] || blank(), full = blank();
      for (const v of F.used) full[v] = mappedIn(m, auto, v);
      out.push({ code: t.code, side, map: full });
    }));
    return out;
  }
  function setBrush(i) { F.brush = i; renderSel(); X.status('Brush: 95 PC sprite colour ' + i); }
  /** the tool for this click: Alt (or the I key held) is the dropper */
  function tool(e) { return e && e.altKey ? 'pick' : F.tool; }
  function setTool(t) {
    F.tool = t;
    document.querySelectorAll('[data-ftool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ftool === t)));
    $('fight-main').classList.toggle('pick', t === 'pick');
  }
  /** a 93 pixel: Paint gives its 93 colour the brush, Dropper takes the colour it shows */
  function on93(e) {
    const x = F.frames.find((y) => y.n === F.frame); if (!x) return;
    const v = pixelAt($('fight-93'), e, x.f); if (!v) return;
    const k = v >= 48 ? v - 16 : v;
    if (tool(e) === 'pick') { F.sel = k; setBrush(mapped(k)); renderMap(); renderPc(); renderSel(); return; }
    if (F.brush == null) { X.status('Pick a brush colour first: click the 95 PC palette or use the Dropper'); return; }
    F.sel = k; assign(F.brush);
  }
  function pixelAt(canvas, e, f) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * f.width), y = Math.floor((e.clientY - r.top) / r.height * f.height);
    return x >= 0 && y >= 0 && x < f.width && y < f.height ? f.pixels[y * f.width + x] : null;
  }
  function tab(on) {
    $('tab-fight').setAttribute('aria-selected', String(on));
    $('fight-main').hidden = !on;
    if (on) {
      $('tab-jerseys').setAttribute('aria-selected', 'false'); $('tab-ice').setAttribute('aria-selected', 'false');
      document.querySelector('main.jed-main').hidden = true; $('ice-main').hidden = true;
      X.guard(load)();
    }
  }
  function wire() {
    $('tab-fight').addEventListener('click', () => tab(true));
    $('tab-jerseys').addEventListener('click', () => tab(false));
    $('tab-ice').addEventListener('click', () => tab(false));
    $('fight-open-rom').addEventListener('click', () => $('fight-rom-file').click());
    $('fight-rom-file').addEventListener('change', X.guard(async (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      F.rom = null; await tryRom(new Uint8Array(await file.arrayBuffer()), file.name); refreshAuto(); renderAll();
    }));
    $('fight-open-rom94').addEventListener('click', () => $('fight-rom94-file').click());
    $('fight-rom94-file').addEventListener('change', X.guard(async (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      F.rom94 = null; $('fight-rom94-note').textContent = '';
      try { await tryRom94(new Uint8Array(await file.arrayBuffer()), file.name); }
      finally { refreshAuto(); renderAll(); }
    }));
    $('fight-team').addEventListener('change', (e) => { F.team = Number(e.target.value); refreshAuto(); renderAll(); });
    $('fight-home').addEventListener('click', () => { F.side = 'home'; fillTeams(); refreshAuto(); renderAll(); });
    $('fight-away').addEventListener('click', () => { F.side = 'away'; fillTeams(); refreshAuto(); renderAll(); });
    $('fight-orig').addEventListener('change', () => { renderStrip(); renderView(); });
    $('fight-scale').addEventListener('input', renderView);
    const step = (d) => { const S = st(); const n = S.sprites ? S.sprites.numFrames : 1; F.pcFrame = Math.max(1, Math.min(n, F.pcFrame + d)); renderView(); };
    $('fight-pc-prev').addEventListener('click', () => step(-1));
    $('fight-pc-next').addEventListener('click', () => step(1));
    $('fight-pc-frame').addEventListener('change', (e) => { F.pcFrame = 1; step(Number(e.target.value) - 1); });
    let painting = false;
    $('fight-93').addEventListener('pointerdown', (e) => { painting = tool(e) === 'paint'; on93(e); });
    $('fight-93').addEventListener('pointermove', (e) => { if (painting && e.buttons & 1) on93(e); });
    window.addEventListener('pointerup', () => { painting = false; });
    document.querySelectorAll('[data-ftool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.ftool)));
    document.addEventListener('keydown', (e) => {
      if ($('fight-main').hidden || /input|select|textarea/i.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('paint'); else if (k === 'i') setTool('pick');
    });
    $('fight-pcf').addEventListener('click', (e) => {
      const S = st(), f = S.sprites && S.sprites.renderFrame(F.pcFrame); if (!f) return;
      const p = pixelAt(e.target, e, f); if (p == null || p === 255) return;
      setBrush(p); renderPc();
    });
    $('fight-auto').addEventListener('click', () => { remember(); F.map = blank(); renderAll(); X.status('Jersey ' + key() + ': back to its 94 colours'); });
    $('fight-undo').addEventListener('click', () => { const u = F.undo.pop(); if (u) { F.maps[u.k] = u.m; renderAll(); } });
    $('fight-import').addEventListener('click', () => $('fight-txt-file').click());
    $('fight-txt-file').addEventListener('change', X.guard(async (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      F.undo = []; setFile(R.readText(await file.text())); renderAll(); X.status(file.name + ' imported (undo history cleared)');
    }));
    $('fight-export').addEventListener('click', X.guard(() => {
      if (!F.rom) throw new Error('Open your NHLPA 93 ROM first');
      if (!F.rom94) throw new Error('Open your NHL 94 ROM first');
      const all = allJerseys();
      if (!all.length) throw new Error('Open an NHL 95 PC game folder first (its HOMEPALS.BIN / AWAYPALS.BIN)');
      X.download(new TextEncoder().encode(R.writeText(all, F.used)), 'FIGHTPAL.TXT');
      X.status('FIGHTPAL.TXT: ' + all.length + ' jerseys; put it in the NHL 95 PC game folder');
    }));
    X.loaded.push(() => { F.rom = F.rom || null; if (!$('fight-main').hidden) X.guard(load)(); else { fillTeams(); refreshAuto(); } });
  }
  wire();
  window.JedFight = { state: F, load, tab };
}());
