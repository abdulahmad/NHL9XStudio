/**
 * NHLPA 93 sound driver on the 68k core: the shared NHL 93/94 harness (nhl9x-68k-harness.js) with this game's
 * addresses. Use as `driver:` of nhl92-sound-chain.js.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./nhl9x-68k-harness') : root.Nhl9xM68kHarness);
  if (node) module.exports = api;
  else root.Nhl93M68kHarness = api;
})(typeof self !== 'undefined' ? self : this, function (H) {
  // Addresses from NHLPA93Genesis src/stubinc/*_stub.asm (p_turnoff, play_sfx_or_music_track, p_music_vblank),
  // the `jsr p_initialZ80` in the retail ROM's Begin ($6478), and the `sfx` wrapper's `move.w d0,(lastsfx).w`
  // ($D860) (retail ROM, SHA-1 8efc1cac).
  const CFG = {
    ENTRY: { p_turnoff: 0x165d8, play_sfx_or_music_track: 0x16608, p_music_vblank: 0x166d4, p_initialZ80: 0x16d92 },
    SEGMENT: [0x165d8, 0x2e1fc], // sound93: code, Z80 program, patches, streams, PCM (graphics93 starts at $2E1FC)
    // rtss: the shared `rts` the driver's bgt.w branches to, in game code ($110E0, from sound93_stub.asm).
    EXTRA: [[0x110e0, [0x4e, 0x75]]],
    LASTSFX: 0xffffbf28,
    STACK: 0xfffffff0
  };
  return H.build(CFG);
});
