// 93S sound-effect voice log: same capture path as snes-sfx-midi.js feeds the Sound test roll.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SD = require('../lib/audio/nhl93s-sound-data');
const Sfx = require('../lib/audio/snes-sfx-midi');
const P = require('../lib/audio/nhl93s-player');

const d = SD.load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl93s-sound.json'))));
const FRAME_RATE = 60.0988;

function commandsForEffect(cue) {
  const p = P.create({ data: d });
  const commands = [];
  const vs = [];
  for (let i = 0; i < 8; i++) vs.push({ srcn: 0, pl: 0, pitch: 0, cur: null });
  const orig = p.spc.dsp.write.bind(p.spc.dsp);
  const endNote = (v, frame) => {
    if (!v.cur) return;
    const dur = frame - v.cur.frame;
    if (dur > 0) v.cur.args.frames = dur;
    commands.push(v.cur);
    v.cur = null;
  };
  p.spc.dsp.write = function (a, val) {
    orig(a, val);
    const v = val & 0xff;
    a &= 0x7f;
    const frame = p.stats.frames;
    if (a === 0x4c) {
      for (let k = 0; k < 8; k++) {
        if (!(v & (1 << k))) continue;
        endNote(vs[k], frame);
        const inst = vs[k].srcn + 10;
        vs[k].cur = { frame, name: 'keyOn', args: { voice: k, sample: inst, inst, pitch: vs[k].pitch || null } };
      }
    } else if (a === 0x5c) {
      for (let j = 0; j < 8; j++) if (v & (1 << j)) endNote(vs[j], frame);
    } else if (a < 0x80 && (a & 0x0f) <= 7) {
      const q = vs[a >> 4];
      switch (a & 0x0f) {
        case 2: q.pl = v; break;
        case 3: q.pitch = ((v & 0x3f) << 8) | q.pl; if (q.cur) q.cur.args.pitch = q.pitch; break;
        case 4: q.srcn = v; break;
        default: break;
      }
    }
  };
  let q = false;
  for (let f = 0; f < 700; f++) {
    if (!q) { p.effect(cue); q = true; }
    p.runFrame();
    if (f > 10 && p.idle()) break;
  }
  p.spc.dsp.write = orig;
  return commands;
}

const fx = commandsForEffect(0x8d);
const song = SD.load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'audio', 'nhl93s-sound.json'))));
const tl = song.timeline(3, { loops: 0 });
let songCmds = 0;
for (const e of tl.events) if (e.type === 'note' || e.type === 'percussion') songCmds += 1;

assert.ok(fx.some((c) => c.name === 'keyOn'), 'effect roll has keyOn');
assert.ok(fx[0].args.frames > 10, 'effect note has sounding length');
assert.ok(songCmds > 20, 'song timeline still has notes for the roll');

console.log('nhl93s voice roll: effect $8D ' + fx.length + ' commands, song cue 3 ' + songCmds + ' notes');
