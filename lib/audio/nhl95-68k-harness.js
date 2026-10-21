/**
 * NHL 95 (Genesis) sound driver on the m68k core. Command-based driver (SoundCmd / SndDriver)
 * from NHL95Genesis sound95.asm; same chain interface as nhl9x-68k-harness.js.
 */
(function (root, factory) {
  var m68k = typeof module === 'object' && module.exports ? require('./m68k-cpu') : root.NhlM68k;
  var api = factory(m68k);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl95M68kHarness = api;
})(typeof self !== 'undefined' ? self : this, function (m68k) {
  const STUB_BASE = 0x400;
  const STUB_END = 0x600;
  const TRAMPOLINE = 0x500;
  const DEFAULT_BUDGET = 4000000;

  const ADDR = {
    SoundCmd: 0x676d8,
    SoundOff: 0x679b2,
    sfx: 0x677ac,
    song: 0x678c2,
    Z80Program: 0xbd86,
    SoundBanks: 0xd8ec
  };

  const CFG = {
    SEGMENT: [0xaf44, 0x7a000],
    STACK: 0xfffffdfa,
    /** Z80 t-states after each bus release while the 68k driver waits on Z80_RAM+$4F. */
    WAIT_TSTATES: 2000,
    /** After SndLoadZ80 releases RESET (Begin), the Z80 must set $4F before RESET is asserted again. */
    Z80_BOOT_TSTATES: 40000
  };

  function build() {
    const SEGMENT = CFG.SEGMENT;
    const STACK = CFG.STACK;
    const be16 = (v) => [(v >> 8) & 0xff, v & 0xff];
    const be32 = (v) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    const movea0 = (addr) => be16(0x207c).concat(be32(addr));
    const movewD0 = (n) => be16(0x303c).concat(be16(n & 0xffff));
    const movewD1 = (n) => be16(0x323c).concat(be16(n & 0xffff));
    const clrD1 = () => be16(0x4241);
    const jsr = (addr) => be16(0x4eb9).concat(be32(addr));

    /** opts.banks: extra sound banks [{ n: 1-3, addr }] set after bank 0 (nhl95-seq.js romWithSong). */
    /** list: the patch load list the boot uploads (0 menus, as Begin; 1 in game, as StartGame). */
    const bootCode = (banks, list) => {
      let code = []
        .concat(movewD0(0), movewD1(0x1b63), movea0(ADDR.Z80Program), jsr(ADDR.SoundCmd))
        .concat(movewD0(9), jsr(ADDR.SoundCmd))
        .concat(movewD0(6), clrD1(), movea0(ADDR.SoundBanks), jsr(ADDR.SoundCmd));
      (banks || []).forEach((b) => { code = code.concat(movewD0(6), movewD1(b.n), movea0(b.addr), jsr(ADDR.SoundCmd)); });
      return code.concat(movewD0(7), movewD1(list || 0), jsr(ADDR.SoundCmd)).concat(jsr(ADDR.SoundOff));
    };

    const VBLANK_CODE = movewD0(1).concat(jsr(ADDR.SoundCmd));

    class DriverError extends Error {}

    function create(opts) {
      const rom = opts.rom;
      const budget = opts.budget || DEFAULT_BUDGET;
      const ram = new Uint8Array(0x10000);
      const z80 = opts.z80Ram || new Uint8Array(0x2000);
      if (z80.length !== 0x2000) throw new RangeError('z80Ram must be 8 KB');
      const stub = new Uint8Array(STUB_END - STUB_BASE);
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
          case 'rom': return a < rom.length ? rom[a] : 0;
          case 'stub': return stub[a - STUB_BASE];
          case 'ram': return ram[a & 0xffff];
          case 'z80': return z80[a & 0x1fff];
          case 'busreq': return a & 1 ? 0 : (io.busreq ? 0 : 1);
          case 'reset': return 0;
          case 'io': return 0xff;
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
            if (was && !io.busreq && opts.onBusRelease) opts.onBusRelease();
          } else if (r === 'reset') {
            // $A11200: 0 asserts RESET, $100 releases it. The chain resets the Z80 when RESET is asserted and runs it
            // when it is released (SndLoadZ80 then waits for Z80_RAM+$4F), so the boot happens while the 68k waits.
            const was = io.reset;
            io.reset = (v >> 8) & 1;
            if (was && !io.reset && opts.onResetAssert) opts.onResetAssert();
            if (!was && io.reset && opts.onResetRelease) opts.onResetRelease();
          } else {
            write8(a, (v >> 8) & 0xff);
            write8((a + 1) & 0xffffff, v & 0xff);
          }
        }
      };
      const cpu = m68k.create(bus);
      cpu.load({ d: [0, 0, 0, 0, 0, 0, 0, 0], a: [0, 0, 0, 0, 0, 0, 0], usp: 0, ssp: STACK, sr: 0x2700, pc: TRAMPOLINE });

      const inCode = (pc) => (pc >= STUB_BASE && pc < STUB_END) || (pc >= SEGMENT[0] && pc < SEGMENT[1]);

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
          if (cpu.halted) throw new DriverError(label + ': CPU halted');
          if (++steps > budget) throw new DriverError(label + ': runaway at PC $' + insnPc.toString(16).toUpperCase());
          cpu.step();
        }
        if ((cpu.A[7] >>> 0) !== sp0) throw new DriverError(label + ': stack not balanced');
        return { steps, events, reads: [] };
      }

      const pushWord = (n) => be16(0x3f3c).concat(be16(n & 0xffff));

      // The patches in the Z80 come from a load list: 0 for the menus (Begin, songs 0-3), 1 in the game
      // (StartGame: team and arena songs, effects). A sound that needs the other list first restarts the driver
      // with it, as the game does between the menus and a game.
      let list = opts.loadList || 0;
      const listFor = (kind, n) => (opts.loadList != null ? opts.loadList : kind === 'song' && n >= 0 && n <= 3 ? 0 : 1);
      const withList = (kind, n, code) => {
        const need = listFor(kind, n);
        if (need === list) return code;
        list = need;
        return bootCode(opts.banks, need).concat(code);
      };

      return {
        cpu, ram, z80, io, unexpectedReads,
        boot() { return runTrampoline(bootCode(opts.banks, list), 'boot'); },
        song(n) { return runTrampoline(withList('song', n, pushWord(n).concat(jsr(ADDR.song))), 'song ' + n); },
        sfx(n) { return runTrampoline(withList('sfx', n, pushWord(n).concat(jsr(ADDR.sfx))), 'sfx ' + n); },
        turnoff() { return runTrampoline(jsr(ADDR.SoundOff), 'SoundOff'); },
        vblank() { return runTrampoline(VBLANK_CODE, 'SndUpdate'); }
      };
    }

    function record(call) {
      return { steps: call.steps, events: call.events.length, unexpected: [] };
    }

    return { create, record, SEGMENT, STACK, DriverError, ADDR, WAIT_TSTATES: CFG.WAIT_TSTATES, Z80_BOOT_TSTATES: CFG.Z80_BOOT_TSTATES };
  }

  return build();
});
