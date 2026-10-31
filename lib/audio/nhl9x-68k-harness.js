/**
 * Runs a retail NHL 93 / NHL 94 (Genesis) 68k sound driver (ROM bytes of the game's sound segment)
 * on the m68k-cpu.js core, on its own, and records what it writes. Same job and the same
 * interface as nhl92-68k-harness.js (create -> boot/song/sfx/turnoff/vblank), so
 * nhl92-sound-chain.js runs it with `driver: Nhl93M68kHarness` / `Nhl94M68kHarness`.
 * The two games share one driver family; only the addresses differ (nhl93-68k-harness.js,
 * nhl94-68k-harness.js give each game's).
 *
 * Memory map (24-bit):
 *   $000000-$3FFFFF  ROM image (the bundled sound slice sits at its ROM offsets)
 *   $000400-$0005FF  harness stubs: the game's `sfx` and `song` wrappers (video94.asm,
 *                    game code, not in the slice) and per-call trampolines
 *   $A00000-$A0FFFF  Z80 window: 8 KB Z80 RAM at $A00000-$A01FFF (mirrored to $A03FFF)
 *   $A10000-$A1001F  I/O (pad ports): reads give "no button pressed" ($FF), writes are ignored
 *   $A11100 / $A11200 Z80 bus request / reset
 *   $FF0000-$FFFFFF  68k RAM (64 KB); stack at $FFFFFDF0
 *
 * Calls follow the game: boot = jsr p_initialZ80, p_turnoff, p_music_vblank (hockey94.asm);
 * a song or SFX = move.w #n,-(a7) then the `song` / `sfx` wrapper, which call
 * play_sfx_or_music_track (n < $30 SFX, $30-$7A songs); each vblank = jsr p_music_vblank.
 */
(function (root, factory) {
  var m68k = typeof module === 'object' && module.exports ? require('./m68k-cpu') : root.NhlM68k;
  var api = factory(m68k);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl9xM68kHarness = api;
})(typeof self !== 'undefined' ? self : this, function (m68k) {
  const STUB_BASE = 0x400;
  const STUB_END = 0x600;
  const SFX_WRAPPER = 0x400;
  const SONG_WRAPPER = 0x440;
  const TRAMPOLINE = 0x500;
  const DEFAULT_BUDGET = 4000000;

  /**
   * @param {{ENTRY:object, SEGMENT:number[], LASTSFX:number, STACK:number}} cfg
   *   ENTRY: p_turnoff, play_sfx_or_music_track, p_music_vblank, p_initialZ80 (ROM addresses);
   *   SEGMENT: [start, end) of the sound code the driver may execute; LASTSFX: the game's `lastsfx` RAM word
   *   (the `sfx` wrapper stores to it); STACK: initial supervisor stack pointer (top of 68k RAM).
   */
  function build(cfg) {
  const ENTRY = cfg.ENTRY;
  const SEGMENT = cfg.SEGMENT;
  const LASTSFX = cfg.LASTSFX;
  const STACK = cfg.STACK;
  // Bytes the driver reaches outside its segment (a shared `rts` in game code): [[address, [bytes]]].
  const EXTRA = cfg.EXTRA || [];
  const extraAt = (a) => { for (const [at, b] of EXTRA) if (a >= at && a < at + b.length) return b[a - at]; return -1; };
  const be16 = (v) => [(v >> 8) & 0xff, v & 0xff];
  const be32 = (v) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  /**
   * video94.asm `sfx`: movem.l d0-d7/a0-a6,-(sp); clr.l d0; move.w $40(sp),d0; bmi.w .none;
   * move.w d0,(lastsfx).w; jsr play_sfx_or_music_track; .none movem.l (sp)+,...; move.l (sp),2(sp);
   * addq.w #2,sp; rts. `song` is the same without the lastsfx store.
   */
  function wrapperBytes(kind) {
    const out = [];
    out.push(...be16(0x48e7), ...be16(0xfffe)); // movem.l d0-d7/a0-a6,-(a7)
    out.push(...be16(0x4280)); // clr.l d0
    out.push(...be16(0x302f), ...be16(0x0040)); // move.w 64(a7),d0
    if (kind === 'sfx') {
      out.push(...be16(0x6b00), ...be16(0x000c)); // bmi.w .none
      out.push(...be16(0x31c0), ...be16(LASTSFX & 0xffff)); // move.w d0,(lastsfx).w
    } else {
      out.push(...be16(0x6b00), ...be16(0x0008)); // bmi.w .none
    }
    out.push(...be16(0x4eb9), ...be32(ENTRY.play_sfx_or_music_track)); // jsr play_sfx_or_music_track
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
    const z80 = opts.z80Ram || new Uint8Array(0x2000);
    if (z80.length !== 0x2000) throw new RangeError('z80Ram must be 8 KB');
    const stub = new Uint8Array(STUB_END - STUB_BASE);
    stub.set(wrapperBytes('sfx'), SFX_WRAPPER - STUB_BASE);
    stub.set(wrapperBytes('song'), SONG_WRAPPER - STUB_BASE);
    const io = { busreq: 0, reset: 0 };
    let insnPc = 0;
    let events = [];
    const unexpectedReads = [];

    function region(a) {
      if (a >= 0xa00000 && a < 0xa04000) return 'z80';
      if (a === 0xa11100 || a === 0xa11101) return 'busreq';
      if (a === 0xa11200 || a === 0xa11201) return 'reset';
      if (a >= 0xa10000 && a < 0xa10020) return 'io';
      if (a >= 0xe00000) return 'ram';
      if (a >= STUB_BASE && a < STUB_END) return 'stub';
      if (a < 0x400000) return 'rom';
      return 'other';
    }

    function read8(a) {
      switch (region(a)) {
        case 'rom': {
          const x = extraAt(a);
          return x >= 0 ? x : a < rom.length ? rom[a] : 0;
        }
        case 'stub': return stub[a - STUB_BASE];
        case 'ram': return ram[a & 0xffff];
        case 'z80': return z80[a & 0x1fff];
        case 'busreq': return a & 1 ? 0 : (io.busreq ? 0 : 1);
        case 'reset': return 0;
        case 'io': return 0xff; // pad lines idle (no buttons)
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
      events.push({ pc: insnPc, addr: a, size, value, region: region(a), sp: cpu.A[7] >>> 0 });
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
        if (r === 'busreq') {
          const was = io.busreq;
          io.busreq = (v >> 8) & 1;
          // The driver gives the bus back and waits (z80_bus_release_delay) for the Z80 to finish its
          // command: let the Z80 run for that wait.
          if (was && !io.busreq && opts.onBusRelease) opts.onBusRelease();
        }
        else if (r === 'reset') io.reset = (v >> 8) & 1;
        else {
          write8(a, (v >> 8) & 0xff);
          write8((a + 1) & 0xffffff, v & 0xff);
        }
      }
    };
    const cpu = m68k.create(bus);
    cpu.load({ d: [0, 0, 0, 0, 0, 0, 0, 0], a: [0, 0, 0, 0, 0, 0, 0], usp: 0, ssp: STACK, sr: 0x2700, pc: TRAMPOLINE });

    const inCode = (pc) => (pc >= STUB_BASE && pc < STUB_END) || (pc >= SEGMENT[0] && pc < SEGMENT[1]) || extraAt(pc) >= 0;

    function runTrampoline(code, label) {
      const bytes = code.concat(be16(0x60fe));
      stub.fill(0, TRAMPOLINE - STUB_BASE);
      stub.set(bytes, TRAMPOLINE - STUB_BASE);
      const sentinel = TRAMPOLINE + bytes.length - 2;
      const sp0 = cpu.A[7] >>> 0;
      events = [];
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
      return { steps, events, reads: [] };
    }

    const jsr = (addr) => be16(0x4eb9).concat(be32(addr));
    const pushWord = (n) => be16(0x3f3c).concat(be16(n & 0xffff));

    return {
      cpu, ram, z80, io, unexpectedReads,
      boot() { return runTrampoline([].concat(jsr(ENTRY.p_initialZ80), jsr(ENTRY.p_turnoff), jsr(ENTRY.p_music_vblank)), 'boot'); },
      /** n = $30-$7A: a song. */
      song(n) { return runTrampoline(pushWord(n).concat(jsr(SONG_WRAPPER)), 'song ' + n); },
      /** n = 0-$2F: a sound effect. */
      sfx(n) { return runTrampoline(pushWord(n).concat(jsr(SFX_WRAPPER)), 'sfx ' + n); },
      turnoff() { return runTrampoline(jsr(ENTRY.p_turnoff), 'p_turnoff'); },
      vblank() { return runTrampoline(jsr(ENTRY.p_music_vblank), 'p_music_vblank'); },
      peek8: (a) => ram[a & 0xffff],
      peek16: (a) => (ram[a & 0xffff] << 8) | ram[(a + 1) & 0xffff],
      peek32: (a) => (((ram[a & 0xffff] << 24) | (ram[(a + 1) & 0xffff] << 16) | (ram[(a + 2) & 0xffff] << 8) | ram[(a + 3) & 0xffff]) >>> 0)
    };
  }

  /** The chain only needs the I/O events (BUSREQ / RESET / Z80 RAM writes); no 92-style record. */
  function record(call) {
    return { steps: call.steps, events: call.events.length, unexpected: [] };
  }

  return { create, record, wrapperBytes, EXTRA, ENTRY, SEGMENT, STACK, LASTSFX, DriverError };
  }

  return { build };
});
