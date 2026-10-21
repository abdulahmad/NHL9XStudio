/**
 * NHL '92 sound chain, end to end from the retail code (step 7):
 *
 *   game call (song / sfx)  ->  68k driver (nhl92-68k-harness.js, ROM bytes)
 *   -> shared 8 KB Z80 RAM  ->  Z80 driver (nhl92-z80-harness.js, retail program
 *   as the 68k copied it)   ->  YM2612 core (ymfm) + SN76489 core  ->  PCM
 *
 * One Uint8Array is the Z80 RAM for both CPUs: every 68k write to $A00000-$A01FFF
 * lands where the Z80 runs from, including the program copy at boot.
 *
 * Frame model (NTSC). A frame runs from one vblank to the next: 59,736 Z80
 * T-states (262 lines x 3,420 master clocks / 15), i.e. 59.92 Hz. At the start of
 * frame f (T-state f * 59,736) the 68k side runs, atomically and in game order:
 *   1. any game calls queued for that frame (song n / sfx n), then
 *   2. p_music_vblank (frame 0: the boot sequence, which ends with one).
 * The 68k calls take zero Z80 time; then the Z80 runs to the next frame start,
 * unless a call left BUSREQ held or RESET asserted, in which case its clock
 * advances with the CPU stopped. A RESET assertion also resets the YM2612 (the
 * chip's /IC is tied to the Z80 reset line). YM2612 writes go to the chip at
 * output sample floor(t * 15 / 1008), with t the write's Z80 T-state.
 *
 * Why the 68k update sits at T-state 0 of the frame: p_music_vblank only runs from
 * the VBlank interrupt, so defining the frame vblank-to-vblank puts it at the
 * start by construction. What the model drops is the 68k time before and during
 * the copy (the game's own VBlank work, then the bus hold): the 68k core has no
 * cycle timing (docs/M68K-CORE.md), so that offset can't be computed. It is a
 * short delay into the frame; the Z80 only acts on the buffer once it sees
 * $02A3 != 1 in its main loop, so the offset shifts that frame's YM writes later
 * by a near-constant amount and cannot reorder them. The game calls (p_initune,
 * p_initfx) write only 68k RAM (checked in the tests), so where they fall in the
 * frame doesn't matter as long as it is before the next p_music_vblank.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(
    node ? require('./nhl92-68k-harness') : root.Nhl92M68kHarness,
    node ? require('./nhl92-68k-run') : root.Nhl92M68kRun,
    node ? require('./nhl92-z80-harness') : root.Nhl92Z80Harness
  );
  if (node) module.exports = api;
  else root.Nhl92SoundChain = api;
})(typeof self !== 'undefined' ? self : this, function (H68, Run, Z80) {
  const FRAME = Z80.FRAME_TSTATES;
  const MASTER_PER_T = 15;
  const MASTER_PER_SAMPLE = 1008;
  const SAMPLE_RATE = 53267;
  const PSG_GAIN = 0.5;
  const WAIT_TSTATES = 480; // Z80 time for the 68k's 100-iteration dbf wait (about 1,000 68k cycles)

  const sampleAt = (t) => Math.floor((t * MASTER_PER_T) / MASTER_PER_SAMPLE);

  /**
   * @param {object} opts
   * @param {Uint8Array} opts.rom 68k ROM (retail, or the bundled sound slice at $F4C8)
   * @param {object} [opts.chip] YM2612 core (write, reset, generateStereoView|generateStereo); omit for registers only
   * @param {object} [opts.psg] SN76489 core (write, generateSamples)
   * @param {boolean} [opts.keepLogs=true] keep the Z80 bus/YM logs (off for long live playback)
   * @param {function} [opts.onYmWrite] read-only tap: (t, port, value) for every YM2612 port write the Z80
   *   makes (port 0/2 = address latch, 1/3 = data, part = port >> 1), called after the chip has taken it
   * @param {function} [opts.onPsgWrite] read-only tap: (t, value) for every SN76489 write
   * @param {function} [opts.onYmReset] read-only tap: (t) when a Z80 RESET assertion resets the YM2612
   *   (t = the frame's first T-state). The taps never change what the chain renders or logs.
   */
  function create(opts) {
    const rom = opts.rom;
    const chip = opts.chip || null;
    const psg = opts.psg || null;
    const keepLogs = opts.keepLogs !== false;
    const tapYm = typeof opts.onYmWrite === 'function' ? opts.onYmWrite : null;
    const tapPsg = typeof opts.onPsgWrite === 'function' ? opts.onPsgWrite : null;
    const tapReset = typeof opts.onYmReset === 'function' ? opts.onYmReset : null;
    const z80Ram = new Uint8Array(Z80.RAM_SIZE);
    // Another game's driver (same interface as nhl92-68k-harness.js): opts.driver = { create, record }.
    const driver = opts.driver || { create: H68.create, record: Run.record };
    // A driver that waits for the Z80 (NHL 94: UploadCommandBufferToZ80) gets Z80 time when it releases the bus.
    const busWait = driver.WAIT_TSTATES || WAIT_TSTATES;
    const m68k = driver.create({
      rom, z80Ram, budget: opts.budget,
      onBusRelease() { if (!resetHeld && z) z.run(busWait); },
      onResetRelease() {
        if (z && driver.Z80_BOOT_TSTATES) z.run(driver.Z80_BOOT_TSTATES);
      }
    });

    let rendered = 0;
    let chunks = [];
    let psgPeak = 0;
    let ymWrites = 0;
    let psgWrites = 0;

    // While muted the chip still receives every register write but no samples are made (fast-forward).
    let muted = false;
    function generate(n) {
      if (n <= 0) return;
      if (!chip || muted) {
        rendered += n;
        return;
      }
      const ym = chip.generateStereoView ? chip.generateStereoView(n) : chip.generateStereo(n);
      const p = psg ? psg.generateSamples(n, SAMPLE_RATE) : null;
      const out = new Int16Array(n * 2);
      for (let i = 0, at = 0; i < n; i++) {
        let pv = 0;
        if (p) {
          pv = Math.round(p[i] * PSG_GAIN * 32768);
          if (Math.abs(pv) > psgPeak) psgPeak = Math.abs(pv);
        }
        // Same mix as nhl92-z80-audio.js: ymfm gives int16 / 32768.
        const l = Math.round(ym.left[i] * 32768) + pv;
        const r = Math.round(ym.right[i] * 32768) + pv;
        out[at++] = l > 32767 ? 32767 : l < -32768 ? -32768 : l;
        out[at++] = r > 32767 ? 32767 : r < -32768 ? -32768 : r;
      }
      chunks.push(out);
      rendered += n;
    }
    const advanceTo = (t) => generate(sampleAt(t) - rendered);

    // Per-channel mute (the roll's lanes): the chip is not given key-ons for a muted FM channel, nor DAC samples for a
    // muted FM6; the taps (and so the roll) still see every write. Held notes are keyed off when the mute is set.
    const chMute = [false, false, false, false, false, false];
    const latch = [0, 0]; // YM2612 address latch of part 1 and 2
    const KEY_CODE = [0, 1, 2, 4, 5, 6];
    function chipWrite(port, value) {
      const part = port >> 1;
      if (!(port & 1)) { latch[part] = value; chip.write(port, value); return; }
      if (part === 0 && latch[0] === 0x28) {
        const idx = KEY_CODE.indexOf(value & 7);
        if (idx >= 0 && chMute[idx]) value &= 0x07;
      } else if (part === 0 && latch[0] === 0x2a && chMute[5]) return;
      chip.write(port, value);
    }
    function setChannelMute(ch, on) {
      if (ch < 0 || ch > 5) return;
      chMute[ch] = !!on;
      if (on && chip) {
        chip.write(0, 0x28);
        chip.write(1, KEY_CODE[ch]);
        chip.write(0, latch[0]);
      }
    }

    // Power-on: the Z80 is held in reset until the 68k releases it (boot).
    let resetHeld = true;
    let busHeld = false;
    const z = Z80.create({
      ram: z80Ram,
      rom,
      onYmWrite(t, port, value) {
        advanceTo(t);
        if (chip) chipWrite(port, value);
        ymWrites += 1;
        if (tapYm) tapYm(t, port, value);
      },
      onPsgWrite(t, value) {
        advanceTo(t);
        if (psg) psg.write(value);
        psgWrites += 1;
        if (tapPsg) tapPsg(t, value);
      }
    });

    let frame = 0;
    const records = [];
    const ioEvents = [];
    /** 68k writes to Z80 RAM made without the bus (must stay empty). */
    const unheldWrites = [];

    /**
     * Apply one call's writes in order: BUSREQ/RESET are word writes with bit 8 as
     * the line ($A11100: 1 = request the bus; $A11200: 0 = assert reset). The Z80
     * RAM writes already landed in the shared RAM; each must come while the 68k
     * holds the bus.
     */
    function applyIo(events, label) {
      for (const ev of events) {
        if (ev.region === 'z80') {
          if (!busHeld) unheldWrites.push({ frame, label, addr: ev.addr & 0x1fff, value: ev.value });
          continue;
        }
        if (ev.region !== 'busreq' && ev.region !== 'reset') continue;
        const v = ev.value;
        const on = ((v >> 8) & 1) === 1;
        ioEvents.push({ frame, kind: ev.region, value: v });
        if (ev.region === 'busreq') busHeld = on;
        else {
          if (!on && !resetHeld) {
            z.reset();
            if (chip && chip.reset) chip.reset();
            if (tapReset) tapReset(frame * FRAME);
          }
          resetHeld = !on;
        }
      }
    }

    function call(fn, label) {
      const raw = fn();
      const rec = driver.record(raw);
      rec.label = label;
      applyIo(raw.events, label);
      return rec;
    }

    /**
     * Run one frame. Frame 0 is the boot (p_initialZ80, p_turnoff, p_music_vblank);
     * later frames run `calls` (e.g. [{ song: 1 }], [{ sfx: 13 }] or [{ turnoff: true }]) and
     * then p_music_vblank.
     */
    function step(calls) {
      const start = frame * FRAME;
      const entry = { frame, calls: [], vblank: null };
      if (frame === 0) {
        if (calls && calls.length) throw new Error('frame 0 is the boot; queue calls from frame 1');
        entry.vblank = call(() => m68k.boot(), 'boot');
      } else {
        for (const c of calls || []) {
          if (c.song != null) entry.calls.push(call(() => m68k.song(c.song), 'song ' + c.song));
          else if (c.sfx != null) entry.calls.push(call(() => m68k.sfx(c.sfx), 'sfx ' + c.sfx));
          else if (c.turnoff) entry.calls.push(call(() => m68k.turnoff(), 'p_turnoff'));
          else throw new Error('unknown call ' + JSON.stringify(c));
        }
        entry.vblank = call(() => m68k.vblank(), 'vblank');
      }
      // ymStart: index in z.ym of this frame's first Z80 write (keepLogs only).
      entry.ymStart = z.ym.length;
      // handoff: Z80 RAM $0273-$02A3 (slots + update flag) as the Z80 finds it this frame.
      if (keepLogs) entry.handoff = Array.from(z80Ram.subarray(H68.Z80_BUFFER, H68.Z80_FLAG + 1));
      records.push(keepLogs ? entry : { frame, buffer: entry.vblank.buffer, flag: entry.vblank.flag });
      const end = start + FRAME;
      if (busHeld || resetHeld) z.stall(end - z.tstates());
      else if (end > z.tstates()) z.run(end - z.tstates());
      advanceTo(end);
      if (!keepLogs) z.clearLogs();
      frame += 1;
      return entry;
    }

    /** Interleaved stereo PCM generated since the last take() (or since create). */
    function take() {
      const n = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Int16Array(n);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      chunks = [];
      return out;
    }

    return {
      m68k,
      z,
      z80Ram,
      chip,
      psg,
      records,
      ioEvents,
      unheldWrites,
      step,
      take,
      /** Skip sample generation (register writes still reach the chips): used to fast-forward to a position. */
      setMute(on) { muted = !!on; },
      setChannelMute,
      channelMuted: (ch) => !!chMute[ch],
      get frame() { return frame; },
      get rendered() { return rendered; },
      get ymWrites() { return ymWrites; },
      get psgWrites() { return psgWrites; },
      get psgPeak() { return psgPeak; },
      get busHeld() { return busHeld; },
      get resetHeld() { return resetHeld; }
    };
  }

  // --- Plans -------------------------------------------------------------------------

  /**
   * A plan is { frames, calls: { [frame]: [call, ...] } }. Frame 0 is the boot.
   * song(id, n) and sfx(id, n) make the same 68k call sequence as step 6's runSong /
   * runSfx (nhl92-68k-run.js), so their 68k logs are comparable line for line.
   */
  function songPlan(id, vblanks) {
    return { kind: 'song', id, frames: 1 + vblanks, calls: { 1: [{ song: id }] } };
  }
  function sfxPlan(id, vblanks) {
    return { kind: 'sfx', id, frames: 2 + vblanks, calls: { 2: [{ sfx: id }] } };
  }
  /**
   * SFX after the music has been initialised and turned off, as the game does before
   * in-game SFX: frame 1 song(initSong) (its vblank runs Sound_InitMusicTrack, which sets
   * every channel's instrument byte $41 to $FF and parses no notes), frame 2 p_turnoff (its
   * vblank sees g_AudioStopFlag first and only runs Sound_PauseMusic: music off, keys off,
   * empty DAC request; $41 is untouched), frame 3 sfx(id). No note of the song is ever
   * parsed. After a bare boot $41 is 0, so siren (instrument 0) would skip its patch load.
   */
  function sfxPlanAfterMusicOff(id, vblanks, initSong) {
    const song = initSong != null ? initSong : 0;
    return { kind: 'sfx', id, frames: 3 + vblanks, calls: { 1: [{ song }], 2: [{ turnoff: true }], 3: [{ sfx: id }] }, prelude: 'music-off' };
  }
  /** Song `songId` from frame 1, plus SFX calls at given vblanks (relative to the song's vb 0). */
  function mixPlan(songId, vblanks, sfxAt) {
    const calls = { 1: [{ song: songId }] };
    for (const [vb, id] of sfxAt) (calls[1 + vb] = calls[1 + vb] || []).push({ sfx: id });
    return { kind: 'mix', id: songId, frames: 1 + vblanks, calls, sfxAt };
  }

  /** Run a whole plan; `onFrame(chain, entry)` sees every frame as it completes. */
  function runPlan(plan, opts, onFrame) {
    const chain = create(opts);
    for (let f = 0; f < plan.frames; f++) {
      const entry = chain.step(plan.calls[f] || null);
      if (onFrame) onFrame(chain, entry);
    }
    return chain;
  }

  /** The 68k side of a song/sfx plan in step 6's run shape, for Run.logText. */
  function stepSixRun(plan, chain) {
    const r = chain.records;
    if (plan.kind === 'song') {
      return { kind: 'song', id: plan.id, boot: r[0].vblank, start: r[1].calls[0], frames: r.slice(1).map((e) => e.vblank) };
    }
    if (plan.kind === 'sfx') {
      return { kind: 'sfx', id: plan.id, boot: r[0].vblank, settle: r[1].vblank, start: r[2].calls[0], frames: r.slice(2).map((e) => e.vblank) };
    }
    throw new Error('only song and sfx plans have a step-6 shape');
  }

  /** Harness YM log as text ("t part:reg=value"), the same format as nhl92-z80-audio.ymLogText. */
  function ymLogText(chain) {
    return chain.z.ym.map((w) => w.t + ' ' + w.part + ':' + w.reg.toString(16).padStart(2, '0') +
      '=' + w.value.toString(16).padStart(2, '0')).join('\n') + '\n';
  }

  return {
    FRAME_TSTATES: FRAME,
    SAMPLE_RATE,
    sampleAt,
    create,
    songPlan,
    sfxPlan,
    sfxPlanAfterMusicOff,
    mixPlan,
    runPlan,
    stepSixRun,
    ymLogText
  };
});
