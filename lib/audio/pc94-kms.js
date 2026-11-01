/**
 * NHL 94 PC .KMS songs and matching .CFG track setup.
 * Layout from NHL94PC docs/MUSIC_FORMAT.md (PR #52) / HOCKEY.EXE 1630:0A90.
 * This is not the wiki Kris' Music System container in lib/audio/kms.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPc94Kms = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function bytesOf(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }

  function isKms(buffer) {
    const b = bytesOf(buffer);
    if (b.length < 0x28) return false;
    if (b[0] !== 1) return false;
    const ntracks = b[6] | (b[7] << 8);
    if (ntracks < 1 || ntracks > 16) return false;
    const off0 = b[8] | (b[9] << 8);
    return off0 >= 0x28 && off0 < b.length;
  }

  function readVlq(d, p) {
    let v = 0;
    for (;;) {
      const b = d[p++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return { v: v, p: p };
    }
  }

  function lowestBit(m) {
    for (let b = 0; b < 16; b++) if ((m >> b) & 1) return b;
    return 0;
  }

  function decodeEvent(d, p) {
    const start = p;
    const delta = readVlq(d, p);
    p = delta.p;
    const cmd = d[p++];
    const e = { pos: start, delta: delta.v, cmd: cmd, a1: 0, a2: 0, data: null };
    if (cmd < 0xd9) {
      if (cmd > 0x80) e.a1 = d[p++];
      const dur = readVlq(d, p);
      e.a2 = dur.v;
      p = dur.p;
    } else if (cmd === 0xdc || cmd === 0xdd || cmd === 0xde || cmd === 0xe0 || cmd === 0xe1 ||
        cmd === 0xe2 || cmd === 0xe4 || cmd === 0xe9 || cmd === 0xea) {
      e.a1 = d[p++];
    } else if (cmd === 0xdf) {
      e.a1 = d[p++];
      e.a2 = d[p++];
    } else if (cmd === 0xe5) {
      e.a2 = d[p] | (d[p + 1] << 8);
      p += 2;
    } else if (cmd === 0xe6) {
      e.a1 = d[p];
      e.a2 = d[p + 1] | (d[p + 2] << 8) | (d[p + 3] << 16) | (d[p + 4] << 24);
      p += 5;
    } else if (cmd === 0xe7 || cmd === 0xe8) {
      const n = d[p++];
      e.data = d.subarray(p, p + n);
      p += n;
    }
    e.len = p - start;
    return e;
  }

  function parseCfg(buffer, ntracks) {
    const cfg = bytesOf(buffer || new Uint8Array(0));
    const tracks = [];
    for (let i = 0; i < ntracks; i++) {
      const rec = cfg.subarray(16 * i, 16 * i + 24);
      const mask = rec.length > 9 ? rec[8] | (rec[9] << 8) : (1 << i);
      tracks.push({
        mask: mask,
        chan: lowestBit(mask),
        vol: rec.length > 0x0e ? rec[0x0e] : 100,
        pan: rec.length > 0x0f ? rec[0x0f] : 64,
        program: rec.length > 0x14 ? rec[0x14] : 0
      });
    }
    return {
      version: cfg[0] || 3,
      ntracks: cfg[1] || ntracks,
      tracks: tracks
    };
  }

  function parse(kmsBytes, cfgBytes) {
    const k = bytesOf(kmsBytes);
    if (k.length < 0x28) throw new Error('KMS too short');
    const tempo = k[1] || 120;
    const ntracks = k[6] | (k[7] << 8);
    const offsets = [];
    for (let i = 0; i < ntracks; i++) offsets.push(k[8 + 2 * i] | (k[9 + 2 * i] << 8));
    const cfg = parseCfg(cfgBytes, ntracks);
    const tracks = [];
    for (let i = 0; i < ntracks; i++) {
      const events = [];
      let p = offsets[i];
      let name = '';
      while (p < k.length) {
        const e = decodeEvent(k, p);
        events.push(e);
        if (e.cmd === 0xe7 && e.data) {
          let s = '';
          for (let j = 0; j < e.data.length; j++) {
            if (!e.data[j]) break;
            s += String.fromCharCode(e.data[j]);
          }
          name = s;
        }
        p += e.len;
        if (e.cmd === 0xd9 || e.cmd === 0xda || e.cmd === 0xdb) break;
      }
      tracks.push({
        index: i,
        offset: offsets[i],
        name: name,
        events: events,
        chan: cfg.tracks[i].chan,
        vol: cfg.tracks[i].vol,
        pan: cfg.tracks[i].pan,
        program: cfg.tracks[i].program,
        mask: cfg.tracks[i].mask
      });
    }
    return {
      version: k[0],
      tempo: tempo,
      ntracks: ntracks,
      offsets: offsets,
      kms: k,
      cfg: cfg,
      tracks: tracks
    };
  }

  function encodeTiny(opts) {
    const tempo = (opts && opts.tempo) || 120;
    const note = (opts && opts.note) || 0x3c;
    const vel = (opts && opts.vel) || 0x64;
    const dur = (opts && opts.dur) || 24;
    const events = [0x00, 0x80 | (note & 0x7f), vel, dur, 0x00, 0xd9];
    const trak = new Uint8Array(8 + events.length);
    trak[0] = 0;
    trak[1] = 0;
    trak[2] = 0;
    trak[3] = 8 + events.length;
    trak.set([0x54, 0x52, 0x41, 0x4b], 4);
    trak.set(events, 8);
    const kms = new Uint8Array(0x28 + trak.length);
    kms[0] = 1;
    kms[1] = tempo;
    kms[2] = 1;
    kms[6] = 1;
    kms[8] = 0x30;
    kms[9] = 0;
    kms.set(trak, 0x28);
    const cfg = new Uint8Array(264);
    cfg[0] = 3;
    cfg[1] = 1;
    cfg[8] = 0x02;
    cfg[0x0e] = 100;
    cfg[0x0f] = 64;
    cfg[0x14] = 1;
    return { kms: kms, cfg: cfg };
  }

  return { isKms, parse, parseCfg, decodeEvent, encodeTiny, lowestBit };
});
