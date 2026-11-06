/**
 * Node-side renders of the NHL '92 chip tests (step 4): every retail patch
 * playing a scale, and every DAC SFX, through the retail Z80 driver into the
 * real YM2612 (ymfm WASM) and SN76489 cores. Shared by
 * tools/render-nhl92-chip-tests.js (writes WAVs) and test/nhl92-z80-audio.js.
 */
const crypto = require('crypto');
const audio = require('./nhl92-z80-audio');
const ymWasm = require('./ym2612-wasm');
const psgApi = require('./sn76489');
const fixture = require('./nhl92-sound-fixture');
const wav = require('./wav');

const RELEASE_FRAMES = 30;

function sources() {
  const program = fixture.getEmbeddedZ80Program();
  const rom = fixture.resolveRom(null);
  if (!program || !rom) throw new Error('bundled NHL 92 sound fixture missing (data/fixtures)');
  return { program, rom };
}

/** Bytes the driver streams for a DAC SFX: from addr+1 up to the 0 terminator. */
function sampleBytes(rom, entry) {
  const start = audio.SOUND_BASE + entry.off + 1;
  let end = start;
  while (rom[end] !== 0) end += 1;
  return { start, end };
}

/** Frames to cover one DAC SFX: its byte count x period (161 + 17*rate T-states) plus a tail. */
function sfxFrames(rom, entry) {
  const { start, end } = sampleBytes(rom, entry);
  const period = 161 + 17 * (entry.rate || 256);
  return Math.ceil(((end - start) * period) / audio.FRAME_TSTATES) + RELEASE_FRAMES;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/**
 * Render one script on a fresh YM2612 + SN76489. Returns PCM, WAV bytes, the
 * harness register log as text, and the machine for further inspection.
 */
async function render(script, src) {
  const { program, rom } = src || sources();
  const chip = await ymWasm.createChip();
  try {
    const m = audio.create({ program, rom, chip, psg: psgApi.create() });
    const pcm = m.play(script);
    const wavBytes = wav.encode16(pcm, audio.SAMPLE_RATE, 2);
    const log = audio.ymLogText(m.z);
    return { pcm, wav: wavBytes, log, machine: m, wavSha256: sha256(wavBytes), logSha256: sha256(log) };
  } finally {
    chip.dispose();
  }
}

function patchName(index) {
  return 'patch-' + String(index).padStart(2, '0');
}

function sfxName(entry) {
  return 'sfx-' + entry.rom.toString(16) + '-' + entry.name.split(' ')[0];
}

async function renderPatch(index, src) {
  const s = src || sources();
  return render(audio.patchScaleScript(s.rom, index), s);
}

async function renderSfx(entry, src) {
  const s = src || sources();
  return render(audio.sfxScript(entry, { frames: sfxFrames(s.rom, entry) }), s);
}

module.exports = {
  sources,
  sampleBytes,
  sfxFrames,
  sha256,
  render,
  renderPatch,
  renderSfx,
  patchName,
  sfxName
};
