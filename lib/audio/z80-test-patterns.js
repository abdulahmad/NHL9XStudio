/**
 * Built-in Z80 test patterns for the Z80 test game mode.
 */
(function (root, factory) {
  var z80Machine = typeof module === 'object' && module.exports
    ? require('./z80-machine')
    : root.NhlZ80Machine;
  var z80Loader = typeof module === 'object' && module.exports
    ? require('./nhl92-z80')
    : root.Nhl92Z80Driver;
  var soundSystem = typeof module === 'object' && module.exports
    ? require('./nhl92-sound-system')
    : root.Nhl92SoundSystem;
  var fixture = typeof module === 'object' && module.exports
    ? require('./nhl92-sound-fixture')
    : root.Nhl92SoundFixture;
  var api = factory(z80Machine, z80Loader, soundSystem, fixture);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlZ80TestPatterns = api;
})(typeof self !== 'undefined' ? self : this, function (z80Machine, z80Loader, soundSystem, fixture) {
  function romFor(rom) {
    return fixture ? fixture.resolveRom(rom) : rom;
  }
  const PATTERNS = [
    {
      id: 'ram_walk',
      label: 'RAM walk (LD/ST)',
      blurb: 'Writes a counting pattern into Z80 RAM without the NHL driver.',
      run() {
        const m = z80Machine.create();
        const prog = new Uint8Array([
          0x21, 0x00, 0x08, 0x3e, 0x01, 0x77, 0x23, 0x3c, 0xfe, 0x10, 0x20, 0xf9, 0x76
        ]);
        m.loadProgram(prog, 0);
        m.runInstructions(200);
        const slice = m.ram.subarray(0x800, 0x810);
        let ok = true;
        for (let i = 0; i < 0x0f; i++) {
          if (slice[i] !== i + 1) ok = false;
        }
        return { ok, snapshot: m.snapshot(), detail: ok ? 'RAM 0x800–0x80E = 1..15' : 'RAM pattern mismatch' };
      }
    },
    {
      id: 'ym_ping',
      label: 'YM2612 ping',
      blurb: 'Z80 code writes key-on to the YM via 0x4000 bus addresses.',
      run() {
        const m = z80Machine.create();
        const prog = new Uint8Array([
          0x3e, 0x28, 0x32, 0x00, 0x40, 0x3e, 0xf0, 0x32, 0x01, 0x40, 0x3e, 0x4c, 0x32, 0x00, 0x40,
          0x3e, 0x00, 0x32, 0x01, 0x40, 0x3e, 0x28, 0x32, 0x00, 0x40, 0x3e, 0x01, 0x32, 0x01, 0x40,
          0x76
        ]);
        m.loadProgram(prog, 0);
        m.runInstructions(80);
        const ch = m.ym.activeChannels();
        return {
          ok: m.ym.writes.length >= 4,
          snapshot: m.snapshot(),
          ym: ch,
          detail: 'YM writes: ' + m.ym.writes.length
        };
      }
    },
    {
      id: 'nhl_driver_boot',
      label: 'NHL 92 driver boot',
      blurb: 'Load NHL 92 Z80_Program_Code (bundled or from your ROM) and run ~2k instructions.',
      needsRom: false,
      run(rom) {
        const resolved = romFor(rom);
        const blob = z80Loader.extractProgram(resolved)
          || (fixture && fixture.getEmbeddedZ80Program());
        if (!blob) return { ok: false, detail: 'Z80 program fixture missing' };
        const m = z80Machine.create();
        m.loadProgram(blob, 0);
        const before = m.snapshot();
        m.runInstructions(2500);
        const after = m.snapshot();
        return {
          ok: after.instructions > before.instructions + 100,
          snapshot: after,
          detail: 'PC=0x' + after.pc.toString(16) + ' instr=' + after.instructions
        };
      }
    },
    {
      id: 'nhl_fmtune_title',
      label: 'NHL 92 title (driver + 68k)',
      blurb: 'Init tune 1, run 2s of vblanks, merge YM + cmdstream preview.',
      needsRom: false,
      run(rom) {
        const resolved = romFor(rom);
        if (!resolved) return { ok: false, detail: 'Load bundled sound fixture failed' };
        const sys = soundSystem.create(resolved);
        sys.initialZ80();
        sys.initTune(1);
        sys.runFrames(120);
        const sched = sys.playEntry({ type: 'fm-song', track: 1 }, null, 60);
        return {
          ok: sched && sched.events && sched.events.length > 0,
          schedule: sched,
          snapshot: sys.machine.snapshot(),
          ym: sys.machine.ym.activeChannels(),
          detail: sched ? (sched.events.length + ' preview events') : 'no schedule'
        };
      }
    },
    {
      id: 'nhl_sfx_beep',
      label: 'NHL 92 UI beep SFX',
      blurb: 'Play cmdstream SFX via 68k schedule (square preview).',
      needsRom: false,
      run(rom) {
        const resolved = romFor(rom);
        if (!resolved) return { ok: false, detail: 'Load bundled sound fixture failed' };
        const sys = soundSystem.create(resolved);
        const entry = { type: 'fm-sfx', start: 0x1016a, end: 0x1017a };
        const sched = sys.playEntry(entry, null, 30);
        return {
          ok: sched && sched.events && sched.events.length > 0,
          schedule: sched,
          detail: sched ? sched.events.length + ' SFX events' : 'no SFX'
        };
      }
    }
  ];

  function list() {
    return PATTERNS.map((p) => ({
      id: p.id,
      label: p.label,
      blurb: p.blurb,
      needsRom: !!p.needsRom
    }));
  }

  function run(id, rom) {
    const pat = PATTERNS.find((p) => p.id === id);
    if (!pat) throw new Error('Unknown Z80 test pattern: ' + id);
    const resolved = romFor(rom) || (fixture && fixture.getCachedRom());
    if (pat.needsRom && !resolved) {
      throw new Error('NHL 92 sound fixture missing — refresh the page');
    }
    return pat.run(resolved || rom);
  }

  return { list, run, PATTERNS };
});
