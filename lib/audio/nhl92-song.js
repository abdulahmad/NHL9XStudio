/**
 * NHL '92 song model and cmdstream encoder.
 *
 * A song here is what the retail 68k driver plays: a tempo (frames per duration unit) and six
 * FM channels, each a single line of notes. All times are in duration units (one unit lasts
 * `tempo` vblanks, so 1 unit = 1/16 note at tempo 6 = 150 BPM and tempo 7 = 128 BPM).
 *
 *   NhlSong = { tempo, units, channels: [ [ { unit, len, index, patch } ] x 6 ] }
 *     unit   start, in units from the song start
 *     len    length in units (1-95: the duration byte is $A0 + units)
 *     index  note-table index 0-95 (MIDI note = index + 12)
 *     patch  Z80 patch 0-21
 *     optional effects, all of which the retail cmdstream can express (docs/NHL92-SOUND-DATA.md):
 *       mod      { delay, delta }  $81: for `delay` frames add `delta` to the note's F-number each frame (one note only)
 *       env      { id, speed }     $86: pitch envelope 0-3, speed -128..127 (a channel state: it stays until another note says otherwise)
 *       legato   true              $83: this note does not key on again or restart its envelope
 *       noKeyOff true              $89: no key-off on this note's last tick
 *
 *   fromParsed(data, songId)   a retail song, one pass of the longest channel (shorter channels repeat), from lib/audio/nhl92-sound-data.js
 *   build(song)                the song as NHL '92 cmdstreams: patterns + order lists (bytes)
 *   romWithSong(rom, built)    a copy of the sound ROM that plays the built song as song 4
 *   toAsm(built, name)         the same bytes as dc.b / dc.w lines in the disassembly's style
 *
 * The retail format is documented in docs/NHL92-SOUND-DATA.md. Nothing here changes the
 * drivers, the patches or the retail data: romWithSong works on a copy.
 *
 * UMD: Node and the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Song = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var BASE = 0xf4c8;
  var CHANNELS = 6;
  var PATCH_COUNT = 22;
  var MAX_INDEX = 95;
  var MAX_UNITS = 95; // duration byte $A0 + n, n 1-95 ($FF)
  var FRAME_HZ = 3579545 / 59736; // NTSC vblank rate
  // Patch byte +$1A, added to every note by the driver. Only patch 4 is non-zero (docs/NHL92-SOUND-DATA.md).
  var NOTE_OFFSETS = [0, 0, 0, 0, -3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Where romWithSong puts things. The pattern area is the retail pattern block ($1061E-$11623):
  // pattern words are BASE-relative and must stay below $8000, so patterns have to sit in the
  // first 32 KB after BASE. Order lists are addressed by 32-bit pointers and go past the sound slice.
  var PATTERN_START = 0x1061e;
  var PATTERN_END = 0x11624; // exclusive
  var ORDER_START = 0x25000;
  var SONG_TABLE = 0x10294;
  var SONG_STRIDE = 0x1a;
  var CUSTOM_SONG = 4;
  var ROM_SIZE = 0x28000;

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var midiOfIndex = function (index) { return index + 12; };
  var indexOfMidi = function (midi) { return midi - 12; };
  var noteName = function (midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); };
  var secondsPerUnit = function (tempo) { return tempo / FRAME_HZ; };
  /** Quarter-note BPM if 4 units make a quarter note (1 unit = a 16th). */
  var bpmOfTempo = function (tempo) { return (60 * FRAME_HZ) / (4 * tempo); };
  var tempoOfBpm = function (bpm) { return Math.max(1, Math.min(32, Math.round((60 * FRAME_HZ) / (4 * bpm)))); };

  // The YM2612 register each of a patch's 26 bytes goes to (channel 0 of a part; add the channel's
  // 0-2 position within its part). Same order as the Z80 driver's table at $00C5.
  var PATCH_REGS = [0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60,
    0x68, 0x64, 0x6c, 0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0xb0, 0xb4];

  /**
   * Which retail patch a register burst from ym-note-tracker is, or -1. Compares the 24 operator
   * registers and $B0 (not $B4: the driver ORs the pan bits in there).
   * @param {Array<{registers:number[]}>} patches parser patches
   * @param {Map<number,number>} regs the burst's register -> value map
   * @param {number} ch FM channel 0-5
   */
  function identifyPatch(patches, regs, ch) {
    var off = ch % 3;
    for (var i = 0; i < patches.length; i++) {
      var ok = true;
      for (var k = 0; k < 25 && ok; k++) {
        var v = regs.get(PATCH_REGS[k] + off);
        if (v !== patches[i].registers[k]) ok = false;
      }
      if (ok) return i;
    }
    return -1;
  }

  function emptySong(tempo) {
    return { tempo: tempo || 6, units: 0, channels: [[], [], [], [], [], []] };
  }

  /** Total length in units: the end of the last note, or `song.units` if longer. */
  function lengthOf(song) {
    var end = song.units || 0;
    song.channels.forEach(function (ch) { ch.forEach(function (n) { end = Math.max(end, n.unit + n.len); }); });
    return end;
  }

  // --- A retail song -> NhlSong ---------------------------------------------------------

  /**
   * One pass over each channel of a retail song: order list with repeats expanded, stopping at
   * the restart or the song switch (the same walk as lib/audio/nhl92-gm-analysis.js patchUsage).
   * Modulation, pitch envelopes, legato and no-key-off are kept as note effects.
   * @param {object} data lib/audio/nhl92-sound-data.js parse() result
   */
  function fromParsed(data, songId) {
    var song = data.songs[songId];
    if (!song) throw new RangeError('song ' + songId);
    var patternAt = new Map();
    data.patternEntries.forEach(function (p) { patternAt.set(p.start, p); });
    var out = emptySong(song.tempo);
    var passes = [];
    song.orderLists.forEach(function (listStart, ch) {
      var list = data.orderLists.find(function (l) { return l.start === listStart; });
      var played = [];
      var prev = null;
      var halted = false;
      list.items.forEach(function (it) {
        if (halted) return;
        if (it.kind === 'restart' || it.kind === 'song') { halted = true; return; }
        if (it.kind === 'pattern') { played.push(it.pattern); prev = it.pattern; }
        if (it.kind === 'repeat') for (var k = 0; k < it.count; k++) played.push(prev);
      });
      var st = { patch: null, transpose: 0, units: null, env: null, mod: null, legato: false, noKeyOff: false };
      var at = 0;
      played.forEach(function (pat) {
        patternAt.get(pat).events.forEach(function (e) {
          if (e.kind === 'instrument') st.patch = e.patch;
          else if (e.kind === 'transpose') st.transpose = e.semitones;
          else if (e.kind === 'duration') st.units = e.units;
          else if (e.kind === 'modulation') st.mod = { delay: e.delay, delta: e.delta };
          else if (e.kind === 'envelope') st.env = e.speed ? { id: e.envelope, speed: e.speed } : null;
          else if (e.kind === 'envelopeOff') st.env = null;
          else if (e.kind === 'sustain') st.legato = true;
          else if (e.kind === 'noKeyOff') st.noKeyOff = true;
          else if (e.kind === 'rest') { if (st.units != null) at += st.units; st.mod = null; st.legato = false; st.noKeyOff = false; }
          else if (e.kind === 'note' && st.patch != null && st.units != null) {
            var index = (e.note + data.patches[st.patch].noteOffset + st.transpose) & 0xff;
            var note = { unit: at, len: st.units, index: index, patch: st.patch };
            if (st.mod) note.mod = st.mod;
            if (st.env) note.env = st.env;
            if (st.legato) note.legato = true;
            if (st.noKeyOff) note.noKeyOff = true;
            out.channels[ch].push(note);
            st.mod = null; st.legato = false; st.noKeyOff = false;
            at += st.units;
          }
        });
      });
      passes[ch] = at;
      out.units = Math.max(out.units, at);
    });
    // Each channel loops on its own at the end of its list, so a shorter channel repeats while a
    // longer one is still playing. Tile it to the longest channel to keep that.
    out.channels.forEach(function (notes, ch) {
      var pass = passes[ch];
      if (!(pass > 0) || pass >= out.units) return;
      var once = notes.slice();
      for (var at = pass; at < out.units; at += pass) {
        once.forEach(function (n) {
          if (n.unit + at < out.units) notes.push(Object.assign({}, n, { unit: n.unit + at, len: Math.min(n.len, out.units - n.unit - at) }));
        });
      }
    });
    return out;
  }

  // --- NhlSong -> cmdstream -------------------------------------------------------------

  var intIn = function (v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.round(v) >= lo && Math.round(v) <= hi; };
  function cleanMod(m, problems, chan, n) {
    if (!m) return null;
    if (!intIn(m.delay, 1, 255) || !intIn(m.delta, -128, 127)) { problems.push('channel ' + (chan + 1) + ': modulation at unit ' + n.unit + ' needs delay 1-255 and delta -128..127 and was left out'); return null; }
    return m.delta === 0 ? null : { delay: Math.round(m.delay), delta: Math.round(m.delta) };
  }
  function cleanEnv(e, problems, chan, n) {
    if (!e) return null;
    if (!intIn(e.id, 0, 3) || !intIn(e.speed, -128, 127)) { problems.push('channel ' + (chan + 1) + ': pitch envelope at unit ' + n.unit + ' needs id 0-3 and speed -128..127 and was left out'); return null; }
    return e.speed === 0 ? null : { id: Math.round(e.id), speed: Math.round(e.speed) };
  }
  var sameEnv = function (a, b) { return (!a && !b) || !!(a && b && a.id === b.id && a.speed === b.speed); };

  /**
   * Notes and gaps of one channel as a flat run of { rest|note, len } covering exactly `total`
   * units. Overlapping notes are cut at the next start (a channel plays one note at a time).
   * Anything longer than 95 units is split into 95-unit pieces; a note's tail piece is a rest.
   */
  function timeline(notes, total, problems, chan) {
    var sorted = notes.slice().sort(function (a, b) { return a.unit - b.unit || a.index - b.index; });
    var out = [];
    var at = 0;
    function rest(len) {
      while (len > 0) { var n = Math.min(MAX_UNITS, len); out.push({ rest: true, len: n }); len -= n; }
    }
    sorted.forEach(function (n, i) {
      var start = Math.max(n.unit, at);
      var next = i + 1 < sorted.length ? sorted[i + 1].unit : Infinity;
      var len = Math.min(n.len - (start - n.unit), next - start, total - start);
      if (!(len >= 1)) {
        problems.push('channel ' + (chan + 1) + ': note at unit ' + n.unit + ' has no room and was dropped');
        return;
      }
      if (n.index < 0 || n.index > MAX_INDEX) {
        problems.push('channel ' + (chan + 1) + ': note index ' + n.index + ' at unit ' + n.unit + ' is outside the driver\'s note tables (0-' + MAX_INDEX + ') and was turned into a rest');
        rest(start - at + len);
        at = start + len;
        return;
      }
      var byte = n.index - NOTE_OFFSETS[n.patch];
      if (byte < 0 || byte >= 0x60) {
        problems.push('channel ' + (chan + 1) + ': note index ' + n.index + ' on patch ' + n.patch + ' cannot be written as a note byte and was turned into a rest');
        rest(start - at + len);
        at = start + len;
        return;
      }
      rest(start - at);
      var first = Math.min(MAX_UNITS, len);
      out.push({ rest: false, len: first, byte: byte, patch: n.patch, mod: cleanMod(n.mod, problems, chan, n), env: cleanEnv(n.env, problems, chan, n), legato: !!n.legato, noKeyOff: !!n.noKeyOff });
      if (len > first) {
        problems.push('channel ' + (chan + 1) + ': note at unit ' + n.unit + ' is ' + len + ' units long; the driver\'s longest duration is ' + MAX_UNITS + ', the rest is silence');
        rest(len - first);
      }
      at = start + len;
    });
    rest(total - at);
    return out;
  }

  /**
   * Bytes of one pattern. Every pattern restates what it needs (the instrument before its first
   * note and the duration before its first event), so it does not depend on the pattern before
   * it and identical bars are the same bytes.
   */
  function patternBytes(events, usesEnv) {
    var b = [];
    var patch = null;
    var dur = null;
    var env;
    events.forEach(function (e) {
      if (!e.rest && e.patch !== patch) { b.push(0x80, e.patch); patch = e.patch; }
      if (!e.rest && usesEnv && (env === undefined || !sameEnv(env, e.env))) {
        if (e.env) b.push(0x86, e.env.id, e.env.speed & 0xff); else b.push(0x87);
        env = e.env;
      }
      if (!e.rest) {
        if (e.mod) b.push(0x81, e.mod.delay, e.mod.delta & 0xff);
        if (e.legato) b.push(0x83);
        if (e.noKeyOff) b.push(0x89);
      }
      if (e.len !== dur) { b.push(0xa0 + e.len); dur = e.len; }
      b.push(e.rest ? 0x60 : e.byte);
    });
    b.push(0x84);
    return b;
  }

  /**
   * Build the cmdstreams.
   * @param {object} song NhlSong
   * @param {{barUnits?: number}} [opts] a pattern is closed once it holds at least this many units
   * @returns {{tempo:number, units:number, channels:Array<{patterns:number[][], order:number[]}>, problems:string[], stats:object}}
   *   order = indexes into the channel's patterns[]; the list ends with a restart ($0000)
   */
  function build(song, opts) {
    var bar = (opts && opts.barUnits) || 16;
    var problems = [];
    var total = lengthOf(song);
    if (!(total >= 1)) throw new RangeError('the song is empty');
    if (!(song.tempo >= 1 && song.tempo <= 255)) throw new RangeError('tempo 1-255');
    song.channels.forEach(function (notes) {
      notes.forEach(function (n) { if (!(n.patch >= 0 && n.patch < PATCH_COUNT)) throw new RangeError('patch ' + n.patch); });
    });
    var channels = song.channels.map(function (notes, chan) {
      var line = timeline(notes, total, problems, chan);
      var usesEnv = line.some(function (e) { return !e.rest && e.env; });
      var seen = {};
      var patterns = [];
      var order = [];
      var cur = [];
      var curUnits = 0;
      var flush = function () {
        if (!cur.length) return;
        var bytes = patternBytes(cur, usesEnv);
        var key = bytes.join(',');
        if (!(key in seen)) { seen[key] = patterns.length; patterns.push(bytes); }
        order.push(seen[key]);
        cur = [];
        curUnits = 0;
      };
      line.forEach(function (e) {
        cur.push(e);
        curUnits += e.len;
        if (curUnits >= bar) flush();
      });
      flush();
      return { patterns: patterns, order: order };
    });
    var patternTotal = 0;
    var orderTotal = 0;
    var count = 0;
    channels.forEach(function (c) {
      c.patterns.forEach(function (p) { patternTotal += p.length; count += 1; });
      orderTotal += c.order.length * 2 + 2;
    });
    return {
      tempo: song.tempo,
      units: total,
      channels: channels,
      problems: problems,
      stats: { patterns: count, patternBytes: patternTotal, orderBytes: orderTotal, seconds: total * secondsPerUnit(song.tempo) }
    };
  }

  // --- Putting a built song into a ROM copy ---------------------------------------------

  /**
   * Lay the built song out: patterns packed from PATTERN_START (fails if they overflow the retail
   * pattern block), order lists from ORDER_START. Returns the bytes to write and the pointers.
   */
  function layout(built) {
    var patternAddr = [];
    var at = PATTERN_START;
    built.channels.forEach(function (c) {
      patternAddr.push(c.patterns.map(function (p) { var a = at; at += p.length; return a; }));
    });
    if (at > PATTERN_END) {
      throw new RangeError('the patterns take ' + (at - PATTERN_START) + ' bytes; the retail pattern block holds ' + (PATTERN_END - PATTERN_START) +
        ' (pattern pointers are 16-bit BASE-relative words, so they cannot move out of the first 32 KB). Shorten the song or repeat more bars.');
    }
    var orderAddr = [];
    var oat = ORDER_START;
    built.channels.forEach(function (c) { orderAddr.push(oat); oat += c.order.length * 2 + 2; });
    return { patternAddr: patternAddr, orderAddr: orderAddr, patternEnd: at, orderEnd: oat };
  }

  /**
   * A copy of `rom` where song 4 (SngPO) is replaced by the built song. The retail patterns of the
   * other songs are overwritten in the copy (the new patterns take their place), so only the
   * custom song is meant to be played from it. Drivers, patches and samples are untouched.
   * @param {Uint8Array} rom the bundled sound ROM (sound region at $F4C8)
   */
  function romWithSong(rom, built) {
    var lay = layout(built);
    var out = new Uint8Array(Math.max(ROM_SIZE, rom.length));
    out.set(rom);
    out.fill(0, PATTERN_START, PATTERN_END);
    built.channels.forEach(function (c, ch) {
      c.patterns.forEach(function (p, i) { out.set(p, lay.patternAddr[ch][i]); });
      var o = lay.orderAddr[ch];
      c.order.forEach(function (pi, k) {
        var rel = lay.patternAddr[ch][pi] - BASE;
        out[o + k * 2] = rel >> 8;
        out[o + k * 2 + 1] = rel & 0xff;
      });
      out[o + c.order.length * 2] = 0; // $0000: restart
      out[o + c.order.length * 2 + 1] = 0;
    });
    var e = SONG_TABLE + CUSTOM_SONG * SONG_STRIDE;
    out[e] = CHANNELS - 1;
    out[e + 1] = built.tempo;
    built.channels.forEach(function (c, ch) {
      var rel = lay.orderAddr[ch] - BASE;
      out[e + 2 + ch * 4] = (rel >>> 24) & 0xff;
      out[e + 3 + ch * 4] = (rel >>> 16) & 0xff;
      out[e + 4 + ch * 4] = (rel >>> 8) & 0xff;
      out[e + 5 + ch * 4] = rel & 0xff;
    });
    return out;
  }

  // --- Text export ----------------------------------------------------------------------

  var hex2 = function (n) { return '$' + (n < 16 ? '0' : '') + n.toString(16).toUpperCase(); };
  var hexOf = function (n) { return '$' + n.toString(16).toUpperCase(); };

  /** Readable form of one pattern's bytes, as a comment. */
  function describePattern(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b === 0x80) { parts.push('inst ' + bytes[i + 1]); i += 1; }
      else if (b === 0x81) { parts.push('mod ' + bytes[i + 1] + ' ' + (bytes[i + 2] > 127 ? bytes[i + 2] - 256 : bytes[i + 2])); i += 2; }
      else if (b === 0x86) { parts.push('env ' + bytes[i + 1] + ' ' + (bytes[i + 2] > 127 ? bytes[i + 2] - 256 : bytes[i + 2])); i += 2; }
      else if (b === 0x87) parts.push('env off');
      else if (b === 0x83) parts.push('legato');
      else if (b === 0x89) parts.push('nokeyoff');
      else if (b === 0x84) parts.push('end');
      else if (b === 0x60) parts.push('rest');
      else if (b >= 0xa0) parts.push('dur ' + (b - 0xa0));
      else parts.push(noteName(b + 12));
    }
    return parts.join(' ');
  }

  /**
   * The built song as assembler source in the disassembly's style: a fmtune header, one order list
   * per channel (BASE-relative words; $0000 restarts) and the patterns.
   * @param {string} [name] label prefix
   */
  function toAsm(built, name) {
    var label = (name || 'custom').replace(/[^A-Za-z0-9_]/g, '_');
    var L = [];
    L.push('; NHL \'92 song "' + label + '", written by NHL9XStudio (lib/audio/nhl92-song.js).');
    L.push('; ' + built.units + ' units at tempo ' + built.tempo + ' = ' + built.stats.seconds.toFixed(1) + ' s per pass; ' + built.stats.patterns + ' patterns, ' +
      built.stats.patternBytes + ' pattern bytes. Cmdstream format: docs/NHL92-SOUND-DATA.md.');
    built.problems.forEach(function (p) { L.push('; note: ' + p); });
    L.push('fmtune_' + label + ':');
    L.push('	dc.b ' + (CHANNELS - 1) + ', ' + built.tempo + '	; last channel, tempo (frames per duration unit)');
    for (var c = 0; c < CHANNELS; c++) L.push('	dc.l ' + label + '_ch' + c + '_orderlist-BASE');
    for (var ch = 0; ch < CHANNELS; ch++) {
      var chan = built.channels[ch];
      L.push('');
      L.push(label + '_ch' + ch + '_orderlist:');
      var words = chan.order.map(function (pi) { return label + '_ch' + ch + '_pat' + pi + '-BASE'; });
      for (var w = 0; w < words.length; w += 4) L.push('	dc.w ' + words.slice(w, w + 4).join(', '));
      L.push('	dc.w $0000	; restart');
      chan.patterns.forEach(function (p, pi) {
        L.push(label + '_ch' + ch + '_pat' + pi + ':	; ' + describePattern(p));
        for (var i = 0; i < p.length; i += 16) L.push('	dc.b ' + p.slice(i, i + 16).map(hex2).join(', '));
      });
    }
    L.push('');
    return L.join('\n');
  }

  /** The built song as one binary: header (26 bytes, pointers relative to the file start), order lists, patterns. */
  function toBinary(built) {
    var header = 2 + CHANNELS * 4;
    var at = header;
    var orderAt = [];
    built.channels.forEach(function (c) { orderAt.push(at); at += c.order.length * 2 + 2; });
    var patAt = [];
    built.channels.forEach(function (c) { patAt.push(c.patterns.map(function (p) { var a = at; at += p.length; return a; })); });
    var out = new Uint8Array(at);
    out[0] = CHANNELS - 1;
    out[1] = built.tempo;
    built.channels.forEach(function (c, ch) {
      out[2 + ch * 4 + 2] = orderAt[ch] >> 8;
      out[2 + ch * 4 + 3] = orderAt[ch] & 0xff;
      c.order.forEach(function (pi, k) {
        out[orderAt[ch] + k * 2] = patAt[ch][pi] >> 8;
        out[orderAt[ch] + k * 2 + 1] = patAt[ch][pi] & 0xff;
      });
      c.patterns.forEach(function (p, i) { out.set(p, patAt[ch][i]); });
    });
    return out;
  }

  return {
    BASE: BASE,
    CHANNELS: CHANNELS,
    PATCH_COUNT: PATCH_COUNT,
    MAX_INDEX: MAX_INDEX,
    MAX_UNITS: MAX_UNITS,
    FRAME_HZ: FRAME_HZ,
    NOTE_OFFSETS: NOTE_OFFSETS,
    PATTERN_START: PATTERN_START,
    PATTERN_END: PATTERN_END,
    ORDER_START: ORDER_START,
    SONG_TABLE: SONG_TABLE,
    SONG_STRIDE: SONG_STRIDE,
    CUSTOM_SONG: CUSTOM_SONG,
    ROM_SIZE: ROM_SIZE,
    midiOfIndex: midiOfIndex,
    indexOfMidi: indexOfMidi,
    noteName: noteName,
    secondsPerUnit: secondsPerUnit,
    bpmOfTempo: bpmOfTempo,
    tempoOfBpm: tempoOfBpm,
    PATCH_REGS: PATCH_REGS,
    identifyPatch: identifyPatch,
    emptySong: emptySong,
    lengthOf: lengthOf,
    fromParsed: fromParsed,
    build: build,
    layout: layout,
    romWithSong: romWithSong,
    toAsm: toAsm,
    toBinary: toBinary,
    hexOf: hexOf
  };
});
