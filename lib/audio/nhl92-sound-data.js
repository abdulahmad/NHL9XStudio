/**
 * NHL '92 (Genesis) sound data parser — the data the 68k sound driver reads,
 * decoded straight from ROM bytes. Format reference: docs/NHL92-SOUND-DATA.md.
 *
 * Every rule here comes from what the driver code in sound.asm does with the
 * bytes (Sound_InitMusicTrack, Sound_ProcessMusicChannels, p_initfx_fn,
 * Sound_Process_SFXChannels, Sound_WriteYM2612). Names come from the
 * disassembly labels. This module does not emulate the driver (that is step 6):
 * it lists songs, order lists, patterns, envelopes, SFX and samples, and maps
 * every byte of each data block to the item that owns it.
 *
 * All addresses are absolute ROM offsets. The sound module is PC-relative to
 * p_music_vblank at $F4C8 ("BASE"): 16/32-bit pointers in the data are BASE-relative.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92SoundData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE = 0xf4c8;
  const Z80_PROGRAM = 0x116a6;
  const PATCH_Z80 = 0x2a5;
  const PATCH_STRIDE = 0x20;
  const PATCH_COUNT = 22;

  /**
   * Data blocks (inclusive start, exclusive end). Bounds are where the
   * disassembly places each table; the parser must account for every byte.
   */
  const BLOCKS = [
    { id: 'sfxTable', name: 'SFX pointer table (sfx_pointer_table)', start: 0xfa92, end: 0xfb1e },
    { id: 'sfxStreams', name: 'FM SFX command streams', start: 0xff74, end: 0x1017a },
    { id: 'noteFreq', name: 'note_frequency_table', start: 0x1017a, end: 0x101da },
    { id: 'noteOctave', name: 'note_octave_table', start: 0x101da, end: 0x1023a },
    { id: 'envelopes', name: 'envelope_table + envelopes', start: 0x1023a, end: 0x10294 },
    { id: 'songTable', name: 'fmtune_pointer_table', start: 0x10294, end: 0x10316 },
    { id: 'orderLists', name: 'Order lists (fmtune_songN_chM)', start: 0x10316, end: 0x1061e },
    { id: 'patterns', name: 'Pattern data (fmtune_seq*)', start: 0x1061e, end: 0x11624 },
    {
      id: 'patches',
      name: 'Z80 instrument patches (Z80 $02A5)',
      start: Z80_PROGRAM + PATCH_Z80,
      end: Z80_PROGRAM + PATCH_Z80 + PATCH_COUNT * PATCH_STRIDE
    },
    { id: 'pcm', name: 'DAC PCM samples', start: 0x11c3e, end: 0x24214 }
  ];

  const SONG_COUNT = 5;
  const SONG_STRIDE = 0x1a;
  const SFX_COUNT = 35;
  const ENVELOPE_COUNT = 4;
  const NOTE_COUNT = 96;
  const SONG_NAMES = ['SngEOP', 'SngTitle', 'SngTitle reprise', 'SngEOG', 'SngPO'];
  /** Handler labels in table order (sound.asm sfx_pointer_table). */
  const SFX_LABELS = [
    'siren', 'beep1', 'beep2', 'id_3', 'whistle', 'horn', 'pass', 'shotbh', 'shotfh', 'shotwiff',
    'stdef', 'puckget', 'puckbody', 'puckwall1', 'puckwall2', 'puckwall3', 'puckpost', 'puckice',
    'playerwall', 'check', 'check2', 'hithigh', 'hitlow', 'id_23', 'crowdcheer', 'crowdboo', 'oooh',
    'id_27', 'id_28', 'id_29', 'id_30', 'id_31', 'id_30', 'id_30', 'id_30'
  ];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const hex = (n, w) => '$' + (n >>> 0).toString(16).toUpperCase().padStart(w || 0, '0');
  const s8 = (b) => (b & 0x80 ? b - 0x100 : b);

  function reader(rom) {
    const u8 = (a) => {
      if (a < 0 || a >= rom.length) throw new RangeError('read past ROM end at ' + hex(a));
      return rom[a];
    };
    const u16 = (a) => (u8(a) << 8) | u8(a + 1);
    const u32 = (a) => ((u16(a) << 16) >>> 0) + u16(a + 2);
    const s32 = (a) => u32(a) | 0;
    return { u8, u16, u32, s32 };
  }

  function noteName(n) {
    return NOTE_NAMES[n % 12] + Math.floor(n / 12);
  }

  // --- Patterns (track streams) -------------------------------------------------------

  /**
   * One pattern event at `at`. Opcode table from Sound_ProcessMusicChannels:
   * $00-$7F note ($60 = rest), $80-$8B commands, every other byte a duration
   * = (byte - $A0) & $FF, times the song tempo.
   */
  function patternEvent(r, at) {
    const op = r.u8(at);
    const arg = (i) => r.u8(at + 1 + i);
    let ev;
    if (op < 0x80) {
      if (op === 0x60) ev = { kind: 'rest', len: 1, text: 'rest' };
      else ev = { kind: 'note', note: op, len: 1, text: 'note ' + hex(op, 2) + ' (' + noteName(op) + ')' };
    } else {
      switch (op) {
        case 0x80: ev = { kind: 'instrument', patch: arg(0), len: 2, text: 'instrument ' + arg(0) + ' (Z80 ' + hex(PATCH_Z80 + arg(0) * PATCH_STRIDE, 4) + ')' }; break;
        case 0x81: ev = { kind: 'modulation', delay: arg(0), delta: s8(arg(1)), len: 3, text: 'modulation delay ' + arg(0) + ' delta ' + s8(arg(1)) }; break;
        case 0x83: ev = { kind: 'sustain', len: 1, text: 'legato: next note keeps key-on and envelope' }; break;
        case 0x84: ev = { kind: 'end', len: 1, text: 'end of pattern → next order-list entry' }; break;
        case 0x85: ev = { kind: 'stop', len: 1, text: 'stop (p_turnoff)' }; break;
        case 0x86: ev = { kind: 'envelope', envelope: arg(0), speed: s8(arg(1)), len: 3, text: 'pitch envelope ' + arg(0) + ' speed ' + s8(arg(1)) }; break;
        case 0x87: ev = { kind: 'envelopeOff', len: 1, text: 'envelope off' }; break;
        case 0x88: ev = { kind: 'transpose', semitones: s8(arg(0)), len: 2, text: 'transpose ' + s8(arg(0)) }; break;
        case 0x89: ev = { kind: 'noKeyOff', len: 1, text: 'next note: no key-off on its last tick' }; break;
        case 0x8a: ev = { kind: 'skip', value: arg(0), len: 2, text: 'skip byte ' + hex(arg(0), 2) + ' (read, unused)' }; break;
        case 0x8b: ev = { kind: 'sfx', sfx: arg(0), len: 2, text: 'trigger SFX ' + arg(0) }; break;
        default: {
          const units = (op - 0xa0) & 0xff;
          ev = { kind: 'duration', units, wraps: op < 0xa0, len: 1, text: 'duration ' + units + ' × tempo' + (op < 0xa0 ? ' (byte < $A0 wraps)' : '') };
        }
      }
    }
    ev.at = at;
    ev.op = op;
    ev.bytes = [];
    for (let i = 0; i < ev.len; i++) ev.bytes.push(r.u8(at + i));
    return ev;
  }

  /** Events from `start` through the $84 / $85 that ends the pattern. */
  function readPattern(r, start, limit) {
    const events = [];
    let at = start;
    for (;;) {
      if (at >= limit) throw new Error('pattern ' + hex(start) + ' runs past ' + hex(limit));
      const ev = patternEvent(r, at);
      events.push(ev);
      at += ev.len;
      if (ev.kind === 'end' || ev.kind === 'stop') break;
    }
    return { start, end: at, events };
  }

  // --- Order lists ---------------------------------------------------------------

  /**
   * Order list words (Sound_InitMusicTrack + the $84 handler): word 0 is the first
   * pattern; then 0 = restart list, 1 n = switch to song n, 2 n = repeat the
   * previous pattern (n+1 plays in all), anything else = next pattern (BASE-relative).
   * A list without 0/1 ends where the next list begins (the driver would read on).
   */
  function readOrderList(r, start, nextStart) {
    const items = [];
    let at = start;
    let fallsInto = null;
    for (;;) {
      if (at >= nextStart) {
        fallsInto = at;
        break;
      }
      const word = r.u16(at);
      if (items.length && word === 0) {
        items.push({ at, len: 2, kind: 'restart', text: 'restart list' });
        at += 2;
        break;
      }
      if (items.length && word === 1) {
        const song = r.u16(at + 2);
        items.push({ at, len: 4, kind: 'song', song, text: 'switch to song ' + song });
        at += 4;
        break;
      }
      if (items.length && word === 2) {
        const count = r.u16(at + 2);
        if (items[items.length - 1].kind !== 'pattern') throw new Error('repeat at ' + hex(at) + ' does not follow a pattern');
        items.push({ at, len: 4, kind: 'repeat', count, text: 'repeat previous pattern ×' + count });
        at += 4;
        continue;
      }
      // movea.w sign-extends: offsets must stay below $8000.
      if (word & 0x8000) throw new Error('order-list word ' + hex(word, 4) + ' at ' + hex(at) + ' would sign-extend');
      const pattern = BASE + word;
      items.push({ at, len: 2, kind: 'pattern', pattern, text: 'pattern ' + hex(pattern) });
      at += 2;
    }
    return { start, end: at, items, fallsInto };
  }

  // --- SFX handlers (decoded only to find which data each SFX uses) ----------------

  /** p_initfx_fn: ... lea sfx_pointer_table(pc),a0; lsl.l #2,d0; adda.l d0,a0; movea.l (a0),a0; adda.l a4,a0; jmp (a0). */
  function findSfxTable(rom) {
    const sig = [0xe5, 0x88, 0xd1, 0xc0, 0x20, 0x50, 0xd1, 0xcc, 0x4e, 0xd0];
    for (let i = 4; i + sig.length <= rom.length; i++) {
      let ok = true;
      for (let k = 0; k < sig.length && ok; k++) ok = rom[i + k] === sig[k];
      if (ok && rom[i - 4] === 0x41 && rom[i - 3] === 0xfa) {
        const disp = s8(rom[i - 2]) * 256 + rom[i - 1];
        return i - 2 + disp;
      }
    }
    return null;
  }

  /**
   * Decode a handler: move.l #imm,d1 / move.b #imm,d2|d3 / moveq #n,d7 / bsr / rts.
   * bsr to Sound_WriteYM2612 = DAC sample; to Sound_InitSFXChannel = FM stream;
   * to another handler = that handler's actions.
   */
  function decodeHandler(r, at, routines, depth) {
    if (depth > 4) throw new Error('SFX handler nesting at ' + hex(at));
    const regs = {};
    const actions = [];
    for (let guard = 0; guard < 40; guard++) {
      const op = r.u16(at);
      if (op === 0x223c) { regs.d1 = r.u32(at + 2); at += 6; continue; }
      if (op === 0x143c) { regs.d2 = r.u16(at + 2) & 0xff; at += 4; continue; }
      if (op === 0x163c) { regs.d3 = r.u16(at + 2) & 0xff; at += 4; continue; }
      if ((op & 0xff00) === 0x7e00) { regs.d7 = s8(op & 0xff); at += 2; continue; }
      if (op === 0x4e75) return { actions, end: at + 2 };
      if ((op & 0xff00) === 0x6100) {
        let target;
        let next;
        if ((op & 0xff) === 0) { target = at + 2 + ((r.u16(at + 2) << 16) >> 16); next = at + 4; }
        else { target = at + 2 + s8(op & 0xff); next = at + 2; }
        if (target === routines.writeYm) {
          actions.push({ type: 'dac', sample: BASE + regs.d1, rate: regs.d2, priority: regs.d3, via: at });
        } else if (target === routines.initChannel) {
          actions.push({ type: 'fm', channel: regs.d7, stream: BASE + regs.d1, via: at });
        } else {
          actions.push(...decodeHandler(r, target, routines, depth + 1).actions.map((a) => Object.assign({ from: target }, a)));
        }
        at = next;
        continue;
      }
      throw new Error('unexpected opcode ' + hex(op, 4) + ' in SFX handler at ' + hex(at));
    }
    throw new Error('SFX handler too long at ' + hex(at));
  }

  /** Locate the two routines handlers call, by their first instructions. */
  function findRoutines(rom, from, to) {
    const out = {};
    for (let a = from; a < to; a += 2) {
      // Sound_WriteYM2612: lea p_music_vblank(pc),a4 ; add.l a4,d1 ; move.l d1,d0 ; ori.w #$8000,d0
      if (rom[a] === 0x49 && rom[a + 1] === 0xfa && rom[a + 4] === 0xd2 && rom[a + 5] === 0x8c &&
          rom[a + 6] === 0x20 && rom[a + 7] === 0x01 && rom[a + 8] === 0x00 && rom[a + 9] === 0x40) out.writeYm = a;
      // Sound_InitSFXChannel: lea (g_SoundWorkspace).l,a3 ; lea p_music_vblank(pc),a4 ; moveq #0,d0 ; move.w #$48,d0
      if (rom[a] === 0x47 && rom[a + 1] === 0xf9 && rom[a + 2] === 0xff && rom[a + 3] === 0xff &&
          rom[a + 4] === 0xfd && rom[a + 5] === 0xfc && rom[a + 6] === 0x49 && rom[a + 7] === 0xfa &&
          rom[a + 10] === 0x70 && rom[a + 11] === 0x00 && rom[a + 12] === 0x30 && rom[a + 13] === 0x3c &&
          rom[a + 14] === 0x00 && rom[a + 15] === 0x48) out.initChannel = a;
    }
    return out;
  }

  /**
   * Sound_StopMusic: lea (g_SoundWorkspace).l,a3; sf 0(a3); bsr.w Sound_ResetAllSFX;
   * bsr.w configure_ym2612. Returns configure_ym2612, the handler-shaped routine
   * Stop/Pause music call to cut the DAC (it is not in sfx_pointer_table).
   */
  function findStopHandler(rom, from, to) {
    const sig = [0x47, 0xf9, 0xff, 0xff, 0xfd, 0xfc, 0x51, 0xeb, 0x00, 0x00, 0x61, 0x00];
    for (let a = from; a + 18 <= to; a += 2) {
      let ok = true;
      for (let k = 0; k < sig.length && ok; k++) ok = rom[a + k] === sig[k];
      if (ok && rom[a + 14] === 0x61 && rom[a + 15] === 0x00) {
        const disp = ((rom[a + 16] << 8) | rom[a + 17]) << 16 >> 16;
        return { stopMusic: a, handler: a + 16 + disp };
      }
    }
    return null;
  }

  // --- FM SFX command streams --------------------------------------------------------

  /** Sound_Process_SFXChannels opcodes; any other byte is skipped (no arguments). */
  function sfxEvent(r, at) {
    const op = r.u8(at);
    let ev;
    switch (op) {
      case 0x80: ev = { kind: 'instrument', patch: r.u8(at + 1), len: 2, text: 'instrument ' + r.u8(at + 1) + ' + key-on' }; break;
      case 0x81: ev = { kind: 'hold', frames: r.u8(at + 1), len: 2, text: 'hold ' + r.u8(at + 1) + ' (repeat sweep)' }; break;
      case 0x82: ev = { kind: 'holdRetrigger', frames: r.u8(at + 1), len: 2, text: 'hold ' + r.u8(at + 1) + ' (repeat sweep, reload patch)' }; break;
      case 0x83: {
        const frames = r.u8(at + 1);
        const freq = r.u32(at + 2);
        const step = r.s32(at + 6);
        ev = { kind: 'sweep', frames, freq, step, len: 10, text: 'sweep from ' + hex(freq) + ' step ' + step + ' for ' + frames + ' frames' };
        break;
      }
      case 0x84: ev = { kind: 'stop', len: 1, text: 'stop (key-off)' }; break;
      case 0x85: ev = { kind: 'loop', len: 1, text: 'loop to stream start' }; break;
      default: ev = { kind: 'ignored', len: 1, text: 'ignored byte ' + hex(op, 2) };
    }
    ev.at = at;
    ev.op = op;
    ev.bytes = [];
    for (let i = 0; i < ev.len; i++) ev.bytes.push(r.u8(at + i));
    return ev;
  }

  function readSfxStream(r, start, limit) {
    const events = [];
    let at = start;
    for (;;) {
      if (at >= limit) throw new Error('SFX stream ' + hex(start) + ' runs past ' + hex(limit));
      const ev = sfxEvent(r, at);
      events.push(ev);
      at += ev.len;
      if (ev.kind === 'stop' || ev.kind === 'loop') break;
    }
    return { start, end: at, events };
  }

  /**
   * DAC sample as the Z80 driver streams it: byte at `start` is skipped, bytes from
   * start+1 play until a 0; the byte after the 0 is 1 to loop, anything else ends.
   */
  function readSample(r, start, limit) {
    let term = start + 1;
    while (r.u8(term) !== 0) {
      term += 1;
      if (term >= limit) throw new Error('sample ' + hex(start) + ' has no 0 terminator before ' + hex(limit));
    }
    const loops = r.u8(term + 1) === 1;
    return { start, end: term + 2, playStart: start + 1, terminator: term, loops, bytes: term - start - 1 };
  }

  // --- Coverage ----------------------------------------------------------------------

  function coverage(blocks, items) {
    return blocks.map((b) => {
      const inside = items.filter((it) => it.start < b.end && it.end > b.start)
        .sort((x, y) => x.start - y.start || x.end - y.end);
      const gaps = [];
      const overlaps = [];
      let at = b.start;
      for (const it of inside) {
        if (it.start < b.start || it.end > b.end) overlaps.push({ item: it.label, start: it.start, end: it.end, reason: 'crosses block edge' });
        if (it.start > at) gaps.push({ start: at, end: it.start });
        else if (it.start < at) overlaps.push({ item: it.label, start: it.start, end: Math.min(at, it.end) });
        at = Math.max(at, it.end);
      }
      if (at < b.end) gaps.push({ start: at, end: b.end });
      return Object.assign({}, b, { items: inside.length, gaps, overlaps });
    });
  }

  // --- Top level -----------------------------------------------------------------------

  /**
   * Parse the sound data. `rom` is the full cartridge image, or anything with the
   * sound module bytes at their ROM offsets (e.g. the bundled fixture slice).
   */
  function parse(romBytes) {
    const rom = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes);
    const r = reader(rom);
    const block = (id) => BLOCKS.find((b) => b.id === id);
    const items = [];
    const own = (start, end, label, kind, extra) => {
      const it = Object.assign({ start, end, label, kind }, extra || {});
      items.push(it);
      return it;
    };

    // Note tables: 96 entries each; slot +5 / slot +6 of the Z80 channel record.
    const noteTables = {
      freq: Array.from(rom.subarray(block('noteFreq').start, block('noteFreq').end)),
      octave: Array.from(rom.subarray(block('noteOctave').start, block('noteOctave').end))
    };
    own(block('noteFreq').start, block('noteFreq').end, 'note_frequency_table (96)', 'table');
    own(block('noteOctave').start, block('noteOctave').end, 'note_octave_table (96)', 'table');

    // Envelopes: 4 BASE-relative longs, each list of signed bytes looping at $84.
    const envTable = block('envelopes').start;
    own(envTable, envTable + ENVELOPE_COUNT * 4, 'envelope_table (4 longs)', 'table');
    const envelopes = [];
    for (let i = 0; i < ENVELOPE_COUNT; i++) {
      const start = BASE + r.u32(envTable + i * 4);
      const values = [];
      let at = start;
      while (r.u8(at) !== 0x84) values.push(s8(r.u8(at++)));
      envelopes.push({ id: i, start, end: at + 1, values });
      own(start, at + 1, 'envelope ' + i, 'envelope');
    }

    // Songs.
    const songTable = block('songTable').start;
    const songs = [];
    const listStarts = new Set();
    for (let i = 0; i < SONG_COUNT; i++) {
      const at = songTable + i * SONG_STRIDE;
      const channels = [];
      for (let c = 0; c < 6; c++) {
        const list = BASE + r.u32(at + 2 + c * 4);
        channels.push(list);
        listStarts.add(list);
      }
      songs.push({
        id: i,
        name: SONG_NAMES[i],
        entry: at,
        lastChannel: r.u8(at),
        tempo: r.u8(at + 1),
        orderLists: channels
      });
      own(at, at + SONG_STRIDE, 'song ' + i + ' header', 'songHeader', { song: i });
    }
    const sortedLists = Array.from(listStarts).sort((a, b) => a - b);
    const orderLists = new Map();
    sortedLists.forEach((start, k) => {
      const next = k + 1 < sortedLists.length ? sortedLists[k + 1] : block('orderLists').end;
      const list = readOrderList(r, start, next);
      orderLists.set(start, list);
      own(list.start, list.end, 'order list ' + hex(start), 'orderList');
    });

    // Patterns: entry points from the order lists; streams that share bytes become
    // one pattern block with several entry points.
    const entries = new Map();
    for (const list of orderLists.values()) {
      for (const it of list.items) if (it.kind === 'pattern') entries.set(it.pattern, true);
    }
    const parsed = Array.from(entries.keys()).sort((a, b) => a - b)
      .map((start) => readPattern(r, start, block('patterns').end));
    const patternBlocks = [];
    for (const p of parsed) {
      const last = patternBlocks[patternBlocks.length - 1];
      if (last && p.start < last.end) {
        if (p.end !== last.end) throw new Error('pattern ' + hex(p.start) + ' overlaps ' + hex(last.start) + ' without sharing its end');
        last.entryPoints.push(p.start);
      } else {
        patternBlocks.push({ start: p.start, end: p.end, entryPoints: [p.start], events: p.events });
      }
    }
    for (const pb of patternBlocks) own(pb.start, pb.end, 'pattern ' + hex(pb.start), 'pattern', { entryPoints: pb.entryPoints });
    const patternAt = new Map();
    for (const p of parsed) patternAt.set(p.start, p);

    // Usage: which songs/channels play each pattern.
    const usedBy = new Map();
    songs.forEach((song) => {
      song.orderLists.forEach((listStart, ch) => {
        const list = orderLists.get(listStart);
        for (const it of list.items) {
          if (it.kind !== 'pattern') continue;
          const key = it.pattern;
          if (!usedBy.has(key)) usedBy.set(key, []);
          const tag = song.id + ':' + ch;
          if (!usedBy.get(key).includes(tag)) usedBy.get(key).push(tag);
        }
      });
    });

    // (Patch note offsets are read below; the walk needs them, so it runs after.)

    // Instrument patches (inside the Z80 program): 26 register bytes, a note offset
    // at +$1A (added to every note), 5 bytes the 68k never reads.
    const patches = [];
    for (let i = 0; i < PATCH_COUNT; i++) {
      const at = block('patches').start + i * PATCH_STRIDE;
      patches.push({
        id: i,
        z80: PATCH_Z80 + i * PATCH_STRIDE,
        rom: at,
        registers: Array.from(rom.subarray(at, at + 26)),
        noteOffset: s8(r.u8(at + 26)),
        tail: Array.from(rom.subarray(at + 27, at + 32)),
        algorithm: r.u8(at + 24) & 7,
        feedback: (r.u8(at + 24) >> 3) & 7
      });
      own(at, at + 26, 'patch ' + i + ' registers', 'patch');
      own(at + 26, at + 27, 'patch ' + i + ' note offset', 'patch');
      own(at + 27, at + 32, 'patch ' + i + ' unused tail', 'patchTail');
    }

    // Static walk of each song channel: which transpose and instrument are in effect
    // when each order-list entry starts, and the note-table index every note uses
    // (note + patch offset at +$1A + transpose; Sound_InitMusicTrack clears the
    // transpose but not the note offset). List order, repeats replayed, a missing
    // terminator followed into the next list, and a second pass after a restart.
    // Not timing: which entry is playing when is step 6.
    for (const song of songs) {
      song.channels = song.orderLists.map((listStart, ch) => {
        const list = orderLists.get(listStart);
        let items = list.items.slice();
        if (list.fallsInto != null) items = items.concat(orderLists.get(list.fallsInto).items);
        const state = { transpose: 0, patch: null, noteOffset: null };
        const entries = [];
        let low = Infinity;
        let high = -Infinity;
        let noteBeforeInstrument = false;
        const restarts = items.some((it) => it.kind === 'restart');
        for (let pass = 0; pass < (restarts ? 2 : 1); pass++) {
          for (const it of items) {
            if (it.kind !== 'pattern') continue;
            if (pass === 0) entries.push({ at: it.at, pattern: it.pattern, transpose: state.transpose, patch: state.patch });
            for (const e of patternAt.get(it.pattern).events) {
              if (e.kind === 'transpose') state.transpose = e.semitones;
              if (e.kind === 'instrument') { state.patch = e.patch; state.noteOffset = s8(r.u8(block('patches').start + e.patch * PATCH_STRIDE + 26)); }
              if (e.kind === 'note') {
                if (state.noteOffset == null) { noteBeforeInstrument = true; continue; }
                const n = (e.note + state.noteOffset + state.transpose) & 0xff;
                low = Math.min(low, n);
                high = Math.max(high, n);
              }
            }
          }
        }
        return { channel: ch, orderList: listStart, entries, noteIndexRange: [low, high], noteBeforeInstrument };
      });
    }

    // SFX: pointer table -> handler -> DAC sample and/or FM stream(s).
    const sfxTable = findSfxTable(rom);
    if (sfxTable !== block('sfxTable').start) throw new Error('sfx_pointer_table not at ' + hex(block('sfxTable').start) + ' (found ' + (sfxTable == null ? 'none' : hex(sfxTable)) + ')');
    own(sfxTable, sfxTable + SFX_COUNT * 4, 'sfx_pointer_table (35 longs)', 'table');
    const routines = findRoutines(rom, BASE, block('sfxStreams').start);
    if (routines.writeYm == null || routines.initChannel == null) throw new Error('SFX helper routines not found');
    const streams = new Map();
    const samples = new Map();
    const sfx = [];
    for (let id = 0; id < SFX_COUNT; id++) {
      const handler = BASE + r.u32(sfxTable + id * 4);
      const decoded = decodeHandler(r, handler, routines, 0);
      for (const a of decoded.actions) {
        if (a.type === 'fm' && !streams.has(a.stream)) streams.set(a.stream, readSfxStream(r, a.stream, block('sfxStreams').end));
        if (a.type === 'dac' && !samples.has(a.sample)) samples.set(a.sample, readSample(r, a.sample, block('pcm').end));
      }
      sfx.push({ id, label: SFX_LABELS[id], handler, actions: decoded.actions });
    }
    // configure_ym2612 (Stop/Pause music): the same DAC call, outside the table.
    const stop = findStopHandler(rom, BASE, sfxTable);
    if (!stop) throw new Error('Sound_StopMusic not found');
    const stopActions = decodeHandler(r, stop.handler, routines, 0).actions;
    for (const a of stopActions) {
      if (a.type === 'dac' && !samples.has(a.sample)) samples.set(a.sample, readSample(r, a.sample, block('pcm').end));
    }
    const stopHandler = { label: 'configure_ym2612 (Stop/Pause music)', handler: stop.handler, calledFrom: stop.stopMusic, actions: stopActions };

    for (const st of streams.values()) {
      own(st.start, st.end, 'SFX stream ' + hex(st.start), 'sfxStream');
    }
    for (const sm of samples.values()) own(sm.start, sm.end, 'sample ' + hex(sm.start), 'sample');

    // Bytes no reference reaches. Classified; tests pin the exact list.
    const cov0 = coverage(BLOCKS, items);
    const unreferenced = [];
    for (const b of cov0) {
      for (const g of b.gaps) {
        const bytes = Array.from(rom.subarray(g.start, g.end));
        let why = 'not referenced by any table, list or handler';
        if (b.id === 'sfxStreams' && g.end - g.start === 1) why = 'after the stream\'s $84 stop; never read';
        if (b.id === 'envelopes') why = 'after envelope 3\'s $84 loop marker; never read';
        if (b.id === 'patterns' && bytes.length % 3 === 0 && bytes.every((v, k) => (k % 3 === 0 ? v === 0x88 : k % 3 === 2 ? v === 0x84 : true))) {
          why = 'transpose-only patterns ($88 n $84) no order list uses';
        }
        if (b.id === 'pcm') why = 'between/after samples; never streamed';
        const it = own(g.start, g.end, 'unreferenced ' + hex(g.start), 'unreferenced', { block: b.id, reason: why, bytes });
        unreferenced.push(it);
      }
    }

    return {
      base: BASE,
      blocks: coverage(BLOCKS, items),
      items: items.sort((a, b) => a.start - b.start),
      noteTables,
      envelopes,
      songs,
      orderLists: Array.from(orderLists.values()),
      patterns: patternBlocks,
      patternEntries: parsed.map((p) => ({ start: p.start, end: p.end, events: p.events, usedBy: usedBy.get(p.start) || [] })),
      patches,
      sfxTable,
      sfxRoutines: routines,
      sfx,
      stopHandler,
      sfxStreams: Array.from(streams.values()).sort((a, b) => a.start - b.start),
      samples: Array.from(samples.values()).sort((a, b) => a.start - b.start),
      unreferenced
    };
  }

  /** Stable JSON summary (for determinism tests and the viewer). */
  function summary(data) {
    return JSON.stringify({
      songs: data.songs,
      orderLists: data.orderLists,
      patterns: data.patternEntries.map((p) => ({ start: p.start, end: p.end, usedBy: p.usedBy, events: p.events.map((e) => [e.at, e.bytes]) })),
      envelopes: data.envelopes,
      patches: data.patches,
      sfx: data.sfx,
      stopHandler: data.stopHandler,
      sfxStreams: data.sfxStreams.map((s) => ({ start: s.start, end: s.end, events: s.events.map((e) => [e.at, e.bytes]) })),
      samples: data.samples,
      unreferenced: data.unreferenced.map((u) => [u.start, u.end, u.block, u.reason]),
      blocks: data.blocks.map((b) => [b.id, b.start, b.end, b.items, b.gaps, b.overlaps])
    });
  }

  return {
    BASE,
    BLOCKS,
    SONG_COUNT,
    SFX_COUNT,
    NOTE_COUNT,
    SONG_NAMES,
    SFX_LABELS,
    PATCH_COUNT,
    hex,
    noteName,
    parse,
    summary
  };
});
