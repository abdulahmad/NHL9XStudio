#!/usr/bin/env node
/**
 * Builds data/audio/nhl9x-dac-analysis.json: what the NHL 93/94 DAC (PCM) samples are and how the songs use them.
 *
 * For each PCM patch ($60-$6E) one hit is played through the retail 68k + Z80 drivers at the pitch the songs use most
 * (a copy of the NHL 94 slice with sound $0 replaced by a one-note stream; the repo's data is untouched) and the YM2612
 * $2A (DAC) writes are captured: that gives the sample's real playback rate, length and waveform. Measured: length,
 * peak, envelope, zero-crossing rate, spectrum split (low / mid / high), and a role guess. For each song the onsets of
 * every drum-like patch are summarised (median gap, how regular, how many hits) to tell a beat from a backbeat.
 * Usage: node tools/build-nhl9x-dac-analysis.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Song = require('../lib/audio/nhl9x-song');
const Stream = require('../lib/audio/nhl9x-stream');
const Chain = require('../lib/audio/nhl92-sound-chain');
const ym = require('../lib/audio/ym2612-wasm');
const DRIVER = { 93: require('../lib/audio/nhl93-68k-harness'), 94: require('../lib/audio/nhl94-68k-harness') };
const ROM_SIZE = { 93: 0x2e1fc, 94: 0x4b5c0 };

const OUT = path.join(__dirname, '..', 'data', 'audio', 'nhl9x-dac-analysis.json');
const Z80_HZ = 3579545;
const PCM = [0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e];
const slice = (g) => fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'nhl' + g + '-sound-slice.bin'));
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const r2 = (v) => Math.round(v * 100) / 100;

function usage() {
  const out = {};
  for (const g of [93, 94]) {
    const sl = slice(g);
    for (let id = 0; id < Song.GAMES[g].count; id++) {
      const m = Stream.fromStream(g, sl, id);
      m.notes.forEach((n) => {
        if (n.patch < 0x60 && n.patch !== 20 && n.patch !== 17 && n.patch !== 25) return;
        const u = out[n.patch] || (out[n.patch] = { notes: [], sounds: new Set(), songs: new Set() });
        u.notes.push(n.note);
        u.sounds.add(g + ':' + id.toString(16));
        if (id >= 0x30) u.songs.add(g + ':' + id.toString(16));
      });
    }
  }
  return out;
}

/** The first 10 values that are not the centre ($80), consecutive repeats collapsed: independent of the playback rate. */
function signature(values) {
  const out = [];
  for (const v of values) {
    if (v === 0x80 || v === out[out.length - 1]) continue;
    out.push(v);
    if (out.length === 10) break;
  }
  return out;
}

function dft(x, rate, f0, f1) { // mean magnitude in a band, direct DFT on up to 1024 samples
  const n = Math.min(1024, x.length);
  let sum = 0;
  let cnt = 0;
  for (let f = f0; f < f1; f += Math.max(20, (f1 - f0) / 24)) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); re += x[i] * w * Math.cos((2 * Math.PI * f * i) / rate); im += x[i] * w * Math.sin((2 * Math.PI * f * i) / rate); }
    sum += Math.sqrt(re * re + im * im);
    cnt++;
  }
  return cnt ? sum / cnt : 0;
}

async function hit(romBase, patch, note, hold, game) {
  const g = game || 94;
  const driver = DRIVER[g];
  const addr = Song.streamAddr(g, slice(g), 0);
  const copy = romBase.slice();
  copy.set([0, 0xc0, patch, 0, 0, 0x90, note, 0x7f, hold, 0x80, note, 0, 0x40, 0, 0xff, 0xff], addr);
  const chip = await ym.createChip();
  const writes = [];
  let latch = 0;
  try {
    const chain = Chain.create({ rom: copy, driver, chip, keepLogs: false, onYmWrite(t, port, value) {
      if (port === 0) latch = value;
      else if (port === 1 && latch === 0x2a) writes.push({ t, v: value });
    } });
    chain.step(null);
    chain.step([{ sfx: 0 }]);
    for (let f = 2; f < 150; f++) chain.step(null);
  } finally { chip.dispose(); }
  return writes;
}

async function build() {
  const sl94 = slice(94);
  const romBase = new Uint8Array(0x4b5c0);
  romBase.set(sl94, Song.GAMES[94].start);
  const use = usage();
  const samples = [];
  for (const p of PCM) {
    const u = use[p];
    const note = u ? median(u.notes) : 60;
    const w = await hit(romBase, p, note, 100, 94);
    if (w.length < 8) { samples.push({ patch: p, note, error: 'no DAC writes' }); continue; }
    // One hit: the writes until a gap of 8 median deltas (the next key on / silence).
    const deltas = [];
    for (let i = 1; i < w.length; i++) deltas.push(w[i].t - w[i - 1].t);
    const md = median(deltas);
    let end = w.length;
    for (let i = 1; i < w.length; i++) if (w[i].t - w[i - 1].t > md * 8) { end = i; break; }
    const rate = Z80_HZ / md;
    const x = w.slice(0, end).map((s) => (s.v - 128) / 128);
    const dur = x.length / rate;
    const peak = Math.max.apply(null, x.map(Math.abs));
    const win = Math.max(1, Math.round(rate * 0.01));
    const env = [];
    for (let i = 0; i + win <= x.length; i += win) env.push(Math.sqrt(x.slice(i, i + win).reduce((s, v) => s + v * v, 0) / win));
    const emax = Math.max.apply(null, env);
    const tPeak = env.indexOf(emax) * 0.01;
    let t20 = dur;
    for (let i = env.indexOf(emax); i < env.length; i++) if (env[i] < emax * 0.1) { t20 = i * 0.01; break; }
    let zc = 0;
    for (let i = 1; i < x.length; i++) if ((x[i] >= 0) !== (x[i - 1] >= 0)) zc++;
    const seg = x.slice(Math.max(0, Math.round(env.indexOf(emax) * win)));
    const low = dft(seg, rate, 40, 250), mid = dft(seg, rate, 250, 2500), high = dft(seg, rate, 2500, Math.min(rate / 2 - 100, 8000));
    const tot = low + mid + high || 1;
    const feat = { lengthS: r2(dur), rateHz: Math.round(rate), peak: r2(peak), peakAtS: r2(tPeak), decay10pcS: r2(t20), zeroCrossHz: Math.round(zc / dur), lowShare: r2(low / tot), midShare: r2(mid / tot), highShare: r2(high / tot) };
    const sigs = {};
    for (const g of [93, 94]) {
      const base = new Uint8Array(ROM_SIZE[g]);
      base.set(slice(g), Song.GAMES[g].start);
      const wg = await hit(base, p, note, 100, g);
      sigs[g] = signature(wg.map((x) => x.v));
    }
    samples.push({ patch: p, sig: sigs, name: '$' + p.toString(16).toUpperCase(), note, notesUsed: u ? Array.from(new Set(u.notes)).sort((a, b) => a - b) : [], sounds: u ? u.sounds.size : 0, songs: u ? u.songs.size : 0, measured: feat });
  }
  // Drum-like FM patches and PCM patches: how a song places them.
  const roles = [];
  for (const g of [93, 94]) {
    const sl = g === 94 ? sl94 : slice(93);
    for (let id = 0x30; id < Song.GAMES[g].count + 0x30 && id < Song.GAMES[g].count; id++) {
      const m = Stream.fromStream(g, sl, id);
      const per = {};
      m.notes.forEach((n) => { if (n.patch === 20 || n.patch === 17 || n.patch === 25 || n.patch >= 0x60) (per[n.patch] = per[n.patch] || []).push(n.t); });
      Object.keys(per).forEach((p) => {
        const t = per[p].sort((a, b) => a - b);
        if (t.length < 8) return;
        const gaps = [];
        for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 3) gaps.push(t[i] - t[i - 1]);
        const mg = median(gaps);
        const regular = gaps.filter((v) => Math.abs(v - mg) <= 2).length / gaps.length;
        roles.push({ game: g, sound: '$' + id.toString(16).toUpperCase(), patch: Number(p), hits: t.length, medianGapVbl: mg, regular: r2(regular) });
      });
    }
  }
  // Where the fixed-pitch FM hit (patch 20, note 21) and the PCM hit (patch $6A) sit against each other in the songs that use both:
  // phase = how far after a patch-20 hit a $6A hit falls, as a share of the gap between patch-20 hits (0.5 = exactly between two).
  const pairs = [];
  for (const g of [93, 94]) {
    const sl = g === 94 ? sl94 : slice(93);
    for (let id = 0x30; id < Song.GAMES[g].count; id++) {
      const m = Stream.fromStream(g, sl, id);
      const a = m.notes.filter((n) => n.patch === 20).map((n) => n.t).sort((x, y) => x - y);
      const b = m.notes.filter((n) => n.patch === 0x6a).map((n) => n.t).sort((x, y) => x - y);
      if (a.length < 8 || b.length < 8) continue;
      const gaps = [];
      for (let i = 1; i < a.length; i++) gaps.push(a[i] - a[i - 1]);
      const gap = median(gaps);
      const phases = b.map((t) => { let prev = null; for (const x of a) if (x <= t) prev = x; return prev == null ? null : (t - prev) / gap; }).filter((v) => v != null && v < 1.5);
      pairs.push({ game: g, sound: '$' + id.toString(16).toUpperCase(), fmHits: a.length, pcmHits: b.length, fmGapVbl: gap, medianPhase: r2(median(phases)) });
    }
  }
  return { note: 'Generated by tools/build-nhl9x-dac-analysis.js from the bundled sound slices; do not edit by hand. The decisions about what each sample is are in nhl9x-gm-map.json.', method: 'One hit of each PCM patch through the retail drivers and ymfm; the $2A (DAC) writes are the waveform (rate = Z80 clock / median write gap). Roles: onset gaps of each drum-like patch in every 93/94 song.', samples, roles, kickSnarePairs: pairs };
}

if (require.main === module) {
  build().then((a) => {
    fs.writeFileSync(OUT, JSON.stringify(a, null, 1) + '\n');
    console.log('wrote ' + OUT);
    a.samples.forEach((s) => console.log(s.name, 'note', s.note, JSON.stringify(s.measured || s.error), 'songs', s.songs));
    const by = {};
    a.roles.forEach((r) => { const k = r.patch; (by[k] = by[k] || []).push(r.medianGapVbl + '/' + r.regular); });
    Object.keys(by).forEach((k) => console.log('patch', k, by[k].slice(0, 10).join(' ')));
  }).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { build };
