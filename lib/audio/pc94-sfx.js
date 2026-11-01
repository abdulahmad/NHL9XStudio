/**
 * NHL 94/95 PC PCFF sound banks: .TIM / .DIG / .PAT.
 * Table layout matches the EACSNDF %sFF%03d.TIM/.PAT/.DIG loader in NHL95PC
 * (asc_C3FA8 / asc_C3FB8). Digital samples are signed 8-bit PCM; the Sound
 * Blaster path XOR-flips with 0x80.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPc94Sfx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function bytesOf(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function s8(v) { return v > 127 ? v - 256 : v; }
  function idAt(b, o) { return b.subarray(o, o + 4); }
  function idKey(id) {
    let s = '';
    for (let i = 0; i < 4; i++) s += (id[i] || 0).toString(16).padStart(2, '0');
    return s;
  }

  function readTable(buffer) {
    const d = bytesOf(buffer);
    if (d.length < 6) throw new Error('PCFF table too short');
    const size = u32(d, 0);
    const count = u16(d, 4);
    const ids = [];
    const offs = [];
    for (let i = 0; i < count; i++) {
      ids.push(idAt(d, 6 + 4 * i));
      offs.push(u32(d, 6 + 4 * count + 4 * i));
    }
    const base = 6 + 8 * count;
    const valid = offs.filter((o) => o !== 0xffffffff).sort((a, b) => a - b);
    valid.push(d.length - base);
    const items = [];
    for (const o of offs) {
      if (o === 0xffffffff) {
        items.push(new Uint8Array(0));
        continue;
      }
      const next = valid[valid.indexOf(o) + 1];
      items.push(d.subarray(base + o, base + next));
    }
    return { size: size, count: count, ids: ids, offs: offs, items: items };
  }

  function loadTim(buffer) {
    const t = readTable(buffer);
    const timbres = {};
    let extra = null;
    for (let i = 0; i < t.ids.length; i++) {
      const id = t.ids[i];
      if (id[0] === 0x80) timbres[id[3] | (id[2] << 8)] = t.items[i];
      else extra = { id: id, data: t.items[i] };
    }
    return { timbres: timbres, extra: extra };
  }

  function parseDigTimbre(t) {
    const b = bytesOf(t);
    if (b.length < 32) return null;
    return {
      type: b[0],
      b1: b[1],
      sampleId: b.subarray(2, 6),
      loop: b[0x11],
      rate: u16(b, 0x12),
      length: u32(b, 0x14),
      loopStart: u32(b, 0x18),
      loopEnd: u32(b, 0x1c)
    };
  }

  function loadDig(buffer) {
    const t = readTable(buffer);
    const samples = {};
    for (let i = 0; i < t.ids.length; i++) samples[idKey(t.ids[i])] = t.items[i];
    return { samples: samples, ids: t.ids, items: t.items };
  }

  function loadPat(buffer) {
    const d = bytesOf(buffer);
    const version = u16(d, 0);
    const pmap = d.subarray(2, 0x102);
    const recs = [];
    for (let i = 0; 0x102 + 20 * (i + 1) <= d.length; i++) {
      recs.push(d.subarray(0x102 + 20 * i, 0x122 + 20 * i));
    }
    return { version: version, map: pmap, recs: recs };
  }

  function parseFmTimbre(t) {
    const b = bytesOf(t);
    if (!b.length || b[0] !== 0x04) return null;
    return {
      type: b[0],
      unknown: b[1],
      car: { amvib: b[2], ksl: b[3], ad: b[4], sr: b[5], wav: b[6] },
      mod: { amvib: b[7], ksl: b[8], ad: b[9], sr: b[10], wav: b[11] },
      fbConn: b[12],
      fnum: b[13],
      block: b[14]
    };
  }

  /** Sound Blaster 8-bit unsigned from signed PCM (XOR 0x80). */
  function toUnsigned8(pcm) {
    const src = bytesOf(pcm);
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] ^ 0x80;
    return out;
  }

  function toFloat32(pcm, loopedSeconds) {
    const src = bytesOf(pcm);
    let bytes = src;
    if (loopedSeconds && loopedSeconds.loopEnd > loopedSeconds.loopStart) {
      const body = [];
      const start = src.subarray(0, loopedSeconds.loopEnd);
      const loop = src.subarray(loopedSeconds.loopStart, loopedSeconds.loopEnd);
      for (let i = 0; i < start.length; i++) body.push(start[i]);
      const need = Math.floor((loopedSeconds.seconds || 2) * (loopedSeconds.rate || 11025));
      while (body.length < need && loop.length) {
        for (let i = 0; i < loop.length; i++) body.push(loop[i]);
      }
      bytes = Uint8Array.from(body);
    }
    const out = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const s = bytes[i] > 127 ? bytes[i] - 256 : bytes[i];
      out[i] = s / 128;
    }
    return out;
  }

  function listDigital(timBuf, digBuf, patBuf) {
    const tim = loadTim(timBuf);
    const dig = loadDig(digBuf);
    const pat = patBuf ? loadPat(patBuf) : null;
    const users = {};
    if (pat) {
      for (let prog = 0; prog < 256; prog++) {
        const r = pat.map[prog];
        if (r && pat.recs[r] && pat.recs[r][0] === 1) {
          const n = pat.recs[r][1];
          if (!users[n]) users[n] = [];
          users[n].push({ program: prog, transpose: s8(pat.recs[r][7]) });
        }
      }
    }
    const out = [];
    const nums = Object.keys(tim.timbres).map(Number).sort((a, b) => a - b);
    for (const n of nums) {
      const rec = parseDigTimbre(tim.timbres[n]);
      if (!rec || rec.type !== 0x06) continue;
      const pcm = dig.samples[idKey(rec.sampleId)] || new Uint8Array(0);
      out.push({
        timbre: n,
        sampleId: idKey(rec.sampleId),
        rate: rec.rate || 11025,
        loop: rec.loop,
        loopStart: rec.loopStart,
        loopEnd: rec.loopEnd,
        length: pcm.length,
        pcm: pcm,
        programs: users[n] || []
      });
    }
    return out;
  }

  return {
    readTable,
    loadTim,
    loadDig,
    loadPat,
    parseDigTimbre,
    parseFmTimbre,
    toUnsigned8,
    toFloat32,
    listDigital,
    idKey,
    s8
  };
});
