/**
 * Shared button icons and tooltips for every Studio page.
 *
 * Icons use the Image Editor's line style (24px grid, 1.7 stroke) and are drawn
 * with a CSS mask on ::before, keyed off a data-ico attribute. That way code
 * that rewrites a button's textContent (Play/Pause, Stop, ...) never wipes the
 * icon. Buttons that already carry an <svg>, or start with a glyph such as
 * "▶", are left alone. A button without a title gets a tooltip from its rule.
 */
(function () {
  'use strict';
  const S = 'fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const P = (d) => `<path d="${d}"/>`;
  const ICONS = {
    open: P('M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z'),
    download: P('M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15'),
    upload: P('M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 19.5h15'),
    play: P('M7 4.5v15l12-7.5z'),
    pause: P('M8 5v14M16 5v14'),
    stop: P('M6 6h12v12H6z'),
    prev: P('M17 5.5L7 12l10 6.5zM5 5v14'),
    next: P('M7 5.5L17 12 7 18.5zM19 5v14'),
    check: P('M4.5 12.5l5 5 10-11'),
    x: P('M6 6l12 12M18 6L6 18'),
    info: P('M12 11v6M12 7.5v.5M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0'),
    image: P('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5v.01'),
    shirt: P('M8.5 4L3.5 7l2 4 2-1v10h9V10l2 1 2-4-5-3a3.5 3.5 0 0 1-7 0z'),
    back: P('M10 6l-6 6 6 6M4 12h16'),
    trash: P('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6'),
    plus: P('M12 5v14M5 12h14'),
    mirror: P('M12 3v18M8 7L3.5 12 8 17zM16 7l4.5 5L16 17z'),
    flip: P('M3 12h18M7 8L12 3.5 17 8zM7 16l5 4.5 5-4.5z'),
    rotcw: P('M20 5v5h-5M19.5 10A8 8 0 1 0 20 14'),
    rotccw: P('M4 5v5h5M4.5 10A8 8 0 1 1 4 14'),
    resize: P('M4 14v6h6M20 10V4h-6M4 20L10 14M20 4l-6 6'),
    list: P('M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01'),
    details: P('M4 5h16v14H4zM14 5v14M17 9h.01M17 12h.01'),
    sort: P('M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5'),
    spin: P('M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5'),
    target: P('M12 3v4M12 17v4M3 12h4M17 12h4M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0'),
    pin: P('M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11zM9.8 10a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0'),
    film: P('M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4'),
    wave: P('M3 12h2.5l2-6 3 12 3-14 2.5 10 1.5-2H21'),
    save: P('M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6'),
    reload: P('M20 11A8 8 0 1 0 18 17M20 4v7h-7'),
    mask: P('M4 4h16v16H4zM12 4v16M4 12h16M12 4h8v8h-8zM4 12h8v8H4z'),
    copy: P('M8 8h12v12H8zM16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8'),
    cut: P('M8.4 16.2L20 4M15.6 16.2L4 4M4.1 17.5a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0M15.1 17.5a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0'),
    paste: P('M5 6h14v15H5zM9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M8 11h8M8 15h6'),
    undo: P('M7 8H3.5V4.5M3.8 7.6A8 8 0 1 1 4 16'),
    redo: P('M17 8h3.5V4.5M20.2 7.6A8 8 0 1 0 20 16'),
    selall: P('M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z'),
    select: P('M4 4h16v16H4z" stroke-dasharray="3 2.5'),
    pick: P('M14.2 4.2l5.6 5.6-8.4 8.4-3.2-3.2zM7.2 16.2L4 20'),
    paint: P('M14.8 3.8l5.4 5.4-11.6 11.6H3.2v-5.4zM13 5.6l5.4 5.4'),
    erase: P('M4 14.5l7.2-7.2 6.5 6.5-4.4 4.4H6.2L4 16.2zM8.2 18.2H20'),
    place: P('M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18'),
    move: P('M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'),
    home: P('M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6'),
    away: P('M3 12h13M11 6l6 6-6 6M20 4v16'),
    search: P('M4 10.5a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0M15.5 15.5L21 21'),
    chip: P('M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4'),
    note: P('M9 18V6l11-2v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
    zip: P('M5 3h10l4 4v14H5zM12 3v10M12 8h2M10 10h2M12 12h2M10 14h4v3h-4z'),
    more: P('M5 12v.01M12 12v.01M19 12v.01'),
    refresh: P('M20 11A8 8 0 1 0 18 17M20 4v7h-7'),
  };

  // [regex on the lower-cased label, icon, tooltip used only when the button has no title]
  const RULES = [
    [/^about\b/, 'info', 'Version, what changed, and how to send feedback'],
    [/^image editor/, 'image', 'Open the Image Editor'],
    [/^jerseys?$/, 'shirt', 'Open the jersey palette editor'],
    [/^(← )?nhl9x studio/, 'back', 'Back to NHL9X Studio'],
    [/^open (game )?folder/, 'open', 'Open a folder of game files'],
    [/^open|^load|^choose|^browse/, 'open', 'Open a file'],
    [/^(edit image)/, 'image', 'Open this picture in the Image Editor'],
    [/^(export|save|download)\b.*(zip|all)|^export all|^download all/, 'zip', 'Save everything as a ZIP'],
    [/^(export|save|download)\b|^logo png|^rink png|^.*\bexport\b/, 'download', 'Save to a file'],
    [/^import\b|^replace\b/, 'upload', 'Bring a file in'],
    [/^(play as gm)/, 'note', 'Play through the General MIDI reference synth'],
    [/^(spin)/, 'spin', 'Spin through facings'],
    [/^(play)\b/, 'play', 'Play'],
    [/^(resume)/, 'play', 'Resume playback'],
    [/^(pause)/, 'pause', 'Pause playback'],
    [/^(stop)/, 'stop', 'Stop playback'],
    [/^(prev|previous|back)\b/, 'prev', 'Previous'],
    [/^(next|forward)\b/, 'next', 'Next'],
    [/^(apply|ok|done|confirm|got it)\b/, 'check', 'Apply the change'],
    [/^(cancel|close|dismiss|discard)\b/, 'x', 'Cancel and close'],
    [/^(undo)\b/, 'undo', 'Undo the last edit'],
    [/^(redo)\b/, 'redo', 'Redo'],
    [/^(revert|reset|restore)\b/, 'undo', 'Put this back the way it was'],
    [/^reload|^refresh/, 'reload', 'Reload'],
    [/^(remove|delete|clear)\b/, 'trash', 'Remove'],
    [/^(new|add|create)\b/, 'plus', 'Add a new one'],
    [/^(copy)\b/, 'copy', 'Copy'],
    [/^(cut)\b/, 'cut', 'Cut'],
    [/^(paste)\b/, 'paste', 'Paste'],
    [/^(select all)/, 'selall', 'Select everything'],
    [/^select\b/, 'select', 'Select cells'],
    [/^(pick)\b/, 'pick', 'Pick a colour from the picture'],
    [/^(paint|draw|pencil)\b/, 'paint', 'Paint'],
    [/^(erase)\b/, 'erase', 'Erase'],
    [/^(place)\b/, 'place', 'Place a tile'],
    [/^(move)\b/, 'move', 'Move'],
    [/^(mirror)\b/, 'mirror', 'Mirror left-right'],
    [/^(flip)\b/, 'flip', 'Flip top-bottom'],
    [/^(⟳|rotate|90)/, 'rotcw', 'Rotate 90° clockwise'],
    [/^(⟲|270)/, 'rotccw', 'Rotate 90° counter-clockwise'],
    [/^180/, 'rotcw', 'Rotate 180°'],
    [/^resize/, 'resize', 'Change the size'],
    [/^mask/, 'mask', 'Build a mask'],
    [/^(show more|more)\b/, 'more', 'Show more'],
    [/^list$/, 'list', 'Show or hide the list'],
    [/^details$/, 'details', 'Show or hide the details'],
    [/^(groups|file)$/, 'sort', 'Change how the list is ordered'],
    [/^0, ?0$/, 'target', 'Player position'],
    [/^hotspot/, 'pin', 'Where the puck sits'],
    [/^frame$/, 'film', 'Browse single frames'],
    [/^(spf|spa)$/, 'film', 'Browse sprite data'],
    [/^images?$/, 'image', 'Browse pictures'],
    [/^(audio|sound)/, 'wave', 'Browse sound'],
    [/^jerseys$/, 'shirt', 'Jersey palettes'],
    [/^centre ice/, 'place', 'Edit the centre-ice logo'],
    [/^home$/, 'home', 'Home jersey'],
    [/^away$/, 'away', 'Away jersey'],
    [/^nhl \d\d pc$/, 'chip', 'Choose the game'],
    [/beep|tone|noise/, 'wave', 'Play a test tone'],
    [/^(pick only|match only|runner-up)/, 'play', 'Play this part'],
  ];

  const LABEL = (b) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/…$/, '');

  const css = Object.keys(ICONS).map((n) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${S}>${ICONS[n]}</svg>`;
    return `[data-ico="${n}"]{--ico:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  }).join('\n') + `
[data-ico]::before{content:"";display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:-2px;flex:none;
  background:currentColor;-webkit-mask:var(--ico) center/contain no-repeat;mask:var(--ico) center/contain no-repeat}
[data-ico]:empty::before,[data-ico].btn-ico-only::before{margin-right:0}
button.jim-icon-btn[data-ico]::before,.pin-options button[data-ico]::before{margin-right:4px}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function decorate(b) {
    if (b.querySelector('svg') || b.classList.contains('jim-icon-btn')) return;
    const raw = (b.textContent || '').trim();
    // Arrow keys and glyph-led labels ("▶ Play") already show a symbol.
    if (!raw && !b.getAttribute('aria-label')) return;
    if (/^[^\p{L}\p{N}]/u.test(raw) && !/^(←|⟳|⟲)/.test(raw)) return;
    const label = LABEL(b);
    const rule = RULES.find((r) => r[0].test(label));
    if (!rule) { if (b.dataset.ico) delete b.dataset.ico; return; }
    if (b.dataset.ico !== rule[1]) b.dataset.ico = rule[1];
    if (!b.title && !b.dataset.tip && !b.hasAttribute('data-btn-tip')) { b.title = rule[2]; b.setAttribute('data-btn-tip', '1'); }
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    const own = root.closest && root.closest('button, a.ghost-btn');
    if (own) decorate(own);
    if (root.querySelectorAll) root.querySelectorAll('button, a.ghost-btn').forEach(decorate);
  }

  let pending = new Set();
  let queued = false;
  function flush() {
    queued = false;
    const nodes = pending; pending = new Set();
    nodes.forEach((n) => { if (n.isConnected) scan(n); });
  }
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.type === 'characterData' ? m.target.parentElement : m.target;
      if (t) pending.add(t);
    }
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  });
  function start() {
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.NHL9XButtonIcons = { ICONS, RULES, scan };
})();
