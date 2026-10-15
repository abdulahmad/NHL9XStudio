/**
 * NHL 92 Genesis sound: 68k driver hooks + Z80 program + YM2612.
 */
(function (root, factory) {
  var z80Machine = typeof module === 'object' && module.exports
    ? require('./z80-machine')
    : root.NhlZ80Machine;
  var z80Loader = typeof module === 'object' && module.exports
    ? require('./nhl92-z80')
    : root.Nhl92Z80Driver;
  var constants = typeof module === 'object' && module.exports
    ? require('./genesis-constants')
    : root.NhlGenesisAudioConstants;
  var sequenceApi = typeof module === 'object' && module.exports
    ? require('./genesis-92-sequence')
    : root.NhlGenesis92Sequence;
  var genesis = typeof module === 'object' && module.exports
    ? require('./genesis')
    : root.NhlGenesisAudio;
  var api = factory(z80Machine, z80Loader, constants, sequenceApi, genesis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92SoundSystem = api;
})(typeof self !== 'undefined' ? self : this, function (z80Machine, z80Loader, constants, sequenceApi, genesis) {
  const WORKSPACE_SIZE = 0x200;
  const CHANNEL_STRIDE = 0x48;
  const Z80_CHANNEL_BUFFER_LEN = 0x30;
  const TICK_HZ = 60;

  const Z80_RAM = {
    audioUpdate: 0x00c0,
    sfxControl: 0x00be,
    comm40: 0x0240,
    comm41: 0x0241,
    flagA3: 0x00a3,
    flagA4: 0x00a4
  };

  function asBytes(buf) {
    if (!buf) return null;
    if (buf instanceof Uint8Array) return buf;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return new Uint8Array(buf);
  }

  function create(romBytes) {
    const rom = asBytes(romBytes);
    if (!rom) throw new Error('ROM required');
    const blob = z80Loader.extractProgram(rom);
    if (!blob) throw new Error('NHL 92 Z80 program missing from ROM');
    const machine = z80Machine.create({ pc: 0, sp: 0xff00 });
    machine.loadProgram(blob, 0);
    const workspace = new Uint8Array(WORKSPACE_SIZE);
    const z80ChannelMirror = new Uint8Array(Z80_CHANNEL_BUFFER_LEN);
    let currentTrack = -1;
    let musicInit = false;
    let audioUpdateFlag = 0;
    let z80WritePending = 0;
    let frame = 0;

    function clearWorkspace() {
      workspace.fill(0);
    }

    function initialZ80() {
      clearWorkspace();
      machine.ym.reset();
      machine.loadProgram(blob, 0);
      machine.cpu.regs.pc = 0;
      machine.cpu.regs.sp = 0xff00;
      machine.cpu.ctl.haltLatch = false;
      musicInit = false;
      currentTrack = -1;
      z80WritePending = 0;
      audioUpdateFlag = 0;
      machine.runInstructions(200);
    }

    function initTune(trackId) {
      currentTrack = trackId & 0xff;
      musicInit = true;
      workspace[4] = currentTrack;
    }

    function buildChannelMirrorFromSchedule(schedule) {
      z80ChannelMirror.fill(0);
      if (!schedule || !schedule.events || !schedule.events.length) return;
      const ev = schedule.events[0];
      const midi = ev.midi || 60;
      z80ChannelMirror[0] = 0x2a;
      z80ChannelMirror[1] = midi & 0xff;
      z80ChannelMirror[2] = 0x01;
    }

    function soundWriteYm2612(reg, dataLo, dataHi) {
      z80WritePending = 1;
      machine.ram[Z80_RAM.sfxControl] = reg & 0xff;
      machine.ram[Z80_RAM.audioUpdate] = dataLo & 0xff;
      machine.ram[Z80_RAM.comm40] = 0x2b;
      machine.ram[Z80_RAM.comm41] = dataHi & 0xff;
      machine.ram[Z80_RAM.flagA4] = 0xff;
    }

    function vblankSync() {
      if (audioUpdateFlag === 1) {
        for (let i = 0; i < Z80_CHANNEL_BUFFER_LEN; i++) {
          machine.ram[0x1c00 + i] = z80ChannelMirror[i];
        }
      }
      if (z80WritePending) {
        machine.ram[Z80_RAM.sfxControl] = z80ChannelMirror[0] || machine.ram[Z80_RAM.sfxControl];
        z80WritePending = 0;
      }
      machine.ram[Z80_RAM.flagA3] = audioUpdateFlag & 1;
      machine.ram[Z80_RAM.flagA4] = 0xff;
      audioUpdateFlag = 0;
      machine.runInstructions(800);
    }

    function updateMusicState(meta) {
      if (!musicInit || currentTrack < 0) return null;
      musicInit = false;
      const gameMeta = meta || constants.GAMES.nhl92;
      const previewMeta = genesis.previewMetaFromGame(gameMeta);
      const entry = { type: 'fm-song', track: currentTrack };
      const schedule = genesis.previewEntry(rom, entry, previewMeta);
      buildChannelMirrorFromSchedule(schedule);
      audioUpdateFlag = 1;
      return schedule;
    }

    function tick(meta) {
      frame += 1;
      const schedule = updateMusicState(meta);
      vblankSync();
      return {
        frame,
        schedule,
        ym: machine.ym.activeChannels(),
        snapshot: machine.snapshot()
      };
    }

    function runFrames(count, meta) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(tick(meta));
      return out;
    }

    function previewScheduleForEntry(entry, meta) {
      const gameMeta = meta || constants.GAMES.nhl92;
      const previewMeta = genesis.previewMetaFromGame(gameMeta);
      return genesis.previewEntry(rom, entry, previewMeta);
    }

    function playEntry(entry, meta, frameCount) {
      initialZ80();
      if (entry.type === 'fm-song') initTune(entry.track);
      else if (entry.type === 'fm-sfx') {
        soundWriteYm2612(0x28, 0x01, 0);
        initTune(0);
      }
      const frames = frameCount || 90;
      const ticks = runFrames(frames, meta);
      const duration = frames / TICK_HZ;
      const ymSchedule = machine.ym.toNoteSchedule(duration);
      if (ymSchedule.events.length) return ymSchedule;
      const last = ticks[ticks.length - 1];
      if (last && last.schedule && last.schedule.events.length) return last.schedule;
      return previewScheduleForEntry(entry, meta);
    }

    return {
      machine,
      rom,
      blob,
      workspace,
      initialZ80,
      initTune,
      tick,
      runFrames,
      playEntry,
      previewScheduleForEntry,
      soundWriteYm2612,
      Z80_RAM
    };
  }

  return { create, Z80_RAM, TICK_HZ };
});
