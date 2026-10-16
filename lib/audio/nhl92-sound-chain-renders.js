/**
 * Node-side renders of the connected NHL '92 sound chain (step 7): every song
 * (IDs 0-4) and SFX (IDs 0-34) through the retail 68k driver, the retail Z80
 * driver and the YM2612 (ymfm WASM) + SN76489 cores, plus songs with SFX on top.
 * Shared by tools/render-nhl92-sound-chain.js and test/nhl92-sound-chain.js.
 */
const crypto = require('crypto');
const chainApi = require('./nhl92-sound-chain');
const Run = require('./nhl92-68k-run');
const SD = require('./nhl92-sound-data');
const names = require('./nhl92-sfx-names');
const ymWasm = require('./ym2612-wasm');
const psgApi = require('./sn76489');
const fixture = require('./nhl92-sound-fixture');
const wav = require('./wav');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function sources() {
  const rom = fixture.resolveRom(null);
  if (!rom) throw new Error('bundled NHL 92 sound fixture missing (data/fixtures)');
  return { rom, data: SD.parse(rom) };
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Songs at step 6's lengths (so the 68k logs compare with its pins), SFX at 600
 * vblanks, and mixes that put SFX on channels a song is using. "ch n" is the
 * driver channel, YM2612 channel n+1 (key-on codes 0,1,2,4,5,6).
 */
const MIXES = [
  { song: 0, vblanks: 900, sfx: [[120, 10], [360, 24]], note: 'SngEOP; whistle (ch4) at vb 120, foghorn (ch0+ch1) at vb 360' },
  { song: 4, vblanks: 900, sfx: [[180, 0]], note: 'SngPO; siren (ch0+ch1) at vb 180' },
  { song: 3, vblanks: 900, sfx: [[60, 13], [240, 25], [480, 15]], note: 'SngEOG; slap shot (DAC) at vb 60, crowd cheer (DAC) at vb 240, player hits boards (DAC + ch2) at vb 480' },
  { song: 1, vblanks: 900, sfx: [[120, 5], [150, 7], [180, 5], [210, 7], [240, 8], [270, 9]], note: 'SngTitle; hit puck (ch1), hit board (ch2), hit puck, hit board, puck faceoff (ch1), post (ch2), every 30 vblanks from vb 120' }
];

function songName(data, id) {
  return data.songs[id].name;
}

/**
 * Every render: { kind, id, plan, file (no extension), title, step6Title? }.
 * kind: 'song', 'sfx', 'sfx-music-off' (SFX after music init + p_turnoff) or 'mix'.
 */
function renders(src) {
  const { data } = src || sources();
  const out = [];
  for (const [id, frames] of Run.PLAN.songs) {
    const n = songName(data, id);
    out.push({
      kind: 'song', id, plan: chainApi.songPlan(id, frames),
      file: 'song-' + id + '-' + slug(n),
      title: 'NHL 92 sound chain · song ' + id + ' ' + n + ' · ' + frames + ' vblanks',
      step6Title: 'NHL 92 68k driver · song ' + id + ' ' + n + ' · ' + frames + ' vblanks'
    });
  }
  for (const [id, frames] of Run.PLAN.sfx) {
    out.push({
      kind: 'sfx', id, plan: chainApi.sfxPlan(id, frames),
      file: 'sfx-' + String(id).padStart(2, '0') + '-' + slug(names.name(id).replace(/^\d+\s*·\s*/, '')),
      title: 'NHL 92 sound chain · SFX ' + names.name(id) + ' · ' + frames + ' vblanks',
      step6Title: 'NHL 92 68k driver · SFX ' + names.name(id) + ' · ' + frames + ' vblanks'
    });
  }
  // Siren as the game reaches it: music initialised, p_turnoff, then sfx 0 (see
  // sfxPlanAfterMusicOff). The plain sfx-00 render above is the bare-boot case.
  {
    const frames = Run.PLAN.sfx.find(([id]) => id === 0)[1];
    out.push({
      kind: 'sfx-music-off', id: 0, plan: chainApi.sfxPlanAfterMusicOff(0, frames, 0),
      file: 'sfx-00-' + slug(names.name(0).replace(/^\d+\s*·\s*/, '')) + '-after-music-off',
      title: 'NHL 92 sound chain · SFX ' + names.name(0) + ' after song 0 init + p_turnoff · ' + frames + ' vblanks'
    });
  }
  MIXES.forEach((m, i) => {
    out.push({
      kind: 'mix', id: i, plan: chainApi.mixPlan(m.song, m.vblanks, m.sfx),
      file: 'mix-' + i + '-' + slug(songName(data, m.song)) + '-' + m.sfx.map(([, id]) => 'sfx' + id).join('-'),
      title: 'NHL 92 sound chain · mix ' + i + ' · ' + m.note + ' · ' + m.vblanks + ' vblanks',
      note: m.note
    });
  });
  return out;
}

/** Log of every frame's 68k → Z80 hand-off and the Z80's YM writes, as text. */
function logText(item, chain) {
  return '# ' + item.title + '\n# t part:reg=value (Z80 T-states; frame = ' + chainApi.FRAME_TSTATES + ')\n' +
    chainApi.ymLogText(chain);
}

/**
 * Render one item on a fresh YM2612 + SN76489. Returns PCM, WAV bytes, the YM log,
 * the chain, and (for songs and SFX) the 68k log in step 6's format.
 */
async function render(item, src) {
  const { rom } = src || sources();
  const chip = await ymWasm.createChip();
  try {
    const chain = chainApi.runPlan(item.plan, { rom, chip, psg: psgApi.create() });
    const pcm = chain.take();
    const wavBytes = wav.encode16(pcm, chainApi.SAMPLE_RATE, 2);
    const log = logText(item, chain);
    const m68kLog = item.step6Title ? Run.logText(chainApi.stepSixRun(item.plan, chain), item.step6Title) : null;
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
      if (v > peak) peak = v;
    }
    return {
      pcm, wav: wavBytes, log, chain, m68kLog, peak,
      wavSha256: sha256(wavBytes), logSha256: sha256(log), m68kSha256: m68kLog ? sha256(m68kLog) : null
    };
  } finally {
    chip.dispose();
  }
}

module.exports = { sources, renders, render, logText, sha256, slug, MIXES };
