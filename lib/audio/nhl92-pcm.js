/**
 * The raw DAC samples of NHL '92: the PCM files NHL92Genesis extracts from the ROM (tools/extractAssets92.js,
 * Extracted/Sound/sfx_*_pcm.bin), named the same way. Unsigned 8-bit, centre 128, ended by 00 00. The 68k starts them
 * through the SFX handlers (move.l #offset,d1 with offset = ROM address - $F4C8), at the rate the handler passes the Z80.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92Pcm = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /** ROM ranges, in ROM order; `name` is the extracted file name without .bin. */
  const SAMPLES = [
    { name: 'sfx_sam_puck2_slap_pcm', start: 0x11C3E, end: 0x12A58 },
    { name: 'sfx_sam_pass2_pcm', start: 0x12A58, end: 0x13960 },
    { name: 'sfx_sam_pass1_pcm', start: 0x13960, end: 0x14886 },
    { name: 'sfx_sam_hitboard_pcm', start: 0x14886, end: 0x15768 },
    { name: 'sfx_sam_hit_pcm', start: 0x15768, end: 0x168AA },
    { name: 'sfx_sam_punch_pcm', start: 0x168AA, end: 0x16E04 },
    { name: 'sfx_sam_crowdgoal_pcm', start: 0x16E04, end: 0x1D786 },
    { name: 'sfx_sam_booing_pcm', start: 0x1D786, end: 0x1FCE8 },
    { name: 'sfx_oooh_pcm', start: 0x1FCE8, end: 0x222AA },
    { name: 'sfx_skating34_pcm', start: 0x222AA, end: 0x24214 }
  ];

  /** The bytes of one sample (a copy of the ROM range, trailing 00 00 included). */
  function bytes(rom, sample) {
    return rom.slice(sample.start, sample.end);
  }

  /** Number of sample bytes before the 00 terminator. */
  function length(rom, sample) {
    var n = 0;
    while (sample.start + n < sample.end && rom[sample.start + n] !== 0) n += 1;
    return n;
  }

  return { SAMPLES, bytes, length };
});
