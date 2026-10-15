# 68000 core (`lib/audio/m68k-cpu.js`)

This is a Motorola 68000 interpreter written for NHL9X Studio, so that later steps can run the retail NHL '92 68k sound driver from ROM bytes. It works at the instruction level and has no cycle timing. It has no runtime dependencies and loads as a UMD module (Node `require` or a browser global `NhlM68k`).

## Interface

```js
const cpu = NhlM68k.create({ read8, read16, write8, write16, fetch16 /* optional */ });
cpu.load({ d: [8 values], a: [7 values], usp, ssp, sr, pc }); // or cpu.reset() from vectors 0/1
cpu.step();               // one instruction, including any exception it raises
cpu.D, cpu.A              // registers (A[7] is the active stack pointer)
cpu.pc, cpu.sr, cpu.usp, cpu.ssp, cpu.halted, cpu.stopped
NhlM68k.groupName(op)     // SingleStepTests group for an opcode, e.g. 'MOVE.w', 'Bcc'
```

The bus addresses are 24-bit. Word and long accesses at odd addresses raise an address error, as on the chip. A long access is two word accesses, high word first, except where the chip does otherwise (see below). `fetch16` serves instruction-stream reads; it defaults to `read16`.

## Scope

- **Implemented:** the full 68000 instruction set; user and supervisor modes with separate stack pointers; group 0 address-error frames; group 1/2 exceptions (TRAP, TRAPV, CHK, divide by zero, privilege violation, illegal instruction, line A and line F); RTE; STOP (`stopped`); and a double fault halting the CPU (`halted`).
- **Not modelled:**
  - cycle counts and the prefetch queue as state (the address-error stacked PC models its effect instead);
  - interrupts;
  - the trace exception (the T bit is never set in the suite);
  - bus errors;
  - RESET's external signal.

## Validation

`node test/m68k-singlestep.js` runs the [SingleStepTests 680x0](https://github.com/SingleStepTests/680x0) suite (68000/v1): about 8,000 randomly generated single-instruction tests for each of 124 operation groups. On first run it downloads the suite into `out/singlesteptests-680x0` (git-ignored, about 200 MB); nothing from the suite is committed.

A test passes when D0–D7, A0–A6, USP, SSP, SR, PC and every RAM byte in the expected final state match, and no other byte was written. Prefetch contents and cycle counts aren't compared. Address-error tests are reported separately; they are the ones whose bus trace reads vector 3.

The latest results are in [`docs/M68K-SINGLESTEP-REPORT.md`](M68K-SINGLESTEP-REPORT.md): **1,000,057 of 1,000,060 tests pass**, including all 178,090 address-error tests. All 46 instruction groups the NHL 92 sound code uses pass 100%.

The 3 failures:

- **`ASL.b` tests 1583 and 1761** (`e502`, ASL.b #2,D2): the expected final D2 differs from the initial value in all 32 bits, but ASL.b only changes the low byte. The expected SR (V and C) doesn't follow from the byte either. These look like errors in the suite's expected values, so the core isn't changed for them.
- **`DIVU` test 5745** (DIVU (d16,A7),D0, divide by zero): the suite stacks the instruction's own address, where the manual and every other divide-by-zero case stack the next instruction's address. It's the only divide-by-zero case in DIVU or DIVS that isn't also an address error, so one example isn't enough to set a rule. It's left as is.

`node test.js` also runs the fast checks in `test/m68k-cpu.js`, which need no download. They cover hand-encoded instructions and exceptions, and a sweep of the sound code.

## The NHL '92 sound code

`test/m68k-driver-ops.js` decodes the sound module's code ranges from the ROM bytes: `$F4C8`–`$FA91`, `$FB1E`–`$FF73` and `$11624`–`$116A5`. The decode must land exactly on each range end. The result is 680 instructions in 46 groups:

ADD.b/w/l, ADDA.w/l, AND.b/w, BCLR, BSET, BTST, BSR, Bcc, CLR.b/w/l, CMP.b/w/l, DBcc, EXT.w/l, JMP, LEA, LSL.w/l, LSR.b/w/l, MOVE.b/w/l, MOVE.q (MOVEQ), MOVEA.w/l, MOVEM.l, MULS, MULU, OR.b/w/l, RTS, SUB.b/w, Scc, TST.b/w.

The suite buckets ADDQ and ADDI with ADD, SUBQ and SUBI with SUB, CMPI and CMPM with CMP, and ORI, ANDI and EORI with their base operations.

## Behaviour taken from the suite rather than the manual

The manual leaves these undefined or describes them loosely. The core follows the suite, which was checked against every case:

- **ABCD, SBCD and NBCD:** the low digit is corrected on a low-nibble carry or borrow. The high digit is corrected when the *binary* result goes past `$99` (add) or below zero (subtract). V is set when the correction flips bit 7 the opposite way.
- **DIVU and DIVS overflow:** V is set and C cleared; X, N and Z are left unchanged.
- **CHK:** Z, V and C are cleared. N is set if the value is below zero, cleared if it's above the bound, and left unchanged when the value is in range.
- **ASR past the operand width:** the result is filled with the sign bit, and C and X are cleared. Musashi sets C = X = sign here instead.
- **Address errors:**
  - **Status word:** the instruction-register bits, plus R/W, plus bit 3 for instruction fetches, plus the function code.
  - **Access address:** the full 32-bit address.
  - **Stacked PC:** the address of the last prefetch read before the faulting access, minus 2. This is modelled as one prefetch per extension word consumed, with three adjustments:
    - MOVE to `-(An)` prefetches before its write;
    - MOVE from memory to `(xxx).l` writes before its last address-word prefetch;
    - a branch, jump or return to an odd address faults at once, with stacked PC = target − 4. JSR checks the target before pushing the return address.
  - **Word order:** MOVE.l, ADDX.l and SUBX.l with `-(An)` access the low word first. MOVEM.l to `-(An)` writes each register's low word first. A faulting `(An)+` MOVE destination leaves An unchanged. A faulting MOVEM `(An)+` load leaves An = base + 2.
