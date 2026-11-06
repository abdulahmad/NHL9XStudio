/**
 * Cross-checks a step-6 driver run (nhl92-68k-run.js) against the step-5 sound
 * data parser (nhl92-sound-data.js), which is an independent reading of the
 * same ROM bytes:
 *   - pattern walk: which patterns each channel enters, in order, vs the order
 *     lists (repeats, restarts, song switches, unterminated lists);
 *   - note timeline: key-on/key-off frames and key-on frequencies vs the parsed
 *     patterns (duration units x tempo, note + patch offset + transpose);
 *   - SFX: the bytes each SFX hands the Z80 and the stream bytes it reads.
 */
(function (root, factory) {
  var H = typeof module === 'object' && module.exports ? require('./nhl92-68k-harness') : root.Nhl92M68kHarness;
  var api = factory(H);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92M68kAnalysis = api;
})(typeof self !== 'undefined' ? self : this, function (H) {
  const SONG_TABLE = 0x10294;
  const SONG_STRIDE = 0x1a;
  const ORDER = [0x10316, 0x1061e];
  const PATTERNS = [0x1061e, 0x11624];

  // --- Pattern walk ----------------------------------------------------------------

  /**
   * From the read tap: song (re)starts and, per channel, every pattern entry and
   * order-list word read, with the vblank they happened in. A pattern entry is
   * the first pattern byte read after an order-list read (or a song start), or
   * any non-sequential pattern read.
   */
  function patternWalk(run) {
    const starts = [{ frame: 0, song: run.id }];
    const channels = [0, 1, 2, 3, 4, 5].map(() => ({ entries: [], orderReads: [] }));
    let last = [];
    let song = run.id;
    run.frames.forEach((fr, frame) => {
      for (const r of fr.reads) {
        if (r.addr >= SONG_TABLE && r.addr < ORDER[0] && (r.addr - SONG_TABLE) % SONG_STRIDE === 0) {
          const s = (r.addr - SONG_TABLE) / SONG_STRIDE;
          if (frame > 0) { starts.push({ frame, song: s }); song = s; }
          last = [];
          continue;
        }
        const ch = H.channelOf(r.a0);
        if (ch < 0) continue;
        const c = channels[ch];
        if (r.addr >= ORDER[0] && r.addr < ORDER[1]) {
          last[ch] = undefined;
          const word = r.addr & ~1;
          const prev = c.orderReads[c.orderReads.length - 1];
          if (!prev || prev.addr !== word || prev.frame !== frame) c.orderReads.push({ frame, addr: word, song });
        } else if (r.addr >= PATTERNS[0] && r.addr < PATTERNS[1]) {
          if (last[ch] === undefined || r.addr !== last[ch] + 1) c.entries.push({ frame, pattern: r.addr, song });
          last[ch] = r.addr;
        }
      }
    });
    return { starts, channels };
  }

  /** Expanded pattern order for one order list (repeats, restarts, fall-through, song switch). */
  function expectedOrder(data, listStart, count) {
    const lists = new Map(data.orderLists.map((l) => [l.start, l]));
    const list = lists.get(listStart);
    let items = list.items.map((it) => Object.assign({ list: list.start }, it));
    if (list.fallsInto != null) items = items.concat(lists.get(list.fallsInto).items.map((it) => Object.assign({ list: list.fallsInto, fall: true }, it)));
    const out = [];
    let i = 0;
    let prev = null;
    let guard = 0;
    while (out.length < count && i < items.length && guard++ < 100000) {
      const it = items[i];
      if (it.kind === 'pattern') { out.push({ pattern: it.pattern, fall: !!it.fall, list: it.list }); prev = it; i++; }
      else if (it.kind === 'repeat') { for (let k = 0; k < it.count; k++) out.push({ pattern: prev.pattern, fall: !!it.fall, list: it.list, repeat: true }); i++; }
      else if (it.kind === 'restart') i = it.fall ? items.findIndex((x) => x.fall) : 0;
      else if (it.kind === 'song') { out.push({ song: it.song, list: it.list }); break; }
    }
    return out;
  }

  /**
   * Compare each channel's pattern entries with the order lists, for the song
   * segment the run started with (up to the first song switch).
   */
  function compareWalk(run, data) {
    const walk = patternWalk(run);
    const switchFrame = walk.starts.length > 1 ? walk.starts[1].frame : Infinity;
    const song = data.songs[run.id];
    const channels = song.orderLists.map((listStart, ch) => {
      const list = data.orderLists.find((l) => l.start === listStart);
      const got = walk.channels[ch].entries.filter((e) => e.frame < switchFrame);
      const want = expectedOrder(data, listStart, got.length + 1);
      let matched = 0;
      while (matched < got.length && want[matched] && want[matched].pattern === got[matched].pattern) matched++;
      const past = walk.channels[ch].orderReads.filter((o) => o.frame < switchFrame && o.addr >= list.end);
      return {
        channel: ch,
        orderList: listStart,
        entries: got.length,
        matched,
        ok: matched === got.length,
        firstReadPastEnd: past.length ? past[0] : null,
        fallThroughEntries: got.filter((e, k) => want[k] && want[k].fall).map((e) => ({ frame: e.frame, pattern: e.pattern })),
        divergence: matched < got.length ? { at: matched, got: got[matched], want: want[matched] || null } : null
      };
    });
    return { starts: walk.starts, switchFrame: Number.isFinite(switchFrame) ? switchFrame : null, channels };
  }

  // --- Note timeline oracle ----------------------------------------------------------

  /**
   * Expected key events for one channel of a song, from the parsed data alone:
   * parsing starts at vblank 1 (vblank 0 runs Sound_InitMusicTrack and keys every
   * channel off); a note keys
   * on and lasts (units x tempo) vblanks with key-off on its last tick; a rest
   * keys off at once and again on its last tick; the key-on frequency is the
   * note-table entry for note + patch note offset + transpose.
   */
  function expectedKeys(data, songId, ch, maxFrame) {
    const song = data.songs[songId];
    const order = expectedOrder(data, song.orderLists[ch], 100000);
    const patterns = new Map(data.patternEntries.map((p) => [p.start, p]));
    // Vblank 0 runs Sound_PauseMusic -> Sound_ResetChannelVolumes, which zeroes
    // every slot's key byte ($FFFFFFB9 + 8n): all channels key off.
    const out = [{ frame: 0, kind: 'off', init: true }];
    let frame = 1;
    let duration = 0;
    let transpose = 0;
    let offset = 0;
    let oi = 0;
    let ev = order[0] && order[0].pattern != null ? patterns.get(order[0].pattern).events : null;
    let ei = 0;
    while (ev && frame < maxFrame) {
      const e = ev[ei++];
      if (e.kind === 'duration') duration = e.units * song.tempo;
      else if (e.kind === 'transpose') transpose = e.semitones;
      else if (e.kind === 'instrument') offset = data.patches[e.patch].noteOffset;
      else if (e.kind === 'end') {
        oi += 1;
        const next = order[oi];
        if (!next || next.song != null) { out.push({ frame, kind: 'song-switch', song: next ? next.song : null }); break; }
        ev = patterns.get(next.pattern).events;
        ei = 0;
      } else if (e.kind === 'stop') break;
      else if (e.kind === 'note' || e.kind === 'rest') {
        if (e.kind === 'note') {
          const n = (e.note + offset + transpose) & 0xff;
          out.push({ frame, kind: 'on', freq: [data.noteTables.freq[n], data.noteTables.octave[n]], at: e.at });
        } else out.push({ frame, kind: 'off', at: e.at });
        if (duration >= 2) out.push({ frame: frame + duration - 1, kind: 'off', tail: true, at: e.at });
        if (duration === 0) break; // the driver would wait 65536 vblanks
        frame += duration;
      }
    }
    return out.filter((k) => k.frame < maxFrame);
  }

  /** Key events the driver handed the Z80 for one channel slot, in frames [from, to). */
  function observedKeys(run, ch, from, to) {
    const out = [];
    for (let frame = from; frame < to && frame < run.frames.length; frame++) {
      const fr = run.frames[frame];
      if (!fr.buffer) continue;
      const s = fr.buffer.slice(ch * 8, ch * 8 + 8);
      if (s[3] === 1) out.push({ frame: frame - from, kind: 'on', freq: s[4] === 0 ? [s[5], s[6]] : null });
      else if (s[3] === 0) out.push({ frame: frame - from, kind: 'off' });
    }
    return out;
  }

  /**
   * Compare oracle and driver key events for every channel of every song
   * segment in the run (a segment starts at a song (re)start and ends at the
   * next one, or at the end of the run).
   */
  function compareNotes(run, data) {
    const walk = patternWalk(run);
    const segments = walk.starts.map((st, k) => ({
      song: st.song,
      from: st.frame,
      to: k + 1 < walk.starts.length ? walk.starts[k + 1].frame : run.frames.length
    }));
    return segments.map((seg) => ({
      song: seg.song,
      from: seg.from,
      to: seg.to,
      channels: [0, 1, 2, 3, 4, 5].map((ch) => {
        const len = seg.to - seg.from;
        const want = expectedKeys(data, seg.song, ch, len).filter((k) => k.kind !== 'song-switch');
        // A tail key-off and a new event in the same frame collapse into the new event.
        const byFrame = new Map();
        for (const k of want) {
          const prev = byFrame.get(k.frame);
          if (!prev || k.kind === 'on' || (prev.tail && !k.tail)) byFrame.set(k.frame, k);
        }
        const expected = Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
        const got = observedKeys(run, ch, seg.from, seg.to);
        let matched = 0;
        while (matched < expected.length && matched < got.length) {
          const w = expected[matched];
          const g = got[matched];
          if (w.frame !== g.frame || w.kind !== g.kind) break;
          if (w.kind === 'on' && (!g.freq || g.freq[0] !== w.freq[0] || g.freq[1] !== w.freq[1])) break;
          matched++;
        }
        const ok = matched === expected.length && matched === got.length;
        return {
          channel: ch,
          expected: expected.length,
          observed: got.length,
          matched,
          keyOns: got.filter((k) => k.kind === 'on').length,
          ok,
          divergence: ok ? null : { at: matched, want: expected[matched] || null, got: got[matched] || null }
        };
      })
    }));
  }

  // --- SFX ---------------------------------------------------------------------------------

  /**
   * What an SFX run handed the Z80, vs the parser's decoding of its handler:
   * DAC requests must appear at $00BE-$00C3 on the first vblank as
   * $BF=addr hi, $BE=addr lo, $C0=0, $C1=rate, $C2=bank, $C3=priority; FM
   * streams must load the stream's first patch into their slot and read
   * exactly the stream's bytes.
   */
  function checkSfx(run, data) {
    const entry = data.sfx[run.id];
    const result = { id: run.id, handler: entry.handler, dac: null, fm: [] };
    const first = run.frames[0];
    const dac = entry.actions.find((a) => a.type === 'dac');
    if (dac) {
      const z = (dac.sample | 0x8000) & 0xffff;
      const want = { 0xbf: z >> 8, 0xbe: z & 0xff, 0xc0: 0, 0xc1: dac.rate, 0xc2: (dac.sample >>> 15) & 0xff, 0xc3: dac.priority };
      const got = first.sfx || {};
      result.dac = { want, got, ok: Object.keys(want).every((k) => got[k] === want[k]) && Object.keys(got).length === 6 };
    } else {
      result.dac = { ok: !run.frames.some((fr) => fr.sfx), none: true };
    }
    for (const a of entry.actions.filter((x) => x.type === 'fm')) {
      const stream = data.sfxStreams.find((s) => s.start === a.stream);
      const firstPatch = stream.events.find((e) => e.kind === 'instrument');
      const patchAddr = 0x2a5 + firstPatch.patch * 0x20;
      const slotLoads = [];
      run.frames.forEach((fr, frame) => {
        if (!fr.buffer) return;
        const s = fr.buffer.slice(a.channel * 8, a.channel * 8 + 8);
        if (s[0] === 0) slotLoads.push({ frame, patch: (s[1] << 8) | s[2] });
      });
      const streamReads = new Set();
      for (const fr of run.frames) for (const r of fr.reads) if (H.channelOf(r.a0) === a.channel && r.addr >= 0xff74 && r.addr < 0x1017a) streamReads.add(r.addr);
      const outside = Array.from(streamReads).filter((x) => x < stream.start || x >= stream.end);
      const eventStarts = stream.events.map((e) => e.at);
      const missed = eventStarts.filter((x) => !streamReads.has(x));
      // .effect_instrument skips the load when the channel already has that instrument.
      const already = run.instruments && run.instruments[a.channel] === firstPatch.patch;
      const patchOk = already ? slotLoads.length === 0 : slotLoads.length > 0 && slotLoads[0].patch === patchAddr;
      result.fm.push({
        channel: a.channel,
        stream: a.stream,
        firstPatch: patchAddr,
        skippedLoad: !!already,
        slotLoads: slotLoads.slice(0, 4),
        patchOk,
        readsOutside: outside,
        eventsNotRead: missed,
        ok: patchOk && !outside.length && !missed.length
      });
    }
    result.ok = result.dac.ok && result.fm.every((f) => f.ok);
    return result;
  }

  return { patternWalk, expectedOrder, compareWalk, expectedKeys, observedKeys, compareNotes, checkSfx };
});
