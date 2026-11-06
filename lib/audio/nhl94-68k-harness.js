/**
 * NHL 94 sound driver on the 68k core: the shared NHL 93/94 harness (nhl9x-68k-harness.js) with this game's
 * addresses. Use as `driver:` of nhl92-sound-chain.js.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./nhl9x-68k-harness') : root.Nhl9xM68kHarness);
  if (node) module.exports = api;
  else root.Nhl94M68kHarness = api;
})(typeof self !== 'undefined' ? self : this, function (H) {
  // Addresses from NHL94Genesis src/stubinc/*_stub.asm and ram_addrs.inc (retail ROM, SHA-1 7b1489ab).
  const CFG = {
    ENTRY: { p_turnoff: 0x1a264, play_sfx_or_music_track: 0x1a294, p_music_vblank: 0x1a50a, p_initialZ80: 0x1acc2 },
    SEGMENT: [0x1a264, 0x4b5c0], // sound94: code, Z80 program, patches, streams, PCM
    LASTSFX: 0xffffc016,
    STACK: 0xfffffdf0
  };
  return H.build(CFG);
});
