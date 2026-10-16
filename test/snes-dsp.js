/**
 * Unit tests for lib/audio/snes-dsp.js: BRR decoding, envelopes, pitch, noise, echo, mixing and determinism.
 * Expected values are worked out by hand from the S-DSP's documented behaviour (each case says how); nothing is
 * compared against another emulator or a recording. What this does not cover is listed in docs/SNES-SOUND-CORE.md.
 */
const assert = require('assert');
const dsp = require('../lib/audio/snes-dsp');
const wav = require('../lib/audio/wav');

const R = dsp.REG;

// A DSP on a private RAM with the sample directory at $0200 (entry 0 -> $1000, loop $1000), echo write off.
function rig(brr, loopAt) {
  const ram = new Uint8Array(0x10000);
  ram.set(brr, 0x1000);
  const loop = loopAt == null ? 0x1000 : loopAt;
  ram[0x200] = 0x00; ram[0x201] = 0x10; ram[0x202] = loop & 0xff; ram[0x203] = loop >> 8;
  const d = dsp.create(ram);
  d.write(R.DIR, 0x02);
  d.write(R.FLG, 0x20);
  d.write(R.MVOLL, 0x7f);
  d.write(R.MVOLR, 0x7f);
  return { d, ram };
}
const block = (hdr, bytes) => { const b = new Uint8Array(9); b[0] = hdr; b.set(bytes, 1); return b; };
const steps = (d, n) => { for (let i = 0; i < n; i++) d.step(); };
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let at = 0; a.forEach((x) => { o.set(x, at); at += x.length; }); return o; };
const FLAT = block(0xc3, [0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44]); // shift 12, nibble 4: constant 8192 (looping)

// --- 1. gaussian table properties ---
{
  const g = dsp.GAUSS;
  assert.strictEqual(g.length, 512);
  assert.strictEqual(g[0], 0);
  assert.strictEqual(g[511], 0x519);
  for (let i = 1; i < 512; i++) assert.ok(g[i] >= g[i - 1], 'monotonic');
  for (let p = 0; p < 256; p++) {
    const sum = g[255 - p] + g[511 - p] + g[256 + p] + g[p];
    assert.ok(sum >= 2047 && sum <= 2049, 'unity gain at phase ' + p + ': ' + sum);
  }
}
console.log('snes dsp: gaussian table is monotonic with unity gain at every phase OK');

// --- 2. BRR decoding (stored sample = 16-bit value, twice the 15-bit sample) ---
{
  // Filter 0, shift 0: sample = nibble >> 1 (signed), stored doubled. Nibbles 1 2 3 4 5 6 7 8 9 A B C D E F 1.
  const r = dsp.decodeBrr(block(0x01, [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf1]));
  assert.deepStrictEqual(Array.from(r.samples), [0, 2, 2, 4, 4, 6, 6, -8, -8, -6, -6, -4, -4, -2, -2, 0]);
  assert.ok(r.endFlag && !r.loopFlag);
}
{
  // Filter 1 (header $04), shift 0, nibbles 7 0 0 0: s = 3 -> 6 stored; then p1/2 + (-p1 >> 5): 3 - 1 = 2 -> 4; 2 -> ... 0
  const r = dsp.decodeBrr(block(0x05, [0x70, 0x00, 0, 0, 0, 0, 0, 0]));
  assert.deepStrictEqual(Array.from(r.samples.slice(0, 5)), [6, 4, 2, 0, 0]);
}
{
  // Filter 2 (header $08 | shift 4): nibbles 7 0 0 -> 112, then 0 + 112 - 0 + 0 + ((112 * -3) >> 6 = -6) = 106 -> 212,
  // then 212 - 56 + (56 >> 4 = 3) + ((212 * -3) >> 6 = -10) = 149 -> 298
  const r = dsp.decodeBrr(block(0x49, [0x70, 0x00, 0, 0, 0, 0, 0, 0]));
  assert.deepStrictEqual(Array.from(r.samples.slice(0, 3)), [112, 212, 298]);
}
{
  // Filter 3 (header $0C | shift 4): 112, then 112 + ((112 * -13) >> 7 = -12) = 100 -> 200, then
  // 200 - 56 + ((200 * -13) >> 7 = -21) + ((56 * 3) >> 4 = 10) = 133 -> 266
  const r = dsp.decodeBrr(block(0x4d, [0x70, 0x00, 0, 0, 0, 0, 0, 0]));
  assert.deepStrictEqual(Array.from(r.samples.slice(0, 3)), [112, 200, 266]);
}
{
  // Shift 13-15 keeps only the sign: nibble 7 -> 0, nibble 8 (-8) -> -2048 -> stored -4096
  const r = dsp.decodeBrr(block(0xd1, [0x78, 0, 0, 0, 0, 0, 0, 0]));
  assert.deepStrictEqual(Array.from(r.samples.slice(0, 2)), [0, -4096]);
}
{
  // Shift 12, filter 1: 14336 -> 28672 stored; next nibble 7: 14336 + 14336 + (-28672 >> 5 = -896) = 27776, doubled
  // wraps in 16 bits to -9984 (the chip's arithmetic, not a clamp)
  const r = dsp.decodeBrr(block(0xc5, [0x77, 0, 0, 0, 0, 0, 0, 0]));
  assert.deepStrictEqual(Array.from(r.samples.slice(0, 2)), [28672, -9984]);
}
{
  // Decoding follows blocks to the end flag and keeps the filter history across blocks
  const a = block(0x00, [0x70, 0, 0, 0, 0, 0, 0, 0]);
  const b = block(0x05, [0x00, 0, 0, 0, 0, 0, 0, 0]); // filter 1 continues from the last sample of block a
  const r = dsp.decodeBrr(concat(a, b));
  assert.strictEqual(r.blocks, 2);
  assert.strictEqual(r.samples.length, 32);
  assert.strictEqual(r.samples[0], 6);
  assert.strictEqual(r.samples[15], 0);
  assert.strictEqual(r.samples[16], 0);
}
console.log('snes dsp: BRR filters 0-3, shift 13+, wrap and block chaining OK');

// --- 3. key-on delay, end/loop flags ---
{
  const { d } = rig(concat(block(0xc0, [0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44]), block(0xc3, [0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44])));
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f });
  for (let k = 1; k <= 5; k++) {
    d.step();
    assert.strictEqual(d.left, 0, 'silent during the 5-sample key-on delay (sample ' + k + ')');
    assert.strictEqual(d.voiceState(0).envelope, 0);
  }
  assert.strictEqual(d.voiceState(0).keyOnDelay, 0);
  steps(d, 40);
  assert.ok(d.left > 0, 'sound after the delay');
  // The loop flag on the second block keeps it going for far longer than its 32 samples
  steps(d, 1000);
  const s = d.voiceState(0);
  assert.ok(s.playing && s.envelope > 0 && s.ended, 'looping voice keeps playing and reports ENDX');
  assert.strictEqual(s.sampleLoop, 0x1000);
  assert.ok(s.samplePos > 1000, 'sample position runs on past the end block');
}
{
  // End flag without loop: the voice is cut when that block starts and ENDX is set
  const brr = concat(block(0xc0, [0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44]), block(0xc1, [0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44]));
  const { d } = rig(brr);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f });
  steps(d, 5 + 14);
  assert.ok(d.voiceState(0).envelope > 0, 'first block plays');
  steps(d, 40);
  const s = d.voiceState(0);
  assert.strictEqual(s.envelope, 0, 'silenced at the end block');
  assert.strictEqual(s.envMode, 'release');
  assert.ok(s.ended);
  assert.strictEqual(d.read(R.ENDX) & 1, 1);
  d.write(R.ENDX, 0xff);
  assert.strictEqual(d.read(R.ENDX), 0, 'any write clears ENDX');
}
console.log('snes dsp: key-on delay, loop flag and end flag OK');

// --- 4. envelopes (audible step k = global sample k - 5; the DSP counter is 0x7800 - k) ---
{
  // GAIN direct: envelope = gain * 16 on the first audible sample
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x40 });
  steps(d, 6);
  assert.strictEqual(d.voiceState(0).envelope, 0x400);
  assert.strictEqual(d.read(0x08), 0x40, 'ENVX is envelope >> 4');
}
{
  // GAIN linear increase (mode 6, rate 31): +$20 every sample
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0xdf });
  steps(d, 5 + 10);
  assert.strictEqual(d.voiceState(0).envelope, 0x140);
}
{
  // GAIN bent increase (mode 7, rate 31): +$20 below $600 then +8. Start from direct gain $5F ($5F0).
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x5f });
  steps(d, 6);
  assert.strictEqual(d.voiceState(0).envelope, 0x5f0);
  d.write(R.GAIN, 0xff);
  steps(d, 1);
  assert.strictEqual(d.voiceState(0).envelope, 0x610);
  steps(d, 1);
  assert.strictEqual(d.voiceState(0).envelope, 0x618);
}
{
  // GAIN linear decrease (mode 4) -$20 per sample; exponential decrease (mode 5) -(((env-1) >> 8) + 1)
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f });
  steps(d, 6);
  assert.strictEqual(d.voiceState(0).envelope, 0x7f0);
  d.write(R.GAIN, 0x9f);
  steps(d, 3);
  assert.strictEqual(d.voiceState(0).envelope, 0x7f0 - 3 * 0x20);
  d.write(R.GAIN, 0xbf);
  steps(d, 1);
  assert.strictEqual(d.voiceState(0).envelope, 0x790 - 8, 'exponential step at $790: ((0x78f >> 8) + 1) = 8');
}
{
  // ADSR attack rate 15 (rate 31: +$400), clamps at $7FF and switches to decay; decay with SL=7 turns straight into
  // sustain; sustain rate 31 then falls exponentially by 8 per sample.
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, adsr1: 0xff, adsr2: 0xff });
  steps(d, 6);
  assert.strictEqual(d.voiceState(0).envelope, 0x400);
  steps(d, 1);
  let s = d.voiceState(0);
  assert.strictEqual(s.envelope, 0x7ff);
  assert.strictEqual(s.envMode, 'decay');
  steps(d, 1); // decay rate 30 (period 2) fires on even global samples: sample 8 -> $7FF - 8
  s = d.voiceState(0);
  assert.strictEqual(s.envelope, 0x7f7);
  assert.strictEqual(s.envMode, 'sustain');
  steps(d, 1);
  assert.strictEqual(d.voiceState(0).envelope, 0x7ef);
  steps(d, 1);
  assert.strictEqual(d.voiceState(0).envelope, 0x7e7);
}
{
  // ADSR attack rate 14 = rate 29 (period 3, offset 1040): fires when the counter is 1 mod 3 -> global samples
  // 8, 11, 14 ...; the voice becomes audible at sample 6, so the envelope steps $20 at 8, 11, 14
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, adsr1: 0x8e, adsr2: 0x00 });
  const seen = [];
  for (let k = 1; k <= 14; k++) { d.step(); seen.push(d.voiceState(0).envelope); }
  assert.deepStrictEqual(seen, [0, 0, 0, 0, 0, 0, 0, 0x20, 0x20, 0x20, 0x40, 0x40, 0x40, 0x60]);
}
{
  // Release: -8 per sample from the key-off sample on, to zero and no further
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f });
  steps(d, 6);
  d.keyOff(0);
  steps(d, 10);
  assert.strictEqual(d.voiceState(0).envelope, 0x7f0 - 80);
  assert.strictEqual(d.voiceState(0).envMode, 'release');
  steps(d, 400);
  assert.strictEqual(d.voiceState(0).envelope, 0);
  assert.strictEqual(d.voiceState(0).playing, false);
}
{
  // Soft reset (FLG bit 7) silences every voice at once
  const { d } = rig(FLAT);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f });
  steps(d, 20);
  d.write(R.FLG, 0xa0);
  steps(d, 2);
  assert.strictEqual(d.voiceState(0).envelope, 0);
}
console.log('snes dsp: GAIN modes, ADSR attack/decay/sustain, rate counter, release and reset OK');

// --- 5. pitch and pitch modulation ---
{
  // Sample position after K audible samples is floor(K * pitch / $1000)
  for (const [pitch, want] of [[0x1000, 8], [0x2000, 16], [0x0800, 4], [0x1800, 12], [0x3fff, 31]]) {
    const { d } = rig(FLAT);
    d.playSample(0, { srcn: 0, pitch, gain: 0x7f });
    steps(d, 5 + 8);
    assert.strictEqual(d.voiceState(0).samplePos, want, 'pitch ' + pitch.toString(16));
  }
  assert.strictEqual(dsp.pitchFromRatio(1), 0x1000);
  assert.strictEqual(dsp.hzFromPitch(0x1000), 32000);
  assert.strictEqual(dsp.pitchShift(0x1000, 12), 0x2000);
}
{
  // PMON: voice 1 is pushed faster by voice 0's output (about +50% at this level); voice 0's PMON bit does nothing
  const run = (pmon) => {
    const { d } = rig(FLAT);
    d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f, volL: 0, volR: 0 });
    d.playSample(1, { srcn: 0, pitch: 0x1000, gain: 0x7f, volL: 0, volR: 0 });
    d.write(R.PMON, pmon);
    steps(d, 5 + 100);
    return [d.voiceState(0).samplePos, d.voiceState(1).samplePos];
  };
  const plain = run(0);
  const mod = run(0x03);
  assert.strictEqual(plain[0], 100);
  assert.strictEqual(plain[1], 100);
  assert.strictEqual(mod[0], 100, 'voice 0 cannot be modulated');
  assert.ok(mod[1] > 140 && mod[1] < 152, 'voice 1 modulated: ' + mod[1]);
}
console.log('snes dsp: pitch, ratio helpers and pitch modulation OK');

// --- 6. noise ---
{
  const { d } = rig(FLAT);
  d.write(R.FLG, 0x20 | 0x1f); // rate 31: clocked every sample
  assert.strictEqual(d.noise, 0x4000);
  steps(d, 1);
  assert.strictEqual(d.noise, 0x2000);
  steps(d, 1);
  assert.strictEqual(d.noise, 0x1000);
  steps(d, 1);
  assert.strictEqual(d.noise, 0x0800);
  steps(d, 10); // 13 steps in total: bit 1 is the only bit left
  assert.strictEqual(d.noise, 0x0002);
  steps(d, 1); // feedback = bit 0 ^ bit 1 = 1 -> $4001
  assert.strictEqual(d.noise, 0x4001);
}
{
  // A voice with NON plays the noise value (doubled, 16 bit) through the envelope instead of its sample
  const { d } = rig(FLAT);
  d.write(R.FLG, 0x20 | 0x1f);
  d.write(R.NON, 0x01);
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f });
  steps(d, 7);
  const n = ((d.noise * 2) << 16) >> 16;
  assert.strictEqual(d.voiceState(0).output, ((n * 0x7f0) >> 11) & ~1);
}
{
  // Slower noise rates fire on the rate counter: rate 4 has period 1024
  const changes = [];
  const d2 = rig(FLAT).d;
  d2.write(R.FLG, 0x20 | 4);
  let last = d2.noise;
  for (let k = 1; k <= 5000; k++) { d2.step(); if (d2.noise !== last) { changes.push(k); last = d2.noise; } }
  assert.ok(changes.length >= 4 && changes.length <= 5, 'changes: ' + changes.join());
  assert.strictEqual(changes[1] - changes[0], 1024);
  assert.strictEqual(changes[2] - changes[1], 1024);
}
console.log('snes dsp: noise generator and NON voices OK');

// --- 7. mixing, volumes, mute ---
{
  const { d } = rig(FLAT);
  d.write(R.MVOLL, 0x40);
  d.write(R.MVOLR, 0xc0); // -64
  d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f, volL: 0x20, volR: 0x40 });
  steps(d, 60);
  const out = d.voiceState(0).output;
  assert.ok(out > 10000);
  assert.strictEqual(d.left, (((out * 0x20) >> 7) * 0x40) >> 7);
  assert.strictEqual(d.right, (((out * 0x40) >> 7) * -64) >> 7);
  d.write(R.FLG, 0x20 | 0x40); // mute
  steps(d, 1);
  assert.strictEqual(d.left, 0);
  assert.strictEqual(d.right, 0);
  assert.ok(d.voiceState(0).envelope > 0, 'mute only silences the output');
}
console.log('snes dsp: voice, main volume (signed) and mute OK');

// --- 8. echo ---
{
  // Echo buffer at $3000, EDL 1 (2 KB = 512 stereo samples). A sample of $1000 left at entry 0 is read on the first
  // output sample: halved to $800, FIR coefficient $40 (x1), EVOL $40 -> ($800 * $40) >> 7 = $400
  const { d, ram } = rig(FLAT);
  ram[0x3000] = 0x00; ram[0x3001] = 0x10;
  d.write(R.ESA, 0x30);
  d.write(R.EDL, 1);
  d.write(R.MVOLL, 0);
  d.write(R.MVOLR, 0);
  d.write(R.EVOLL, 0x40);
  d.write(R.EVOLR, 0x40);
  d.write(R.FIR0 + 0x70, 0x40); // C7: newest tap
  steps(d, 1);
  assert.strictEqual(d.left, 0x400);
  assert.strictEqual(d.right, 0);
  steps(d, 1);
  assert.strictEqual(d.left, 0, 'the next buffer entry is empty');
}
{
  // C0 is the oldest tap: the same sample comes out seven samples later
  const { d, ram } = rig(FLAT);
  ram[0x3000] = 0x00; ram[0x3001] = 0x10;
  d.write(R.ESA, 0x30);
  d.write(R.EDL, 1);
  d.write(R.MVOLL, 0);
  d.write(R.EVOLL, 0x40);
  d.write(R.FIR0, 0x40);
  const seen = [];
  for (let k = 0; k < 9; k++) { d.step(); seen.push(d.left); }
  assert.deepStrictEqual(seen, [0, 0, 0, 0, 0, 0, 0, 0x400, 0]);
}
{
  // Writing: an EON voice goes into the buffer at the current entry (4 bytes per sample), unless FLG bit 5 is set
  for (const writeOff of [true, false]) {
    const { d, ram } = rig(FLAT);
    d.write(R.ESA, 0x30);
    d.write(R.EDL, 1);
    d.write(R.EON, 0x01);
    d.write(R.FLG, writeOff ? 0x20 : 0x00);
    d.playSample(0, { srcn: 0, pitch: 0x1000, gain: 0x7f, volL: 0x40, volR: 0x20 });
    steps(d, 20);
    const out = d.voiceState(0).output;
    const at = 0x3000 + 19 * 4;
    const l = (ram[at] | (ram[at + 1] << 8)) << 16 >> 16;
    const r = (ram[at + 2] | (ram[at + 3] << 8)) << 16 >> 16;
    if (writeOff) { assert.strictEqual(l, 0); assert.strictEqual(r, 0); }
    else {
      assert.strictEqual(l, ((out * 0x40) >> 7) & ~1);
      assert.strictEqual(r, ((out * 0x20) >> 7) & ~1);
      assert.ok(l > 1000);
    }
  }
}
{
  // The buffer wraps after EDL * 2 KB: 512 samples for EDL 1; EDL 0 is a single entry
  const { d } = rig(FLAT);
  d.write(R.EDL, 1);
  steps(d, 511);
  assert.strictEqual(d.echoOffset, 511 * 4);
  steps(d, 1);
  assert.strictEqual(d.echoOffset, 0);
  const z = rig(FLAT).d;
  z.write(R.EDL, 0);
  steps(z, 5);
  assert.strictEqual(z.echoOffset, 0);
}
{
  // Feedback: EFB $40 (x0.5) feeds the FIR output back into what is written
  const { d, ram } = rig(FLAT);
  ram[0x3000] = 0x00; ram[0x3001] = 0x10;
  d.write(R.ESA, 0x30);
  d.write(R.EDL, 0);
  d.write(R.FIR0 + 0x70, 0x40);
  d.write(R.EFB, 0x40);
  d.write(R.FLG, 0x00);
  steps(d, 1);
  // read $1000 -> $800 -> fir $800; written = ($800 * $40) >> 7 = $400 (EDL 0: always entry 0)
  assert.strictEqual(ram[0x3000] | (ram[0x3001] << 8), 0x400);
}
console.log('snes dsp: echo read, FIR taps, write, write disable, wrap and feedback OK');

// --- 9. hooks and determinism ---
{
  const brr = concat(FLAT, FLAT);
  const a = dsp.renderVoice({ brr, pitch: 0x1000, adsr1: 0xff, adsr2: 0xe0, samples: 4000, keyOffAt: 2500 });
  const b = dsp.renderVoice({ brr, pitch: 0x1000, adsr1: 0xff, adsr2: 0xe0, samples: 4000, keyOffAt: 2500 });
  assert.deepStrictEqual(Buffer.from(a.samples.buffer), Buffer.from(b.samples.buffer), 'byte-identical renders');
  assert.strictEqual(a.samples.length, 8000);
  assert.ok(a.samples.some((v) => v !== 0));
  assert.strictEqual(a.final.envMode, 'release');
  const w = dsp.renderVoiceToWav({ brr, pitch: 0x1000, gain: 0x7f, samples: 1000 });
  assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.strictEqual(w.length, 44 + 1000 * 4);
  const dec = wav.decode16(w);
  assert.strictEqual(dec.sampleRate, 32000);
  assert.strictEqual(dec.channels, 2);
  // a whole-DSP run with noise, echo, pitch modulation and two voices: same registers, same RAM, same bytes
  const full = () => {
    const { d, ram } = rig(concat(FLAT, FLAT));
    for (let i = 0x3000; i < 0x3200; i++) ram[i] = (i * 37) & 0xff;
    d.write(R.ESA, 0x30); d.write(R.EDL, 1); d.write(R.EON, 0x03); d.write(R.EVOLL, 0x30); d.write(R.EVOLR, 0x30);
    d.write(R.EFB, 0x30); d.write(R.FIR0, 0x20); d.write(R.FIR0 + 0x70, 0x30); d.write(R.NON, 0x02); d.write(R.PMON, 0x02);
    d.write(R.FLG, 0x08);
    d.playSample(0, { srcn: 0, pitch: 0x0c00, adsr1: 0xff, adsr2: 0x2a, volL: 0x50, volR: 0x30 });
    d.playSample(1, { srcn: 0, pitch: 0x1400, gain: 0xdf, volL: 0x20, volR: 0x60 });
    return Buffer.from(d.render(6000).buffer);
  };
  assert.deepStrictEqual(full(), full());
}
console.log('snes dsp: render hooks, WAV output and determinism OK');
