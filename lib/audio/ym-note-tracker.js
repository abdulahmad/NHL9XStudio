/**
 * YM2612 write -> note tracker (UMD, Node and browser).
 *
 * Turns the register writes a sound driver makes into what a listener would call
 * notes, with no knowledge of any game's song data:
 *
 *   $28            key on/off. Low 3 bits are the channel code (0,1,2,4,5,6 = YM ch1-6;
 *                  3 and 7 don't exist), high 4 bits the operator mask. A note runs from a
 *                  write with a non-zero mask on a channel that is off to the next write with
 *                  mask 0. A key-on on a channel that is already on doesn't retrigger the
 *                  envelope on the chip, so it is counted (stats.redundantOn) and ignored.
 *   $A4-$A6, $A0-$A2  block + F-number. The high byte ($A4+: block in bits 3-5, F-number
 *                  bits 8-10 in bits 0-2) is latched; the low byte ($A0+) commits both, as on
 *                  the chip. Pitch = fnum * (fmClock/144) / 2^(21 - block), named by the
 *                  nearest equal-tempered semitone (C4 = 261.63 Hz = MIDI 60).
 *   $30-$9F, $B0-$B6  operator and channel parameters. A run of these writes to one channel is
 *                  one burst: with at least PATCH_MIN_REGS different registers it is a patch
 *                  load ('patch'), otherwise a parameter tweak such as a TL volume write
 *                  ('level'). A register written twice, or a gap over PATCH_GAP_T, starts a
 *                  new burst.
 *   $2B bit 7, $2A DAC on/off and sample writes. While the DAC is on, FM6 isn't what you hear.
 *   $22, $27, $A8-$AE  seen and counted, not interpreted (LFO, channel 3 special mode).
 *
 * The driver keys a note on *before* it writes the note's F-number (a few dozen T-states
 * later), so the first F-number committed within SETTLE_T of a key-on replaces the pitch the
 * channel was left with instead of starting a second segment. If no F-number follows, the note
 * keeps the inherited pitch (segment.inherited stays true).
 *
 * Time is whatever the caller passes as `t` (the chain uses Z80 T-states); nothing here reads
 * a clock. Input is either raw port writes (writePort: port 0/2 address, 1/3 data) or decoded
 * (write: part, reg, value). Bad input never throws; it is counted in stats.
 *
 * Data (read it, don't change it):
 *   notes[]     { ch, t0, t1|null, mask, segs: [{ t0, t1|null, midi|null, note, name, cents, hz,
 *                 fnum, block, inherited }] }   one per key-on edge, ch 0-5 = YM ch1-6
 *   patches[]   { ch, t0, t1, regs: Map(reg -> last value), kind, sig, algorithm, feedback }
 *   dacSpans[]  { t0, t1|null, writes }
 *   dacHits[]   { t0, t1, writes, peak, sig }  one per run of $2A writes that are not the centre value ($80): a PCM sample playing.
 *               sig = the first 10 distinct-in-a-row values, which identify the sample whatever pitch it is played at
 *   psg[]       { t, value }
 *   stats, channels[i] ({ keyed, dac (ch 5), pitch (current segment's, while keyed) })
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YmNoteTracker = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FM_CLOCK_NTSC = 7670454; // Genesis NTSC: 53,693,175 / 7
  const SETTLE_T = 2000;
  const DAC_HIT_GAP_T = 6000; // T-states
  const PATCH_MIN_REGS = 8;
  const PATCH_GAP_T = 29868; // half a Genesis frame in Z80 T-states
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CHANNEL_NAMES = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'FM6'];
  /** $28 channel code for YM channel 1-6 (index = channel - 1). */
  const KEY_CODES = [0, 1, 2, 4, 5, 6];

  /** Scientific pitch name of a MIDI note number (60 = C4). The driver's note index is midi - 12. */
  function midiName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  /**
   * Block + F-number -> pitch. Returns null for F-number 0 (no frequency). `note` is the
   * NHL '92 driver's note index (0-95 = C0-B7, midi - 12), which is also the generic
   * "semitones above C0" and may fall outside 0-95 for other games.
   */
  function fnumToPitch(block, fnum, fmClock) {
    if (!(fnum > 0)) return null;
    const hz = (fnum * ((fmClock || FM_CLOCK_NTSC) / 144)) / Math.pow(2, 21 - (block & 7));
    const exact = 69 + 12 * Math.log2(hz / 440);
    const midi = Math.round(exact);
    return { hz, midi, note: midi - 12, cents: (exact - midi) * 100, name: midiName(midi) };
  }

  function fnv(h, n) {
    h ^= n & 0xff;
    return Math.imul(h, 0x01000193) >>> 0;
  }

  function makePatch(ch, t) {
    const p = { ch, t0: t, t1: t, regs: new Map() };
    Object.defineProperties(p, {
      kind: { get() { return p.regs.size >= PATCH_MIN_REGS ? 'patch' : 'level'; } },
      // Same register contents -> same signature on any channel (the channel bits of the register are dropped).
      sig: {
        get() {
          const keys = Array.from(p.regs.keys()).sort((a, b) => (a & 0xfc) - (b & 0xfc) || a - b);
          let h = 0x811c9dc5;
          for (const k of keys) { h = fnv(h, k & 0xfc); h = fnv(h, p.regs.get(k)); }
          return h.toString(16).padStart(8, '0');
        }
      },
      algorithm: { get() { const v = p.regs.get(0xb0 + (p.ch % 3)); return v == null ? null : v & 7; } },
      feedback: { get() { const v = p.regs.get(0xb0 + (p.ch % 3)); return v == null ? null : (v >> 3) & 7; } }
    });
    return p;
  }

  /** @param {{fmClock?: number, settleT?: number, patchMinRegs?: number}} [opts] */
  function create(opts) {
    const o = opts || {};
    const fmClock = o.fmClock || FM_CLOCK_NTSC;
    const settleT = o.settleT != null ? o.settleT : SETTLE_T;
    const patchGapT = o.patchGapT != null ? o.patchGapT : PATCH_GAP_T;
    const six = (v) => new Array(6).fill(v);
    const stats = {
      writes: 0, keyWrites: six(0), keyOns: six(0), keyOffs: six(0), redundantOn: six(0), redundantOff: six(0),
      invalidKey: 0, invalidReg: 0, patchWrites: 0, freqWrites: 0, dacWrites: 0, psgWrites: 0, resets: 0,
      other: 0, ch3Special: 0
    };
    const notes = [];
    const patches = [];
    const dacSpans = [];
    const dacHits = [];
    let dacHit = null;
    const psg = [];
    const latch = [0, 0];
    const state = [];
    for (let i = 0; i < 6; i++) {
      state.push({ index: i, name: CHANNEL_NAMES[i], fnumHi: 0, fnum: 0, block: 0, hasFreq: false, keyMask: 0, keyed: false, cur: null, burst: null });
    }
    let dacOn = false;
    let dacSpan = null;
    let ch3Mode = 0;

    const channels = state.map((c) => ({
      get index() { return c.index; },
      get name() { return c.name; },
      get keyed() { return c.keyed; },
      get dac() { return c.index === 5 && dacOn; },
      get pitch() {
        if (!c.keyed || !c.cur) return null;
        const s = c.cur.segs[c.cur.segs.length - 1];
        return s && s.midi != null ? s : null;
      }
    }));

    function segFor(t, c) {
      const p = c.hasFreq ? fnumToPitch(c.block, c.fnum, fmClock) : null;
      return {
        t0: t, t1: null, midi: p ? p.midi : null, note: p ? p.note : null, name: p ? p.name : null,
        cents: p ? p.cents : 0, hz: p ? p.hz : 0, fnum: c.fnum, block: c.block, inherited: true
      };
    }

    function startNote(t, c, mask) {
      const n = { ch: c.index, t0: t, t1: null, mask, segs: [segFor(t, c)] };
      c.cur = n;
      c.keyed = true;
      notes.push(n);
      stats.keyOns[c.index] += 1;
    }

    function endNote(t, c) {
      const n = c.cur;
      n.t1 = t;
      n.segs[n.segs.length - 1].t1 = t;
      c.cur = null;
      c.keyed = false;
      stats.keyOffs[c.index] += 1;
    }

    function keyWrite(t, v) {
      const code = v & 7;
      if ((code & 3) === 3) { stats.invalidKey += 1; return; }
      const c = state[(code & 3) + (code & 4 ? 3 : 0)];
      const mask = (v >> 4) & 15;
      stats.keyWrites[c.index] += 1;
      c.keyMask = mask;
      if (mask) {
        if (c.keyed) stats.redundantOn[c.index] += 1;
        else startNote(t, c, mask);
      } else if (c.keyed) endNote(t, c);
      else stats.redundantOff[c.index] += 1;
    }

    function commitFreq(t, c, lo) {
      c.block = (c.fnumHi >> 3) & 7;
      c.fnum = ((c.fnumHi & 7) << 8) | (lo & 0xff);
      c.hasFreq = true;
      stats.freqWrites += 1;
      const n = c.cur;
      if (!n) return;
      const seg = n.segs[n.segs.length - 1];
      const p = fnumToPitch(c.block, c.fnum, fmClock);
      const midi = p ? p.midi : null;
      const fill = (s) => {
        s.midi = midi; s.note = p ? p.note : null; s.name = p ? p.name : null;
        s.cents = p ? p.cents : 0; s.hz = p ? p.hz : 0; s.fnum = c.fnum; s.block = c.block; s.inherited = false;
      };
      if (n.segs.length === 1 && seg.inherited && t - n.t0 <= settleT) fill(seg);
      else if (midi !== seg.midi) {
        seg.t1 = t;
        const next = segFor(t, c);
        next.inherited = false;
        n.segs.push(next);
      } else {
        seg.cents = p ? p.cents : 0; seg.hz = p ? p.hz : 0; seg.fnum = c.fnum; seg.block = c.block;
      }
    }

    function patchWrite(t, c, reg, v) {
      stats.patchWrites += 1;
      let b = c.burst;
      if (!b || t - b.t1 > patchGapT || b.regs.has(reg)) {
        b = c.burst = makePatch(c.index, t);
        patches.push(b);
      }
      b.regs.set(reg, v);
      b.t1 = t;
    }

    function dacEnable(t, on) {
      if (on && !dacOn) {
        dacOn = true;
        dacSpan = { t0: t, t1: null, writes: 0 };
        dacSpans.push(dacSpan);
      } else if (!on && dacOn) {
        dacOn = false;
        dacSpan.t1 = t;
        dacSpan = null;
      }
    }

    /** One decoded register write. */
    // A PCM sample is a run of $2A writes; the centre value ($80) is silence and does not extend it. A gap of more than
    // DAC_HIT_GAP_T without a non-centre write ends the hit (a sample at the slowest rate writes every ~450 T-states).
    function dacWrite(t, v) {
      if (v === 0x80) return;
      if (dacHit && v === dacHit.lastV) {
        // The driver keeps writing a sample's last byte once it has run out (a held level is silence on the DAC), so a
        // run of the same value does not extend the hit; a change after a long hold is a new sample starting.
        dacHit.held += 1;
        return;
      }
      if (!dacHit || t - dacHit.t1 > DAC_HIT_GAP_T || dacHit.restart) {
        dacHit = { t0: t, t1: t, writes: 0, peak: 0, sig: [], lastV: -1, held: 0, restart: false };
        dacHits.push(dacHit);
      }
      dacHit.writes += 1 + dacHit.held;
      dacHit.held = 0;
      dacHit.t1 = t;
      dacHit.lastV = v;
      const a = Math.abs(v - 0x80);
      if (a > dacHit.peak) dacHit.peak = a;
      if (dacHit.sig.length < 10 && dacHit.sig[dacHit.sig.length - 1] !== v) dacHit.sig.push(v);
    }

    /** A $2B enable write (even a redundant one) is how the drivers start a sample: the next non-centre write opens a new hit. */
    function dacStart() {
      if (dacHit) dacHit.restart = true;
    }

    function write(t, part, reg, value) {
      part &= 1;
      reg &= 0xff;
      const v = value & 0xff;
      stats.writes += 1;
      if (part === 0 && reg < 0x30) {
        if (reg === 0x28) keyWrite(t, v);
        else if (reg === 0x2a) { stats.dacWrites += 1; if (dacSpan) dacSpan.writes += 1; dacWrite(t, v); }
        else if (reg === 0x2b) { dacEnable(t, (v & 0x80) !== 0); if (v & 0x80) dacStart(); }
        else if (reg === 0x27) { ch3Mode = (v >> 6) & 3; stats.other += 1; }
        else stats.other += 1;
        return;
      }
      if (reg >= 0xa0 && reg <= 0xa6) {
        const k = reg & 3;
        if (k === 3) { stats.invalidReg += 1; return; }
        const c = state[part * 3 + k];
        if (reg & 4) c.fnumHi = v & 0x3f;
        else commitFreq(t, c, v);
        return;
      }
      if (reg >= 0xa8 && reg <= 0xae) { stats.ch3Special += 1; return; }
      if ((reg >= 0x30 && reg <= 0x9f) || (reg >= 0xb0 && reg <= 0xb6)) {
        const k = reg & 3;
        if (k === 3) { stats.invalidReg += 1; return; }
        patchWrite(t, state[part * 3 + k], reg, v);
        return;
      }
      stats.other += 1;
    }

    /** One raw port write: port 0/2 latches the register, 1/3 writes it (part = port >> 1). */
    function writePort(t, port, value) {
      const part = (port >> 1) & 1;
      if ((port & 1) === 0) latch[part] = value & 0xff;
      else write(t, part, latch[part], value);
    }

    function psgWrite(t, value) {
      stats.psgWrites += 1;
      psg.push({ t, value: value & 0xff });
    }

    /** Close every open note and DAC span at `t` (end of a render or analysis). */
    function finish(t) {
      for (const c of state) if (c.keyed) endNote(t, c);
      for (const c of state) c.burst = null;
      if (dacOn) dacEnable(t, false);
    }

    /** The chip was reset: everything stops and the registers read back as power-on. */
    function reset(t) {
      stats.resets += 1;
      finish(t);
      for (const c of state) { c.fnumHi = 0; c.fnum = 0; c.block = 0; c.hasFreq = false; c.keyMask = 0; }
      latch[0] = latch[1] = 0;
      ch3Mode = 0;
    }

    /** Drop closed notes, bursts, DAC spans and PSG writes that ended before `beforeT`. */
    function trim(beforeT) {
      const keep = (arr, endOf) => {
        let w = 0;
        for (let i = 0; i < arr.length; i++) {
          const e = endOf(arr[i]);
          if (e === null || e >= beforeT) arr[w++] = arr[i];
        }
        arr.length = w;
      };
      keep(notes, (n) => n.t1);
      keep(patches, (p) => p.t1);
      keep(dacSpans, (d) => d.t1);
      keep(dacHits, (d) => d.t1);
      keep(psg, (x) => x.t);
    }

    return {
      notes, patches, dacSpans, dacHits, psg, stats, channels,
      write, writePort, psgWrite, finish, reset, trim,
      get dacOn() { return dacOn; },
      get ch3Mode() { return ch3Mode; },
      fmClock
    };
  }

  /**
   * Run a whole decoded YM log ([{ t, part, reg, value }], the harness's z.ym) and close
   * everything at `endT` (default: the last write).
   */
  function trackLog(log, opts, endT) {
    const tr = create(opts);
    let last = 0;
    for (const w of log) {
      tr.write(w.t, w.part, w.reg, w.value);
      last = w.t;
    }
    tr.finish(endT != null ? endT : last);
    return tr;
  }

  return {
    FM_CLOCK_NTSC, SETTLE_T, PATCH_MIN_REGS, PATCH_GAP_T, NOTE_NAMES, CHANNEL_NAMES, KEY_CODES,
    midiName, fnumToPitch, create, trackLog
  };
});
