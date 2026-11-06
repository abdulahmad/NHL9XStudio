/**
 * Motorola 68000 interpreter (instruction-level, no cycle timing).
 *
 * Written for NHL9X Studio so the retail NHL '92 68k sound driver can run from
 * ROM bytes. Covers the full 68000 instruction set, user/supervisor modes and
 * the exception model (group 0 address errors, group 1/2 traps). Validated
 * against the SingleStepTests 680x0 suite: node test/m68k-singlestep.js.
 *
 * Bus: create({ read8, read16, write8, write16, fetch16? }) with 24-bit
 * addresses. fetch16 (optional) serves instruction-stream reads; it defaults
 * to read16. Word/long accesses at odd addresses raise an address error, as on
 * the real chip; long accesses are two word accesses (high word first).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlM68k = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const C = 0x01;
  const V = 0x02;
  const Z = 0x04;
  const N = 0x08;
  const X = 0x10;
  const SR_MASK = 0xa71f;
  const S_BIT = 0x2000;
  const T_BIT = 0x8000;

  const MASK = { 1: 0xff, 2: 0xffff, 4: 0xffffffff };
  const MSB = { 1: 0x80, 2: 0x8000, 4: 0x80000000 };
  const SUFFIX = { 1: '.b', 2: '.w', 4: '.l' };

  /** Group-0 address error, thrown out of the faulting access. */
  class AddressError {
    constructor(address, read, instruction) {
      this.address = address >>> 0;
      this.read = read;
      this.instruction = instruction;
    }
  }
  /** Group-1/2 exception raised by an instruction (vector, stacked PC). */
  class Trap {
    constructor(vector, pc) {
      this.vector = vector;
      this.pc = pc >>> 0;
    }
  }

  const sx8 = (v) => ((v & 0xff) ^ 0x80) - 0x80;
  const sx16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;
  const sext = (v, size) => (size === 1 ? sx8(v) : size === 2 ? sx16(v) : v | 0);

  function create(bus) {
    const fetchBus = bus.fetch16 || bus.read16;
    const D = [0, 0, 0, 0, 0, 0, 0, 0];
    const A = [0, 0, 0, 0, 0, 0, 0, 0]; // A[7] = active stack pointer
    let usp = 0;
    let ssp = 0;
    let sr = S_BIT | 0x0700;
    let pc = 0;
    let ir = 0;
    let insnPc = 0;
    let aeAdjust = 0;
    let halted = false;
    let stopped = false;

    const sup = () => (sr & S_BIT) !== 0;
    function setSR(v) {
      if (sup()) ssp = A[7]; else usp = A[7];
      sr = v & SR_MASK;
      A[7] = sup() ? ssp : usp;
    }
    const getCCR = () => sr & 0x1f;
    const setCCR = (v) => { sr = (sr & 0xff00) | (v & 0x1f); };
    const flag = (f, on) => { sr = on ? sr | f : sr & ~f; };

    // --- Bus ---------------------------------------------------------------------
    function read(addr, size) {
      const a = addr >>> 0;
      if (size === 1) return bus.read8(a & 0xffffff) & 0xff;
      if (a & 1) throw new AddressError(a, true, false);
      if (size === 2) return bus.read16(a & 0xffffff) & 0xffff;
      const hi = bus.read16(a & 0xffffff) & 0xffff;
      const lo = bus.read16((a + 2) & 0xffffff) & 0xffff;
      return ((hi << 16) | lo) >>> 0;
    }
    function write(addr, size, value) {
      const a = addr >>> 0;
      if (size === 1) { bus.write8(a & 0xffffff, value & 0xff); return; }
      if (a & 1) throw new AddressError(a, false, false);
      if (size === 2) { bus.write16(a & 0xffffff, value & 0xffff); return; }
      bus.write16(a & 0xffffff, (value >>> 16) & 0xffff);
      bus.write16((a + 2) & 0xffffff, value & 0xffff);
    }
    function fetch() {
      if (pc & 1) throw new AddressError(pc, true, true);
      const w = fetchBus(pc & 0xffffff) & 0xffff;
      pc = (pc + 2) >>> 0;
      return w;
    }
    function fetchLong() {
      const hi = fetch();
      return ((hi << 16) | fetch()) >>> 0;
    }
    function push(size, v) {
      A[7] = (A[7] - size) >>> 0;
      write(A[7], size, v);
    }
    function pop(size) {
      const v = read(A[7], size);
      A[7] = (A[7] + size) >>> 0;
      return v;
    }

    // --- Effective addresses ---------------------------------------------------------
    /** Brief extension word: (d8, base, Xn). */
    function indexed(base) {
      const ext = fetch();
      const r = (ext >> 12) & 7;
      let idx = ext & 0x8000 ? A[r] : D[r];
      if (!(ext & 0x0800)) idx = sx16(idx);
      return (base + (idx | 0) + sx8(ext)) >>> 0;
    }

    /**
     * Decode an effective address. Pre/post-increment side effects happen here,
     * once. Returns { t: 'd'|'a'|'m'|'i', r?, addr?, value? }.
     */
    function ea(mode, reg, size) {
      switch (mode) {
        case 0: return { t: 'd', r: reg };
        case 1: return { t: 'a', r: reg };
        case 2: return { t: 'm', addr: A[reg] };
        case 3: {
          const addr = A[reg];
          A[reg] = (addr + (size === 1 && reg === 7 ? 2 : size)) >>> 0;
          return { t: 'm', addr };
        }
        case 4: {
          A[reg] = (A[reg] - (size === 1 && reg === 7 ? 2 : size)) >>> 0;
          return { t: 'm', addr: A[reg] };
        }
        case 5: return { t: 'm', addr: (A[reg] + sx16(fetch())) >>> 0 };
        case 6: return { t: 'm', addr: indexed(A[reg]) };
        case 7:
          switch (reg) {
            case 0: return { t: 'm', addr: sx16(fetch()) >>> 0 };
            case 1: return { t: 'm', addr: fetchLong() };
            case 2: { const base = pc; return { t: 'm', addr: (base + sx16(fetch())) >>> 0 }; }
            case 3: { const base = pc; return { t: 'm', addr: indexed(base) }; }
            case 4: {
              if (size === 4) return { t: 'i', value: fetchLong() };
              const w = fetch();
              return { t: 'i', value: size === 1 ? w & 0xff : w };
            }
          }
      }
      throw new Trap(4, insnPc);
    }
    function get(e, size) {
      switch (e.t) {
        case 'd': return (D[e.r] & MASK[size]) >>> 0;
        case 'a': return (A[e.r] & MASK[size]) >>> 0;
        case 'i': return e.value >>> 0;
        default: return read(e.addr, size);
      }
    }
    function put(e, size, v) {
      v = (v & MASK[size]) >>> 0;
      switch (e.t) {
        case 'd': D[e.r] = size === 4 ? v : ((D[e.r] & ~MASK[size]) | v) >>> 0; return;
        case 'a': A[e.r] = size === 4 ? v : sext(v, size) >>> 0; return;
        case 'm': write(e.addr, size, v); return;
      }
      throw new Trap(4, insnPc);
    }

    // --- Flags ---------------------------------------------------------------------
    function nz(v, size) {
      v = (v & MASK[size]) >>> 0;
      let ccr = sr & X;
      if (v & MSB[size]) ccr |= N;
      if (v === 0) ccr |= Z;
      setCCR(ccr);
    }
    function addFlags(s, d, r, size, keepZ) {
      const m = MSB[size];
      const mask = MASK[size];
      const res = (r & mask) >>> 0;
      let ccr = 0;
      if (res & m) ccr |= N;
      if (keepZ) { if (res === 0) ccr |= sr & Z; } else if (res === 0) ccr |= Z;
      if (((s ^ res) & (d ^ res)) & m) ccr |= V;
      const carry = ((s & d) | (~res & (s | d))) & m;
      if (carry) ccr |= C | X;
      setCCR(ccr);
    }
    function subFlags(s, d, r, size, setX, keepZ) {
      const m = MSB[size];
      const mask = MASK[size];
      const res = (r & mask) >>> 0;
      let ccr = setX ? 0 : sr & X;
      if (res & m) ccr |= N;
      if (keepZ) { if (res === 0) ccr |= sr & Z; } else if (res === 0) ccr |= Z;
      if (((s ^ d) & (res ^ d)) & m) ccr |= V;
      const borrow = ((s & ~d) | (res & ~d) | (s & res)) & m;
      if (borrow) ccr |= setX ? C | X : C;
      setCCR(ccr);
    }

    function cond(cc) {
      const c = sr & C ? 1 : 0;
      const v = sr & V ? 1 : 0;
      const z = sr & Z ? 1 : 0;
      const n = sr & N ? 1 : 0;
      switch (cc) {
        case 0: return true;
        case 1: return false;
        case 2: return !c && !z;
        case 3: return !!(c || z);
        case 4: return !c;
        case 5: return !!c;
        case 6: return !z;
        case 7: return !!z;
        case 8: return !v;
        case 9: return !!v;
        case 10: return !n;
        case 11: return !!n;
        case 12: return n === v;
        case 13: return n !== v;
        case 14: return !z && n === v;
        default: return !!(z || n !== v);
      }
    }

    function privileged() {
      if (!sup()) throw new Trap(8, insnPc);
    }

    // --- Instruction groups ---------------------------------------------------------
    const SIZE_BITS = [1, 2, 4];

    function immOp(op) {
      const kind = (op >> 9) & 7; // 0 OR 1 AND 2 SUB 3 ADD 5 EOR 6 CMP
      const sz = (op >> 6) & 3;
      const mode = (op >> 3) & 7;
      const reg = op & 7;
      if (sz === 3) throw new Trap(4, insnPc);
      const size = SIZE_BITS[sz];
      if (mode === 7 && reg === 4 && (kind === 0 || kind === 1 || kind === 5)) {
        // to CCR (byte) / to SR (word)
        const imm = fetch();
        if (size === 1) {
          const v = imm & 0xff;
          const cur = getCCR();
          setCCR(kind === 0 ? cur | v : kind === 1 ? cur & v : cur ^ v);
          return;
        }
        if (size === 2) {
          privileged();
          setSR(kind === 0 ? sr | imm : kind === 1 ? sr & imm : sr ^ imm);
          return;
        }
        throw new Trap(4, insnPc);
      }
      const imm = size === 4 ? fetchLong() : size === 2 ? fetch() : fetch() & 0xff;
      const e = ea(mode, reg, size);
      const d = get(e, size);
      switch (kind) {
        case 0: { const r = d | imm; nz(r, size); put(e, size, r); return; }
        case 1: { const r = d & imm; nz(r, size); put(e, size, r); return; }
        case 5: { const r = d ^ imm; nz(r, size); put(e, size, r); return; }
        case 2: { const r = d - imm; subFlags(imm, d, r, size, true); put(e, size, r); return; }
        case 3: { const r = d + imm; addFlags(imm, d, r, size); put(e, size, r); return; }
        case 6: { const r = d - imm; subFlags(imm, d, r, size, false); return; }
      }
      throw new Trap(4, insnPc);
    }

    function bitOp(op) {
      const mode = (op >> 3) & 7;
      const reg = op & 7;
      const kind = (op >> 6) & 3; // 0 BTST 1 BCHG 2 BCLR 3 BSET
      let bit;
      if (op & 0x100) bit = D[(op >> 9) & 7];
      else bit = fetch() & 0xff;
      if (mode === 0) {
        bit &= 31;
        const v = D[reg];
        flag(Z, !((v >>> bit) & 1));
        if (kind === 1) D[reg] = (v ^ (1 << bit)) >>> 0;
        else if (kind === 2) D[reg] = (v & ~(1 << bit)) >>> 0;
        else if (kind === 3) D[reg] = (v | (1 << bit)) >>> 0;
        return;
      }
      bit &= 7;
      const e = ea(mode, reg, 1);
      const v = get(e, 1);
      flag(Z, !((v >> bit) & 1));
      if (kind === 1) put(e, 1, v ^ (1 << bit));
      else if (kind === 2) put(e, 1, v & ~(1 << bit));
      else if (kind === 3) put(e, 1, v | (1 << bit));
    }

    function movep(op) {
      const dreg = (op >> 9) & 7;
      const areg = op & 7;
      const opmode = (op >> 6) & 7; // 4 w mem->reg, 5 l mem->reg, 6 w reg->mem, 7 l reg->mem
      const addr = (A[areg] + sx16(fetch())) >>> 0;
      const n = opmode & 1 ? 4 : 2;
      if (opmode < 6) {
        let v = 0;
        for (let i = 0; i < n; i++) v = (v << 8) | read(addr + i * 2, 1);
        if (n === 2) D[dreg] = ((D[dreg] & 0xffff0000) | (v & 0xffff)) >>> 0;
        else D[dreg] = v >>> 0;
      } else {
        const v = D[dreg];
        for (let i = 0; i < n; i++) write(addr + i * 2, 1, (v >>> ((n - 1 - i) * 8)) & 0xff);
      }
    }

    function line0(op) {
      if (op & 0x100) {
        if (((op >> 3) & 7) === 1) return movep(op);
        return bitOp(op);
      }
      if (((op >> 9) & 7) === 4) return bitOp(op);
      if (((op >> 9) & 7) === 7) throw new Trap(4, insnPc);
      return immOp(op);
    }

    function move(op, size) {
      const src = ea((op >> 3) & 7, op & 7, size);
      const v = get(src, size);
      const dmode = (op >> 6) & 7;
      const dreg = (op >> 9) & 7;
      if (dmode === 1) { // MOVEA
        if (size === 1) throw new Trap(4, insnPc);
        A[dreg] = sext(v, size) >>> 0;
        return;
      }
      if (dmode === 3) { // (An)+: the register advances only after the write succeeds
        nz(v, size);
        write(A[dreg], size, v);
        A[dreg] = (A[dreg] + (size === 1 && dreg === 7 ? 2 : size)) >>> 0;
        return;
      }
      if (dmode === 4 && size === 4) {
        // -(An).l: low word first at An-2, then high word at An-4 (An steps by 2).
        const a0 = A[dreg];
        aeAdjust = 2;
        nz(v, 4);
        A[dreg] = (a0 - 2) >>> 0;
        write(A[dreg], 2, v & 0xffff);
        A[dreg] = (a0 - 4) >>> 0;
        write(A[dreg], 2, v >>> 16);
        return;
      }
      const srcImm = ((op >> 3) & 7) === 7 && (op & 7) === 4;
      const dst = ea(dmode, dreg, size);
      if (dmode === 4) aeAdjust = 2; // -(An): next opcode prefetched before the write
      else if (dmode === 7 && dreg === 1 && !srcImm && ((op >> 3) & 7) >= 2) aeAdjust = -2; // memory -> (xxx).l: write before the last address word's prefetch
      nz(v, size);
      put(dst, size, v);
    }

    function movem(op) {
      const size = op & 0x40 ? 4 : 2;
      const toReg = (op & 0x400) !== 0;
      const mode = (op >> 3) & 7;
      const reg = op & 7;
      const mask = fetch();
      if (!toReg && mode === 4) {
        // Predecrement: list is reversed (bit 0 = A7 ... bit 15 = D0).
        let addr = A[reg];
        for (let i = 0; i < 16; i++) {
          if (!(mask & (1 << i))) continue;
          const r = 15 - i;
          addr = (addr - size) >>> 0;
          const v = r < 8 ? D[r] : A[r - 8];
          if (size === 4) { // low word first
            write(addr + 2, 2, v & 0xffff);
            write(addr, 2, v >>> 16);
          } else write(addr, size, v);
        }
        A[reg] = addr;
        return;
      }
      let addr;
      if (mode === 3) addr = A[reg];
      else {
        const e = ea(mode, reg, size);
        if (e.t !== 'm') throw new Trap(4, insnPc);
        addr = e.addr;
      }
      if (mode === 3 && toReg && (addr & 1) && mask) {
        // Faulting (An)+ load: the chip has already stepped An by one word.
        A[reg] = (addr + 2) >>> 0;
        read(addr, size);
      }
      for (let i = 0; i < 16; i++) {
        if (!(mask & (1 << i))) continue;
        if (toReg) {
          const v = sext(read(addr, size), size) >>> 0;
          if (i < 8) D[i] = v; else A[i - 8] = v;
        } else {
          write(addr, size, i < 8 ? D[i] : A[i - 8]);
        }
        addr = (addr + size) >>> 0;
      }
      if (mode === 3) A[reg] = addr;
    }

    /**
     * BCD arithmetic as the 68000 does it (fitted to every ABCD/SBCD/NBCD case in
     * SingleStepTests): the low digit is corrected on a low-nibble carry/borrow,
     * the high digit when the binary result passes $99 (add) or goes negative
     * (subtract); V is set when the correction flips bit 7 the other way.
     */
    function bcdAdd(s, d, x) {
      const bin = d + s + x;
      let res = bin;
      if ((d & 15) + (s & 15) + x > 9) res += 6;
      const carry = bin > 0x99;
      if (carry) res += 0x60;
      res &= 0xff;
      return { res, carry, v: (~bin & res & 0x80) !== 0 };
    }
    function bcdSub(s, d, x) {
      const bin = d - s - x;
      let res = bin;
      if ((d & 15) - (s & 15) - x < 0) res -= 6;
      const borrow = bin < 0;
      if (borrow) res -= 0x60;
      const carry = borrow || res < 0;
      const out = res & 0xff;
      return { res: out, carry, v: (bin & ~out & 0x80) !== 0 };
    }

    function line4(op) {
      const mode = (op >> 3) & 7;
      const reg = op & 7;
      if (op & 0x100) {
        if ((op & 0x1c0) === 0x1c0) { // LEA
          const e = ea(mode, reg, 4);
          if (e.t !== 'm') throw new Trap(4, insnPc);
          A[(op >> 9) & 7] = e.addr;
          return;
        }
        if ((op & 0x1c0) === 0x180) { // CHK.w
          const e = ea(mode, reg, 2);
          if (e.t === 'a') throw new Trap(4, insnPc);
          const bound = sx16(get(e, 2));
          const v = sx16(D[(op >> 9) & 7]);
          // SingleStepTests: Z, V, C cleared; N = 1 below zero, 0 above the
          // bound, unchanged when in range.
          const keep = sr & (X | N);
          if (v < 0) { setCCR((keep & X) | N); throw new Trap(6, pc); }
          if (v > bound) { setCCR(keep & X); throw new Trap(6, pc); }
          setCCR(keep);
          return;
        }
        throw new Trap(4, insnPc);
      }
      const sub = (op >> 8) & 0xf;
      const sz = (op >> 6) & 3;
      switch (sub) {
        case 0x0: // NEGX / MOVE from SR
          if (sz === 3) {
            const e = ea(mode, reg, 2);
            if (e.t === 'a') throw new Trap(4, insnPc);
            get(e, 2);
            put(e, 2, sr);
            return;
          } else {
            const size = SIZE_BITS[sz];
            const e = ea(mode, reg, size);
            if (e.t === 'a') throw new Trap(4, insnPc);
            const d = get(e, size);
            const x = sr & X ? 1 : 0;
            const r = 0 - d - x;
            subFlags(d, 0, r, size, true, true);
            put(e, size, r);
            return;
          }
        case 0x2: // CLR
          if (sz === 3) throw new Trap(4, insnPc);
          {
            const size = SIZE_BITS[sz];
            const e = ea(mode, reg, size);
            if (e.t === 'a') throw new Trap(4, insnPc);
            get(e, size);
            setCCR((sr & X) | Z);
            put(e, size, 0);
            return;
          }
        case 0x4: // NEG / MOVE to CCR
          if (sz === 3) {
            const e = ea(mode, reg, 2);
            if (e.t === 'a') throw new Trap(4, insnPc);
            setCCR(get(e, 2));
            return;
          } else {
            const size = SIZE_BITS[sz];
            const e = ea(mode, reg, size);
            if (e.t === 'a') throw new Trap(4, insnPc);
            const d = get(e, size);
            const r = 0 - d;
            subFlags(d, 0, r, size, true);
            put(e, size, r);
            return;
          }
        case 0x6: // NOT / MOVE to SR
          if (sz === 3) {
            privileged();
            const e = ea(mode, reg, 2);
            if (e.t === 'a') throw new Trap(4, insnPc);
            setSR(get(e, 2));
            return;
          } else {
            const size = SIZE_BITS[sz];
            const e = ea(mode, reg, size);
            if (e.t === 'a') throw new Trap(4, insnPc);
            const r = ~get(e, size);
            nz(r, size);
            put(e, size, r);
            return;
          }
        case 0x8:
          if (sz === 0) { // NBCD
            const e = ea(mode, reg, 1);
            if (e.t === 'a') throw new Trap(4, insnPc);
            const d = get(e, 1);
            const r = bcdSub(d, 0, sr & X ? 1 : 0);
            let ccr = sr & Z;
            if (r.res !== 0) ccr = 0;
            if (r.carry) ccr |= C | X;
            if (r.res & 0x80) ccr |= N;
            if (r.v) ccr |= V;
            setCCR(ccr);
            put(e, 1, r.res);
            return;
          }
          if (sz === 1) {
            if (mode === 0) { // SWAP
              const v = D[reg];
              const r = ((v << 16) | (v >>> 16)) >>> 0;
              D[reg] = r;
              nz(r, 4);
              return;
            }
            const e = ea(mode, reg, 4); // PEA
            if (e.t !== 'm') throw new Trap(4, insnPc);
            push(4, e.addr);
            return;
          }
          if (mode === 0) { // EXT
            if (sz === 2) { D[reg] = ((D[reg] & 0xffff0000) | (sx8(D[reg]) & 0xffff)) >>> 0; nz(D[reg], 2); }
            else { D[reg] = sx16(D[reg]) >>> 0; nz(D[reg], 4); }
            return;
          }
          return movem(op);
        case 0xa:
          if (sz === 3) {
            if (op === 0x4afc) throw new Trap(4, insnPc); // ILLEGAL
            const e = ea(mode, reg, 1); // TAS
            if (e.t === 'a') throw new Trap(4, insnPc);
            const v = get(e, 1);
            nz(v, 1);
            put(e, 1, v | 0x80);
            return;
          } else {
            const size = SIZE_BITS[sz];
            const e = ea(mode, reg, size); // TST
            if (e.t === 'a') throw new Trap(4, insnPc);
            nz(get(e, size), size);
            return;
          }
        case 0xc:
          if (sz >= 2) return movem(op);
          throw new Trap(4, insnPc);
        case 0xe:
          if (sz === 1) {
            if ((op & 0x30) === 0) throw new Trap(32 + (op & 15), pc); // TRAP
            if ((op & 0x38) === 0x10) { // LINK
              const disp = sx16(fetch());
              push(4, reg === 7 ? (A[7] - 4) >>> 0 : A[reg]); // LINK A7 pushes the decremented SP
              A[reg] = A[7];
              A[7] = (A[7] + disp) >>> 0;
              return;
            }
            if ((op & 0x38) === 0x18) { // UNLK
              A[7] = A[reg];
              A[reg] = pop(4);
              return;
            }
            if ((op & 0x38) === 0x20) { privileged(); usp = A[reg]; return; } // MOVE An,USP
            if ((op & 0x38) === 0x28) { privileged(); A[reg] = usp; return; } // MOVE USP,An
            switch (op) {
              case 0x4e70: privileged(); return; // RESET
              case 0x4e71: return; // NOP
              case 0x4e72: privileged(); { const v = fetch(); setSR(v); stopped = true; } return; // STOP
              case 0x4e73: { // RTE
                privileged();
                const newSR = pop(2);
                const newPC = pop(4);
                setSR(newSR);
                pc = newPC;
                return;
              }
              case 0x4e75: pc = pop(4); return; // RTS
              case 0x4e76: if (sr & V) throw new Trap(7, pc); return; // TRAPV
              case 0x4e77: { // RTR
                const ccr = pop(2);
                const newPC = pop(4);
                setCCR(ccr);
                pc = newPC;
                return;
              }
            }
            throw new Trap(4, insnPc);
          }
          if (sz === 2 || sz === 3) { // JSR / JMP
            const e = ea(mode, reg, 4);
            if (e.t !== 'm') throw new Trap(4, insnPc);
            if (e.addr & 1) throw new AddressError(e.addr, true, true); // JSR/JMP: target checked before the push
            if (sz === 2) push(4, pc);
            pc = e.addr;
            return;
          }
          throw new Trap(4, insnPc);
      }
      throw new Trap(4, insnPc);
    }

    function line5(op) {
      const mode = (op >> 3) & 7;
      const reg = op & 7;
      const sz = (op >> 6) & 3;
      if (sz === 3) {
        const cc = (op >> 8) & 0xf;
        if (mode === 1) { // DBcc
          const disp = sx16(fetch());
          if (cond(cc)) return;
          const v = (D[reg] - 1) & 0xffff;
          D[reg] = ((D[reg] & 0xffff0000) | v) >>> 0;
          if (v !== 0xffff) pc = (insnPc + 2 + disp) >>> 0;
          return;
        }
        const e = ea(mode, reg, 1); // Scc
        if (e.t === 'a') throw new Trap(4, insnPc);
        get(e, 1);
        put(e, 1, cond(cc) ? 0xff : 0);
        return;
      }
      const size = SIZE_BITS[sz];
      const q = ((op >> 9) & 7) || 8;
      const sub = (op & 0x100) !== 0;
      if (mode === 1) { // ADDQ/SUBQ to An: whole register, no flags
        if (size === 1) throw new Trap(4, insnPc);
        A[reg] = (sub ? A[reg] - q : A[reg] + q) >>> 0;
        return;
      }
      const e = ea(mode, reg, size);
      const d = get(e, size);
      if (sub) { const r = d - q; subFlags(q, d, r, size, true); put(e, size, r); }
      else { const r = d + q; addFlags(q, d, r, size); put(e, size, r); }
    }

    function line6(op) {
      const cc = (op >> 8) & 0xf;
      let disp = sx8(op);
      const base = pc;
      if (disp === 0) disp = sx16(fetch());
      if (cc === 1) { // BSR
        push(4, pc);
        pc = (base + disp) >>> 0;
        return;
      }
      if (cond(cc)) pc = (base + disp) >>> 0;
    }

    function divide(op, signed) {
      const e = ea((op >> 3) & 7, op & 7, 2);
      if (e.t === 'a') throw new Trap(4, insnPc);
      const src = get(e, 2);
      const r = (op >> 9) & 7;
      const dividend = D[r];
      if (src === 0) {
        // Divide by zero: N/Z/V cleared, C cleared (68000).
        setCCR(sr & X);
        throw new Trap(5, pc);
      }
      if (!signed) {
        const q = Math.floor(dividend / src);
        const rem = dividend % src;
        if (q > 0xffff) { setCCR((sr & (X | N | Z)) | V); return; } // overflow: X, N, Z kept
        D[r] = ((rem << 16) | q) >>> 0;
        let ccr = sr & X;
        if (q & 0x8000) ccr |= N;
        if (q === 0) ccr |= Z;
        setCCR(ccr);
        return;
      }
      const s = sx16(src);
      const dv = dividend | 0;
      const q = Math.trunc(dv / s);
      const rem = dv - q * s;
      if (q > 0x7fff || q < -0x8000) {
        setCCR((sr & (X | N | Z)) | V); // overflow: X, N, Z kept
        return;
      }
      D[r] = (((rem & 0xffff) << 16) | (q & 0xffff)) >>> 0;
      let ccr = sr & X;
      if (q & 0x8000) ccr |= N;
      if ((q & 0xffff) === 0) ccr |= Z;
      setCCR(ccr);
    }

    function multiply(op, signed) {
      const e = ea((op >> 3) & 7, op & 7, 2);
      if (e.t === 'a') throw new Trap(4, insnPc);
      const src = get(e, 2);
      const r = (op >> 9) & 7;
      const res = signed
        ? (Math.imul(sx16(src), sx16(D[r])) >>> 0)
        : (Math.imul(src, D[r] & 0xffff) >>> 0);
      D[r] = res;
      nz(res, 4);
    }

    function bcdOp(op, add) {
      const rx = op & 7;
      const ry = (op >> 9) & 7;
      const x = sr & X ? 1 : 0;
      let s;
      let d;
      let dst;
      if (op & 8) {
        A[rx] = (A[rx] - (rx === 7 ? 2 : 1)) >>> 0;
        s = read(A[rx], 1);
        A[ry] = (A[ry] - (ry === 7 ? 2 : 1)) >>> 0;
        dst = { t: 'm', addr: A[ry] };
        d = read(A[ry], 1);
      } else {
        s = D[rx] & 0xff;
        dst = { t: 'd', r: ry };
        d = D[ry] & 0xff;
      }
      const r = add ? bcdAdd(s, d, x) : bcdSub(s, d, x);
      let ccr = sr & Z;
      if (r.res !== 0) ccr = 0;
      if (r.carry) ccr |= C | X;
      if (r.res & 0x80) ccr |= N;
      if (r.v) ccr |= V;
      setCCR(ccr);
      put(dst, 1, r.res);
    }

    function addxSubx(op, add) {
      const sz = (op >> 6) & 3;
      const size = SIZE_BITS[sz];
      const rx = op & 7;
      const ry = (op >> 9) & 7;
      const x = sr & X ? 1 : 0;
      let s;
      let d;
      let dst;
      if (op & 8) {
        if (size === 4) {
          // -(An).l: low word first at An-2, then the high word (An steps by 2).
          const predecLong = (r) => {
            A[r] = (A[r] - 2) >>> 0;
            const lo = read(A[r], 2);
            A[r] = (A[r] - 2) >>> 0;
            return ((read(A[r], 2) << 16) | lo) >>> 0;
          };
          s = predecLong(rx);
          d = predecLong(ry);
          dst = { t: 'm', addr: A[ry] };
        } else {
          A[rx] = (A[rx] - (size === 1 && rx === 7 ? 2 : size)) >>> 0;
          s = read(A[rx], size);
          A[ry] = (A[ry] - (size === 1 && ry === 7 ? 2 : size)) >>> 0;
          dst = { t: 'm', addr: A[ry] };
          d = read(A[ry], size);
        }
      } else {
        s = (D[rx] & MASK[size]) >>> 0;
        d = (D[ry] & MASK[size]) >>> 0;
        dst = { t: 'd', r: ry };
      }
      if (add) {
        const r = d + s + x;
        addFlags(s, d, r, size, true);
        put(dst, size, r);
      } else {
        const r = d - s - x;
        subFlags(s, d, r, size, true, true);
        put(dst, size, r);
      }
    }

    /** Lines 8, 9, B, C, D: OR/SUB/CMP/EOR/AND/ADD families. */
    function arith(op, line) {
      const reg = (op >> 9) & 7;
      const opmode = (op >> 6) & 7;
      const mode = (op >> 3) & 7;
      const ereg = op & 7;
      if (opmode === 3 || opmode === 7) {
        if (line === 0x8) return divide(op, opmode === 7);
        if (line === 0xc) return multiply(op, opmode === 7);
        // ADDA / SUBA / CMPA
        const size = opmode === 7 ? 4 : 2;
        const s = sext(get(ea(mode, ereg, size), size), size) >>> 0;
        const d = A[reg];
        if (line === 0xd) A[reg] = (d + s) >>> 0;
        else if (line === 0x9) A[reg] = (d - s) >>> 0;
        else subFlags(s, d, d - s, 4, false);
        return;
      }
      const size = SIZE_BITS[opmode & 3];
      const toEa = opmode >= 4;
      if (toEa && mode <= 1) {
        if (line === 0x8 && opmode === 4) return bcdOp(op, false); // SBCD
        if (line === 0xc && opmode === 4) return bcdOp(op, true); // ABCD
        if (line === 0xc && opmode >= 5) { // EXG
          const ry = op & 7;
          if (opmode === 5 && mode === 0) { const t = D[reg]; D[reg] = D[ry]; D[ry] = t; return; }
          if (opmode === 5 && mode === 1) { const t = A[reg]; A[reg] = A[ry]; A[ry] = t; return; }
          if (opmode === 6 && mode === 1) { const t = D[reg]; D[reg] = A[ry]; A[ry] = t; return; }
          throw new Trap(4, insnPc);
        }
        if (line === 0xd) return addxSubx(op, true);
        if (line === 0x9) return addxSubx(op, false);
        if (line === 0xb && mode === 1) { // CMPM
          const ax = op & 7;
          const sAddr = A[ax];
          A[ax] = (sAddr + (size === 1 && ax === 7 ? 2 : size)) >>> 0;
          const s = read(sAddr, size);
          const dAddr = A[reg];
          A[reg] = (dAddr + (size === 1 && reg === 7 ? 2 : size)) >>> 0;
          const d = read(dAddr, size);
          subFlags(s, d, d - s, size, false);
          return;
        }
        if (line === 0xb && mode === 0) { // EOR Dn,Dn
          const r = (D[ereg] ^ D[reg]) & MASK[size];
          nz(r, size);
          put({ t: 'd', r: ereg }, size, r);
          return;
        }
      }
      if (line === 0xb && toEa) { // EOR Dn,<ea>
        const e = ea(mode, ereg, size);
        const r = get(e, size) ^ D[reg];
        nz(r, size);
        put(e, size, r);
        return;
      }
      if (!toEa) {
        const e = ea(mode, ereg, size);
        if (e.t === 'a' && size === 1) throw new Trap(4, insnPc);
        const s = get(e, size);
        const d = (D[reg] & MASK[size]) >>> 0;
        let r;
        switch (line) {
          case 0x8: r = s | d; nz(r, size); break;
          case 0xc: r = s & d; nz(r, size); break;
          case 0x9: r = d - s; subFlags(s, d, r, size, true); break;
          case 0xd: r = d + s; addFlags(s, d, r, size); break;
          case 0xb: subFlags(s, d, d - s, size, false); return;
        }
        put({ t: 'd', r: reg }, size, r);
        return;
      }
      const e = ea(mode, ereg, size);
      const d = get(e, size);
      const s = (D[reg] & MASK[size]) >>> 0;
      let r;
      switch (line) {
        case 0x8: r = s | d; nz(r, size); break;
        case 0xc: r = s & d; nz(r, size); break;
        case 0x9: r = d - s; subFlags(s, d, r, size, true); break;
        case 0xd: r = d + s; addFlags(s, d, r, size); break;
      }
      put(e, size, r);
    }

    /** One shift/rotate step loop. kind: 0 AS 1 LS 2 ROX 3 RO. */
    function shift(v, size, count, left, kind) {
      const mask = MASK[size];
      const m = MSB[size];
      v = (v & mask) >>> 0;
      let c = 0;
      let x = sr & X ? 1 : 0;
      let ovf = false;
      if (count === 0) {
        let ccr = sr & X;
        if (kind === 2 && x) ccr |= C;
        if (v & m) ccr |= N;
        if (v === 0) ccr |= Z;
        setCCR(ccr);
        return v;
      }
      const bits = size * 8;
      if (kind === 0 && !left && count > bits) {
        // SingleStepTests: ASR past the operand width fills with the sign and
        // clears C and X (Musashi sets C = X = sign here instead).
        const r = v & m ? mask : 0;
        let ccr = 0;
        if (r & m) ccr |= N;
        if (r === 0) ccr |= Z;
        setCCR(ccr);
        return r >>> 0;
      }
      for (let i = 0; i < count; i++) {
        if (left) {
          const out = v & m ? 1 : 0;
          let inBit = 0;
          if (kind === 2) inBit = x;
          else if (kind === 3) inBit = out;
          const nv = (((v << 1) & mask) | inBit) >>> 0;
          if (kind === 0 && ((nv ^ v) & m)) ovf = true;
          v = nv;
          c = out;
          if (kind !== 3) x = out;
        } else {
          const out = v & 1;
          let inBit = 0;
          if (kind === 0) inBit = v & m ? 1 : 0;
          else if (kind === 2) inBit = x;
          else if (kind === 3) inBit = out;
          v = ((v >>> 1) | (inBit ? m : 0)) >>> 0;
          v = (v & mask) >>> 0;
          c = out;
          if (kind !== 3) x = out;
        }
      }
      let ccr = kind === 3 ? sr & X : (x ? X : 0);
      if (c) ccr |= C;
      if (v & m) ccr |= N;
      if (v === 0) ccr |= Z;
      if (ovf) ccr |= V;
      setCCR(ccr);
      return v;
    }

    function lineE(op) {
      const sz = (op >> 6) & 3;
      const left = (op & 0x100) !== 0;
      if (sz === 3) { // memory, word, by 1
        const kind = (op >> 9) & 3;
        if (op & 0x800) throw new Trap(4, insnPc);
        const e = ea((op >> 3) & 7, op & 7, 2);
        if (e.t !== 'm') throw new Trap(4, insnPc);
        const r = shift(get(e, 2), 2, 1, left, kind);
        put(e, 2, r);
        return;
      }
      const size = SIZE_BITS[sz];
      const kind = (op >> 3) & 3;
      const reg = op & 7;
      const c = (op >> 9) & 7;
      const count = op & 0x20 ? D[c] & 63 : (c || 8);
      const r = shift(D[reg], size, count, left, kind);
      put({ t: 'd', r: reg }, size, r);
    }

    function execute(op) {
      switch (op >> 12) {
        case 0x0: return line0(op);
        case 0x1: return move(op, 1);
        case 0x2: return move(op, 4);
        case 0x3: return move(op, 2);
        case 0x4: return line4(op);
        case 0x5: return line5(op);
        case 0x6: return line6(op);
        case 0x7:
          if (op & 0x100) throw new Trap(4, insnPc);
          D[(op >> 9) & 7] = sx8(op) >>> 0;
          nz(D[(op >> 9) & 7], 4);
          return;
        case 0x8: case 0x9: case 0xb: case 0xc: case 0xd: return arith(op, op >> 12);
        case 0xa: throw new Trap(10, insnPc);
        case 0xe: return lineE(op);
        default: throw new Trap(11, insnPc);
      }
    }

    // --- Exceptions -------------------------------------------------------------------
    function enterSupervisor() {
      const old = sr;
      setSR((sr | S_BIT) & ~T_BIT);
      return old;
    }
    function vectorJump(vector) {
      pc = read(vector * 4, 4);
    }
    function exception(vector, stackedPC) {
      const old = enterSupervisor();
      push(4, stackedPC);
      push(2, old);
      vectorJump(vector);
    }
    function addressError(err, stackedPC) {
      const old = enterSupervisor();
      push(4, stackedPC);
      push(2, old);
      push(2, ir);
      push(4, err.address);
      const fc = (old & S_BIT ? 4 : 0) | (err.instruction ? 2 : 1);
      push(2, (ir & 0xffe0) | (err.read ? 0x10 : 0) | (err.instruction ? 0x08 : 0) | fc);
      vectorJump(3);
    }

    /** Execute one instruction (and any exception it raises). */
    function step() {
      if (halted || stopped) return;
      insnPc = pc;
      aeAdjust = 0;
      try {
        ir = fetch();
        execute(ir);
        // A transfer to an odd address faults at once: the chip prefetches the
        // target as part of the branch/jump/return.
        if (pc & 1) throw new AddressError(pc, true, true);
      } catch (err) {
        if (err instanceof Trap) {
          try { exception(err.vector, err.pc); } catch (e2) { halted = true; }
        } else if (err instanceof AddressError) {
          try { addressError(err, addressErrorPC(err)); } catch (e2) { halted = true; }
        } else {
          throw err;
        }
      }
    }

    /**
     * PC stacked by an address error. On the chip it is the address of the last
     * prefetch read before the faulting access, minus 2. Model: every extension
     * word consumed so far advanced the prefetch by one word (pc - 2 here), plus
     * per-instruction adjustments (aeAdjust) where the microcode prefetches
     * earlier or later than that.
     */
    function addressErrorPC(err) {
      if (err.instruction) return (err.address - 4) >>> 0; // odd branch/jump/return target
      return (pc - 2 + aeAdjust) >>> 0;
    }

    function reset() {
      sr = S_BIT | 0x0700;
      halted = false;
      stopped = false;
      ssp = read(0, 4);
      A[7] = ssp;
      pc = read(4, 4);
    }

    return {
      D,
      A,
      step,
      reset,
      get pc() { return pc; },
      set pc(v) { pc = v >>> 0; },
      get sr() { return sr; },
      set sr(v) { setSR(v); },
      get usp() { return sup() ? usp : A[7]; },
      set usp(v) { if (sup()) usp = v >>> 0; else A[7] = v >>> 0; },
      get ssp() { return sup() ? A[7] : ssp; },
      set ssp(v) { if (sup()) A[7] = v >>> 0; else ssp = v >>> 0; },
      get halted() { return halted; },
      get stopped() { return stopped; },
      /** Load a full register state ({ d: [8], a: [7], usp, ssp, sr, pc }). */
      load(s) {
        for (let i = 0; i < 8; i++) D[i] = s.d[i] >>> 0;
        for (let i = 0; i < 7; i++) A[i] = s.a[i] >>> 0;
        usp = s.usp >>> 0;
        ssp = s.ssp >>> 0;
        sr = s.sr & SR_MASK;
        A[7] = sup() ? ssp : usp;
        pc = s.pc >>> 0;
        halted = false;
        stopped = false;
      }
    };
  }

  // --- Instruction naming (SingleStepTests groups) ----------------------------------------
  /**
   * Group name for an opcode, matching the SingleStepTests file names
   * (e.g. 'MOVE.w', 'Bcc', 'MOVEM.l', 'ANDItoSR'); null for illegal encodings.
   */
  function groupName(op) {
    const mode = (op >> 3) & 7;
    const sz = (op >> 6) & 3;
    const sizeName = ['.b', '.w', '.l'][sz];
    switch (op >> 12) {
      case 0x0: {
        if (op & 0x100) return mode === 1 ? (op & 0x40 ? 'MOVEP.l' : 'MOVEP.w') : ['BTST', 'BCHG', 'BCLR', 'BSET'][sz];
        const kind = (op >> 9) & 7;
        if (kind === 4) return ['BTST', 'BCHG', 'BCLR', 'BSET'][sz];
        if (sz === 3 || kind === 7) return null;
        const base = ['ORI', 'ANDI', 'SUBI', 'ADDI', null, 'EORI', 'CMPI'][kind];
        if (!base) return null;
        if ((op & 0x3f) === 0x3c && (kind === 0 || kind === 1 || kind === 5)) {
          const n = { 0: 'OR', 1: 'AND', 5: 'EOR' }[kind];
          return sz === 0 ? n + 'ItoCCR' : sz === 1 ? n + 'ItoSR' : null;
        }
        return { ORI: 'OR', ANDI: 'AND', SUBI: 'SUB', ADDI: 'ADD', EORI: 'EOR', CMPI: 'CMP' }[base] + sizeName;
      }
      case 0x1: case 0x2: case 0x3: {
        const sizeChar = { 1: '.b', 2: '.l', 3: '.w' }[op >> 12];
        return (((op >> 6) & 7) === 1 ? 'MOVEA' : 'MOVE') + sizeChar;
      }
      case 0x4: {
        if (op & 0x100) {
          if ((op & 0x1c0) === 0x1c0) return 'LEA';
          if ((op & 0x1c0) === 0x180) return 'CHK';
          return null;
        }
        const sub = (op >> 8) & 0xf;
        if (sub === 0) return sz === 3 ? 'MOVEfromSR' : 'NEGX' + sizeName;
        if (sub === 2) return sz === 3 ? null : 'CLR' + sizeName;
        if (sub === 4) return sz === 3 ? 'MOVEtoCCR' : 'NEG' + sizeName;
        if (sub === 6) return sz === 3 ? 'MOVEtoSR' : 'NOT' + sizeName;
        if (sub === 8) {
          if (sz === 0) return 'NBCD';
          if (sz === 1) return mode === 0 ? 'SWAP' : 'PEA';
          if (mode === 0) return sz === 2 ? 'EXT.w' : 'EXT.l';
          return sz === 2 ? 'MOVEM.w' : 'MOVEM.l';
        }
        if (sub === 0xa) return sz === 3 ? (op === 0x4afc ? 'ILLEGAL' : 'TAS') : 'TST' + sizeName;
        if (sub === 0xc) return sz === 2 ? 'MOVEM.w' : sz === 3 ? 'MOVEM.l' : null;
        if (sub === 0xe) {
          if (sz === 1) {
            if ((op & 0x30) === 0) return 'TRAP';
            if ((op & 0x38) === 0x10) return 'LINK';
            if ((op & 0x38) === 0x18) return 'UNLINK';
            if ((op & 0x38) === 0x20) return 'MOVEtoUSP';
            if ((op & 0x38) === 0x28) return 'MOVEfromUSP';
            return { 0x4e70: 'RESET', 0x4e71: 'NOP', 0x4e72: 'STOP', 0x4e73: 'RTE', 0x4e75: 'RTS', 0x4e76: 'TRAPV', 0x4e77: 'RTR' }[op] || null;
          }
          if (sz === 2) return 'JSR';
          if (sz === 3) return 'JMP';
        }
        return null;
      }
      case 0x5:
        if (sz === 3) return mode === 1 ? 'DBcc' : 'Scc';
        return (op & 0x100 ? 'SUB' : 'ADD') + sizeName; // ADDQ/SUBQ are bucketed with ADD/SUB
      case 0x6: return (op & 0x0f00) === 0x0100 ? 'BSR' : 'Bcc';
      case 0x7: return op & 0x100 ? null : 'MOVE.q';
      case 0xa: return 'LINEA';
      case 0xf: return 'LINEF';
      case 0xe: {
        if (sz === 3) {
          if (op & 0x800) return null;
          return ['AS', 'LS', 'ROX', 'RO'][(op >> 9) & 3] + (op & 0x100 ? 'L' : 'R') + '.w';
        }
        return ['AS', 'LS', 'ROX', 'RO'][(op >> 3) & 3] + (op & 0x100 ? 'L' : 'R') + sizeName;
      }
      default: {
        const line = op >> 12;
        const opmode = (op >> 6) & 7;
        const toEa = opmode >= 4;
        if (opmode === 3 || opmode === 7) {
          if (line === 0x8) return opmode === 7 ? 'DIVS' : 'DIVU';
          if (line === 0xc) return opmode === 7 ? 'MULS' : 'MULU';
          const n = { 0x9: 'SUBA', 0xb: 'CMPA', 0xd: 'ADDA' }[line];
          return n + (opmode === 7 ? '.l' : '.w');
        }
        const size = ['.b', '.w', '.l'][opmode & 3];
        if (toEa && mode <= 1) {
          if (line === 0x8 && opmode === 4) return 'SBCD';
          if (line === 0xc && opmode === 4) return 'ABCD';
          if (line === 0xc) return 'EXG';
          if (line === 0xd) return 'ADDX' + size;
          if (line === 0x9) return 'SUBX' + size;
          if (line === 0xb && mode === 1) return 'CMP' + size; // CMPM (bucketed with CMP)
        }
        if (line === 0xb) return (toEa ? 'EOR' : 'CMP') + size;
        return { 0x8: 'OR', 0x9: 'SUB', 0xc: 'AND', 0xd: 'ADD' }[line] + size;
      }
    }
  }

  return { create, groupName, SR_MASK };
});
