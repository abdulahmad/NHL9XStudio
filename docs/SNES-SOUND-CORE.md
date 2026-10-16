# SNES sound hardware (`spc700-cpu.js`, `snes-spc.js`, `snes-dsp.js`)

Step 1 of the SNES sound work: the sound hardware of the SNES as plain JS modules, with no runtime dependency, so that later steps can run the NHL '93 and NHL '94 SNES sound programs (93S/94S) from their own bytes. This step contains **no driver, no data parsing, no MIDI and no UI**, and nothing was captured from a retail game, a console or an emulator. Whether it sounds right is checked by ear in a later step.

| File | What it is |
|---|---|
| `lib/audio/spc700-cpu.js` | The SPC700 CPU: all 256 opcodes, flags, cycles per instruction. |
| `lib/audio/snes-spc.js` | The sound unit: 64 KB audio RAM, boot ROM, four CPU ports, three timers, the `$F0`–`$FF` window with the DSP address/data pair, and the clock that paces the DSP. |
| `lib/audio/snes-dsp.js` | The S-DSP: 8 voices at 32 kHz, BRR, pitch (with modulation), ADSR/GAIN, noise, echo with the FIR filter, main and echo volume. |
| `test/spc700-singlestep.js` | Runs the SingleStepTests SPC700 suite (downloads it into git-ignored `out/`; not part of `node test.js`). |
| `docs/SPC700-SINGLESTEP-REPORT.md` | The latest result of that run, per instruction group and per opcode. |
| `test/spc700-cpu.js`, `test/snes-spc.js`, `test/snes-dsp.js` | Fast hand-checked tests, part of `node test.js`. |
| `test/spc700-driver-ops.js`, `tools/scan-spc700-driver-ops.js` | The SPC700 opcodes the 93S and 94S sound programs use, and the script that finds them. |

All three modules are UMD (Node `require` or the browser globals `NhlSpc700`, `NhlSnesSpc`, `NhlSnesDsp`). `snes-dsp.js` and `spc700-cpu.js` are standalone; `snes-spc.js` uses both.

## SPC700 CPU

```js
const cpu = NhlSpc700.create({ read(addr), write(addr, value) }); // 16-bit addresses
cpu.load({ a, x, y, sp, pc, psw });
const cycles = cpu.step();   // one instruction; returns its cycle count (2-12, +2 for a taken branch)
cpu.a, cpu.x, cpu.y, cpu.sp, cpu.pc, cpu.psw, cpu.halted
NhlSpc700.CYCLES, NhlSpc700.NAMES, NhlSpc700.groupName(op)
```

- **Implemented:** the full instruction set, including `DIV`'s overflow behaviour, `DAA`/`DAS`, the 13-bit-address bit operations, `TSET1`/`TCLR1`, `TCALL`/`PCALL`, `BRK`, `ADDW`/`SUBW`/`CMPW` and direct-page wrap (the high byte of a 16-bit direct-page access wraps inside the page). `SLEEP` and `STOP` halt the core.
- **Cycles:** each instruction returns its total cycle count. The order of the individual bus accesses (including the dummy reads the real chip makes) is **not** modelled. That only matters for a read with side effects at `$F0`–`$FF` inside a read-modify-write instruction, such as the timer outputs `$FD`–`$FF` being cleared by an `INC`.
- **Not modelled:** interrupts (the SPC700 has none wired up), the `TEST` register's effects (`$F0` is stored and ignored), and the wait states some `TEST` settings add.

### Validation

`node test/spc700-singlestep.js` runs the [SingleStepTests SPC700 suite](https://github.com/SingleStepTests/spc700) (v1): 1,000 randomly generated single-instruction tests for each of the 256 opcodes. On first run it clones the suite into `out/singlesteptests-spc700` (git-ignored; nothing from it is committed). Set `SINGLESTEP_SPC700_DIR` to an existing checkout's `v1` folder to skip the download. Options: group names or hex opcodes to select, `--limit N`, `--show N`, `--report path`.

A test passes when A, X, Y, SP, PC, PSW and every RAM byte of the expected final state match, no other byte was written, and the cycle count equals the length of the suite's bus trace. The order of the bus accesses isn't compared. The suite's RAM is flat, so the I/O registers and boot ROM aren't exercised by it.

Result: **256,000 of 256,000 tests pass (100%)**, every instruction group at 100%; the table is in [`SPC700-SINGLESTEP-REPORT.md`](SPC700-SINGLESTEP-REPORT.md). The first run had two groups failing: `SLEEP` and `STOP`, which the suite counts as 7 cycles (the core had 3). The table was changed, nothing else.

### The 93S/94S sound programs

`tools/scan-spc700-driver-ops.js <NHLPA93SNES> <NHL94SNES>` reads the two SPC700 programs (both load at sound RAM `$0400`: `data/spc/driver.spc700` in NHLPA93SNES, 9,959 bytes; the `SoundDriver` block in the NHL94SNES ROM, 1,097 bytes) and records the opcodes in `test/spc700-driver-ops.js`:

- **reached:** the opcodes of code reachable from `$0400` by following branches, jumps, calls and `jmp [!a+X]` tables: 113 opcodes in the '93 program, 40 in the '94 program, 119 together.
- **swept:** a linear decode of each whole block, data included: 226 opcodes. It is a superset that also covers code the trace can't follow (the trace can't follow indirect jumps other than `jmp [!a+X]` tables and covers 2,183 of the '93 program's 9,959 bytes, the rest being data or code reached only that way).

`node test/spc700-singlestep.js` marks both sets in its report and exits non-zero if any of them is below 100%. All of them are at 100%, as is every other opcode. Only opcode numbers are kept in the repo, not the program bytes.

The '94 program is a command server: sequencing happens on the 65816 side (`SPCCmd01`–`SPCCmd0E`) and the SPC700 runs 17 commands. The '93 program is far larger; whether it sequences on the SPC700 itself is for step 2 to find out.

## The sound unit

```js
const unit = NhlSnesSpc.create({ ram /* optional Uint8Array(65536) */ });
unit.ram, unit.cpu, unit.dsp, unit.bus
unit.load(addr, bytes)            // copy into audio RAM
unit.start(pc)                    // hide the boot ROM and start running at pc
unit.iplUpload([{ addr, bytes }, ...], entry) // the main CPU's side of the boot ROM protocol, run to completion
unit.portWrite(n, v) / unit.portRead(n)       // the main CPU's $2140-$2143
unit.step()                       // one instruction (and the DSP samples and timer ticks inside it)
unit.runCycles(n), unit.render(nSamples)      // render returns interleaved Int16 L,R at 32 kHz
unit.cycles
```

- **Memory:** 64 KB of RAM. The 64-byte boot ROM shows at `$FFC0`–`$FFFF` while `CONTROL` bit 7 is set (the power-on state); writes always go to the RAM underneath. At reset the CPU starts at the vector in the boot ROM (`$FFC0`), which announces `$BBAA` on the ports and loads blocks as the main CPU sends them (`iplUpload` plays the main CPU's part).
- **Window:** `$F0` TEST (stored), `$F1` CONTROL (timer enables, port clears, boot ROM), `$F2`/`$F3` DSP address/data, `$F4`–`$F7` ports (each side has its own latch, as on the chip), `$F8`/`$F9` plain bytes, `$FA`–`$FC` timer targets, `$FD`–`$FF` timer outputs (4 bits, cleared on read).
- **Timers:** timers 0 and 1 are clocked every 128 CPU cycles (8 kHz), timer 2 every 16 (64 kHz); a stage-2 counter counts to the target (0 means 256) and a 4-bit output counts the wraps. Enabling a timer clears its counters. The prescalers run from reset, not from the enable.
- **Clock:** 1,024,000 CPU cycles per second; one DSP sample per 32 cycles. An instruction takes its cycles at once, so a DSP sample or timer tick can land up to 11 cycles later than on the chip relative to a bus access inside the same instruction.

## The S-DSP

```js
const dsp = NhlSnesDsp.create(ram);
dsp.write(reg, v) / dsp.read(reg)      // the 128 registers; reg + $80 mirrors are ignored on write
dsp.step()                             // one 32 kHz sample into dsp.left / dsp.right
dsp.render(n)                          // n samples, interleaved Int16
```

What is modelled, per output sample and voice:

- **BRR:** 9-byte blocks of 16 samples; filters 0–3 with the chip's rounding; shift 13–15 keeping only the sign; results clamped to 16 bit and stored doubled (wrapping, as on the chip); end flag (sets ENDX; with the loop flag the next block comes from the loop address in the sample directory, without it the voice is cut when that block starts); filter history carries across blocks and loops.
- **Pitch:** 14-bit `PITCH` (`$1000` = the stored samples at 32 kHz), 4-point gaussian interpolation, and pitch modulation by the previous voice's output (`PMON`, not for voice 0).
- **Envelope:** ADSR (attack rate `2·AR+1`, decay `2·DR+16`, sustain `SR`, sustain level `SL`) and GAIN (direct, linear/exponential decrease, linear/bent increase), both driven by the rate counter (`0x7800` samples long, per-rate period and offset); release is −8 per sample regardless of rate; KOFF, soft reset (`FLG` bit 7) and the 5-sample key-on delay.
- **Noise:** the 15-bit LFSR at `FLG` rate, per-voice `NON`.
- **Mix:** per-voice signed 8-bit volumes with a clamp after every add, main volumes, `FLG` mute.
- **Echo:** `ESA`/`EDL` buffer in audio RAM (4 bytes per stereo sample, `EDL` × 2 KB, `EDL` 0 = one entry), the 8-tap FIR (`C0` oldest … `C7` newest), `EFB` feedback, `EON` per voice, echo write disable (`FLG` bit 5), echo volumes.
- **Registers:** `ENVX` and `OUTX` per voice, `ENDX` (any write clears it).

### Simplifications

The real chip runs a 32-step pipeline per sample. This core computes each voice in one go, so:

- register writes take effect between samples, not at their pipeline step;
- `KON`/`KOFF` are polled every sample, not every other sample, so a key-on can start up to one sample earlier than on the chip;
- `ENVX`/`OUTX` have no one-sample latency, and ENDX is set when a block has been decoded (a few samples before the chip would);
- `ESA` is read live rather than latched at the buffer wrap;
- the end-without-loop cut happens when the end block's first sample is reached, as the chip does, but decoding of a block can run ahead of the playback position by up to 16 samples, so ENDX can be set earlier.

None of this is expected to be audible; all of it is listed so an audible difference can be traced to its cause.

## What is tested

Run individually, or all together with `node test.js` once its fixtures exist (the full run in this checkout stops at the existing `ANIM` fixtures before reaching any audio test, which is unrelated to this change).

| Area | How |
|---|---|
| SPC700, all opcodes | `test/spc700-singlestep.js`: 256,000 tests, 100%. Needs the download; not in `node test.js`. |
| SPC700, spot checks | `test/spc700-cpu.js`: hand-encoded programs whose results and cycle counts were worked out by hand (ADC/SBC flags, MUL, DIV, CALL/RET, taken and untaken branches, DBNZ, the P flag, bit operations, INCW wrap, ADDW flags, TCALL, DAA, XCN, push/pop), the tables, and the driver opcode lists. |
| Boot ROM, ports, window, timers, clock | `test/snes-spc.js`: the ROM disassembles to the boot program and the upload protocol loads two blocks and starts them; ports in both directions and the port clear; the DSP window; timers 0 and 2 (rate, target 0 = 256, clear on read); one DSP sample per 32 cycles; an SPC700 program that plays a BRR sample through the DSP window. |
| BRR | `test/snes-dsp.js`: filters 0–3 with expected values worked out by hand, shift 13+, the 16-bit wrap, block chaining, key-on delay, loop flag, end flag, ENDX. |
| Envelopes | GAIN direct, linear/exponential/bent, ADSR attack → decay → sustain, a rate-29 attack whose firing samples were worked out from the counter, release, soft reset. |
| Pitch | Sample position after N samples for five pitches; pitch modulation (voice 1 modulated, voice 0 not). |
| Noise | The LFSR sequence from `$4000`, a NON voice's output, rate 4's period of 1,024 samples. |
| Mix and echo | Signed voice and main volumes, mute; echo read, FIR tap order (C0 oldest: a seven-sample delay), write, write disable, wrap and `EDL` 0, feedback. |
| Determinism | Two renders of the same setup are byte-identical, including a run with noise, echo, pitch modulation and two voices. |

## What is not verified

- **Nothing here was compared with a real SNES, an emulator or a recording**, by design. The CPU is checked against the SingleStepTests suite; the sound unit and the DSP are checked against the documented behaviour as I understand it, with expected values worked out by hand. A test that passes on the first run (most of them did) shows the code does what the notes say, not that the notes are right. The DSP is where a mistake is most likely and the most audible.
- **The gaussian table** is the 512-entry table from public S-DSP documentation (jwdonal's APU/DSP document), transcribed through a text fetch, so a transcription error is possible. It is checked only structurally: 512 entries, monotonic, ends at `$519`, and the four taps of all 256 phases sum to 2047–2049 (the unity gain the chip's table has to within ±1). A single wrong entry would likely break that sum; it is not proof.
- **The boot ROM bytes** were written from the publicly documented 64-byte program. The test shows they disassemble to a sensible boot program and that the upload protocol works, not that every byte matches a chip.
- **The rate counter's phase**: the period/offset tables are the documented ones, and the counter starts at `0x7800` at power-on here. The real chip's phase at power-on is unknown, so envelope timings with slow rates can be off by up to one period at the start of a note.
- **Envelope and BRR details at the edges**: what GAIN does in the sample after a mode change, the exact sample at which the chip cuts a voice at an end block, and the filter behaviour with the extreme shift values are as documented but untested against hardware.
- **Timing inside an instruction** (above), and everything listed under "Simplifications".
- **Unused registers**: reads of `$xA`–`$xB`, `$1D`, `$0E` and the like return what was written.

## Hooks for the next steps

Everything below exists and is tested.

### Render a single voice to a WAV

```js
const { renderVoiceToWav } = require('./lib/audio/snes-dsp');
const wav = renderVoiceToWav({
  brr,            // Uint8Array of 9-byte BRR blocks (as stored in the game)
  loopBlock: 0,   // block the loop flag jumps to
  pitch: 0x1000,  // 14-bit, $1000 = stored samples at 32 kHz
  adsr1: 0xff, adsr2: 0xe0,   // or gain: 0x7f
  samples: 32000, keyOffAt: 20000
}); // Uint8Array, 32 kHz stereo 16-bit
```

`renderVoice(opts)` returns the samples and the final voice state instead of the WAV.

### Play a given sample at a given pitch and envelope

On a live DSP: `dsp.playSample(voice, { srcn, pitch, adsr1, adsr2, gain, volL, volR })` writes the voice's registers and keys it on; `dsp.keyOff(voice)` releases it. `srcn` indexes the sample directory (`DIR` register, 4 bytes per entry: start, loop). Helpers: `pitchFromRatio(r)`, `hzFromPitch(p)`, `pitchShift(p, semitones)`.

### Read each voice's sample, pitch and envelope

`dsp.voiceState(i)` returns `{ srcn, sampleStart, sampleLoop, brrAddr, samplePos, pitch, pitchCounter, adsr1, adsr2, gain, envelope (0-$7FF), envMode ('attack' | 'decay' | 'sustain' | 'release'), envx, outx, output, volL, volR, keyOnDelay, playing, ended }`. Poll it after every `step()` (or every few) to build a note log for the roll, the way `ym-note-tracker.js` does for the YM2612.

`NhlSnesDsp.decodeBrr(bytes, offset)` decodes a sample to Int16 (`{ samples, blocks, endFlag, loopFlag }`) for waveform display and analysis without running the DSP.

### Room for the two-way instrument ↔ GM mapping

The existing maps (`data/audio/nhl92-gm-map.json`, `nhl9x-gm-map.json`, documented in `NHL92-GM-MAP.md`) work because an instrument is a small record of parameters plus a human-checkable reason. The SNES version fits the same shape without touching the cores, since an instrument on this hardware is fully described by values the hooks above already take and report:

- **Instrument record (SNES → GM):** `srcn` or a game's instrument id, the sample's `sampleStart`/`sampleLoop`, a root `pitch` (the pitch register value at which the sample sounds the note it is meant to), `adsr1`/`adsr2` or `gain`, volume. These are exactly the `playSample` arguments and `voiceState` fields, so measuring an instrument (render it with `renderVoice`, analyse the WAV or `decodeBrr` output) and auditioning a mapping use the same code.
- **GM → SNES:** a GM note becomes `pitchShift(rootPitch, note - rootNote)` on the mapped instrument; a drum note maps to an instrument and a fixed pitch.
- **Editable JSON with reasons**, like the existing maps, can sit next to the data without any change to the cores. The cores take plain numbers, never a mapping object.

No format is fixed here on purpose: the instrument tables of the two games are only read in step 2, and the schema should follow what they contain.
