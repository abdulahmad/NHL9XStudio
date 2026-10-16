/**
 * NHL '94 (SNES) music player: the main CPU's sequencer, ported from the NHL94SNES disassembly, driving the game's own
 * SPC700 sound program on the sound unit in lib/audio/snes-spc.js.
 *
 * What the real game does, and what this does:
 *   - the 65816 runs SoundUpdate once a frame: UpdateSfxVoices (per-voice vibrato and the pitch / gain commands),
 *     then SequencerTick (tempo counter; UpdateVoices; StepTrack for every track);
 *   - every voice action is a command to the sound program through the four ports ($2140-$2143), each with the same
 *     wait / write / wait-for-echo handshake as SPCCmd* and SeqCmd* (the SPC700 runs between port accesses);
 *   - the sound program (the 1,097 bytes at $0400 in the ROM, uploaded through the boot ROM) loads samples, sets the
 *     DSP registers and starts the voices; lib/audio/snes-dsp.js makes the sound.
 * The routines keep the original's order and its quirks (8-bit wraps, direct-page aliases such as DSPGain = high byte of
 * the pitch word at $5A, the stale InstPtr in the pitch-bend event). Names in comments are the disassembly's labels.
 *
 * Not ported (sound effects, not music): track $10 (sound-effect) work, PlaySound/QueueSound/StreamSfx, the special
 * sound entries StartSoundVoice checks by address, MusicDuck, the fade, the Mode 7 software multiplier (the hardware
 * result is what it matches).
 *
 *   const player = NhlNhl94sPlayer.create({ data: NhlNhl94sSoundData.load(pack) });
 *   player.boot();                // upload the sound program
 *   player.loadSet('game');       // SPCGameUpload: clear, SoundInit, upload the samples
 *   player.startSong('SongBrassBonanza');
 *   player.record(); player.runFrames(600); const pcm = player.stopRecording();   // 32 kHz stereo Int16
 */
(function (root, factory) {
  var api = factory(root.NhlSnesSpc, root.NhlNhl94sSoundData);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl94sPlayer = api;
})(typeof self !== 'undefined' ? self : this, function (SnesSpc, SoundData) {
  'use strict';
  if (typeof require === 'function' && typeof module === 'object') {
    SnesSpc = SnesSpc || require('./snes-spc');
    SoundData = SoundData || require('./nhl94s-sound-data');
  }

  var SET_UPLOAD = { game: 'game', menu: 'menu', title: 'title', intro: 'intro' };
  var MASKS = [1, 2, 4, 8, 16, 32, 64, 128];

  var s8 = function (v) { return (v << 24) >> 24; };
  var s16 = function (v) { return (v << 16) >> 16; };

  /** MulFrac8 (hardware path): hi is the byte left in B (signed), lo the byte in A (doubled, 8 bit); returns the product's middle byte. */
  function mulFrac8(hi, lo) {
    return ((((lo << 1) & 0xff) * s8(hi)) >> 8) & 0xff;
  }
  /** MulFrac16 (hardware path): a (16 bit, signed) * y (8 bit, signed) / 128, 16 bit. */
  function mulFrac16(a, y) {
    return ((((s16(a) * s8(y)) >> 8) << 1) & 0xffff);
  }

  function create(opts) {
    opts = opts || {};
    var data = opts.data;
    var region = opts.region || 'ntsc';
    var mono = !!opts.mono;
    var spc = opts.spc || SnesSpc.create();
    var pack = data.pack;
    var pitchTable = pack.pitchTable;
    var volumeCurve = pack.volumeCurve;

    // ---- direct page ($5A-$61) and the variables the routines share ----
    var dp = new Uint8Array(256);
    var ED1 = 0x5a, DSPGAIN = 0x5b, STARTGAIN = 0x5c, ED2 = 0x5e, EVCODE = 0x60;
    var rd16 = function (a) { return dp[a] | (dp[a + 1] << 8); };
    var wr16 = function (a, v) { dp[a] = v & 0xff; dp[a + 1] = (v >> 8) & 0xff; };

    var song = null; // { bytes, name, tempo, trackCount }
    var soundTable = null; // the 48-byte sound entries of the loaded set (arrays)
    var setName = null;
    var instPtr = null; // the global InstPtr ($..) the routines share

    var musicOn = 0;
    var musicPause = 0;
    var tempoAcc = 0;
    var tempoTick = 0x12;
    var trackCount = 0;
    var curTrack = 0;
    var curVoice = 0;
    var voiceRotor = 0;
    var soundVolHi = 0x50;
    var echoVoices = 0, noiseVoices = 0, pitchModVoices = 0, echoDelay = 0, echoVolume = 0, echoFeedback = 0;
    var voiceVolL = 0, voiceVolR = 0;
    var instVolL = 0, instVolR = 0;
    var eventPtr = 0, curTrackPtr = 0;

    var T = 17;
    var trackPtr = new Array(T).fill(0), trackLoop = new Array(T).fill(0), trackWait = new Array(T).fill(0);
    var trackInst = new Array(T).fill(null), trackBend = new Array(T).fill(0), trackBendRange = new Array(T).fill(0);
    var trackVolL = new Array(T).fill(0), trackVolR = new Array(T).fill(0), trackSustain = new Array(T).fill(0);
    var V = 8;
    var vState = new Array(V).fill(0), vTrack = new Array(V).fill(0), vVelocity = new Array(V).fill(0), vNote = new Array(V).fill(0);
    var vPriority = new Array(V).fill(0), vLength = new Array(V).fill(0), vInst = new Array(V).fill(null), vGain = new Array(V).fill(0);
    var vPitch = new Array(V).fill(0), vBase = new Array(V).fill(0), vAge = new Array(V).fill(0);
    var vVibCount = new Array(V).fill(0), vVibOfs = new Array(V).fill(0), vVibRate = new Array(V).fill(0), vVibRateFrac = new Array(V).fill(0);
    var vVibDepth = new Array(V).fill(0), vVibDepthFrac = new Array(V).fill(0), vVibSpeed = new Array(V).fill(0), vVibSpeedFrac = new Array(V).fill(0);
    var vVibDir = new Array(V).fill(0);

    var stats = { commands: 0, keyOns: 0, steals: 0, frames: 0 };
    var commandLog = null;

    // ---- the ports: run the sound unit until a condition holds ----
    function runUntil(cond, what) {
      for (var i = 0; i < 400000; i++) {
        if (cond()) return;
        spc.step();
      }
      throw new Error('nhl94s-player: the sound program stopped answering (' + what + ')');
    }
    var port0Zero = function () { return spc.portRead(0) === 0; };
    function waitFree() { runUntil(port0Zero, 'port 0 busy'); }
    function waitEcho(n, v) { runUntil(function () { return spc.portRead(n) === v; }, 'echo ' + v.toString(16) + ' on port ' + n); }
    function pw(n, v) { spc.portWrite(n, v & 0xff); }
    function logCmd(name, args) { stats.commands += 1; if (commandLog) commandLog.push({ frame: stats.frames, name: name, args: args }); }

    // Commands the sequencer sends (SeqCmd*), the way the 65816 code does.
    function seqCmd07(voice) {
      waitFree();
      pw(1, voice); pw(2, voiceVolL); pw(3, voiceVolR); pw(0, 0x07);
      waitEcho(0, 0x07);
      var inst = instPtr;
      pw(1, inst[0x14]); pw(2, inst[0x15]); pw(3, inst[0x16]); pw(0, 0x81);
      waitEcho(0, 0x81);
      pw(0, 0);
      waitFree();
      pw(1, voice); pw(2, dp[ED1]); pw(3, dp[ED1 + 1]); pw(0, 0x06);
      waitEcho(0, 0x06);
      pw(0, 0);
      stats.keyOns += 1;
      logCmd('keyOn', { voice: voice, sample: inst[0x14], adsr1: inst[0x15], adsr2: inst[0x16], volL: voiceVolL, volR: voiceVolR, pitch: rd16(ED1) });
      if (!(inst[0x15] & 0x80)) {
        waitFree();
        pw(2, dp[STARTGAIN + 1]); pw(0, 0x0c);
        waitEcho(0, 0x0c);
        pw(0, 0);
      }
    }
    function seqCmd0C(voice) {
      waitFree();
      pw(2, dp[DSPGAIN]); pw(1, voice); pw(0, 0x0c);
      waitEcho(0, 0x0c);
      pw(0, 0);
      logCmd('gain', { voice: voice, gain: dp[DSPGAIN] });
    }
    function seqCmd0B(voice) {
      waitFree();
      pw(2, dp[EVCODE]); pw(3, dp[EVCODE + 1]); pw(1, voice); pw(0, 0x0b);
      waitEcho(0, 0x0b);
      pw(0, 0);
    }
    function seqCmd0C0B(voice) { seqCmd0C(voice); seqCmd0B(voice); }
    function cmd0E(voice, l, r) {
      waitFree();
      pw(3, r); pw(2, l); pw(1, voice); pw(0, 0x0e);
      waitEcho(0, 0x0e);
      pw(0, 0);
    }
    function cmdSimple(c) {
      waitFree();
      pw(0, c);
      waitEcho(0, c);
      pw(0, 0);
    }
    /** SeqCmd08Init_send: master volume, pitch modulation, noise, echo enable. */
    function seqCmd08InitSend() {
      waitFree();
      pw(1, soundVolHi); pw(2, soundVolHi); pw(3, pitchModVoices); pw(0, 0x08);
      waitEcho(0, 0x08);
      pw(1, noiseVoices); pw(2, echoVoices); pw(0, 0x82);
      waitEcho(0, 0x82);
      pw(0, 0);
    }
    /** SeqCmd08: the same, then the echo parameters when any voice has echo. */
    function seqCmd08() {
      seqCmd08InitSend();
      if (echoVoices) {
        waitFree();
        pw(1, echoVolume); pw(2, echoVolume); pw(3, echoFeedback); pw(0, 0x09);
        waitEcho(0, 0x09);
        pw(1, 0xe0); pw(2, echoDelay); pw(0, 0x83);
        waitEcho(0, 0x83);
        pw(0, 0);
      }
    }
    function seqCmd08Init() {
      cmdSimple(0x0d);
      pitchModVoices = 0; noiseVoices = 0; echoVoices = 0; echoDelay = 0; echoVolume = 0; echoFeedback = 0;
      seqCmd08InitSend();
    }

    // ---- voices ----
    function stopVoice(v) {
      vState[v] = 0; vTrack[v] = 0xff;
      dp[DSPGAIN] = 0x9f;
      seqCmd0C(v);
    }

    function releaseVoice(v) {
      var st = vState[v];
      if (st === 0) return;
      if (st === 1) { stopVoice(v); return; }
      vState[v] = 4;
      instPtr = vInst[v];
      var w15 = instPtr[0x15] | (instPtr[0x16] << 8);
      vGain[v] = (((w15 >> 1) & 0x7000) + 0x0fff) & 0xffff;
      var b = instPtr[0x11]; // (word at +$10) after xba: its high byte
      dp[DSPGAIN] = b >= 0x6d ? 0x9f : b >= 0x36 ? 0x99 : b >= 0x03 ? 0x8c : 0x81;
      seqCmd0C(v);
    }

    /** UpdateVoice for a music voice: count the note length down, release at the end unless the sustain pedal is held. */
    function updateVoice(v) {
      var len = vLength[v];
      if (len & 0x8000) return;
      if (len) { vLength[v] = (len - 1) & 0xffff; return; }
      if (vState[v] === 4) return;
      if (trackSustain[vTrack[v]] !== 0) return;
      releaseVoice(v);
    }
    function updateVoices() {
      for (var v = 0; v < 8; v++) {
        curVoice = v;
        if (vState[v] && vTrack[v] < 0x10) updateVoice(v);
      }
    }

    /** UpdateSfxVoices: every frame, for every active voice: age, vibrato, then the pitch / gain commands for its state. */
    function updateSfxVoices() {
      for (var v = 0; v < 8; v++) {
        curVoice = v;
        var st = vState[v];
        if (!st) continue;
        if (vTrack[v] >= 0x10) updateVoice(v);
        instPtr = vInst[v];
        var inst = instPtr;
        var w = function (o) { return inst[o] | (inst[o + 1] << 8); };
        wr16(EVCODE, vPitch[v]); // SendPitch
        wr16(ED1, vGain[v]); // GainWord
        var age = (vAge[v] + 1) & 0xffff;
        vAge[v] = age;
        if (!(age >= w(0x1a)) && !(age < w(0x18))) {
          vVibCount[v] = (vVibCount[v] - 1) & 0xffff;
          if (vVibCount[v] & 0x8000) {
            // .t3: ramp the vibrato rate, depth and speed (16-bit adds with carry from the fraction), then step the offset
            var sum = w(0x2a) + vVibRateFrac[v];
            vVibRateFrac[v] = sum & 0xffff;
            var rate = (w(0x2c) + vVibRate[v] + (sum >> 16)) & 0xffff;
            vVibRate[v] = rate; vVibCount[v] = rate;
            sum = w(0x26) + vVibDepthFrac[v];
            vVibDepthFrac[v] = sum & 0xffff;
            vVibDepth[v] = (w(0x28) + vVibDepth[v] + (sum >> 16)) & 0xffff;
            sum = w(0x22) + vVibSpeedFrac[v];
            vVibSpeedFrac[v] = sum & 0xffff;
            var speed = (w(0x24) + vVibSpeed[v] + (sum >> 16)) & 0xffff;
            vVibSpeed[v] = speed;
            if (!(vVibDir[v] & 0x8000)) {
              var ofs = (speed + vVibOfs[v]) & 0xffff;
              vVibOfs[v] = ofs;
              if (!(ofs & 0x8000) && ofs >= vVibDepth[v]) {
                if (w(0x2d) & 0x4000) vVibDir[v] = (vVibDir[v] - 1) & 0xffff;
                else vVibOfs[v] = 0;
              }
            } else {
              var o2 = (vVibOfs[v] - speed) & 0xffff;
              vVibOfs[v] = o2;
              if (o2 & 0x8000) {
                var mag = ((o2 ^ 0xffff) + 1) & 0xffff;
                if (!(mag < vVibDepth[v])) {
                  if (w(0x2d) & 0x8000) vVibDir[v] = (vVibDir[v] + 1) & 0xffff;
                  else vVibOfs[v] = 0;
                }
              }
            }
            wr16(EVCODE, (rd16(EVCODE) + vVibOfs[v]) & 0xffff);
          }
        }
        if (st === 2) seqCmd0B(v);
        else if (st === 4) {
          var g = vGain[v] - (inst[0x10] | (inst[0x11] << 8));
          vGain[v] = g & 0xffff;
          if (g >= 0) seqCmd0B(v);
          else stopVoice(v);
        } else seqCmd0C0B(v);
      }
    }

    /** FindFreeVoice: the next free voice (round robin) the sound entry may use, else steal the best candidate. -1: none. */
    function findFreeVoice(inst) {
      voiceRotor = (voiceRotor + 1) & 7;
      var x = voiceRotor;
      for (var y = 7; y >= 0; y--) {
        if (vState[x] === 0 && (inst[0] & MASKS[x])) return x;
        x = (x + 1) & 7;
      }
      var best = 0xff;
      instVolL = 0; voiceVolL = 0; instVolR = 0;
      voiceVolR = inst[0x2a];
      x = voiceRotor;
      var yy = 0x0e;
      for (var n = 0; n < 8; n++) {
        if (inst[0] & MASKS[x]) {
          // the age index runs down from voice 7 while x walks up from the rotor, as in the original
          var ageHere = vAge[yy >> 1];
          if (!(voiceVolR < vPriority[x])) {
            var st = vState[x];
            if (!(st < instVolR)) {
              if (st === instVolR) {
                if (!(ageHere < instVolL)) { best = x; instVolL = ageHere; }
              } else { best = x; instVolR = st; instVolL = ageHere; }
            }
          }
        }
        x = (x + 1) & 7;
        yy -= 2;
      }
      if (best !== 0xff) {
        stats.steals += 1;
        seqCmd0C(best);
      }
      return best === 0xff ? -1 : best;
    }

    /** StartSoundVoice for the note just read (EventCode, EventData1 = velocity, EventData2 = length) on track t. */
    function startSoundVoice(t) {
      var inst = trackInst[t];
      if (!inst) return;
      instPtr = inst;
      var v = findFreeVoice(inst);
      curVoice = v;
      if (v < 0) return;
      vTrack[v] = curTrack;
      vPriority[v] = inst[0x2a];
      vState[v] = (inst[0x15] & 0x80) ? 2 : 1;
      var w = function (o) { return inst[o] | (inst[o + 1] << 8); };
      vLength[v] = (rd16(ED2) - 1) & 0xffff;
      vAge[v] = 0; vVibCount[v] = 0; vVibOfs[v] = 0;
      vVibRate[v] = w(0x1c); vVibRateFrac[v] = 0;
      vVibDepth[v] = w(0x20); vVibDepthFrac[v] = 0;
      vVibSpeed[v] = w(0x1e); vVibSpeedFrac[v] = 0;
      vVibDir[v] = (w(0x2d) & 0x8000) ? 0x0000 : 0xffff;
      vGain[v] = w(0x0a);
      wr16(STARTGAIN, w(0x0a));
      vInst[v] = inst;
      var c = volumeCurve[dp[ED1]] || 0;
      if (c === 0x40) {
        voiceVolL = trackVolL[curTrack];
        voiceVolR = trackVolR[curTrack];
      } else {
        var a = (c << 1) & 0xff;
        dp[ED1] = a;
        vVelocity[v] = a;
        voiceVolL = mulFrac8(a, trackVolL[curTrack]);
        voiceVolR = mulFrac8(a, trackVolR[curTrack]);
      }
      var note = (dp[EVCODE] + inst[4]) & 0xff;
      dp[EVCODE] = note;
      vNote[v] = note;
      var a2 = curTrack === 9 ? (0x3f + inst[4]) & 0xff : note;
      var pitch = pitchTable[a2 & 0x7f];
      vBase[v] = pitch;
      wr16(ED1, pitch);
      var range = trackBendRange[curTrack];
      var bend = trackBend[curTrack];
      if (range && bend) {
        var ec = dp[EVCODE];
        if (!(bend & 0x80)) {
          wr16(ED2, (pitchTable[((ec + range) & 0xff) & 0x7f] - rd16(ED1)) & 0xffff);
          wr16(ED1, (mulFrac16(rd16(ED2), bend) + rd16(ED1)) & 0xffff);
        } else {
          wr16(ED2, (rd16(ED1) - pitchTable[((ec - range) & 0xff) & 0x7f]) & 0xffff);
          var tneg = (0 - bend) & 0xff;
          var mf = (tneg & 0x80) ? rd16(ED2) : mulFrac16(rd16(ED2), tneg);
          wr16(ED1, (rd16(ED1) - mf) & 0xffff);
        }
      }
      vPitch[v] = (w(2) + rd16(ED1)) & 0xffff;
      seqCmd07(v);
    }

    // ---- reading the track ----
    var bytes = null;
    function readVarLen() {
      var v = 0;
      for (;;) {
        var c = bytes[eventPtr++];
        v = ((v << 7) | (c & 0x7f)) & 0xffff;
        if (!(c & 0x80)) return v;
      }
    }
    /** ReadTrackEvent: drop the delay in front of the event, read the event and its operands into the direct page. */
    function readTrackEvent() {
      eventPtr = curTrackPtr;
      readVarLen();
      var code = bytes[eventPtr++];
      dp[EVCODE] = code;
      if (code < 0xd9) {
        dp[ED1] = bytes[eventPtr++];
        wr16(ED2, readVarLen());
        return code;
      }
      if (code === 0xe7) { eventPtr += bytes[eventPtr] + 1; return code; }
      if (code === 0xd9 || code === 0xda || code === 0xdb || code === 0xe3) return code;
      if (code === 0xdc || code === 0xea || code === 0xdd || code === 0xde || code === 0xe2) { dp[ED1] = bytes[eventPtr++]; return code; }
      if (code === 0xdf) { dp[ED1] = bytes[eventPtr++]; dp[ED2] = bytes[eventPtr++]; return code; }
      if (code === 0xe5) { wr16(ED2, bytes[eventPtr] | (bytes[eventPtr + 1] << 8)); eventPtr += 2; return code; }
      return code;
    }

    function setTrackVolumeFromInst(t) {
      var inst = trackInst[t];
      if (!inst) return;
      if (mono) { trackVolL[t] = inst[0x17]; trackVolR[t] = inst[0x17]; } else { trackVolL[t] = inst[0x12]; trackVolR[t] = inst[0x13]; }
    }

    /** StepTrack: count the track's wait down, or play its events until the next wait. */
    function stepTrack(t) {
      curTrack = t;
      if (trackWait[t]) { trackWait[t] = (trackWait[t] - 1) & 0xffff; return; }
      curTrackPtr = trackPtr[t];
      for (;;) {
        var code = readTrackEvent();
        curTrackPtr = eventPtr;
        if (code < 0xd9) {
          if (t === 9) {
            instPtr = soundTable[(code - 0x2f) & 0xff] || null;
            trackInst[t] = instPtr;
            if (instPtr) { trackVolL[t] = instPtr[0x12]; trackVolR[t] = instPtr[0x13]; trackBendRange[t] = instPtr[0x2f]; trackBend[t] = 0; }
          }
          startSoundVoice(t);
        } else if (code === 0xd9 || code === 0xda) {
          musicStop();
          return;
        } else if (code === 0xe2) {
          trackLoop[t] = trackPtr[t];
        } else if (code === 0xdb) {
          trackPtr[t] = trackLoop[t];
          curTrackPtr = trackPtr[t];
          continue; // the wait is 0: read again from the loop point
        } else if (code === 0xdd) {
          tempoTick = dp[ED1];
        } else if (code === 0xde) {
          trackVolume(t, dp[ED1]);
        } else if (code === 0xdf) {
          controller(t, dp[ED1], dp[ED2]);
        } else if (code === 0xe5) {
          bendEvent(t);
        } else if (code === 0xdc) {
          instPtr = soundTable[dp[ED1] === 0x6a ? 0x14 : dp[ED1]] || null;
          trackInst[t] = instPtr;
          if (instPtr) {
            trackBendRange[t] = instPtr[0x2f];
            trackBend[t] = 0;
            setTrackVolumeFromInst(t);
          }
        }
        // $E3, $E7, $EA and anything unknown: nothing more to do
        var delay = readVarLen();
        if (delay === 0) continue; // next event now (curTrackPtr still points before the zero delay)
        trackPtr[t] = curTrackPtr;
        trackWait[t] = (delay - 1) & 0xffff;
        return;
      }
    }

    /** Event $DE / controller 7: scale the track volume by the new value and send each of the track's voices its new level. */
    function trackVolume(t, value) {
      var inst = trackInst[t];
      if (!inst) return;
      instPtr = inst;
      instVolL = mono ? inst[0x17] : inst[0x12];
      instVolR = mono ? inst[0x17] : inst[0x13];
      trackVolL[t] = mulFrac8(instVolL, value);
      trackVolR[t] = mulFrac8(instVolR, value);
      for (var y = 7; y >= 0; y--) {
        if (vTrack[y] !== t) continue;
        voiceVolL = mulFrac8(trackVolL[t], vVelocity[y]);
        voiceVolR = mulFrac8(trackVolR[t], vVelocity[y]);
        cmd0E(y, voiceVolL, voiceVolR);
      }
    }

    function controller(t, num, value) {
      if (num === 0x07) trackVolume(t, value);
      else if (num === 0x40) {
        trackSustain[t] = value;
        if (value === 0) {
          for (var x = 7; x >= 0; x--) if (vTrack[x] === t && vState[x]) releaseVoice(x);
        }
      } else if (num === 0x0b) trackVolL[t] = value;
      else if (num === 0x0c) trackVolR[t] = value;
      else if (num === 0x32) { echoVoices = value; seqCmd08(); }
      else if (num === 0x33) { echoDelay = value; seqCmd08(); }
      else if (num === 0x34) { echoVolume = value; seqCmd08(); }
      else if (num === 0x35) { echoFeedback = value; seqCmd08(); }
      else if (num === 0x37) { soundVolHi = value; seqCmd08InitSend(); }
      else if (num === 0x39) { noiseVoices = value; seqCmd08InitSend(); }
      // $38, $3A and the rest: nothing
    }

    /** Event $E5 (pitch bend): two data bytes make a signed bend; each voice of the track is re-pitched from its base note. */
    function bendEvent(t) {
      var e = rd16(ED2);
      var lo = (e & 0xff) << 1 & 0xff;
      var a = ((e & 0xff00) | lo);
      a = ((a - 0x4000) << 1) & 0xffff;
      var bend = (a >> 8) & 0xff;
      trackBend[t] = bend;
      dp[STARTGAIN] = bend;
      var range = trackBendRange[t];
      if (!range) return;
      dp[EVCODE] = range;
      for (var y = 7; y >= 0; y--) {
        if (vTrack[y] !== curTrack) continue;
        var ed1;
        if (bend === 0) ed1 = vBase[y];
        else if (!(bend & 0x80)) {
          var up = (pitchTable[((vNote[y] + range) & 0xff) & 0x7f] - vBase[y]) & 0xffff;
          wr16(ED2, up);
          ed1 = (mulFrac16(up, bend) + vBase[y]) & 0xffff;
        } else {
          var lowP = pitchTable[((vNote[y] - range) & 0xff) & 0x7f];
          wr16(ED1, lowP);
          var diff = (vBase[y] - lowP) & 0xffff;
          wr16(ED2, diff);
          var tneg = (0 - bend) & 0xff;
          var mf = (tneg & 0x80) ? diff : mulFrac16(diff, tneg);
          ed1 = (vBase[y] - mf) & 0xffff;
        }
        wr16(ED1, ed1);
        var off = instPtr ? (instPtr[2] | (instPtr[3] << 8)) : 0; // the original uses whatever InstPtr was left pointing at
        vPitch[y] = (off + ed1) & 0xffff;
      }
    }

    function sequencerTick() {
      tempoAcc = (tempoAcc + 0x40) & 0xff;
      for (;;) {
        if (tempoAcc < tempoTick) return;
        updateVoices();
        if (!musicPause) {
          if (!trackCount) return;
          for (var x = trackCount - 1; x >= 0; x--) {
            stepTrack(x);
            if (!musicOn) return;
          }
        }
        tempoAcc = (tempoAcc - tempoTick) & 0xff;
      }
    }

    function musicStop() {
      musicOn = 0;
      trackCount = 0;
      for (var y = 7; y >= 0; y--) if (vTrack[y] < 0x10 && vState[y]) stopVoice(y);
      for (var i = 0; i < 16; i++) { trackInst[i] = null; trackWait[i] = 0; }
    }

    // ---- boot, uploads, song start ----
    var frameCycles = SnesSpc.CPU_HZ / (region === 'pal' ? SoundData.FRAME_RATE.pal : SoundData.FRAME_RATE.ntsc);
    var frameTarget = 0;

    function boot() {
      var drv = pack.driver;
      var code = Uint8Array.from(typeof Buffer !== 'undefined' ? Buffer.from(drv.code, 'base64') : atob(drv.code).split('').map(function (c) { return c.charCodeAt(0); }));
      spc.iplUpload([{ addr: drv.load, bytes: code }], drv.load);
      spc.start(drv.load);
      frameTarget = spc.cycles;
    }

    function soundInit() {
      for (var v = 7; v >= 0; v--) stopVoice(v);
      soundVolHi = 0x50;
      for (var i = 0; i < T; i++) { trackInst[i] = null; trackWait[i] = 0; trackBend[i] = 0; trackBendRange[i] = 0; trackSustain[i] = 0; trackVolL[i] = 0; trackVolR[i] = 0; }
      for (var j = 0; j < V; j++) { vState[j] = 0; vTrack[j] = 0; vAge[j] = 0; }
      seqCmd08Init();
      tempoTick = 0x12;
      voiceRotor = 0;
    }

    /** SPCUpload of one sample: command $03 with the loop point, then the BRR bytes one handshake each. */
    function uploadSample(name) {
      var s = data.sample(name);
      waitFree();
      pw(2, s.loop & 0xff); pw(3, s.loop >> 8); pw(0, 0x03); pw(1, 0);
      waitEcho(0, 0x03);
      for (var i = 0; i < s.brr.length; i++) {
        pw(2, s.brr[i]);
        var cnt = (i + 1) & 0xff;
        pw(1, cnt);
        waitEcho(1, cnt);
      }
      pw(0, 0);
    }

    /** Load a sample set the way SPCGameUpload / SPCMenuUpload do: clear, SoundInit, upload the samples in list order. */
    function loadSet(name) {
      if (!SET_UPLOAD[name]) throw new Error('unknown sample set ' + name);
      setName = name;
      musicStop();
      cmdSimple(0x01);
      soundTable = data.sounds(name).map(function (s) { return s.raw; });
      soundInit();
      data.sampleList(name).forEach(uploadSample);
    }

    /** MusicStart. */
    function startSong(name) {
      musicStop();
      song = data.song(name);
      bytes = data.songBytes(name);
      var numerator = SoundData.TEMPO_NUMERATOR[region];
      tempoTick = Math.floor(numerator / bytes[1]) & 0xff;
      tempoAcc = 0;
      trackCount = bytes[6];
      for (var i = 0; i < 16; i++) { trackPtr[i] = 0; trackLoop[i] = 0; trackWait[i] = 0; }
      var n = 0;
      for (var y = 8; y + 1 < bytes.length; y += 2) {
        var off = bytes[y] | (bytes[y + 1] << 8);
        if (!off) break;
        trackPtr[n] = off; trackLoop[n] = off;
        n += 1;
      }
      musicOn = 1;
      frameTarget = spc.cycles; // the frame clock starts here (uploads take as long as they take)
    }

    /** One video frame of SoundUpdate; the sound unit then runs on to the frame boundary. */
    function runFrame() {
      updateSfxVoices();
      if (musicOn) sequencerTick();
      stats.frames += 1;
      frameTarget += frameCycles;
      if (spc.cycles < frameTarget) spc.runCycles(frameTarget - spc.cycles);
    }
    function runFrames(n) { for (var i = 0; i < n; i++) runFrame(); }

    return {
      spc: spc, boot: boot, loadSet: loadSet, startSong: startSong, stop: musicStop, runFrame: runFrame, runFrames: runFrames,
      record: function () { spc.startRecording(); },
      stopRecording: function () { return spc.stopRecording(); },
      logCommands: function (on) { commandLog = on ? [] : null; },
      get commands() { return commandLog; },
      get stats() { return stats; },
      get musicOn() { return !!musicOn; },
      get song() { return song; },
      voices: function () { return vState.map(function (s, i) { return { state: s, track: vTrack[i], note: vNote[i], pitch: vPitch[i], age: vAge[i] }; }); },
      mulFrac8: mulFrac8, mulFrac16: mulFrac16
    };
  }

  return { create: create, mulFrac8: mulFrac8, mulFrac16: mulFrac16 };
});
