/**
 * Step 6 runs: the retail 68k sound driver on its own (nhl92-68k-harness.js),
 * one song or one SFX at a time, with a per-vblank record of everything it
 * writes to the Z80 side. Logs are plain text and deterministic.
 */
(function (root, factory) {
  var harness = typeof module === 'object' && module.exports ? require('./nhl92-68k-harness') : root.Nhl92M68kHarness;
  var api = factory(harness);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92M68kRun = api;
})(typeof self !== 'undefined' ? self : this, function (H) {
  const hex = (n, w) => '$' + (n >>> 0).toString(16).toUpperCase().padStart(w || 0, '0');
  const bytes = (a) => a.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  /**
   * Condense one call's writes into a vblank record:
   * z80: [[z80addr, value]...] in order; buffer: the 48 bytes if all of
   * $0273-$02A2 were written this call, else null; flag: last value written to
   * $02A3; sfx: { $BE..$C3 values } written; io: busreq/reset writes in order;
   * unexpected: writes outside the expected address set.
   */
  function record(call) {
    const z80 = [];
    const io = [];
    const unexpected = [];
    const buf = new Array(48).fill(null);
    let flag = null;
    const sfx = {};
    let driverWrites = 0;
    for (const ev of call.events) {
      const c = H.classify(ev);
      if (c.who === 'driver') driverWrites += 1;
      const allowed = c.who === 'driver'
        ? ['z80 buffer', 'z80 update flag', 'z80 sfx', 'z80 program', 'z80 busreq', 'z80 reset', 'sound ram', 'stack']
        : c.who === 'game' ? ['stack', 'lastsfx'] : ['stack'];
      if (!allowed.includes(c.what)) unexpected.push({ who: c.who, what: c.what, pc: ev.pc, addr: ev.addr, size: ev.size, value: ev.value });
      if (ev.region === 'z80') {
        const z = ev.addr & 0x1fff;
        z80.push([z, ev.value]);
        if (z >= H.Z80_BUFFER && z < H.Z80_BUFFER + 48) buf[z - H.Z80_BUFFER] = ev.value;
        if (z === H.Z80_FLAG) flag = ev.value;
        if (z >= H.Z80_SFX && z < H.Z80_SFX + 6) sfx[z] = ev.value;
      } else if (ev.region === 'busreq' || ev.region === 'reset') {
        io.push([ev.region, ev.value]);
      }
    }
    return {
      steps: call.steps,
      writes: driverWrites,
      z80,
      buffer: buf.every((b) => b !== null) ? buf : null,
      flag,
      sfx: Object.keys(sfx).length ? sfx : null,
      io,
      unexpected,
      reads: call.reads
    };
  }

  /** Boot, start song `id`, run `frames` vblanks. */
  function runSong(rom, id, frames, opts) {
    const h = H.create({ rom, budget: opts && opts.budget });
    const boot = record(h.boot());
    const start = record(h.song(id));
    const out = [];
    for (let f = 0; f < frames; f++) out.push(record(h.vblank()));
    return { kind: 'song', id, boot, start, frames: out, harness: h };
  }

  /** Boot, one vblank, trigger SFX `id`, run `frames` vblanks. */
  function runSfx(rom, id, frames, opts) {
    const h = H.create({ rom, budget: opts && opts.budget });
    const boot = record(h.boot());
    const settle = record(h.vblank());
    // Each channel's current instrument ($41) when the SFX is triggered: the
    // driver skips a patch load when the stream's instrument equals it.
    const instruments = [0, 1, 2, 3, 4, 5].map((ch) => h.peek8(H.CHANNEL_BASE + ch * H.CHANNEL_STRIDE + 0x41));
    const start = record(h.sfx(id));
    const out = [];
    for (let f = 0; f < frames; f++) out.push(record(h.vblank()));
    return { kind: 'sfx', id, boot, settle, instruments, start, frames: out, harness: h };
  }

  /** One text line per vblank (plus boot/start lines). Deterministic. */
  function logText(run, title) {
    const lines = ['# ' + title];
    const describe = (label, r) => {
      const parts = [label, 'steps ' + r.steps];
      if (r.io.length) parts.push('io ' + r.io.map(([k, v]) => k + '=' + hex(v, 4)).join(','));
      if (r.z80.length > 60) parts.push('z80 writes ' + r.z80.length + ' ($' + Math.min(...r.z80.map(([z]) => z)).toString(16).toUpperCase().padStart(4, '0') + '-$' + Math.max(...r.z80.map(([z]) => z)).toString(16).toUpperCase().padStart(4, '0') + ')');
      if (r.sfx) parts.push('sfx ' + Object.keys(r.sfx).map(Number).sort((a, b) => a - b).map((z) => hex(z, 4) + '=' + hex(r.sfx[z], 2)).join(' '));
      if (r.buffer) parts.push('buf ' + bytes(r.buffer));
      else {
        const some = r.z80.filter(([z]) => z >= H.Z80_BUFFER && z < H.Z80_BUFFER + 48);
        if (some.length) parts.push('buf partial ' + some.map(([z, v]) => hex(z, 4) + '=' + hex(v, 2)).join(' '));
      }
      if (r.flag !== null) parts.push('flag ' + hex(r.flag, 2));
      for (const u of r.unexpected) parts.push('UNEXPECTED ' + u.who + ' ' + u.what + ' ' + hex(u.addr, 6) + '.' + u.size + '=' + hex(u.value) + ' @' + hex(u.pc, 6));
      lines.push(parts.join(' | '));
    };
    describe('boot', run.boot);
    if (run.settle) describe('vb -1', run.settle);
    describe(run.kind + ' ' + run.id, run.start);
    run.frames.forEach((r, i) => describe('vb ' + String(i).padStart(5, '0'), r));
    return lines.join('\n') + '\n';
  }

  /**
   * Canonical runs (tools/run-nhl92-68k-driver.js, test/nhl92-68k-driver.js):
   * every song for 3,600 vblanks (60 s), SngTitle for 9,000 so the run passes
   * channel 0's switch to song 2 at vblank 8,450; every SFX ID for 600.
   */
  const PLAN = {
    songs: [[0, 3600], [1, 9000], [2, 3600], [3, 3600], [4, 3600]],
    sfx: Array.from({ length: 35 }, (_, id) => [id, 600])
  };

  return { record, runSong, runSfx, logText, PLAN };
});
