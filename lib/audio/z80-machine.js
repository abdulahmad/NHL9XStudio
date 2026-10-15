/**
 * Genesis Z80 + 8K RAM + YM2612 bus (for NHL 92 sound program).
 */
(function (root, factory) {
  var core = typeof module === 'object' && module.exports
    ? require('./z80-cpu-core')
    : root.NhlZ80CpuCore;
  var ymApi = typeof module === 'object' && module.exports
    ? require('./ym2612')
    : root.NhlYm2612;
  var api = factory(core && core.Z80Cpu, ymApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlZ80Machine = api;
})(typeof self !== 'undefined' ? self : this, function (Z80Cpu, ymApi) {
  const Z80_RAM_SIZE = 0x2000;
  const YM_BASE = 0x4000;

  function create(opts) {
    if (!Z80Cpu) throw new Error('Z80 CPU core not loaded');
    const ram = opts && opts.ram ? opts.ram : new Uint8Array(Z80_RAM_SIZE);
    const ym = (opts && opts.ym) || ymApi.create();
    const cpu = new Z80Cpu();
    cpu.regs.pc = opts && opts.pc != null ? opts.pc : 0;
    cpu.regs.sp = opts && opts.sp != null ? opts.sp : 0xff00;
    const ports = new Uint8Array(256);
    let edges = 0;
    let instructions = 0;

    function mapRead(addr) {
      const a = addr & 0xffff;
      if (a < Z80_RAM_SIZE) return ram[a];
      if (a >= YM_BASE && a < YM_BASE + 4) {
        if (a === YM_BASE + 2) return 0;
        return 0xff;
      }
      return 0xff;
    }

    function mapWrite(addr, value) {
      const a = addr & 0xffff;
      const v = value & 0xff;
      if (a < Z80_RAM_SIZE) ram[a] = v;
      else if (a >= YM_BASE && a < YM_BASE + 4) ym.writeBus(a, v);
    }

    function portRead(port) {
      const p = port & 0xff;
      if (p === 0x40) return ram[0xa4] != null ? ram[0xa4] : 0;
      if (p === 0x60) return ram[0xa3] != null ? ram[0xa3] : 0;
      return ports[p] != null ? ports[p] : 0xff;
    }

    function portWrite(port, value) {
      ports[port & 0xff] = value & 0xff;
    }

    function resolveBus() {
      const b = cpu.bus;
      if (b.nMREQ === 0) {
        if (b.nRD === 0) b.data = mapRead(b.addr);
        if (b.nWR === 0) mapWrite(b.addr, b.data);
      }
      if (b.nIORQ === 0) {
        const p = b.addr & 0xff;
        if (b.nRD === 0) b.data = portRead(p);
        if (b.nWR === 0) portWrite(p, b.data);
      }
    }

    function clockEdge() {
      resolveBus();
      cpu.clockEdge();
      edges += 1;
      if (cpu.seq.lastOpTState && cpu.seq.phase) instructions += 1;
    }

    function runEdges(maxEdges) {
      const limit = maxEdges || 200000;
      for (let i = 0; i < limit; i++) {
        clockEdge();
      }
      return { edges, instructions, pc: cpu.regs.pc, halted: cpu.ctl.haltLatch };
    }

    function runInstructions(maxInstr) {
      const target = (instructions + (maxInstr || 1000));
      let guard = 0;
      while (instructions < target && guard < 5000000) {
        clockEdge();
        guard += 1;
        if (cpu.ctl.haltLatch) break;
      }
      return { edges, instructions, pc: cpu.regs.pc, halted: cpu.ctl.haltLatch };
    }

    function loadProgram(blob, offset) {
      const off = offset || 0;
      ram.set(blob, off);
      cpu.regs.pc = off;
    }

    function snapshot() {
      return {
        pc: cpu.regs.pc,
        sp: cpu.regs.sp,
        edges,
        instructions,
        halted: cpu.ctl.haltLatch,
        ram: ram.slice(0),
        ymWrites: ym.writes.length
      };
    }

    return {
      cpu,
      ram,
      ym,
      ports,
      loadProgram,
      clockEdge,
      runEdges,
      runInstructions,
      snapshot,
      Z80_RAM_SIZE
    };
  }

  return { create, Z80_RAM_SIZE, YM_BASE };
});
