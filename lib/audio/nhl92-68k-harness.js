/**
 * Runs the retail NHL '92 68k sound driver (ROM bytes, sound module at $F4C8)
 * on the m68k-cpu.js core, on its own, and records what it writes.
 *
 * Memory map (24-bit):
 *   $000000-$3FFFFF  ROM image (the bundled sound slice sits at its ROM offsets)
 *   $000400-$0005FF  harness stubs: the game's `sfx` and `song` wrappers,
 *                    re-assembled from middle.asm (game code, not in the slice),
 *                    and per-call trampolines
 *   $A00000-$A0FFFF  Z80 window: 8 KB Z80 RAM at $A00000-$A01FFF (mirrored to $A03FFF)
 *   $A11100 / $A11200 Z80 bus request / reset
 *   $E00000-$FFFFFF  68k RAM (64 KB, mirrored); stack starts at $FFFFFDF0 (ram.asm Stack)
 *
 * Calls follow the game: boot = jsr p_initialZ80, p_turnoff, p_music_vblank
 * (hockey.asm); songs and SFX = move.w #n,-(a7) then the song/sfx wrapper;
 * each vblank = jsr p_music_vblank (video.asm VBlank, minus the game's own work).
 * Every call must return to its trampoline's sentinel within a step budget,
 * with the PC inside the sound code or the stubs; otherwise it throws.
 */
(function (root, factory) {
  var m68k = typeof module === 'object' && module.exports ? require('./m68k-cpu') : root.NhlM68k;
  var api = factory(m68k);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92M68kHarness = api;
})(typeof self !== 'undefined' ? self : this, function (m68k) {
  const BASE = 0xf4c8;
  const ENTRY = {
    p_music_vblank: BASE,
    p_initialZ80: BASE + 4,
    p_initune: BASE + 8,
    p_turnoff: BASE + 12,
    p_initfx: BASE + 16
  };
  /** Sound module code (data tables excluded); see test/m68k-driver-ops.js. */
  const SOUND_CODE = [[0xf4c8, 0xfa92], [0xfb1e, 0xff74], [0x11624, 0x116a6]];
  const STUB_BASE = 0x400;
  const STUB_END = 0x600;
  const SFX_WRAPPER = 0x400;
  const SONG_WRAPPER = 0x440;
  const TRAMPOLINE = 0x500;
  /** The game variable `lastsfx`: the retail `sfx` wrapper stores to ($D53C).w. */
  const LASTSFX = 0xffffd53c;
  const STACK = 0xfffffdf0;
  /** Stack writes are expected in the 4 KB below Stack. */
  const STACK_WINDOW = 0x1000;
  const SOUND_RAM = [0xfffdfc, 0x1000000]; // g_SoundWorkspace .. end of RAM (24-bit)
  /** Sound module ROM range; reads here outside SOUND_CODE are data reads (recorded). */
  const SOUND_DATA_START = 0xf4c8;
  const SOUND_DATA_END = 0x24214;
  /** Channel records: g_SoundWorkspace + 6 + n * $48 (Sound_InitMusicTrack). */
  const CHANNEL_BASE = 0xfffffe02;
  const CHANNEL_STRIDE = 0x48;
  const Z80_BUFFER = 0x273;
  const Z80_FLAG = 0x2a3;
  const Z80_SFX = 0xbe;
  const DEFAULT_BUDGET = 2000000;

  const be16 = (v) => [(v >> 8) & 0xff, v & 0xff];
  const be32 = (v) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  /**
   * middle.asm `sfx`: movem.l d0-d7/a0-a6,-(a7); clr.l d0; move 16*4(a7),d0;
   * bmi .none; move d0,lastsfx; jsr p_initfx; .none movem.l (a7)+,d0-d7/a0-a6;
   * move.l (a7),2(a7); addq #2,a7; rts. `song` is the same without lastsfx and
   * with jsr p_initune. Encodings as in the retail ROM ($8D94 and $8DB8): bmi.w,
   * and lastsfx as an absolute short.
   */
  function wrapperBytes(kind) {
    const out = [];
    out.push(...be16(0x48e7), ...be16(0xfffe)); // movem.l d0-d7/a0-a6,-(a7)
    out.push(...be16(0x4280)); // clr.l d0
    out.push(...be16(0x302f), ...be16(0x0040)); // move.w 64(a7),d0
    if (kind === 'sfx') {
      out.push(...be16(0x6b00), ...be16(0x000c)); // bmi.w .none
      out.push(...be16(0x31c0), ...be16(LASTSFX & 0xffff)); // move.w d0,(lastsfx).w
      out.push(...be16(0x4eb9), ...be32(ENTRY.p_initfx)); // jsr p_initfx
    } else {
      out.push(...be16(0x6b00), ...be16(0x0008)); // bmi.w .none
      out.push(...be16(0x4eb9), ...be32(ENTRY.p_initune)); // jsr p_initune
    }
    out.push(...be16(0x4cdf), ...be16(0x7fff)); // .none: movem.l (a7)+,d0-d7/a0-a6
    out.push(...be16(0x2f57), ...be16(0x0002)); // move.l (a7),2(a7)
    out.push(...be16(0x544f)); // addq.w #2,a7
    out.push(...be16(0x4e75)); // rts
    return out;
  }

  class DriverError extends Error {}

  function create(opts) {
    const rom = opts.rom;
    const budget = opts.budget || DEFAULT_BUDGET;
    const ram = new Uint8Array(0x10000);
    // opts.z80Ram: the 8 KB Z80 RAM shared with a running Z80 (nhl92-sound-chain.js).
    const z80 = opts.z80Ram || new Uint8Array(0x2000);
    if (z80.length !== 0x2000) throw new RangeError('z80Ram must be 8 KB');
    const stub = new Uint8Array(STUB_END - STUB_BASE);
    stub.set(wrapperBytes('sfx'), SFX_WRAPPER - STUB_BASE);
    stub.set(wrapperBytes('song'), SONG_WRAPPER - STUB_BASE);
    const io = { busreq: 0, reset: 0 };
    let insnPc = 0;
    let events = [];
    let reads = [];
    const unexpectedReads = [];

    function region(a) {
      if (a >= 0xa00000 && a < 0xa04000) return 'z80';
      if (a === 0xa11100 || a === 0xa11101) return 'busreq';
      if (a === 0xa11200 || a === 0xa11201) return 'reset';
      if (a >= 0xe00000) return 'ram';
      if (a >= STUB_BASE && a < STUB_END) return 'stub';
      if (a < 0x400000) return 'rom';
      return 'other';
    }

    function read8(a) {
      switch (region(a)) {
        case 'rom':
          if (isData(a)) reads.push({ pc: insnPc, addr: a, a0: cpu.A[0] >>> 0 });
          return a < rom.length ? rom[a] : 0;
        case 'stub': return stub[a - STUB_BASE];
        case 'ram': return ram[a & 0xffff];
        case 'z80': return z80[a & 0x1fff];
        case 'busreq': return a & 1 ? 0 : (io.busreq ? 0 : 1); // bus granted at once when requested
        case 'reset': return 0;
        default:
          unexpectedReads.push({ pc: insnPc, addr: a });
          return 0xff;
      }
    }
    function write8(a, v) {
      const r = region(a);
      if (r === 'ram') ram[a & 0xffff] = v;
      else if (r === 'z80') z80[a & 0x1fff] = v;
      return r;
    }
    function record(a, size, value) {
      const r = region(a);
      events.push({ pc: insnPc, addr: a, size, value, region: r, sp: cpu.A[7] >>> 0 });
    }
    const bus = {
      read8,
      read16: (a) => (read8(a) << 8) | read8((a + 1) & 0xffffff),
      write8: (a, v) => {
        record(a, 1, v & 0xff);
        write8(a, v & 0xff);
      },
      write16: (a, v) => {
        record(a, 2, v & 0xffff);
        const r = region(a);
        if (r === 'busreq') io.busreq = (v >> 8) & 1;
        else if (r === 'reset') io.reset = (v >> 8) & 1;
        else {
          write8(a, (v >> 8) & 0xff);
          write8((a + 1) & 0xffffff, v & 0xff);
        }
      }
    };
    const cpu = m68k.create(bus);
    cpu.load({ d: [0, 0, 0, 0, 0, 0, 0, 0], a: [0, 0, 0, 0, 0, 0, 0], usp: 0, ssp: STACK, sr: 0x2700, pc: TRAMPOLINE });

    const isData = (a) => a >= SOUND_DATA_START && a < SOUND_DATA_END && !SOUND_CODE.some(([c0, c1]) => a >= c0 && a < c1);
    const inCode = (pc) => (pc >= STUB_BASE && pc < STUB_END) || SOUND_CODE.some(([s, e]) => pc >= s && pc < e);

    /** Run a trampoline (bytes ending in a `bra.s *` sentinel) until it reaches the sentinel. */
    function runTrampoline(code, label) {
      const bytes = code.concat(be16(0x60fe));
      stub.fill(0, TRAMPOLINE - STUB_BASE);
      stub.set(bytes, TRAMPOLINE - STUB_BASE);
      const sentinel = TRAMPOLINE + bytes.length - 2;
      const sp0 = cpu.A[7] >>> 0;
      events = [];
      reads = [];
      cpu.pc = TRAMPOLINE;
      let steps = 0;
      while (cpu.pc !== sentinel) {
        insnPc = cpu.pc;
        if (!inCode(insnPc)) throw new DriverError(label + ': PC left the sound code at $' + insnPc.toString(16).toUpperCase());
        if (cpu.halted) throw new DriverError(label + ': CPU halted (double fault)');
        if (++steps > budget) throw new DriverError(label + ': runaway, no return after ' + budget + ' instructions (PC $' + insnPc.toString(16).toUpperCase() + ')');
        cpu.step();
      }
      if ((cpu.A[7] >>> 0) !== sp0) throw new DriverError(label + ': stack not balanced ($' + (cpu.A[7] >>> 0).toString(16) + ' vs $' + sp0.toString(16) + ')');
      if ((cpu.sr & 0x2000) === 0) throw new DriverError(label + ': left supervisor mode');
      return { steps, events, reads };
    }

    const jsr = (addr) => be16(0x4eb9).concat(be32(addr));
    const pushWord = (n) => be16(0x3f3c).concat(be16(n & 0xffff));

    return {
      cpu,
      ram,
      z80,
      io,
      unexpectedReads,
      /** Game boot: p_initialZ80, p_turnoff, p_music_vblank (hockey.asm). */
      boot() {
        return runTrampoline([].concat(jsr(ENTRY.p_initialZ80), jsr(ENTRY.p_turnoff), jsr(ENTRY.p_music_vblank)), 'boot');
      },
      /** move.w #n,-(a7) ; bsr song */
      song(n) { return runTrampoline(pushWord(n).concat(jsr(SONG_WRAPPER)), 'song ' + n); },
      /** move.w #n,-(a7) ; bsr sfx */
      sfx(n) { return runTrampoline(pushWord(n).concat(jsr(SFX_WRAPPER)), 'sfx ' + n); },
      /** jsr p_turnoff */
      turnoff() { return runTrampoline(jsr(ENTRY.p_turnoff), 'p_turnoff'); },
      /** One vblank: jsr p_music_vblank. */
      vblank() { return runTrampoline(jsr(ENTRY.p_music_vblank), 'p_music_vblank'); },
      /** 68k RAM byte/word/long at a 24- or 32-bit address. */
      peek8: (a) => ram[a & 0xffff],
      peek16: (a) => (ram[a & 0xffff] << 8) | ram[(a + 1) & 0xffff],
      peek32: (a) => (((ram[a & 0xffff] << 24) | (ram[(a + 1) & 0xffff] << 16) | (ram[(a + 2) & 0xffff] << 8) | ram[(a + 3) & 0xffff]) >>> 0)
    };
  }

  /**
   * Classify one recorded write. 'driver' writes come from sound-module code;
   * 'game' writes from the re-assembled wrappers; the rest are the harness.
   */
  function classify(ev) {
    const a = ev.addr;
    const who = ev.pc >= TRAMPOLINE && ev.pc < STUB_END ? 'harness'
      : ev.pc >= STUB_BASE && ev.pc < STUB_END ? 'game' : 'driver';
    let what;
    if (ev.region === 'z80') {
      const z = a & 0x1fff;
      if (z >= Z80_BUFFER && z < Z80_BUFFER + 48) what = 'z80 buffer';
      else if (z === Z80_FLAG) what = 'z80 update flag';
      else if (z >= Z80_SFX && z < Z80_SFX + 6) what = 'z80 sfx';
      else if (z < 0x598) what = 'z80 program';
      else what = 'z80 other';
    } else if (ev.region === 'busreq') what = 'z80 busreq';
    else if (ev.region === 'reset') what = 'z80 reset';
    else if (ev.region === 'ram') {
      const r = a & 0xffffff;
      if (r >= SOUND_RAM[0] && r < SOUND_RAM[1]) what = 'sound ram';
      else if (r >= ((STACK - STACK_WINDOW) & 0xffffff) && r < (STACK & 0xffffff)) what = 'stack';
      else if (r === (LASTSFX & 0xffffff) || r === ((LASTSFX + 1) & 0xffffff)) what = 'lastsfx';
      else what = 'other ram';
    } else what = ev.region;
    return { who, what };
  }

  /** Channel index (0-5) of a channel-record pointer, or -1. */
  function channelOf(a0) {
    const off = (a0 - CHANNEL_BASE) >>> 0;
    return off % CHANNEL_STRIDE === 0 && off / CHANNEL_STRIDE < 6 ? off / CHANNEL_STRIDE : -1;
  }

  return {
    create, classify, channelOf, wrapperBytes,
    ENTRY, SOUND_CODE, STACK, LASTSFX, CHANNEL_BASE, CHANNEL_STRIDE, Z80_BUFFER, Z80_FLAG, Z80_SFX, DriverError
  };
});
