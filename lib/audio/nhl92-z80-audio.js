/**
 * NHL '92 retail Z80 driver driving real chip cores.
 *
 * The step-3 harness (nhl92-z80-harness.js) runs the unmodified driver bytes;
 * this module forwards every YM2612 port write it makes, at its Z80 T-state, to
 * a real YM2612 core (ymfm WASM), and every PSG write to the SN76489 core. Audio
 * is generated up to each write's exact sample position, so DAC timing comes
 * from the driver's own loop, not from us. The harness register log is kept.
 *
 * Timing: one Z80 T-state = 15 master clocks, one YM2612 output sample =
 * 144 YM clocks x 7 = 1008 master clocks, so a write at T-state t lands before
 * output sample floor(t * 15 / 1008). Integer maths only: same input, same bytes.
 *
 * Inputs are 68k-side vblank snapshots (sound.asm p_music_vblank_fn), built with
 * the helpers below. Nothing here alters the driver, its patches or its samples.
 */
(function (root, factory) {
  var harness = typeof module === 'object' && module.exports
    ? require('./nhl92-z80-harness')
    : root.Nhl92Z80Harness;
  var api = factory(harness);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Z80Audio = api;
})(typeof self !== 'undefined' ? self : this, function (harness) {
  const FRAME = harness.FRAME_TSTATES;
  const MASTER_PER_T = 15;
  const MASTER_PER_SAMPLE = 1008;
  /** ymfm reports clock/144 truncated to an integer; the WAV header uses the same. */
  const SAMPLE_RATE = 53267;
  const BOOT_FRAMES = 2;
  const PSG_GAIN = 0.5;

  // Z80 program layout (retail bytes, data/fixtures/nhl92-z80-program.bin).
  const PATCH_BASE = 0x2a5;
  const PATCH_STRIDE = 0x20;
  const PATCH_COUNT = 22;
  const PATCH_BYTES = 26;

  // 68k sound module (ROM). p_music_vblank is the PC-relative base a4.
  const SOUND_BASE = 0xf4c8;
  const NOTE_HI_TABLE = 0x1017a; // note_frequency_table -> slot +5 ($A4: block|fnum hi)
  const NOTE_LO_TABLE = 0x101da; // note_octave_table    -> slot +6 ($A0: fnum lo)
  const NOTE_COUNT = 96;
  const SLOT_CHANNELS = [0, 1, 2, 4, 5, 6];

  /**
   * The DAC SFX the 68k can request, read off the retail handler bytes
   * (move.l #off,d1 / move.b #rate,d2 / move.b #pri,d3 / bsr Sound_WriteYM2612),
   * in ROM order. `name` is the disassembly handler label; `rom` is the handler
   * address. Sample address = SOUND_BASE + off.
   */
  const DAC_SFX = [
    { rom: 0xfd1c, name: 'puckwall3', off: 0x53be, rate: 0x13, priority: 1 },
    { rom: 0xfd32, name: 'id_3', off: 0x12de2, rate: 0x08, priority: 1 },
    { rom: 0xfd44, name: 'stop (configure_ym2612)', off: 0x53ba, rate: 0x0b, priority: 0 },
    { rom: 0xfd56, name: 'whistle', off: 0x12de2, rate: 0x0b, priority: 1 },
    { rom: 0xfd6a, name: 'puckpost', off: 0x53be, rate: 0x18, priority: 1 },
    { rom: 0xfd82, name: 'puckice', off: 0x53be, rate: 0x10, priority: 1 },
    { rom: 0xfd9a, name: 'playerwall', off: 0x62a0, rate: 0x10, priority: 1 },
    { rom: 0xfdae, name: 'check', off: 0x62a0, rate: 0x13, priority: 1 },
    { rom: 0xfdc2, name: 'check2', off: 0x62a0, rate: 0x18, priority: 1 },
    { rom: 0xfdd6, name: 'puckget', off: 0x4498, rate: 0x0c, priority: 2 },
    { rom: 0xfdea, name: 'puckbody', off: 0x3590, rate: 0x0c, priority: 2 },
    { rom: 0xfdfe, name: 'puckwall1', off: 0x2776, rate: 0x0b, priority: 2 },
    { rom: 0xfe12, name: 'hithigh', off: 0x73e2, rate: 0x15, priority: 2 },
    { rom: 0xfe26, name: 'id_23', off: 0x73e2, rate: 0x1f, priority: 2 },
    { rom: 0xfe3a, name: 'hitlow', off: 0x73e2, rate: 0x19, priority: 2 },
    { rom: 0xfe4e, name: 'crowdboo', off: 0x793c, rate: 0x13, priority: 0 },
    { rom: 0xfe62, name: 'oooh', off: 0xe2be, rate: 0x18, priority: 0 },
    { rom: 0xfe76, name: 'id_31', off: 0x10820, rate: 0x1b, priority: 0 }
  ];

  // --- 68k-side inputs -------------------------------------------------------------

  /** One 8-byte channel slot; omitted fields keep bit 7 set ("no change"). */
  function slot(fields) {
    const f = fields || {};
    const s = [0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff];
    if (f.patch != null) {
      s[0] = 0x00;
      s[1] = f.patch >> 8;
      s[2] = f.patch & 0xff;
    }
    if (f.key != null) s[3] = f.key;
    if (f.freq) {
      s[4] = 0x00;
      s[5] = f.freq[0];
      s[6] = f.freq[1];
    }
    if (f.tl != null) s[7] = f.tl;
    return s;
  }

  /** 48-byte $FFFFFFB6 buffer from up to six slot field objects. */
  function channels(slots) {
    const out = [];
    for (let i = 0; i < 6; i++) out.push(...slot(slots && slots[i]));
    return out;
  }

  /** The six $FFFFFFE6.. bytes Sound_WriteYM2612 leaves for a sample at ROM `addr`. */
  function sfxBytes(addr, rate, priority) {
    const z = (addr | 0x8000) & 0xffff;
    return [z >> 8, z & 0xff, 0x00, rate & 0xff, (addr >>> 15) & 0xff, priority & 0xff];
  }

  const IDLE = Object.freeze({ flag: 1, channels: channels(), pending: 0 });

  function patchAddress(index) {
    if (!(index >= 0 && index < PATCH_COUNT)) throw new RangeError('patch index 0-' + (PATCH_COUNT - 1));
    return PATCH_BASE + index * PATCH_STRIDE;
  }

  /** The game's own note -> [slot+5, slot+6] lookup (68k .process_note_frequency). */
  function noteFreq(rom, note) {
    if (!(note >= 0 && note < NOTE_COUNT)) throw new RangeError('note 0-' + (NOTE_COUNT - 1));
    return [rom[NOTE_HI_TABLE + note], rom[NOTE_LO_TABLE + note]];
  }

  /** C major, one octave up from note 48 (fnum $284 block 4 = C4). */
  const SCALE_NOTES = [48, 50, 52, 53, 55, 57, 59, 60];

  /**
   * vblank inputs that load patch `index` on channel 0 and play a scale through
   * it the way the 68k does: a note sets key=1 (off, then on) and +5/+6 from the
   * note tables; a rest sets key=0 (off only).
   */
  function patchScaleScript(rom, index, opts) {
    const o = opts || {};
    const hold = o.hold || 10;
    const gap = o.gap || 2;
    const tail = o.tail || 30;
    const notes = o.notes || SCALE_NOTES;
    const frames = [];
    const on = (fields) => ({ flag: 0, channels: channels([fields]), pending: 0 });
    frames.push(on({ patch: patchAddress(index) }));
    for (const note of notes) {
      frames.push(on({ key: 0x01, freq: noteFreq(rom, note) }));
      for (let i = 1; i < hold; i++) frames.push(IDLE);
      frames.push(on({ key: 0x00 }));
      for (let i = 1; i < gap; i++) frames.push(IDLE);
    }
    for (let i = 0; i < tail; i++) frames.push(IDLE);
    return frames;
  }

  /** vblank inputs that trigger one DAC SFX and then idle. */
  function sfxScript(entry, opts) {
    const o = opts || {};
    const frames = [{ flag: 1, channels: channels(), pending: 1, sfx: sfxBytes(SOUND_BASE + entry.off, entry.rate, entry.priority) }];
    const n = o.frames || 180;
    for (let i = 1; i < n; i++) frames.push(IDLE);
    return frames;
  }

  // --- Machine + chips ---------------------------------------------------------------

  /**
   * @param {object} opts
   * @param {Uint8Array} opts.program retail Z80 program bytes
   * @param {Uint8Array} [opts.rom] 68k ROM (or the bundled sound slice placed at $F4C8)
   * @param {object} opts.chip YM2612 core: write(offset, data) + generateStereoView(n) or generateStereo(n)
   * @param {object} [opts.psg] SN76489 core: write(byte) + generateSamples(n, rate)
   */
  function create(opts) {
    const chip = opts.chip;
    const psg = opts.psg || null;
    let rendered = 0;
    let capacity = 0;
    let pcm = new Int16Array(0);
    let psgPeak = 0;
    let ymWrites = 0;
    let psgWrites = 0;

    function grow(frames) {
      if (frames <= capacity) return;
      const next = new Int16Array(Math.max(frames, capacity * 2, 4096) * 2);
      next.set(pcm.subarray(0, rendered * 2));
      pcm = next;
      capacity = next.length / 2;
    }

    function generate(n) {
      if (n <= 0) return;
      grow(rendered + n);
      const ym = chip.generateStereoView ? chip.generateStereoView(n) : chip.generateStereo(n);
      const p = psg ? psg.generateSamples(n, SAMPLE_RATE) : null;
      let at = rendered * 2;
      for (let i = 0; i < n; i++) {
        let pv = 0;
        if (p) {
          pv = Math.round(p[i] * PSG_GAIN * 32768);
          if (Math.abs(pv) > psgPeak) psgPeak = Math.abs(pv);
        }
        // ymfm returns int16 / 32768, so this recovers the chip's integer output.
        const l = Math.round(ym.left[i] * 32768) + pv;
        const r = Math.round(ym.right[i] * 32768) + pv;
        pcm[at++] = l > 32767 ? 32767 : l < -32768 ? -32768 : l;
        pcm[at++] = r > 32767 ? 32767 : r < -32768 ? -32768 : r;
      }
      rendered += n;
    }

    function sampleAt(t) {
      return Math.floor((t * MASTER_PER_T) / MASTER_PER_SAMPLE);
    }

    function advanceTo(t) {
      generate(sampleAt(t) - rendered);
    }

    const z = harness.create({
      program: opts.program,
      rom: opts.rom || null,
      onYmWrite(t, port, value) {
        advanceTo(t);
        chip.write(port, value);
        ymWrites += 1;
      },
      onPsgWrite(t, value) {
        advanceTo(t);
        if (psg) psg.write(value);
        psgWrites += 1;
      }
    });

    /** Run the Z80 up to absolute T-state `t` (instruction-boundary rounded). */
    function runTo(t) {
      const left = t - z.tstates();
      if (left > 0) z.run(left);
    }

    /**
     * Boot, then one vblank per input at exact frame boundaries. Returns the
     * interleaved stereo PCM for exactly (BOOT_FRAMES + inputs.length) frames.
     */
    function play(inputs) {
      const start = z.tstates();
      runTo(start + BOOT_FRAMES * FRAME);
      inputs.forEach((input, i) => {
        if (input) z.vblank(input);
        runTo(start + (BOOT_FRAMES + i + 1) * FRAME);
      });
      const end = start + (BOOT_FRAMES + inputs.length) * FRAME;
      advanceTo(end);
      const frames = sampleAt(end) - sampleAt(start);
      const first = sampleAt(start);
      return pcm.slice(first * 2, (first + frames) * 2);
    }

    return {
      z,
      chip,
      psg,
      play,
      runTo,
      get rendered() { return rendered; },
      get psgPeak() { return psgPeak; },
      get ymWrites() { return ymWrites; },
      get psgWrites() { return psgWrites; }
    };
  }

  /** Text form of the harness YM log: one "t part:reg=value" line per register write. */
  function ymLogText(z) {
    return z.ym.map((w) => w.t + ' ' + w.part + ':' + w.reg.toString(16).padStart(2, '0') +
      '=' + w.value.toString(16).padStart(2, '0')).join('\n') + '\n';
  }

  /** Bus traffic that is neither YM2612 nor bank-select (PSG, VDP, unmapped). */
  function otherTraffic(z) {
    return z.log.filter((e) => e.kind !== 'ymPort' && e.kind !== 'bank');
  }

  return {
    SAMPLE_RATE,
    FRAME_TSTATES: FRAME,
    BOOT_FRAMES,
    PATCH_BASE,
    PATCH_STRIDE,
    PATCH_COUNT,
    PATCH_BYTES,
    SOUND_BASE,
    SLOT_CHANNELS,
    SCALE_NOTES,
    DAC_SFX,
    IDLE,
    slot,
    channels,
    sfxBytes,
    patchAddress,
    noteFreq,
    patchScaleScript,
    sfxScript,
    create,
    ymLogText,
    otherTraffic
  };
});
