/**
 * Sony SPC700 interpreter (the SNES audio CPU) with a cycle count per instruction.
 *
 * Written for NHL9X Studio so the SNES NHL '93 / '94 sound drivers can run from their own code. Covers all 256
 * opcodes. Validated against the SingleStepTests SPC700 suite: node test/spc700-singlestep.js.
 *
 * Bus: create({ read(addr), write(addr, value) }) with 16-bit addresses; the core never touches memory except
 * through it, so the caller maps RAM, the I/O window ($F0-$FF) and the boot ROM (lib/audio/snes-spc.js does).
 * step() runs one instruction and returns the cycles it took (the SPC700 runs at 1.024 MHz, 2-12 cycles each;
 * a taken branch costs 2 more). The cycle count is the instruction's total; the order of its individual bus
 * accesses (including the dummy reads the real chip makes) is not modelled, which only matters for reads with side
 * effects at $F0-$FF in the middle of a read-modify-write instruction.
 *
 * Registers: a, x, y, sp (page 1), pc, psw with N=$80 V=$40 P=$20 (direct page at $100) B=$10 H=$08 I=$04 Z=$02 C=$01.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSpc700 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var N = 0x80, V = 0x40, P = 0x20, B = 0x10, H = 0x08, I = 0x04, Z = 0x02, C = 0x01;

  // Base cycles per opcode (a taken branch adds 2).
  var CYCLES = [
    2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 4, 6, 8, // 00
    2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 6, 5, 2, 2, 4, 6, // 10
    2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 4, 5, 4, // 20
    2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 6, 5, 2, 2, 3, 8, // 30
    2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 4, 6, 6, // 40
    2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 4, 5, 2, 2, 4, 3, // 50
    2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 4, 5, 5, // 60
    2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 3, 6, // 70
    2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 2, 4, 5, // 80
    2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 12, 5, // 90
    3, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 2, 4, 4, // A0
    2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 3, 4, // B0
    3, 8, 4, 5, 4, 5, 4, 7, 2, 5, 6, 4, 5, 2, 4, 9, // C0
    2, 8, 4, 5, 5, 6, 6, 7, 4, 5, 5, 5, 2, 2, 6, 3, // D0
    2, 8, 4, 5, 3, 4, 3, 6, 2, 4, 5, 3, 4, 3, 4, 7, // E0
    2, 8, 4, 5, 4, 5, 5, 6, 3, 4, 5, 4, 2, 2, 4, 7 // F0
  ];

  /** Mnemonic per opcode, for tests and the docs (SingleStepTests groups opcodes by number). */
  var NAMES = (function () {
    var n = new Array(256);
    var alu = ['OR', 'AND', 'EOR', 'CMP', 'ADC', 'SBC'];
    var forms = { 4: 'A,d', 5: 'A,!a', 6: 'A,(X)', 7: 'A,[d+X]', 8: 'A,#i', 9: 'dd,ds' };
    var forms2 = { 4: 'A,d+X', 5: 'A,!a+X', 6: 'A,!a+Y', 7: 'A,[d]+Y', 8: 'd,#i', 9: '(X),(Y)' };
    for (var op = 0; op < 256; op++) {
      var lo = op & 15;
      var hi = op >> 4;
      if (op < 0xc0 && lo >= 4 && lo <= 9) n[op] = alu[op >> 5] + ' ' + ((hi & 1) ? forms2 : forms)[lo];
      else if (lo === 1) n[op] = 'TCALL ' + hi;
      else if (lo === 2 && op < 0x100) n[op] = ((hi & 1) ? 'CLR1' : 'SET1') + ' d.' + (hi >> 1);
      else if (lo === 3) n[op] = ((hi & 1) ? 'BBC' : 'BBS') + ' d.' + (hi >> 1) + ',r';
    }
    var m = {
      0x00: 'NOP', 0x0a: 'OR1 C,m.b', 0x0b: 'ASL d', 0x0c: 'ASL !a', 0x0d: 'PUSH PSW', 0x0e: 'TSET1 !a', 0x0f: 'BRK',
      0x10: 'BPL r', 0x1a: 'DECW d', 0x1b: 'ASL d+X', 0x1c: 'ASL A', 0x1d: 'DEC X', 0x1e: 'CMP X,!a', 0x1f: 'JMP [!a+X]',
      0x20: 'CLRP', 0x2a: 'OR1 C,/m.b', 0x2b: 'ROL d', 0x2c: 'ROL !a', 0x2d: 'PUSH A', 0x2e: 'CBNE d,r', 0x2f: 'BRA r',
      0x30: 'BMI r', 0x3a: 'INCW d', 0x3b: 'ROL d+X', 0x3c: 'ROL A', 0x3d: 'INC X', 0x3e: 'CMP X,d', 0x3f: 'CALL !a',
      0x40: 'SETP', 0x4a: 'AND1 C,m.b', 0x4b: 'LSR d', 0x4c: 'LSR !a', 0x4d: 'PUSH X', 0x4e: 'TCLR1 !a', 0x4f: 'PCALL u',
      0x50: 'BVC r', 0x5a: 'CMPW YA,d', 0x5b: 'LSR d+X', 0x5c: 'LSR A', 0x5d: 'MOV X,A', 0x5e: 'CMP Y,!a', 0x5f: 'JMP !a',
      0x60: 'CLRC', 0x6a: 'AND1 C,/m.b', 0x6b: 'ROR d', 0x6c: 'ROR !a', 0x6d: 'PUSH Y', 0x6e: 'DBNZ d,r', 0x6f: 'RET',
      0x70: 'BVS r', 0x7a: 'ADDW YA,d', 0x7b: 'ROR d+X', 0x7c: 'ROR A', 0x7d: 'MOV A,X', 0x7e: 'CMP Y,d', 0x7f: 'RETI',
      0x80: 'SETC', 0x8a: 'EOR1 C,m.b', 0x8b: 'DEC d', 0x8c: 'DEC !a', 0x8d: 'MOV Y,#i', 0x8e: 'POP PSW', 0x8f: 'MOV d,#i',
      0x90: 'BCC r', 0x9a: 'SUBW YA,d', 0x9b: 'DEC d+X', 0x9c: 'DEC A', 0x9d: 'MOV X,SP', 0x9e: 'DIV YA,X', 0x9f: 'XCN A',
      0xa0: 'EI', 0xaa: 'MOV1 C,m.b', 0xab: 'INC d', 0xac: 'INC !a', 0xad: 'CMP Y,#i', 0xae: 'POP A', 0xaf: 'MOV (X)+,A',
      0xb0: 'BCS r', 0xba: 'MOVW YA,d', 0xbb: 'INC d+X', 0xbc: 'INC A', 0xbd: 'MOV SP,X', 0xbe: 'DAS A', 0xbf: 'MOV A,(X)+',
      0xc0: 'DI', 0xc4: 'MOV d,A', 0xc5: 'MOV !a,A', 0xc6: 'MOV (X),A', 0xc7: 'MOV [d+X],A', 0xc8: 'CMP X,#i', 0xc9: 'MOV !a,X',
      0xca: 'MOV1 m.b,C', 0xcb: 'MOV d,Y', 0xcc: 'MOV !a,Y', 0xcd: 'MOV X,#i', 0xce: 'POP X', 0xcf: 'MUL YA',
      0xd0: 'BNE r', 0xd4: 'MOV d+X,A', 0xd5: 'MOV !a+X,A', 0xd6: 'MOV !a+Y,A', 0xd7: 'MOV [d]+Y,A', 0xd8: 'MOV d,X', 0xd9: 'MOV d+Y,X',
      0xda: 'MOVW d,YA', 0xdb: 'MOV d+X,Y', 0xdc: 'DEC Y', 0xdd: 'MOV A,Y', 0xde: 'CBNE d+X,r', 0xdf: 'DAA A',
      0xe0: 'CLRV', 0xe4: 'MOV A,d', 0xe5: 'MOV A,!a', 0xe6: 'MOV A,(X)', 0xe7: 'MOV A,[d+X]', 0xe8: 'MOV A,#i', 0xe9: 'MOV X,!a',
      0xea: 'NOT1 m.b', 0xeb: 'MOV Y,d', 0xec: 'MOV Y,!a', 0xed: 'NOTC', 0xee: 'POP Y', 0xef: 'SLEEP',
      0xf0: 'BEQ r', 0xf4: 'MOV A,d+X', 0xf5: 'MOV A,!a+X', 0xf6: 'MOV A,!a+Y', 0xf7: 'MOV A,[d]+Y', 0xf8: 'MOV X,d', 0xf9: 'MOV X,d+Y',
      0xfa: 'MOV dd,ds', 0xfb: 'MOV Y,d+X', 0xfc: 'INC Y', 0xfd: 'MOV Y,A', 0xfe: 'DBNZ Y,r', 0xff: 'STOP'
    };
    Object.keys(m).forEach(function (k) { n[Number(k)] = m[k]; });
    return n;
  })();

  /** SingleStepTests-style group of an opcode: the mnemonic without operands, e.g. 'MOV', 'ADC', 'BBS'. */
  function groupName(op) {
    var s = NAMES[op];
    return s.split(' ')[0];
  }

  function create(bus) {
    var a = 0, x = 0, y = 0, sp = 0xef, pc = 0, psw = 0;
    var halted = false;

    var rd = function (ad) { return bus.read(ad & 0xffff) & 0xff; };
    var wr = function (ad, v) { bus.write(ad & 0xffff, v & 0xff); };
    var rd16 = function (ad) { return rd(ad) | (rd(ad + 1) << 8); };

    function setNZ(v) { psw = (psw & ~(N | Z)) | (v & 0x80) | ((v & 0xff) === 0 ? Z : 0); }
    function setF(f, on) { psw = on ? psw | f : psw & ~f; }

    var fetch = function () { var v = rd(pc); pc = (pc + 1) & 0xffff; return v; };
    var fetch16 = function () { var l = fetch(); return l | (fetch() << 8); };
    var dpBase = function () { return psw & P ? 0x100 : 0; };
    var dp = function (o) { return dpBase() | (o & 0xff); };
    var push = function (v) { wr(0x100 | sp, v); sp = (sp - 1) & 0xff; };
    var pop = function () { sp = (sp + 1) & 0xff; return rd(0x100 | sp); };

    // --- effective addresses (each consumes its operand bytes) ---
    function eaD() { return dp(fetch()); }
    function eaDX() { return dp(fetch() + x); }
    function eaDY() { return dp(fetch() + y); }
    function eaAbs() { return fetch16(); }
    function eaAbsX() { return (fetch16() + x) & 0xffff; }
    function eaAbsY() { return (fetch16() + y) & 0xffff; }
    function eaIndX() { return dp(x); }
    function eaIndDX() { var o = (fetch() + x) & 0xff; return rd(dp(o)) | (rd(dp(o + 1)) << 8); }
    function eaIndDY() { var o = fetch(); return ((rd(dp(o)) | (rd(dp(o + 1)) << 8)) + y) & 0xffff; }

    // --- ALU on 8 bits ---
    function adc(l, r) {
      var c = psw & C;
      var s = l + r + c;
      setF(H, ((l & 15) + (r & 15) + c) > 15);
      setF(V, (~(l ^ r) & (l ^ s) & 0x80) !== 0);
      setF(C, s > 0xff);
      s &= 0xff;
      setNZ(s);
      return s;
    }
    function sbc(l, r) { return adc(l, r ^ 0xff); }
    function cmp(l, r) {
      var s = l - r;
      setF(C, s >= 0);
      setNZ(s & 0xff);
    }
    var ALU = [
      function (l, r) { var v = l | r; setNZ(v); return v; },
      function (l, r) { var v = l & r; setNZ(v); return v; },
      function (l, r) { var v = l ^ r; setNZ(v); return v; },
      function (l, r) { cmp(l, r); return l; },
      adc,
      sbc
    ];

    function asl(v) { setF(C, (v & 0x80) !== 0); v = (v << 1) & 0xff; setNZ(v); return v; }
    function lsr(v) { setF(C, (v & 1) !== 0); v >>= 1; setNZ(v); return v; }
    function rol(v) { var c = psw & C; setF(C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xff; setNZ(v); return v; }
    function ror(v) { var c = psw & C; setF(C, (v & 1) !== 0); v = (v >> 1) | (c << 7); setNZ(v); return v; }
    function inc(v) { v = (v + 1) & 0xff; setNZ(v); return v; }
    function dec(v) { v = (v - 1) & 0xff; setNZ(v); return v; }
    var RMW = { 0: asl, 1: rol, 2: lsr, 3: ror, 4: dec, 5: inc };

    function branch(cond, cycles) {
      var o = fetch();
      if (!cond) return cycles;
      pc = (pc + ((o ^ 0x80) - 0x80)) & 0xffff;
      return cycles + 2;
    }

    function bitAddr() { var m = fetch16(); return { ad: m & 0x1fff, bit: m >> 13 }; }

    function step() {
      if (halted) return 3;
      var op = fetch();
      var cyc = CYCLES[op];
      var ad, v, w, r;

      // The six ALU rows: OR AND EOR CMP ADC SBC x 12 addressing forms.
      if (op < 0xc0 && (op & 15) >= 4 && (op & 15) <= 9) {
        var f = ALU[op >> 5];
        var cmpRow = (op >> 5) === 3;
        var form = op & 15;
        if (op & 0x10) {
          if (form === 4) { a = f(a, rd(eaDX())); }
          else if (form === 5) { a = f(a, rd(eaAbsX())); }
          else if (form === 6) { a = f(a, rd(eaAbsY())); }
          else if (form === 7) { a = f(a, rd(eaIndDY())); }
          else if (form === 8) { v = fetch(); ad = eaD(); w = f(rd(ad), v); if (!cmpRow) wr(ad, w); }
          else { ad = eaIndX(); r = dp(y); w = f(rd(ad), rd(r)); if (!cmpRow) wr(ad, w); }
        } else if (form === 4) a = f(a, rd(eaD()));
        else if (form === 5) a = f(a, rd(eaAbs()));
        else if (form === 6) a = f(a, rd(eaIndX()));
        else if (form === 7) a = f(a, rd(eaIndDX()));
        else if (form === 8) a = f(a, fetch());
        else { v = rd(dp(fetch())); ad = eaD(); w = f(rd(ad), v); if (!cmpRow) wr(ad, w); }
        return cyc;
      }

      switch (op) {
        case 0x00: break; // NOP
        // TCALL n
        case 0x01: case 0x11: case 0x21: case 0x31: case 0x41: case 0x51: case 0x61: case 0x71:
        case 0x81: case 0x91: case 0xa1: case 0xb1: case 0xc1: case 0xd1: case 0xe1: case 0xf1:
          push(pc >> 8); push(pc & 0xff);
          pc = rd16(0xffde - 2 * (op >> 4));
          break;
        // SET1 / CLR1 d.b
        case 0x02: case 0x22: case 0x42: case 0x62: case 0x82: case 0xa2: case 0xc2: case 0xe2:
          ad = eaD(); wr(ad, rd(ad) | (1 << (op >> 5)));
          break;
        case 0x12: case 0x32: case 0x52: case 0x72: case 0x92: case 0xb2: case 0xd2: case 0xf2:
          ad = eaD(); wr(ad, rd(ad) & ~(1 << (op >> 5)));
          break;
        // BBS / BBC d.b,r
        case 0x03: case 0x23: case 0x43: case 0x63: case 0x83: case 0xa3: case 0xc3: case 0xe3:
          v = rd(eaD()); cyc = branch(((v >> (op >> 5)) & 1) === 1, 5);
          break;
        case 0x13: case 0x33: case 0x53: case 0x73: case 0x93: case 0xb3: case 0xd3: case 0xf3:
          v = rd(eaD()); cyc = branch(((v >> (op >> 5)) & 1) === 0, 5);
          break;
        // shifts and rotates, INC/DEC
        case 0x0b: case 0x2b: case 0x4b: case 0x6b: case 0x8b: case 0xab:
          ad = eaD(); wr(ad, RMW[op >> 5](rd(ad)));
          break;
        case 0x0c: case 0x2c: case 0x4c: case 0x6c: case 0x8c: case 0xac:
          ad = eaAbs(); wr(ad, RMW[op >> 5](rd(ad)));
          break;
        case 0x1b: case 0x3b: case 0x5b: case 0x7b: case 0x9b: case 0xbb:
          ad = eaDX(); wr(ad, RMW[op >> 5](rd(ad)));
          break;
        case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0x9c: case 0xbc:
          a = RMW[op >> 5](a);
          break;
        case 0x1d: x = dec(x); break;
        case 0x3d: x = inc(x); break;
        case 0xdc: y = dec(y); break;
        case 0xfc: y = inc(y); break;
        case 0x0d: push(psw); break;
        case 0x2d: push(a); break;
        case 0x4d: push(x); break;
        case 0x6d: push(y); break;
        case 0x8e: psw = pop(); break;
        case 0xae: a = pop(); break;
        case 0xce: x = pop(); break;
        case 0xee: y = pop(); break;
        // bit ops on memory
        case 0x0a: { var m0 = bitAddr(); if ((rd(m0.ad) >> m0.bit) & 1) psw |= C; } break;
        case 0x2a: { var m1 = bitAddr(); if (!((rd(m1.ad) >> m1.bit) & 1)) psw |= C; } break;
        case 0x4a: { var m2 = bitAddr(); if (!((rd(m2.ad) >> m2.bit) & 1)) psw &= ~C; } break;
        case 0x6a: { var m3 = bitAddr(); if ((rd(m3.ad) >> m3.bit) & 1) psw &= ~C; } break;
        case 0x8a: { var m4 = bitAddr(); if ((rd(m4.ad) >> m4.bit) & 1) psw ^= C; } break;
        case 0xaa: { var m5 = bitAddr(); setF(C, ((rd(m5.ad) >> m5.bit) & 1) === 1); } break;
        case 0xca: { var m6 = bitAddr(); v = rd(m6.ad); v = (psw & C) ? v | (1 << m6.bit) : v & ~(1 << m6.bit); wr(m6.ad, v); } break;
        case 0xea: { var m7 = bitAddr(); wr(m7.ad, rd(m7.ad) ^ (1 << m7.bit)); } break;
        case 0x0e: ad = eaAbs(); v = rd(ad); setNZ((a - v) & 0xff); wr(ad, v | a); break; // TSET1
        case 0x4e: ad = eaAbs(); v = rd(ad); setNZ((a - v) & 0xff); wr(ad, v & ~a); break; // TCLR1
        case 0x0f: // BRK
          push(pc >> 8); push(pc & 0xff); push(psw);
          psw = (psw | B) & ~I;
          pc = rd16(0xffde);
          break;
        // conditional branches
        case 0x10: cyc = branch(!(psw & N), 2); break;
        case 0x30: cyc = branch((psw & N) !== 0, 2); break;
        case 0x50: cyc = branch(!(psw & V), 2); break;
        case 0x70: cyc = branch((psw & V) !== 0, 2); break;
        case 0x90: cyc = branch(!(psw & C), 2); break;
        case 0xb0: cyc = branch((psw & C) !== 0, 2); break;
        case 0xd0: cyc = branch(!(psw & Z), 2); break;
        case 0xf0: cyc = branch((psw & Z) !== 0, 2); break;
        case 0x2f: cyc = branch(true, 2); break;
        case 0x2e: v = rd(eaD()); cyc = branch(a !== v, 5); break; // CBNE d,r
        case 0xde: v = rd(eaDX()); cyc = branch(a !== v, 6); break; // CBNE d+X,r
        case 0x6e: ad = eaD(); v = (rd(ad) - 1) & 0xff; wr(ad, v); cyc = branch(v !== 0, 5); break; // DBNZ d,r
        case 0xfe: y = (y - 1) & 0xff; cyc = branch(y !== 0, 4); break; // DBNZ Y,r
        // flags
        case 0x20: psw &= ~P; break;
        case 0x40: psw |= P; break;
        case 0x60: psw &= ~C; break;
        case 0x80: psw |= C; break;
        case 0xa0: psw |= I; break;
        case 0xc0: psw &= ~I; break;
        case 0xe0: psw &= ~(V | H); break;
        case 0xed: psw ^= C; break;
        // jumps
        case 0x1f: ad = (fetch16() + x) & 0xffff; pc = rd16(ad); break;
        case 0x3f: ad = fetch16(); push(pc >> 8); push(pc & 0xff); pc = ad; break;
        case 0x4f: v = fetch(); push(pc >> 8); push(pc & 0xff); pc = 0xff00 | v; break;
        case 0x5f: pc = fetch16(); break;
        case 0x6f: v = pop(); pc = v | (pop() << 8); break;
        case 0x7f: psw = pop(); v = pop(); pc = v | (pop() << 8); break;
        // CMP X / Y
        case 0xc8: cmp(x, fetch()); break;
        case 0x3e: cmp(x, rd(eaD())); break;
        case 0x1e: cmp(x, rd(eaAbs())); break;
        case 0xad: cmp(y, fetch()); break;
        case 0x7e: cmp(y, rd(eaD())); break;
        case 0x5e: cmp(y, rd(eaAbs())); break;
        // loads
        case 0xe4: a = rd(eaD()); setNZ(a); break;
        case 0xe5: a = rd(eaAbs()); setNZ(a); break;
        case 0xe6: a = rd(eaIndX()); setNZ(a); break;
        case 0xe7: a = rd(eaIndDX()); setNZ(a); break;
        case 0xe8: a = fetch(); setNZ(a); break;
        case 0xf4: a = rd(eaDX()); setNZ(a); break;
        case 0xf5: a = rd(eaAbsX()); setNZ(a); break;
        case 0xf6: a = rd(eaAbsY()); setNZ(a); break;
        case 0xf7: a = rd(eaIndDY()); setNZ(a); break;
        case 0xbf: a = rd(dp(x)); x = (x + 1) & 0xff; setNZ(a); break;
        case 0xcd: x = fetch(); setNZ(x); break;
        case 0xf8: x = rd(eaD()); setNZ(x); break;
        case 0xe9: x = rd(eaAbs()); setNZ(x); break;
        case 0xf9: x = rd(eaDY()); setNZ(x); break;
        case 0x8d: y = fetch(); setNZ(y); break;
        case 0xeb: y = rd(eaD()); setNZ(y); break;
        case 0xec: y = rd(eaAbs()); setNZ(y); break;
        case 0xfb: y = rd(eaDX()); setNZ(y); break;
        // stores
        case 0xc4: wr(eaD(), a); break;
        case 0xc5: wr(eaAbs(), a); break;
        case 0xc6: wr(eaIndX(), a); break;
        case 0xc7: wr(eaIndDX(), a); break;
        case 0xd4: wr(eaDX(), a); break;
        case 0xd5: wr(eaAbsX(), a); break;
        case 0xd6: wr(eaAbsY(), a); break;
        case 0xd7: wr(eaIndDY(), a); break;
        case 0xaf: wr(dp(x), a); x = (x + 1) & 0xff; break;
        case 0xd8: wr(eaD(), x); break;
        case 0xc9: wr(eaAbs(), x); break;
        case 0xd9: wr(eaDY(), x); break;
        case 0xcb: wr(eaD(), y); break;
        case 0xcc: wr(eaAbs(), y); break;
        case 0xdb: wr(eaDX(), y); break;
        case 0x8f: v = fetch(); wr(eaD(), v); break; // MOV d,#i
        case 0xfa: v = rd(dp(fetch())); wr(eaD(), v); break; // MOV dd,ds
        // register moves
        case 0x5d: x = a; setNZ(x); break;
        case 0x7d: a = x; setNZ(a); break;
        case 0xdd: a = y; setNZ(a); break;
        case 0xfd: y = a; setNZ(y); break;
        case 0x9d: x = sp; setNZ(x); break;
        case 0xbd: sp = x; break;
        // 16-bit
        case 0xba: { ad = eaD(); var lo = rd(ad); var hi = rd(dp((ad & 0xff) + 1)); a = lo; y = hi; psw = (psw & ~(N | Z)) | (y & 0x80) | (((y << 8) | a) === 0 ? Z : 0); } break;
        case 0xda: { ad = eaD(); wr(ad, a); wr(dp((ad & 0xff) + 1), y); } break;
        case 0x3a: case 0x1a: {
          ad = eaD();
          var o = ad & 0xff;
          w = (rd(ad) | (rd(dp(o + 1)) << 8));
          w = (op === 0x3a ? w + 1 : w - 1) & 0xffff;
          wr(ad, w & 0xff); wr(dp(o + 1), w >> 8);
          psw = (psw & ~(N | Z)) | ((w >> 8) & 0x80) | (w === 0 ? Z : 0);
        } break;
        case 0x5a: { // CMPW YA,d
          ad = eaD();
          w = rd(ad) | (rd(dp((ad & 0xff) + 1)) << 8);
          var ya = (y << 8) | a;
          var d16 = ya - w;
          setF(C, d16 >= 0);
          d16 &= 0xffff;
          psw = (psw & ~(N | Z)) | ((d16 >> 8) & 0x80) | (d16 === 0 ? Z : 0);
        } break;
        case 0x7a: case 0x9a: { // ADDW / SUBW YA,d
          ad = eaD();
          var l8 = rd(ad);
          var h8 = rd(dp((ad & 0xff) + 1));
          if (op === 0x7a) {
            psw &= ~C;
            a = adc(a, l8);
            y = adc(y, h8);
          } else {
            psw |= C;
            a = sbc(a, l8);
            y = sbc(y, h8);
          }
          psw = (psw & ~(N | Z)) | (y & 0x80) | (((y << 8) | a) === 0 ? Z : 0);
        } break;
        case 0xcf: w = y * a; a = w & 0xff; y = w >> 8; setNZ(y); break; // MUL YA
        case 0x9e: { // DIV YA,X
          var yva = (y << 8) | a;
          setF(H, (y & 15) >= (x & 15));
          setF(V, y >= x);
          if (y < (x << 1)) {
            if (x === 0) { a = 0xff; y = a; } else { a = Math.floor(yva / x) & 0xff; y = yva % x; }
          } else {
            a = (255 - Math.floor((yva - (x << 9)) / (256 - x))) & 0xff;
            y = (x + ((yva - (x << 9)) % (256 - x))) & 0xff;
          }
          setNZ(a);
        } break;
        case 0x9f: a = ((a << 4) | (a >> 4)) & 0xff; setNZ(a); break; // XCN
        case 0xdf: // DAA
          if ((psw & C) || a > 0x99) { a = (a + 0x60) & 0xff; psw |= C; }
          if ((psw & H) || (a & 15) > 9) a = (a + 6) & 0xff;
          setNZ(a);
          break;
        case 0xbe: // DAS
          if (!(psw & C) || a > 0x99) { a = (a - 0x60) & 0xff; psw &= ~C; }
          if (!(psw & H) || (a & 15) > 9) a = (a - 6) & 0xff;
          setNZ(a);
          break;
        case 0xef: case 0xff: halted = true; break; // SLEEP, STOP
        default: throw new Error('unhandled SPC700 opcode ' + op.toString(16));
      }
      return cyc;
    }

    return {
      step: step,
      load: function (s) {
        a = s.a & 0xff; x = s.x & 0xff; y = s.y & 0xff; sp = s.sp & 0xff; pc = s.pc & 0xffff; psw = s.psw & 0xff;
        halted = false;
      },
      get a() { return a; }, set a(v) { a = v & 0xff; },
      get x() { return x; }, set x(v) { x = v & 0xff; },
      get y() { return y; }, set y(v) { y = v & 0xff; },
      get sp() { return sp; }, set sp(v) { sp = v & 0xff; },
      get pc() { return pc; }, set pc(v) { pc = v & 0xffff; },
      get psw() { return psw; }, set psw(v) { psw = v & 0xff; },
      get halted() { return halted; }, set halted(v) { halted = !!v; }
    };
  }

  return { create: create, CYCLES: CYCLES, NAMES: NAMES, groupName: groupName, N: N, V: V, P: P, B: B, H: H, I: I, Z: Z, C: C };
});
