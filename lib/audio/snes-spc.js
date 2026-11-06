/**
 * The SNES sound unit: SPC700 + 64 KB audio RAM + boot ROM + the four CPU ports + three timers + the S-DSP window.
 *
 * Written for NHL9X Studio. lib/audio/spc700-cpu.js runs the code, lib/audio/snes-dsp.js makes the sound. This file is
 * the glue the real chip has: the $F0-$FF register window, the 64-byte IPL boot ROM at $FFC0-$FFFF, the port latches
 * the main CPU talks through, the timers, and the 1.024 MHz clock that also paces the DSP (one DSP sample per 32
 * CPU cycles = 32 kHz).
 *
 * Register window: $F0 TEST (stored), $F1 CONTROL (bit 0-2 timer enables, bit 4 clear ports 0-1, bit 5 clear ports
 * 2-3, bit 7 boot ROM visible), $F2 DSP address, $F3 DSP data, $F4-$F7 ports, $F8/$F9 plain bytes, $FA-$FC timer
 * targets (write), $FD-$FF timer outputs (read, clears). Writes to $F0-$FF and to $FFC0-$FFFF also land in the RAM
 * underneath; reads of $FFC0-$FFFF see the boot ROM only while CONTROL bit 7 is set.
 *
 * Main CPU side: portWrite(n, v) / portRead(n) (the 65816's $2140-$2143). A "tick" of the whole unit is step().
 */
(function (root, factory) {
  var api = factory(root.NhlSpc700, root.NhlSnesDsp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSnesSpc = api;
})(typeof self !== 'undefined' ? self : this, function (SpcCpu, SnesDsp) {
  'use strict';
  if (typeof require === 'function' && typeof module === 'object') {
    SpcCpu = SpcCpu || require('./spc700-cpu');
    SnesDsp = SnesDsp || require('./snes-dsp');
  }

  var CPU_HZ = 1024000;
  var CYCLES_PER_SAMPLE = 32;

  // The 64-byte boot ROM every SNES sound unit has at $FFC0 (the "IPL"): announces $BBAA on the ports, then loads
  // blocks of bytes the main CPU sends (address, bytes, next address ...) and jumps to the address it is given.
  var IPL = new Uint8Array([
    0xcd, 0xef, 0xbd, 0xe8, 0x00, 0xc6, 0x1d, 0xd0, 0xfc, 0x8f, 0xaa, 0xf4, 0x8f, 0xbb, 0xf5, 0x78,
    0xcc, 0xf4, 0xd0, 0xfb, 0x2f, 0x19, 0xeb, 0xf4, 0xd0, 0xfc, 0x7e, 0xf4, 0xd0, 0x0b, 0xe4, 0xf5,
    0xcb, 0xf4, 0xd7, 0x00, 0xfc, 0xd0, 0xf3, 0xab, 0x01, 0x10, 0xef, 0x7e, 0xf4, 0x10, 0xeb, 0xba,
    0xf6, 0xda, 0x00, 0xba, 0xf4, 0xc4, 0xf4, 0xdd, 0x5d, 0xd0, 0xdb, 0x1f, 0x00, 0x00, 0xc0, 0xff
  ]);

  function create(opts) {
    opts = opts || {};
    var ram = opts.ram || new Uint8Array(0x10000);
    var dsp = SnesDsp.create(ram);
    var apuIn = new Uint8Array(4); // written by the main CPU, read by the SPC700 at $F4-$F7
    var apuOut = new Uint8Array(4); // written by the SPC700, read by the main CPU
    var control = 0x80;
    var dspAddr = 0;
    var test = 0x0a;
    var f8 = 0;
    var f9 = 0;
    var target = [0, 0, 0];
    var stage1 = [0, 0, 0];
    var stage2 = [0, 0, 0];
    var stage3 = [0, 0, 0];
    var cycles = 0; // total CPU cycles run since reset
    var dspCredit = 0;
    var samplesOut = null;
    var samplesAt = 0;
    var rec = null; // growing recording of every DSP sample while on: { buf, at }

    function timerTick(t) {
      if (!(control & (1 << t))) return;
      stage2[t] += 1;
      if (stage2[t] === (target[t] || 256)) {
        stage2[t] = 0;
        stage3[t] = (stage3[t] + 1) & 15;
      }
    }
    // Prescalers: timers 0 and 1 count every 128 CPU cycles, timer 2 every 16.
    function advanceTimers(c) {
      for (var t = 0; t < 3; t++) {
        var period = t === 2 ? 16 : 128;
        stage1[t] += c;
        while (stage1[t] >= period) { stage1[t] -= period; timerTick(t); }
      }
    }

    var bus = {
      read: function (a) {
        if (a >= 0xf0 && a < 0x100) {
          switch (a) {
            case 0xf0: return 0; // TEST is write-only
            case 0xf1: return 0; // CONTROL is write-only
            case 0xf2: return dspAddr;
            case 0xf3: return dsp.read(dspAddr);
            case 0xf4: case 0xf5: case 0xf6: case 0xf7: return apuIn[a - 0xf4];
            case 0xf8: return f8;
            case 0xf9: return f9;
            case 0xfa: case 0xfb: case 0xfc: return 0;
            default: { var t = a - 0xfd; var v = stage3[t]; stage3[t] = 0; return v; }
          }
        }
        if (a >= 0xffc0 && (control & 0x80)) return IPL[a - 0xffc0];
        return ram[a];
      },
      write: function (a, v) {
        ram[a] = v;
        if (a >= 0xf0 && a < 0x100) {
          switch (a) {
            case 0xf0: test = v; break;
            case 0xf1: {
              for (var t = 0; t < 3; t++) {
                if (!(control & (1 << t)) && (v & (1 << t))) { stage2[t] = 0; stage3[t] = 0; }
              }
              if (v & 0x10) { apuIn[0] = 0; apuIn[1] = 0; }
              if (v & 0x20) { apuIn[2] = 0; apuIn[3] = 0; }
              control = v & 0x87;
              break;
            }
            case 0xf2: dspAddr = v; break;
            case 0xf3: dsp.write(dspAddr, v); break;
            case 0xf4: case 0xf5: case 0xf6: case 0xf7: apuOut[a - 0xf4] = v; break;
            case 0xf8: f8 = v; break;
            case 0xf9: f9 = v; break;
            case 0xfa: case 0xfb: case 0xfc: target[a - 0xfa] = v; break;
            default: break;
          }
        }
      }
    };

    var cpu = SpcCpu.create(bus);

    function reset() {
      control = 0x80;
      apuIn.fill(0); apuOut.fill(0);
      cpu.load({ a: 0, x: 0, y: 0, sp: 0xef, pc: IPL[62] | (IPL[63] << 8), psw: 0 });
    }
    reset();

    /** Run one SPC700 instruction (and whatever DSP samples / timer ticks fall inside it). Returns its cycles. */
    function step() {
      var c = cpu.step();
      cycles += c;
      advanceTimers(c);
      dspCredit += c;
      while (dspCredit >= CYCLES_PER_SAMPLE) {
        dspCredit -= CYCLES_PER_SAMPLE;
        dsp.step();
        if (samplesOut && samplesAt < samplesOut.length) {
          samplesOut[samplesAt++] = dsp.left;
          samplesOut[samplesAt++] = dsp.right;
        }
        if (rec) {
          if (rec.at + 2 > rec.buf.length) { var bigger = new Int16Array(rec.buf.length * 2); bigger.set(rec.buf); rec.buf = bigger; }
          rec.buf[rec.at++] = dsp.left;
          rec.buf[rec.at++] = dsp.right;
        }
      }
      return c;
    }

    /** Run at least n CPU cycles. */
    function runCycles(n) {
      var end = cycles + n;
      while (cycles < end) step();
    }

    /** Run until n DSP output samples are produced (n / 32000 s); returns them as interleaved Int16Array (L, R, ...). */
    function render(n) {
      samplesOut = new Int16Array(n * 2);
      samplesAt = 0;
      while (samplesAt < samplesOut.length) step();
      var out = samplesOut;
      samplesOut = null;
      return out;
    }

    /** Keep every DSP sample produced from now on (while step()/runCycles() run); stopRecording() returns them as interleaved L, R. */
    var recRead = 0;
    function startRecording() { rec = { buf: new Int16Array(1 << 16), at: 0 }; recRead = 0; }
    /** Interleaved L/R samples appended since the last drain (or since startRecording). For live playback. */
    function drainRecording() {
      if (!rec || rec.at <= recRead) return new Int16Array(0);
      var out = rec.buf.slice(recRead, rec.at);
      recRead = rec.at;
      return out;
    }
    function stopRecording() {
      var out = rec ? rec.buf.slice(0, rec.at) : new Int16Array(0);
      rec = null;
      recRead = 0;
      return out;
    }

    function load(addr, bytes) { for (var i = 0; i < bytes.length; i++) ram[(addr + i) & 0xffff] = bytes[i]; }

    /** Boot like the real unit does after a main-CPU upload: skip the IPL and start running at pc with the boot ROM hidden. */
    function start(pc) {
      control &= 0x7f;
      cpu.load({ a: 0, x: 0, y: 0, sp: 0xef, pc: pc, psw: 0 });
    }

    function portWrite(n, v) { apuIn[n & 3] = v & 0xff; }
    function portRead(n) { return apuOut[n & 3]; }

    /**
     * Main-CPU side of the boot ROM's upload protocol, run to completion: waits for the $BBAA hello, sends each block
     * ({ addr, bytes }) and finally starts the program at entry. The SPC700 runs between port accesses, so what this
     * does is what a game's upload routine does. Throws if the boot ROM stops answering.
     */
    function iplUpload(blocks, entry) {
      var wait = function (n, v) {
        for (var i = 0; i < 200000; i++) {
          if (portRead(n) === v) return;
          step();
        }
        throw new Error('snes-spc: boot ROM did not answer on port ' + n + ' (wanted ' + v.toString(16) + ', saw ' + portRead(n).toString(16) + ')');
      };
      wait(0, 0xaa);
      wait(1, 0xbb);
      var cmd = 0xcc;
      var sendHeader = function (addr, nonzero) {
        portWrite(2, addr & 0xff);
        portWrite(3, addr >> 8);
        portWrite(1, nonzero ? 1 : 0);
        portWrite(0, cmd);
        wait(0, cmd);
      };
      blocks.forEach(function (b) {
        sendHeader(b.addr, true);
        for (var i = 0; i < b.bytes.length; i++) {
          portWrite(1, b.bytes[i]);
          portWrite(0, i & 0xff);
          wait(0, i & 0xff);
        }
        cmd = ((b.bytes.length - 1) & 0xff) + 2;
        if ((cmd & 0xff) === 0) cmd = 1;
        cmd &= 0xff;
      });
      sendHeader(entry, false);
    }

    return {
      cpu: cpu, dsp: dsp, ram: ram, bus: bus,
      step: step, runCycles: runCycles, render: render, startRecording: startRecording, drainRecording: drainRecording, stopRecording: stopRecording, load: load, start: start, reset: reset,
      portWrite: portWrite, portRead: portRead, iplUpload: iplUpload,
      get cycles() { return cycles; },
      get control() { return control; }
    };
  }

  return { create: create, IPL: IPL, CPU_HZ: CPU_HZ, CYCLES_PER_SAMPLE: CYCLES_PER_SAMPLE };
});
