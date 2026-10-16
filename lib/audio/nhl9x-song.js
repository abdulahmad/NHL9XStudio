/**
 * NHLPA 93 / NHL 94 (Genesis) sound streams: reads the driver's event streams and FM patches straight from the
 * bundled sound slices (data/fixtures/nhl9{3,4}-sound-slice.bin).
 *
 * Stream (sound93.asm / sound94.asm ProcessOneMusicTrack): 4-byte events  [delay, status, a, b].
 *   delay  vblanks to wait BEFORE the event (59.92 Hz);
 *   status $1c key on  (a = note, b = volume, 0 = key off)   $0c key off (a = note)   $4c patch = a
 *          $3c controller a (only 7 = volume, b)             $6c pitch bend (word a:b - $2000)
 *          $2x $5x $7x ignored;  c = channel 0-15;  status 0 ends the stream, and a non-negative long at +2 loops.
 * Patches: 32 x 32 bytes, patch >= $60 is a PCM sample.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl9xSong = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 93 streams are 16-bit offsets from the table, 94 streams are long ROM addresses.
  const GAMES = {
    93: { start: 0x165d8, table: 0x2870a, count: 56, kind: 'offset' },
    94: { start: 0x1a264, table: 0x2c648, count: 123, kind: 'long' }
  };
  const VBLANK_HZ = 59.92;
  const MAX_EVENTS = 20000;

  function be16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

  /** ROM address of sound `id`'s stream. */
  function streamAddr(game, slice, id) {
    const g = GAMES[game];
    if (!g || id < 0 || id >= g.count) return -1;
    const t = g.table - g.start;
    return g.kind === 'offset' ? g.table + be16(slice, t + 2 * id) : be32(slice, t + 4 * id);
  }

  /** The 32 FM patches as Uint8Array(32) each. */
  function patches(game, slice) {
    const g = GAMES[game];
    const o = g.table - g.start - 1024;
    const out = [];
    for (let i = 0; i < 32; i++) out.push(slice.slice(o + i * 32, o + i * 32 + 32));
    return out;
  }

  /**
   * Parse a stream into events with absolute vblank time. Returns
   * { events:[{t,ch,kind,note,vel,patch,ctl,val,bend}], ticks, loopTick|null, end:'end'|'loop' }.
   * `ticks` is the length up to the end event (or up to the loop jump). Loops are followed once to find loopTick.
   */
  function parse(game, slice, addr) {
    const g = GAMES[game];
    const base = g.start;
    const events = [];
    let p = addr - base, t = 0, loopTick = null, end = 'end';
    const seen = new Map();
    for (let n = 0; n < MAX_EVENTS; n++) {
      if (p < 0 || p + 4 > slice.length) { end = 'bad'; break; }
      seen.set(p, t);
      t += slice[p];
      const st = slice[p + 1];
      if (st === 0) {
        const hi = be16(slice, p + 2);
        if (hi & 0x8000) { end = 'end'; break; }
        const target = be32(slice, p + 2) - base;
        end = 'loop';
        loopTick = seen.has(target) ? seen.get(target) : null;
        break;
      }
      const cmd = (st >> 4) & 7, ch = st & 15, a = slice[p + 2], b = slice[p + 3];
      if (cmd === 1) events.push({ t, ch, kind: b ? 'on' : 'off', note: a, vel: b });
      else if (cmd === 0) events.push({ t, ch, kind: 'off', note: a, vel: 0 });
      else if (cmd === 4) events.push({ t, ch, kind: 'patch', patch: a });
      else if (cmd === 3) events.push({ t, ch, kind: 'ctl', ctl: a, val: b });
      else if (cmd === 6) events.push({ t, ch, kind: 'bend', bend: ((a << 8) | b) - 0x2000 });
      p += 4;
    }
    return { events, ticks: t, loopTick, end, seconds: t / VBLANK_HZ };
  }

  // --- stream -> General MIDI ------------------------------------------------------------------------

  const GM_PPQ = 480;
  const GM_TICKS_PER_S = 960; // 480 PPQ at 120 BPM, like nhl92-song-gm.js gmFromTracker
  const DRUM_CH = 9;
  const DRUM_LEN = 60;
  const toTick = (vbl) => Math.round((vbl / VBLANK_HZ) * GM_TICKS_PER_S);

  /**
   * Sound `id` as a General MIDI song (smf.js / nhl92-song-gm.js shape: notes {tick,dur,ch,pitch,vel,program}).
   * `map` is data/audio/nhl9x-gm-map.json. Stream channels become MIDI channels 0-8, 10-15 in order of first use;
   * notes of a drum target (or a PCM patch the map sends to a drum) go to channel 10. The note velocity is the key-on
   * volume scaled by the channel's controller 7. Pitch bends are not converted.
   * @returns {{song:object, notes:number, ticks:number, loopTick:number|null, seconds:number, unmapped:number[]}}
   */
  function toGm(game, slice, id, map) {
    const addr = streamAddr(game, slice, id);
    if (addr < 0) throw new RangeError('no such sound ' + id);
    const r = parse(game, slice, addr);
    const byPatch = {};
    map.patches.forEach((e) => { byPatch[e.patch] = e; });
    const state = {}; // stream channel -> {patch, vol}
    const gmCh = {};
    let nextCh = 0;
    const channelOf = (c) => {
      if (gmCh[c] == null) { if (nextCh === DRUM_CH) nextCh++; gmCh[c] = Math.min(nextCh++, 15); }
      return gmCh[c];
    };
    const open = {}; // 'ch:note' -> note being held
    const notes = [];
    const unmapped = new Set();
    const endTick = toTick(r.ticks);
    const close = (n, tick) => { n.dur = Math.max(1, tick - n.tick); };
    r.events.forEach((e) => {
      const st = state[e.ch] || (state[e.ch] = { patch: 0, vol: 0x7f });
      const key = e.ch + ':' + e.note;
      if (e.kind === 'patch') st.patch = e.patch;
      else if (e.kind === 'ctl') { if (e.ctl === 7) st.vol = e.val; }
      else if (e.kind === 'off') {
        if (open[key]) { close(open[key], toTick(e.t)); delete open[key]; }
      } else if (e.kind === 'on') {
        const tick = toTick(e.t);
        if (open[key]) { close(open[key], tick); delete open[key]; }
        const entry = byPatch[st.patch];
        if (!entry) unmapped.add(st.patch);
        const vel = Math.max(1, Math.min(127, Math.round((e.vel * st.vol) / 127)));
        const tgt = entry && entry.target;
        if (tgt && tgt.kind === 'drum') {
          notes.push({ tick, dur: DRUM_LEN, ch: DRUM_CH, pitch: tgt.note, vel, program: null });
        } else {
          const n = { tick, dur: 0, ch: channelOf(e.ch), pitch: Math.max(0, Math.min(127, e.note)), vel, program: tgt ? tgt.program : 0 };
          notes.push(n);
          open[key] = n;
        }
      }
    });
    Object.keys(open).forEach((k) => close(open[k], endTick));
    notes.forEach((n) => { if (!n.dur) n.dur = DRUM_LEN; });
    notes.sort((a, b) => a.tick - b.tick || a.ch - b.ch);
    return {
      song: { ppq: GM_PPQ, tempos: [{ tick: 0, bpm: 120 }], name: '', notes },
      notes: notes.length, ticks: r.ticks, loopTick: r.loopTick, seconds: r.seconds,
      unmapped: Array.from(unmapped).sort((a, b) => a - b)
    };
  }

  /**
   * Which FM patch a register burst from ym-note-tracker is, or -1. The Z80 writes a patch's bytes 0-23 to the
   * operator registers in order (+0, +4, +8, +$C per group $30-$80) and byte 28 to $B0.
   * @param {Uint8Array[]} bank patches()
   * @param {Map<number,number>} regs the burst's register -> value map
   */
  function identify(bank, regs, ch) {
    const off = ch % 3;
    for (let i = 0; i < bank.length; i++) {
      let ok = true;
      for (let k = 0; k < 25 && ok; k++) {
        const reg = k < 24 ? 0x30 + (k >> 2) * 0x10 + (k & 3) * 4 : 0xb0;
        ok = regs.get(reg + off) === bank[i][k < 24 ? k : 28];
      }
      if (ok) return i;
    }
    return -1;
  }

  return { GAMES, VBLANK_HZ, GM_PPQ, streamAddr, patches, parse, toGm, identify };
});
