/**
 * Replay recorded 68k-side vblank inputs into the retail NHL '92 Z80 driver and
 * compare the YM2612 register log against a retail log.
 *
 * Capture JSON (one file per recording, data/captures/nhl92/*.json):
 *   {
 *     "frames": [{ "flag": 0, "channels": "<96 hex>", "pending": 0, "sfx": "<12 hex>" }, ...],
 *     "ym": [[part, reg, value], ...]      // or "vgm": "<file next to the JSON>"
 *   }
 * frames[i] is what p_music_vblank_fn saw at vblank i after Sound_LoadZ80Program:
 * g_AudioUpdateFlag, 68k RAM $FFFFFFB6-$FFFFFFE5, z80_write_pending and
 * $FFFFFFE6-$FFFFFFEB. The Z80 runs one NTSC frame before each vblank.
 */
const harness = require('./nhl92-z80-harness');

function bytes(hexText, length, label) {
  const clean = String(hexText || '').replace(/\s+/g, '');
  if (clean.length !== length * 2) throw new Error(label + ': expected ' + length + ' bytes');
  const out = [];
  for (let i = 0; i < length; i++) out.push(parseInt(clean.slice(i * 2, i * 2 + 2), 16));
  return out;
}

function replay(capture, opts) {
  const z = harness.create({ program: opts.program, rom: opts.rom });
  const frameOf = [];
  capture.frames.forEach((f, i) => {
    z.run(harness.FRAME_TSTATES);
    frameOf.push(z.ym.length);
    z.vblank({
      flag: f.flag,
      channels: bytes(f.channels, 48, 'frame ' + i + ' channels'),
      pending: f.pending ? 1 : 0,
      sfx: f.pending ? bytes(f.sfx, 6, 'frame ' + i + ' sfx') : null
    });
  });
  z.run(harness.FRAME_TSTATES);
  return {
    ym: z.ym.map((w) => [w.part, w.reg, w.value]),
    frameStarts: frameOf,
    other: z.log.filter((e) => e.kind !== 'ymPort' && e.kind !== 'bank')
  };
}

/** YM2612 writes from a VGM (0x52/0x53, plus 0x8n DAC from the 0x67 data block). */
function ymLogFromVgm(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x206d6756) throw new Error('not a VGM file');
  const version = dv.getUint32(8, true);
  let pos = version >= 0x150 && dv.getUint32(0x34, true) ? 0x34 + dv.getUint32(0x34, true) : 0x40;
  const ym = [];
  const psg = [];
  let sample = 0;
  let pcm = new Uint8Array(0);
  let pcmPos = 0;
  while (pos < u8.length) {
    const op = u8[pos];
    if (op === 0x66) break;
    if (op === 0x52 || op === 0x53) {
      ym.push({ sample, part: op - 0x52, reg: u8[pos + 1], value: u8[pos + 2] });
      pos += 3;
    } else if (op === 0x50) {
      psg.push({ sample, value: u8[pos + 1] });
      pos += 2;
    } else if (op === 0x4f) {
      pos += 2;
    } else if (op === 0x61) {
      sample += dv.getUint16(pos + 1, true);
      pos += 3;
    } else if (op === 0x62 || op === 0x63) {
      sample += op === 0x62 ? 735 : 882;
      pos += 1;
    } else if (op >= 0x70 && op <= 0x7f) {
      sample += (op & 0x0f) + 1;
      pos += 1;
    } else if (op >= 0x80 && op <= 0x8f) {
      ym.push({ sample, part: 0, reg: 0x2a, value: pcm[pcmPos++] });
      sample += op & 0x0f;
      pos += 1;
    } else if (op === 0xe0) {
      pcmPos = dv.getUint32(pos + 1, true);
      pos += 5;
    } else if (op === 0x67) {
      const size = dv.getUint32(pos + 3, true) & 0x7fffffff;
      if (u8[pos + 2] === 0x00) {
        const next = new Uint8Array(pcm.length + size);
        next.set(pcm);
        next.set(u8.subarray(pos + 7, pos + 7 + size), pcm.length);
        pcm = next;
      }
      pos += 7 + size;
    } else {
      throw new Error('unsupported VGM command 0x' + op.toString(16) + ' at 0x' + pos.toString(16));
    }
  }
  return { ym, psg };
}

/** Exact sequence comparison of [part, reg, value] triples; reports the first divergence. */
function compare(actual, expected) {
  const n = Math.max(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const e = expected[i];
    if (!a || !e || a[0] !== e[0] || a[1] !== e[1] || a[2] !== e[2]) {
      return { ok: false, index: i, actual: a || null, expected: e || null, actualLength: actual.length, expectedLength: expected.length };
    }
  }
  return { ok: true, count: n };
}

module.exports = { replay, ymLogFromVgm, compare };
