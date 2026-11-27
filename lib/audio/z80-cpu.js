/**
 * Minimal Z80 CPU for NHL 92 sound-driver bring-up (not cycle-accurate).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlZ80Cpu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function create(memory, opts) {
    const mem = memory instanceof Uint8Array ? memory : new Uint8Array(memory);
    const size = mem.length;
    const state = {
      a: 0,
      f: 0,
      bc: 0,
      de: 0,
      hl: 0,
      sp: opts && opts.sp != null ? opts.sp : 0xfffe,
      pc: opts && opts.pc != null ? opts.pc : 0,
      halted: false,
      iff1: false,
      iff2: false
    };

    function read8(addr) {
      const a = addr & 0xffff;
      if (a >= size) return 0xff;
      return mem[a];
    }

    function write8(addr, value) {
      const a = addr & 0xffff;
      if (a >= size) return;
      mem[a] = value & 0xff;
    }

    function read16(addr) {
      return read8(addr) | (read8(addr + 1) << 8);
    }

    function write16(addr, value) {
      write8(addr, value & 0xff);
      write8(addr + 1, (value >> 8) & 0xff);
    }

    function push16(value) {
      state.sp = (state.sp - 2) & 0xffff;
      write16(state.sp, value);
    }

    function pop16() {
      const v = read16(state.sp);
      state.sp = (state.sp + 2) & 0xffff;
      return v;
    }

    function step() {
      if (state.halted) return false;
      const op = read8(state.pc++);
      switch (op) {
        case 0x00:
          return true;
        case 0x76:
          state.halted = true;
          return false;
        case 0xf3:
          state.iff1 = false;
          state.iff2 = false;
          return true;
        case 0xfb:
          state.iff1 = true;
          state.iff2 = true;
          return true;
        case 0xc3:
          state.pc = read16(state.pc);
          return true;
        case 0x18:
        case 0x10: {
          const off = read8(state.pc++);
          state.pc = (state.pc + ((off & 0x80) ? off - 0x100 : off)) & 0xffff;
          return true;
        }
        case 0xfa: {
          const off = read8(state.pc++);
          const b = ((state.bc >> 8) - 1) & 0xff;
          state.bc = (b << 8) | (state.bc & 0xff);
          if (b !== 0) {
            state.pc = (state.pc + ((off & 0x80) ? off - 0x100 : off)) & 0xffff;
          }
          return true;
        }
        case 0x3e:
          state.a = read8(state.pc++);
          return true;
        case 0x32:
          write8(read16(state.pc), state.a);
          state.pc += 2;
          return true;
        case 0x3a:
          state.a = read8(read16(state.pc));
          state.pc += 2;
          return true;
        case 0x21:
          state.hl = read16(state.pc);
          state.pc += 2;
          return true;
        case 0x11:
          state.de = read16(state.pc);
          state.pc += 2;
          return true;
        case 0x01:
          state.bc = read16(state.pc);
          state.pc += 2;
          return true;
        case 0x31:
          state.sp = read16(state.pc);
          state.pc += 2;
          return true;
        case 0x7e:
          state.a = read8(state.hl);
          return true;
        case 0x23:
          state.hl = (state.hl + 1) & 0xffff;
          return true;
        case 0x2b:
          state.hl = (state.hl - 1) & 0xffff;
          return true;
        case 0x46:
          state.b = read8(state.hl);
          return true;
        case 0x78:
          state.a = state.b;
          return true;
        case 0xb7:
          state.f = state.a === 0 ? 0x40 : 0;
          return true;
        case 0x20: {
          const off = read8(state.pc++);
          if ((state.f & 0x40) === 0) {
            state.pc = (state.pc + ((off & 0x80) ? off - 0x100 : off)) & 0xffff;
          }
          return true;
        }
        case 0x28: {
          const off = read8(state.pc++);
          if (state.f & 0x40) {
            state.pc = (state.pc + ((off & 0x80) ? off - 0x100 : off)) & 0xffff;
          }
          return true;
        }
        case 0xcd: {
          const dest = read16(state.pc);
          state.pc += 2;
          push16(state.pc);
          state.pc = dest;
          return true;
        }
        case 0xc9:
          state.pc = pop16();
          return true;
        case 0xaf:
          state.a = 0;
          state.f = 0x40;
          return true;
        case 0x3c:
          state.a = (state.a + 1) & 0xff;
          state.f = state.a === 0 ? 0x40 : 0;
          return true;
        case 0xfe: {
          const n = read8(state.pc++);
          const diff = (state.a - n) & 0xff;
          state.f = diff === 0 ? 0x40 : 0;
          return true;
        }
        case 0xdb:
        case 0xd3:
          state.pc++;
          return true;
        case 0xed: {
          const sub = read8(state.pc++);
          if (sub === 0x46) {
            state.a = read8(state.bc);
            return true;
          }
          throw new Error('unsupported ED prefix 0x' + sub.toString(16));
        }
        default:
          throw new Error('unsupported opcode 0x' + op.toString(16) + ' at pc 0x' + (state.pc - 1).toString(16));
      }
    }

    function run(maxSteps) {
      let n = maxSteps || 10000;
      while (n-- > 0) {
        if (!step()) break;
      }
      return state;
    }

    return { mem, state, read8, write8, step, run };
  }

  return { create };
});
