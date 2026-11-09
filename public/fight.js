/* Fight colours tab: the colours the NHL 95 PC port gives NHLPA 93's fight frames (NHL95PC port/fight/). The 93 frames
 * come from the player's own NHLPA 93 ROM (lib/rom93.js, the port's reader); the 95 PC skater frames and team
 * palettes from the opened game folder (JedShared, jed.js). Each 93 colour the fight frames use is given a 95 PC sprite
 * colour; the port reads the choice from FIGHTPAL.TXT in its game folder (without one it takes the nearest colours,
 * which is what Auto shows). Sprite colours 144-191 are team colours, so a fighter keeps his own team's jersey. */
(function () {
  'use strict';
  const R = NhlRom93, J = NhlPcJersey, X = window.JedShared;
  const $ = (id) => document.getElementById(id);
  const F = {
    rom: null, frames: [], frame: R.FRAMES.fight + 5, team: 0, side: 'home', team93: 0,
    map: new Array(64).fill(null), auto: null, used: new Set(), sel: null, undo: [], pcFrame: 1, hit: null, wired: false
  };
  const st = () => X.state;
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rgb = (c) => 'rgb(' + c.join(',') + ')';

  // ---- palettes ----
  function pcPalette() { return X.paletteFor(F.team, F.side); }
  function pal93() { return F.rom ? R.palette(F.rom, F.team93, true) : null; }
  function pal93pc() { return F.rom ? R.pc95Colours(R.palette(F.rom, 0, true)) : null; }   // what the port matches from
  /** v (0-63) -> the 95 PC sprite colour in use: the choice, else the port's nearest */
  function mapped(v) {
    const k = v >= 48 ? v - 16 : v;
    return F.map[k] != null ? F.map[k] : (F.auto ? F.auto[k] : 0);
  }
  function refreshAuto() { const pc = pcPalette(); F.auto = pc && F.rom ? R.autoMap(pal93pc(), pc) : null; }

  // ---- loading ----
  async function tryRom(bytes, name) {
    F.rom = R.open(bytes);
    F.frames = R.FIGHT_FRAMES.map((n) => ({ n, f: R.markEyes(R.decode(F.rom, n)) })).filter((x) => x.f);
    F.used = new Set();
    for (const x of F.frames) for (const p of x.f.pixels) if (p) F.used.add(p >= 48 ? p - 16 : p);
    $('fight-rom-note').textContent = 'Rev ' + F.rom.rev + (name ? ' · ' + name : '');
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
  async function findText() {
    const b = await X.file('FIGHTPAL.TXT');
    if (b) { F.map = R.readText(new TextDecoder().decode(b)); X.status('FIGHTPAL.TXT read from the game folder'); }
  }
  async function load() {
    await findRom(); await findText().catch(() => {});
    fillTeams(); refreshAuto(); renderAll();
  }

  // ---- UI ----
  function fillTeams() {
    const S = st(), f = S.files.home || S.files.away, sel = $('fight-team');
    sel.innerHTML = '';
    if (f) f.file.teams.forEach((t, i) => sel.add(new Option((i + 1) + '. ' + t.name, String(i))));
    F.team = Math.min(F.team, Math.max(0, sel.options.length - 1)); sel.value = String(F.team);
    const s93 = $('fight-team93');
    if (!s93.options.length) R.TEAMS.forEach((t, i) => s93.add(new Option(t, String(i))));
    s93.value = String(F.team93);
    $('fight-home').setAttribute('aria-pressed', String(F.side === 'home'));
    $('fight-away').setAttribute('aria-pressed', String(F.side === 'away'));
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
  function colour93(orig) {
    const pc = pcPalette(), p93 = pal93();
    return (v) => (!v ? null : orig || !pc ? (v === R.EYE && p93 ? R.pc95Colours(p93.slice())[v] : p93[v]) : pc[mapped(v)]);
  }
  function renderStrip() {
    const box = $('fight-strip'); box.innerHTML = '';
    const draw = colour93($('fight-orig').checked);
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
  function renderMap() {
    const box = $('fight-map'); box.innerHTML = '';
    const p93 = pal93(), pc = pcPalette();
    if (!F.rom) { box.textContent = 'Open your NHLPA 93 ROM to see its fight frames.'; return; }
    const shown = p93 ? R.pc95Colours(p93.slice()) : null;
    [...F.used].sort((a, b) => a - b).forEach((v) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fight-pairbtn';
      b.setAttribute('aria-selected', String(v === F.sel));
      if (F.map[v] != null && (!F.auto || F.map[v] !== F.auto[v])) b.classList.add('changed');
      const a = document.createElement('i'); a.style.background = rgb((v === R.EYE ? shown : p93)[v]);
      const m = mapped(v), z = document.createElement('i'); z.style.background = pc ? rgb(pc[m]) : '#000';
      const lab = document.createElement('b'); lab.textContent = m;
      b.append(a, '→', z, lab);
      b.dataset.tip = '93 ' + name93(v) + ' ' + hex(p93[v]) + ' → 95 PC sprite colour ' + m + (pc ? ' ' + hex(pc[m]) : '') +
        (m >= 144 && m < 192 ? ' (team colour)' : '') + (F.map[v] == null ? ' · nearest (Auto)' : '');
      b.addEventListener('click', () => { F.sel = v; renderMap(); renderPc(); renderSel(); });
      box.appendChild(b);
    });
  }
  function renderPc() {
    const box = $('fight-pc'); box.innerHTML = '';
    const pc = pcPalette(); if (!pc) { $('fight-pc-note').textContent = 'open an NHL 95 PC game folder'; return; }
    $('fight-pc-note').textContent = 'click to give the selected 93 colour';
    const cur = F.sel != null ? mapped(F.sel) : -1;
    for (let i = 0; i < 256; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ice-sw';
      if (i === 255) b.classList.add('src-clear'); else b.style.background = rgb(pc[i]);
      if (i >= 144 && i < 192) b.classList.add('src-home');
      if (i === cur) b.setAttribute('aria-selected', 'true');
      if (i === F.hit) b.classList.add('fight-hit');
      b.dataset.tip = 'Sprite colour ' + i + (i < 255 ? ' ' + hex(pc[i]) : ' (transparent)') + (i >= 144 && i < 192 ? ' · team colour' : '');
      if (i < 255) b.addEventListener('click', () => assign(i));
      box.appendChild(b);
    }
  }
  function renderSel() {
    const p = $('fight-sel');
    if (F.sel == null) { p.textContent = 'Select a 93 colour above, or click a pixel of the 93 frame.'; return; }
    const m = mapped(F.sel);
    p.textContent = '93 ' + name93(F.sel) + ' → 95 PC sprite colour ' + m + (F.map[F.sel] == null ? ' (nearest)' : '');
  }
  function renderView() {
    const scale = Number($('fight-scale').value);
    const x = F.frames.find((y) => y.n === F.frame);
    const c = $('fight-93');
    if (x) drawIndexed(c, x.f, colour93($('fight-orig').checked), scale); else { c.width = c.height = 1; }
    $('fight-93-cap').textContent = x ? '93 frame ' + x.n + ($('fight-orig').checked ? ' · 93 colours' : ' · as 95 PC draws it') : '';
    const S = st(), pc = pcPalette(), f = S.sprites && S.sprites.renderFrame(F.pcFrame), pcv = $('fight-pcf');
    if (f && f.width && pc) {
      const skip = f.transparent == null ? 255 : f.transparent, cols = f.dynamic === false ? (pc.game || pc) : pc;
      drawIndexed(pcv, f, (p) => (p === skip ? null : cols[p] || [0, 0, 0]), scale);
    } else { pcv.width = pcv.height = 1; }
    $('fight-pc-frame').value = String(F.pcFrame);
    $('fight-note').textContent = !S.sprites ? 'Open an NHL 95 PC game folder for its skater frames and team colours.' :
      F.rom ? '' : 'Open your NHLPA 93 ROM (or put it in the game folder you open) for the fight frames.';
  }
  function renderAll() { renderStrip(); renderMap(); renderPc(); renderSel(); renderView(); }

  // ---- editing ----
  function assign(i) {
    if (F.sel == null) { X.status('Select a 93 colour first'); return; }
    F.undo.push(F.map.slice()); if (F.undo.length > 200) F.undo.shift();
    F.map[F.sel] = i; renderAll();
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
    $('fight-team').addEventListener('change', (e) => { F.team = Number(e.target.value); refreshAuto(); renderAll(); });
    $('fight-team93').addEventListener('change', (e) => { F.team93 = Number(e.target.value); renderAll(); });
    $('fight-home').addEventListener('click', () => { F.side = 'home'; fillTeams(); refreshAuto(); renderAll(); });
    $('fight-away').addEventListener('click', () => { F.side = 'away'; fillTeams(); refreshAuto(); renderAll(); });
    $('fight-orig').addEventListener('change', () => { renderStrip(); renderView(); });
    $('fight-scale').addEventListener('input', renderView);
    const step = (d) => { const S = st(); const n = S.sprites ? S.sprites.numFrames : 1; F.pcFrame = Math.max(1, Math.min(n, F.pcFrame + d)); renderView(); };
    $('fight-pc-prev').addEventListener('click', () => step(-1));
    $('fight-pc-next').addEventListener('click', () => step(1));
    $('fight-pc-frame').addEventListener('change', (e) => { F.pcFrame = 1; step(Number(e.target.value) - 1); });
    $('fight-93').addEventListener('click', (e) => {
      const x = F.frames.find((y) => y.n === F.frame); if (!x) return;
      const v = pixelAt(e.target, e, x.f); if (!v) return;
      F.sel = v >= 48 ? v - 16 : v; renderMap(); renderPc(); renderSel();
    });
    $('fight-pcf').addEventListener('click', (e) => {
      const S = st(), f = S.sprites && S.sprites.renderFrame(F.pcFrame); if (!f) return;
      const p = pixelAt(e.target, e, f); if (p == null || p === 255) return;
      F.hit = p;
      if ($('fight-pick').checked && F.sel != null) assign(p); else renderPc();
      X.status('95 PC pixel: sprite colour ' + p);
    });
    $('fight-auto').addEventListener('click', () => { if (!F.auto) return; F.undo.push(F.map.slice()); F.map = F.auto.slice(); renderAll(); });
    $('fight-undo').addEventListener('click', () => { const m = F.undo.pop(); if (m) { F.map = m; renderAll(); } });
    $('fight-import').addEventListener('click', () => $('fight-txt-file').click());
    $('fight-txt-file').addEventListener('change', X.guard(async (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      F.undo.push(F.map.slice()); F.map = R.readText(await file.text()); renderAll(); X.status(file.name + ' imported');
    }));
    $('fight-export').addEventListener('click', X.guard(() => {
      if (!F.rom) throw new Error('Open your NHLPA 93 ROM first');
      const full = new Array(64).fill(null);
      for (const v of F.used) full[v] = mapped(v);
      X.download(new TextEncoder().encode(R.writeText(full, F.used)), 'FIGHTPAL.TXT');
      X.status('FIGHTPAL.TXT: put it in the NHL 95 PC game folder');
    }));
    X.loaded.push(() => { F.rom = F.rom || null; if (!$('fight-main').hidden) X.guard(load)(); else { fillTeams(); refreshAuto(); } });
  }
  wire();
  window.JedFight = { state: F, load, tab };
}());
