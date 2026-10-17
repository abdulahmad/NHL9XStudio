/**
 * Step 4: the retail NHL '92 Z80 driver driving the real YM2612 (ymfm WASM) and
 * SN76489 cores. Checks that the chips are wired without changing what the
 * driver does, that every retail patch sounds, that the DAC plays the retail
 * sample bytes, that the PSG stays silent, and that output is deterministic.
 * Ear-checking retail accuracy is manual (tools/render-nhl92-chip-tests.js).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const audio = require('../lib/audio/nhl92-z80-audio');
const harness = require('../lib/audio/nhl92-z80-harness');
const renders = require('../lib/audio/nhl92-chip-renders');
const ymWasm = require('../lib/audio/ym2612-wasm');
const wav = require('../lib/audio/wav');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl92-chip-tests.json'), 'utf8'));
const SRC = renders.sources();
const { program: PROGRAM, rom: ROM } = SRC;
const FRAME = audio.FRAME_TSTATES;
const RATE = audio.SAMPLE_RATE;
const sampleAt = (t) => Math.floor((t * 15) / 1008);
const frameSample = (frame) => sampleAt(frame * FRAME);
const left = (pcm, from, to) => {
  const out = [];
  for (let i = from; i < to; i++) out.push(pcm[i * 2]);
  return out;
};
const rms = (xs) => Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length);

/** Normalized autocorrelation at a fractional lag (linear interpolation). */
function periodicity(x, lag) {
  let num = 0;
  let d1 = 0;
  let d2 = 0;
  const n = x.length - Math.ceil(lag) - 1;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i + lag);
    const f = i + lag - k;
    const y = x[k] * (1 - f) + x[k + 1] * f;
    num += x[i] * y;
    d1 += x[i] * x[i];
    d2 += y * y;
  }
  return num / Math.sqrt(d1 * d2);
}

function noteHz(note) {
  const [hi, lo] = audio.noteFreq(ROM, note);
  const fnum = ((hi & 7) << 8) | lo;
  const block = (hi >> 3) & 7;
  return (fnum * (7670454 / 144)) / (1 << (21 - block));
}

/** Window bytes the driver must stream: addr+1 .. 0 terminator, skipping window $FFFF. */
function expectedDacBytes(entry) {
  const { start, end } = renders.sampleBytes(ROM, entry);
  const out = [];
  for (let a = start; a < end; a++) if ((a & 0x7fff) !== 0x7fff) out.push(ROM[a]);
  return out;
}

(async () => {
  // --- Wiring: chips attached, Z80 behaviour unchanged -------------------------------
  {
    const script = [
      { flag: 0, channels: audio.channels(audio.SLOT_CHANNELS.map((c, i) => ({
        patch: audio.patchAddress(i * 3), key: 0x01, freq: audio.noteFreq(ROM, 48 + i), tl: 0x10 + i
      }))), pending: 1, sfx: audio.sfxBytes(audio.SOUND_BASE + 0x4498, 0x0c, 2) }
    ];
    for (let i = 0; i < 40; i++) script.push(audio.IDLE);
    const plain = harness.create({ program: PROGRAM, rom: ROM });
    const start = plain.tstates();
    const runTo = (t) => { const d = t - plain.tstates(); if (d > 0) plain.run(d); };
    runTo(start + audio.BOOT_FRAMES * FRAME);
    script.forEach((input, i) => {
      plain.vblank(input);
      runTo(start + (audio.BOOT_FRAMES + i + 1) * FRAME);
    });
    const r = await renders.render(script, SRC);
    assert.deepStrictEqual(r.machine.z.log, plain.log, 'attaching the chips must not change the bus log');
    assert.deepStrictEqual(r.machine.z.ym, plain.ym);
    assert.strictEqual(r.machine.ymWrites, plain.log.filter((e) => e.kind === 'ymPort').length, 'every YM port write reaches the core');
    assert.ok(rms(left(r.pcm, frameSample(audio.BOOT_FRAMES + 1), frameSample(audio.BOOT_FRAMES + 8))) > 500, 'six channels + DAC audible');
  }
  {
    // The YM2612 output timebase: 53267 Hz samples, exactly (frames x 59736 x 15 / 1008).
    const r = await renders.render([audio.IDLE, audio.IDLE], SRC);
    assert.strictEqual(r.pcm.length / 2, sampleAt((audio.BOOT_FRAMES + 2) * FRAME));
    const back = wav.decode16(r.wav);
    assert.deepStrictEqual([back.sampleRate, back.channels], [RATE, 2]);
    assert.deepStrictEqual(Array.from(back.samples), Array.from(r.pcm));
    const idle = Array.from(r.pcm);
    assert.ok(idle.every((v) => v === idle[0]), 'boot + idle frames: constant output, no tone');
    assert.strictEqual(r.log, '\n', 'boot writes nothing to the YM2612');
  }
  console.log('nhl92 z80 audio: chips wired, driver bus log unchanged OK');

  // --- 22 retail patches, scale on channel 1 ------------------------------------------
  const highFeedback = [];
  for (let i = 0; i < audio.PATCH_COUNT; i++) {
    const r = await renders.renderPatch(i, SRC);
    const m = r.machine;
    const at = audio.patchAddress(i);
    const feedback = (PROGRAM[at + 24] >> 3) & 7;
    assert.strictEqual(PROGRAM[at + 25] & 0xc0, 0xc0, 'patch ' + i + ' pans to both outputs');
    assert.deepStrictEqual(audio.otherTraffic(m.z), [], 'patch ' + i + ': YM/bank traffic only');
    assert.strictEqual(m.psgWrites, 0);
    assert.strictEqual(m.psgPeak, 0, 'PSG output silent');
    audio.SCALE_NOTES.forEach((note, k) => {
      // Note k keys on at frame BOOT + 1 + 12k (10 held + 2 gap). Skip the first 50 ms of attack.
      const s = frameSample(audio.BOOT_FRAMES + 1 + k * 12) + Math.floor(RATE * 0.05);
      const seg = left(r.pcm, s, s + Math.floor(RATE * 0.08));
      const level = rms(seg);
      assert.ok(level > 200, 'patch ' + i + ' note ' + note + ' audible (rms ' + level.toFixed(0) + ')');
      // Feedback 6-7 makes operator 1 noise-like; those patches are not periodic by design.
      if (feedback < 6) {
        const p = periodicity(seg, (2 * RATE) / noteHz(note));
        assert.ok(p > 0.75, 'patch ' + i + ' note ' + note + ' repeats at the note period (r=' + p.toFixed(2) + ')');
      }
    });
    if (feedback >= 6) highFeedback.push(i);
    const pinned = MANIFEST.patches[i];
    assert.strictEqual(pinned.file, renders.patchName(i) + '.wav');
    assert.strictEqual(r.logSha256, pinned.log, 'patch ' + i + ' YM log hash');
    assert.strictEqual(r.wavSha256, pinned.wav, 'patch ' + i + ' WAV hash');
  }
  console.log('nhl92 z80 audio: 22 retail patches audible, periodic at the note pitch where feedback < 6 ' +
    '(not asserted for feedback 6-7: ' + highFeedback.join(',') + '), PSG silent, WAVs match pinned hashes OK');

  // --- DAC SFX through the real core --------------------------------------------------
  const levels = [];
  {
    const chip = await ymWasm.createChip();
    chip.writeRegister(0x2b, 0x80);
    for (let b = 0; b < 256; b++) {
      chip.writeRegister(0x2a, b);
      levels.push(Math.round(chip.generateStereo(1).left[0] * 32768));
    }
    chip.dispose();
    assert.ok(levels.every((v, b) => !b || v > levels[b - 1]), 'DAC levels rise with the sample byte');
  }
  for (const [k, entry] of audio.DAC_SFX.entries()) {
    const r = await renders.renderSfx(entry, SRC);
    const m = r.machine;
    const writes = m.z.ym.filter((w) => w.part === 0 && w.reg === 0x2a);
    const want = expectedDacBytes(entry);
    assert.deepStrictEqual(writes.map((w) => w.value), want, entry.name + ': streams the retail sample bytes');
    if (want.length) {
      const regs = m.z.ym.map((w) => w.part + ':' + w.reg.toString(16) + '=' + w.value.toString(16));
      assert.strictEqual(regs[0], '0:2b=80', 'DAC enabled first');
      assert.strictEqual(regs[regs.length - 1], '0:2b=0', 'DAC disabled at the end');
      // Between two DAC writes the output holds exactly the chip's level for that byte.
      for (let i = 0; i + 1 < writes.length; i++) {
        const a = sampleAt(writes[i].t);
        const b = sampleAt(writes[i + 1].t);
        for (let s = a; s < b; s++) {
          if (r.pcm[s * 2] !== levels[writes[i].value] || r.pcm[s * 2 + 1] !== levels[writes[i].value]) {
            assert.fail(entry.name + ': sample ' + s + ' = ' + r.pcm[s * 2] + ', want ' + levels[writes[i].value]);
          }
        }
      }
      const period = 161 + 17 * (entry.rate || 256);
      for (let i = 1; i < writes.length; i++) {
        const d = writes[i].t - writes[i - 1].t;
        assert.ok(d === period || d === period + 262, entry.name + ': byte period ' + d);
      }
    }
    assert.strictEqual(m.z.ram[0x2a4], 0xff, entry.name + ': finished ($02A4 = $FF)');
    assert.deepStrictEqual(audio.otherTraffic(m.z), [], entry.name + ': no PSG/VDP writes');
    assert.strictEqual(m.psgWrites, 0);
    assert.strictEqual(m.psgPeak, 0, entry.name + ': PSG output silent');
    const pinned = MANIFEST.sfx[k];
    assert.strictEqual(pinned.file, renders.sfxName(entry) + '.wav');
    assert.strictEqual(r.logSha256, pinned.log, entry.name + ' YM log hash');
    assert.strictEqual(r.wavSha256, pinned.wav, entry.name + ' WAV hash');
  }
  {
    // Raw PCM files (lib/audio/nhl92-pcm.js): they tile the PCM block, and every DAC SFX handler starts one of them.
    const pcm = require('../lib/audio/nhl92-pcm');
    for (let i = 1; i < pcm.SAMPLES.length; i++) assert.strictEqual(pcm.SAMPLES[i].start, pcm.SAMPLES[i - 1].end, pcm.SAMPLES[i].name + ' follows the previous file');
    assert.strictEqual(pcm.SAMPLES[0].start, 0x11c3e);
    assert.strictEqual(pcm.SAMPLES[pcm.SAMPLES.length - 1].end, 0x24214);
    for (const entry of audio.DAC_SFX) {
      if (entry.name.startsWith('stop')) continue;
      const at = audio.SOUND_BASE + entry.off;
      const own = pcm.SAMPLES.filter((s) => s.start === at);
      assert.strictEqual(own.length, 1, entry.name + ' starts exactly one PCM file (' + at.toString(16) + ')');
    }
    for (const s of pcm.SAMPLES) assert.deepStrictEqual(Array.from(pcm.bytes(SRC.rom, s).slice(-2)), [0, 0], s.name + ' ends with 00 00');
    console.log('nhl92 pcm: ' + pcm.SAMPLES.length + ' raw PCM files tile $11C3E-$24213 and match the DAC SFX handlers OK');
  }
  console.log('nhl92 z80 audio: ' + audio.DAC_SFX.length + ' DAC SFX play the retail bytes at the driver rate, PSG silent OK');

  // --- Determinism: same input, byte-identical log and WAV ----------------------------
  {
    const crowd = audio.DAC_SFX.find((e) => e.name === 'sam_crowdgoal');
    const pairs = [
      [() => renders.renderPatch(0, SRC), 'patch 0'],
      [() => renders.renderPatch(15, SRC), 'patch 15'],
      [() => renders.renderSfx(crowd, SRC), 'sam_crowdgoal']
    ];
    for (const [run, label] of pairs) {
      const a = await run();
      const b = await run();
      assert.strictEqual(Buffer.compare(Buffer.from(a.wav), Buffer.from(b.wav)), 0, label + ': WAV bytes identical');
      assert.strictEqual(a.log, b.log, label + ': YM log identical');
    }
    // ymfm's reset() does not rewind every internal counter (a reused chip drifts
    // from a fresh one), so a reused chip is restored from a saved pristine state.
    const chip = await ymWasm.createChip();
    const pristine = chip.saveState();
    const once = audio.create({ program: PROGRAM, rom: ROM, chip }).play(audio.patchScaleScript(ROM, 3));
    chip.loadState(pristine);
    const twice = audio.create({ program: PROGRAM, rom: ROM, chip }).play(audio.patchScaleScript(ROM, 3));
    chip.dispose();
    const fresh = await renders.renderPatch(3, SRC);
    const bytes = (pcm) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    assert.strictEqual(Buffer.compare(bytes(once), bytes(fresh.pcm)), 0, 'first render on a new chip = fresh render');
    assert.strictEqual(Buffer.compare(bytes(twice), bytes(once)), 0, 'chip restored to its pristine state reproduces the render');
  }
  console.log('nhl92 z80 audio: deterministic register logs and WAV bytes OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
