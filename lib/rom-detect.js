/**
 * Detect NHL 9x ROM game profile from size and header (Genesis / SNES).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlRomDetect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PROFILES = [
    { id: 'nhl92', platform: 'genesis', sizes: [0x80000], names: [/nhl92/i] },
    { id: 'nhlpa93', platform: 'genesis', sizes: [0x80000], names: [/nhlpa93|nhl93/i] },
    { id: 'nhl94', platform: 'genesis', sizes: [0x100000], names: [/nhl94/i] },
    { id: 'nhl95', platform: 'genesis', sizes: [0x200000], names: [/nhl95/i] },
    { id: 'nhlpa93snes', platform: 'snes', sizes: [0x80000], names: [/nhlpa93/i, /\.sfc$/i, /\.smc$/i] },
    { id: 'nhl94snes', platform: 'snes', sizes: [0x100000, 0x80000], names: [/nhl94/i, /\.sfc$/i, /\.smc$/i] }
  ];

  function stripHeader(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (view.length % 1024 === 512) return view.subarray(512);
    if (view.length >= 0x304) {
      const sega300 = String.fromCharCode(view[0x300], view[0x301], view[0x302], view[0x303]);
      const sega100 = String.fromCharCode(view[0x100], view[0x101], view[0x102], view[0x103]);
      if (sega300 === 'SEGA' && sega100 !== 'SEGA') return view.subarray(0x200);
    }
    return view;
  }

  function headerDate(bytes) {
    if (bytes.length < 0x120) return '';
    return String.fromCharCode.apply(null, bytes.subarray(0x118, 0x120));
  }

  function segaHeader(body) {
    if (body.length < 0x104) return false;
    return String.fromCharCode(body[0x100], body[0x101], body[0x102], body[0x103]) === 'SEGA';
  }

  function scoreProfile(profile, name, body) {
    let score = 0;
    const lower = name.toLowerCase();
    const ext = (lower.match(/\.[^.]+$/) || [''])[0];
    for (const re of profile.names) {
      if (re.test(name)) score += 12;
    }
    if (profile.platform === 'genesis') {
      if (ext === '.gen' || ext === '.md') score += 80;
      if (/snes|\.sfc|\.smc/i.test(lower)) score -= 120;
      if (segaHeader(body)) score += 60;
      if (profile.id === 'nhlpa93' && /nhlpa93|nhl93/i.test(lower) && !/snes/i.test(lower)) score += 20;
      if (profile.id === 'nhl94' && /nhl94/i.test(lower) && !/snes/i.test(lower)) score += 20;
    }
    if (profile.platform === 'snes') {
      if (ext === '.sfc' || ext === '.smc') score += 80;
      if (ext === '.gen' || ext === '.md') score -= 120;
      if (/snes/i.test(lower)) score += 40;
      if (!/snes|\.sfc|\.smc/i.test(lower) && ext === '.bin') score -= 15;
    }
    return score;
  }

  function detect(filename, bytes) {
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const body = stripHeader(raw);
    const name = String(filename || '');
    let best = null;
    let bestScore = -999;
    for (const profile of PROFILES) {
      if (!profile.sizes.includes(body.length)) continue;
      const score = scoreProfile(profile, name, body);
      if (score > bestScore) {
        bestScore = score;
        best = profile.id;
      }
    }
    if (!best) {
      const bySize = PROFILES.find((p) => p.sizes.includes(body.length));
      if (bySize) best = bySize.id;
    }
    if (best === 'nhlpa93snes' && /nhl94/i.test(name) && !/snes/i.test(name)) best = 'nhl94snes';
    if (best === 'nhl94snes' && body.length === 0x80000 && /93|nhlpa/i.test(name) && !/94/i.test(name)) best = 'nhlpa93snes';
    if (segaHeader(body) && /^nhl94/i.test(name) && body.length === 0x100000) best = 'nhl94';
    if (segaHeader(body) && /nhlpa93|nhl93/i.test(name) && body.length === 0x80000) best = 'nhlpa93';
    return best ? { id: best, bytes: body, revADate: best === 'nhlpa93' ? headerDate(body) : '' } : null;
  }

  return { detect, stripHeader, headerDate };
});
