/**
 * Genesis Z80 bus harness for running the retail NHL '92 Z80 sound driver
 * alone on our Z80 core. Every YM2612 port write is logged (`log`, `ym`); the
 * optional `onYmWrite(t, port, value)` / `onPsgWrite(t, value)` hooks forward
 * the same writes, with their T-state, to real chip cores (nhl92-z80-audio.js).
 * The hooks never change what the Z80 sees, so the log is identical with or
 * without them.
 *
 * Z80 map: 0000-3FFF RAM (8 KB, mirrored), 4000-5FFF YM2612 (A0-A1 decode),
 * 6000-60FF bank register (9-bit serial, bit 0 of each write), 7F00-7F1F VDP
 * with PSG at the odd addresses 7F11/13/15/17, 8000-FFFF 68k bank window.
 */
(function (root, factory) {
  var core = typeof module === 'object' && module.exports
    ? require('./z80-cpu-core')
    : root.NhlZ80CpuCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Z80Harness = api;
})(typeof self !== 'undefined' ? self : this, function (core) {
const { Z80Cpu } = core;

const RAM_SIZE = 0x2000;
const Z80_CLOCK = 3579545;
// 262 lines x 3420 master clocks / 15 (NTSC).
const FRAME_TSTATES = 59736;
const RETAIL_LOAD_LENGTH = 0x597;
const NO_PREFIX = 0;
const IX_PREFIX = 1;
const CB_PREFIX = 2;
const ED_PREFIX = 3;

/** Opcode-fetch (M1) prefix tracking: DD/FD CB d op has only two M1 cycles. */
function nextPrefix(state, byte) {
  if (state === CB_PREFIX || state === ED_PREFIX) return NO_PREFIX;
  if (state === IX_PREFIX && byte === 0xcb) return NO_PREFIX;
  if (byte === 0xdd || byte === 0xfd) return IX_PREFIX;
  if (byte === 0xcb) return CB_PREFIX;
  if (byte === 0xed) return ED_PREFIX;
  return NO_PREFIX;
}

function create(opts) {
  const o = opts || {};
  const program = o.program;
  const rom = o.rom || null;
  const onYmWrite = typeof o.onYmWrite === 'function' ? o.onYmWrite : null;
  const onPsgWrite = typeof o.onPsgWrite === 'function' ? o.onPsgWrite : null;
  const ram = new Uint8Array(RAM_SIZE);
  if (program) {
    const len = o.loadLength != null ? o.loadLength : RETAIL_LOAD_LENGTH;
    ram.set(program.subarray(0, Math.min(len, program.length)));
  }

  let cpu = null;
  let edges = 0;
  let prevM1 = 1;
  let prevRd = false;
  let prevWr = false;
  let prevIo = false;
  let prefix = NO_PREFIX;
  let fetchPending = false;
  let bank = 0;
  const latch = [0, 0];
  const log = [];
  const ym = [];
  const bankReads = [];
  let ymReads = 0;
  let ioCount = 0;

  function tstates() {
    return edges >> 1;
  }

  function reset() {
    cpu = new Z80Cpu();
    cpu.regs.pc = 0;
    cpu.regs.sp = 0xffff;
    prevM1 = 1;
    prevRd = false;
    prevWr = false;
    prevIo = false;
    prefix = NO_PREFIX;
    fetchPending = false;
  }

  function memRead(a, logIt) {
    if (a < 0x4000) return ram[a & 0x1fff];
    if (a < 0x6000) {
      if (logIt) {
        ymReads += 1;
        log.push({ t: tstates(), kind: 'ymRead', addr: a });
      }
      return 0x00;
    }
    if (a >= 0x8000) {
      const addr68k = (bank << 15) | (a & 0x7fff);
      if (logIt) bankReads.push({ t: tstates(), addr68k });
      if (!rom || addr68k >= rom.length) return 0xff;
      return rom[addr68k];
    }
    return 0xff;
  }

  function memWrite(a, v) {
    const t = tstates();
    if (a < 0x4000) {
      ram[a & 0x1fff] = v;
      return;
    }
    if (a < 0x6000) {
      const port = a & 3;
      log.push({ t, kind: 'ymPort', port, value: v });
      const part = port >> 1;
      if ((port & 1) === 0) latch[part] = v;
      else ym.push({ t, part, reg: latch[part], value: v });
      if (onYmWrite) onYmWrite(t, port, v);
      return;
    }
    if (a < 0x6100) {
      bank = ((bank >> 1) | ((v & 1) << 8)) & 0x1ff;
      log.push({ t, kind: 'bank', bit: v & 1, bank });
      return;
    }
    if (a >= 0x7f00 && a < 0x7f20) {
      const kind = (a & 0x19) === 0x11 ? 'psg' : 'vdp';
      log.push({ t, kind, addr: a, value: v });
      if (kind === 'psg' && onPsgWrite) onPsgWrite(t, v);
      return;
    }
    log.push({ t, kind: a >= 0x8000 ? 'bankWrite' : 'unmapped', addr: a, value: v });
  }

  function edge() {
    const b = cpu.bus;
    if (b.nM1 === 0 && prevM1 === 1) fetchPending = true;
    prevM1 = b.nM1;
    const rd = b.nMREQ === 0 && b.nRD === 0;
    const wr = b.nMREQ === 0 && b.nWR === 0;
    const io = b.nIORQ === 0 && (b.nRD === 0 || b.nWR === 0);
    const a = b.addr & 0xffff;
    if (rd) {
      b.data = memRead(a, !prevRd);
      if (fetchPending) {
        prefix = nextPrefix(prefix, b.data & 0xff);
        fetchPending = false;
      }
    }
    if (wr && !prevWr) memWrite(a, b.data & 0xff);
    if (io) {
      if (b.nRD === 0) b.data = 0xff;
      if (!prevIo) {
        ioCount += 1;
        log.push({ t: tstates(), kind: 'io', port: a & 0xff });
      }
    }
    prevRd = rd;
    prevWr = wr;
    prevIo = io;
    cpu.clockEdge();
    edges += 1;
  }

  function atBoundary() {
    const b = cpu.bus;
    return b.nM1 === 0 && prevM1 === 1 && prefix === NO_PREFIX;
  }

  /** Run at least `count` T-states, stopping at the next instruction boundary. */
  function run(count) {
    const end = edges + count * 2;
    let guard = 0;
    while (edges < end || !atBoundary()) {
      edge();
      if (++guard > 1e9) throw new Error('run guard');
    }
  }

  /** Run until the next instruction fetch from `pc` (or throw after maxT T-states). */
  function runUntilPc(pc, maxT) {
    const end = edges + (maxT || 2000000) * 2;
    let first = true;
    while (true) {
      if (!first && atBoundary() && (cpu.bus.addr & 0xffff) === pc) return tstates();
      if (edges >= end) throw new Error('runUntilPc timeout at pc ' + cpu.regs.pc.toString(16));
      edge();
      first = false;
    }
  }

  const TRAMPOLINE = 0x1e00;
  const LD8 = { a: 0x3e, b: 0x06, c: 0x0e, d: 0x16, e: 0x1e, h: 0x26, l: 0x2e };
  const LD16 = { bc: [0x01], de: [0x11], hl: [0x21], ix: [0xdd, 0x21], iy: [0xfd, 0x21] };

  /**
   * Reset the CPU and call a driver routine from a RAM trampoline
   * (ld sp; ld r,n...; call addr; jr $). Returns T-states from the CALL
   * fetch to the return, i.e. CALL (17) + routine + RET.
   */
  function call(addr, regs, maxT) {
    const code = [0x31, 0x00, 0x1f];
    for (const [name, value] of Object.entries(regs || {})) {
      if (LD8[name] != null) code.push(LD8[name], value & 0xff);
      else if (LD16[name]) code.push(...LD16[name], value & 0xff, (value >> 8) & 0xff);
      else throw new Error('unsupported register ' + name);
    }
    const callAt = TRAMPOLINE + code.length;
    code.push(0xcd, addr & 0xff, addr >> 8);
    const stopAt = TRAMPOLINE + code.length;
    code.push(0x18, 0xfe);
    ram.set(code, TRAMPOLINE);
    reset();
    cpu.regs.pc = TRAMPOLINE;
    const t0 = runUntilPc(callAt, 1000);
    return runUntilPc(stopAt, maxT || 200000) - t0;
  }

  /** 68k write into Z80 RAM while the 68k holds the bus (applied between instructions). */
  function busWrite(addr, value) {
    ram[addr & 0x1fff] = value & 0xff;
  }

  /**
   * p_music_vblank_fn write order (sound.asm): the 48-byte channel buffer goes to
   * $0273 unless the 68k update flag is 1; when an SFX write is pending, $BF, $BE,
   * $C0-$C3 are written and the flag byte becomes 0; then the flag goes to $02A3.
   */
  function vblank(input) {
    let flag = input.flag & 0xff;
    if (flag !== 1) {
      for (let i = 0; i < 48; i++) busWrite(0x273 + i, input.channels[i]);
    }
    if (input.pending) {
      const s = input.sfx;
      busWrite(0xbf, s[0]);
      busWrite(0xbe, s[1]);
      busWrite(0xc0, s[2]);
      busWrite(0xc1, s[3]);
      busWrite(0xc2, s[4]);
      busWrite(0xc3, s[5]);
      flag = 0;
    }
    busWrite(0x2a3, flag);
  }

  reset();

  return {
    ram,
    get cpu() { return cpu; },
    get bank() { return bank; },
    get ymReads() { return ymReads; },
    get ioCount() { return ioCount; },
    log,
    ym,
    bankReads,
    tstates,
    reset,
    run,
    runUntilPc,
    call,
    busWrite,
    vblank,
    clearLogs() {
      log.length = 0;
      ym.length = 0;
      bankReads.length = 0;
    }
  };
}

return { create, RAM_SIZE, Z80_CLOCK, FRAME_TSTATES, RETAIL_LOAD_LENGTH };
});
