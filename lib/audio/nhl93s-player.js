/**
 * NHLPA Hockey '93 (SNES) sound player: the game's own SPC700 sound program, run from its own bytes.
 *
 * Unlike NHL '94, '93 has no sequencer on the main CPU. The game uploads the sound program once (the "boot" stream:
 * driver, instruments, title/menu samples), later swaps the samples for the in-game set (the "game" stream), and
 * from then on only writes one-byte cues to port 0 with a counter on port 1. This module does what the main CPU
 * does: the two uploads (SPCBootUpload / SPCGameUpload), the cue queue (p_music_vblank: one cue every other video
 * frame) and the frame clock, and lets lib/audio/snes-spc.js run the program.
 *
 *   const p = NhlNhl93sPlayer.create({ data });   // data = NhlNhl93sSoundData.load(pack)
 *   p.loadSet('boot' | 'game');                  // uploads; 'boot' holds songs 1, 2, 3, 9, 'game' songs 4-8 and the effects
 *   p.cue(3);                                    // a song (1-9)       p.effect(0x89)  an effect ($80-$A1)
 *   p.crowd(4)                                   // crowd noise level 1-7 (cue $80+n); p.crowd(0) is KillCrowd ($88)
 *   p.record(); p.runFrames(600); const pcm = p.stopRecording();   // interleaved Int16 L, R at 32 kHz
 *
 * Cue numbers on port 0: 0 stops the music, $01-$09 start a song, $80-$87 set the crowd noise, $88 silences it,
 * $89-$A1 are effects, $F8 hands the sound unit back to its boot ROM for the next upload (docs/NHL93S-SOUND.md).
 */
(function (root, factory) {
  var api = factory(root.NhlSnesSpc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl93sPlayer = api;
})(typeof self !== 'undefined' ? self : this, function (Spc) {
  'use strict';
  if (typeof require === 'function' && typeof module === 'object') Spc = Spc || require('./snes-spc');

  var FRAME_RATE = { ntsc: 60.0988, pal: 50.0070 };
  var SETTLE_FRAMES = 10; // p_music_vblank waits after a sample upload (sndsettle)

  function create(opts) {
    opts = opts || {};
    var data = opts.data;
    var region = opts.region || 'ntsc';
    var spc = opts.spc || Spc.create();
    var frameCycles = Spc.CPU_HZ / FRAME_RATE[region];
    var frameTarget = spc.cycles;
    var running = false;
    var set = null;
    var counter = 0;
    var queue = [];
    var frames = 0;
    var log = null;
    var currentCue = 0;

    function frame(n) {
      for (var i = 0; i < n; i++) {
        frameTarget += frameCycles;
        if (spc.cycles < frameTarget) spc.runCycles(frameTarget - spc.cycles);
      }
    }

    /** Send the blocks of a stream to the boot ROM's loader and start the program at the stream's entry. */
    function upload(stream) {
      spc.iplUpload(stream.blocks.map(function (b) { return { addr: b.addr, bytes: b.bytes }; }), stream.entry);
      frameTarget = spc.cycles;
      running = true;
    }

    /**
     * SPCBootUpload / SPCGameUpload. The first upload goes to the boot ROM the unit starts in; later ones are asked for
     * with $F8 on port 0 (the program jumps back into its boot ROM), as the game's SPCUpload does.
     */
    function loadSet(name) {
      if (running) {
        spc.portWrite(0, 0xf8);
        spc.portWrite(1, 0);
        frame(8);
      }
      if (name === 'boot') {
        upload({ blocks: data.boot, entry: 0x0400 });
      } else if (name === 'game') {
        if (!running) upload({ blocks: data.boot, entry: 0x0400 }), frame(5), spc.portWrite(0, 0xf8), frame(8);
        upload({ blocks: data.game, entry: 0x0800 });
      } else throw new Error('unknown sample set ' + name);
      set = name;
      queue = [];
      currentCue = 0;
      counter = 0;
      frame(SETTLE_FRAMES);
    }

    /** Queue a command byte; it goes out on a later odd video frame like the game's vblank handler. */
    function send(cmd) {
      queue.push(cmd & 0xff);
    }

    function deliver() {
      if (!queue.length || (frames & 1) === 0) return;
      var cmd = queue.shift();
      counter = (counter + 1) & 0xff;
      spc.portWrite(0, cmd);
      spc.portWrite(1, counter);
      if (log) log.push({ frame: frames, cmd: cmd });
      if (cmd < 0x80) currentCue = cmd;
    }

    function runFrame() {
      deliver();
      frames += 1;
      frameTarget += frameCycles;
      if (spc.cycles < frameTarget) spc.runCycles(frameTarget - spc.cycles);
    }
    function runFrames(n) { for (var i = 0; i < n; i++) runFrame(); }

    function cue(n) {
      var info = data.cueList.filter(function (c) { return c.cue === n; })[0];
      if (!info) throw new Error('no song cue ' + n);
      if (set !== info.set) loadSet(info.set);
      send(n);
    }
    function effect(id) {
      if (id < 0x80 || id > 0xa1) throw new Error('effect ids are $80-$A1');
      if (set !== 'game') loadSet('game'); // QueueSound uploads the in-game set first
      send(id);
    }
    function crowd(level) {
      if (set !== 'game') loadSet('game');
      send(level ? 0x80 + level : 0x88);
    }
    function stop() { send(0); }

    /**
     * Play a song of your own (lib/audio/nhl93s-midi.js fromSmf): load the sample set it was made for, put the song bytes in
     * sound RAM at `base`, aim song cue 7 (unused in the game) at it and send the cue.
     */
    function playCustom(setName, bytes, base) {
      if (set !== setName) loadSet(setName);
      spc.load(base, bytes);
      spc.load(0x0e91 + 2 * 7, [base & 0xff, base >> 8]);
      send(7);
    }

    /** The sequencer's command register ($04) holds the last cue: 1-9 while a song plays, 0 once its order list ended. */
    function songActive() { var c = spc.ram[0x04]; return c >= 1 && c <= 0x0f; }
    function effectsActive() {
      for (var i = 0; i < 8; i++) if (spc.ram[0x03a1 + 2 * i]) return true;
      return false;
    }

    return {
      spc: spc, loadSet: loadSet, cue: cue, playCustom: playCustom, effect: effect, crowd: crowd, stop: stop, send: send,
      runFrame: runFrame, runFrames: runFrames,
      record: function () { spc.startRecording(); },
      stopRecording: function () { return spc.stopRecording(); },
      logCommands: function (on) { log = on ? [] : null; },
      get commands() { return log; },
      get frames() { return frames; },
      get set() { return set; },
      get cue_() { return currentCue; },
      get musicOn() { return songActive(); },
      /** True when nothing queued, no song and no effect program is running (the last sound may still be fading). */
      idle: function () { return !queue.length && !songActive() && !effectsActive(); },
      get stats() { return { frames: frames, cycles: spc.cycles }; }
    };
  }

  return { create: create, FRAME_RATE: FRAME_RATE };
});
