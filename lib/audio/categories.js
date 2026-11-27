/**
 * The category names of the Audio list, shared by every game so the same kind of sound has the same heading everywhere.
 * A game fills the categories it has: Genesis songs and effects are event streams, the SNES ones are SPC700 sequences;
 * Genesis samples are DAC PCM files, SNES samples are BRR blocks; instruments are FM patches (Genesis) or sample/envelope
 * entries (SNES). Items are named by the game's own ID (92 and 93G equates, 93S Sng and SFX names).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlAudioCategories = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CATEGORY = {
    midi: 'MIDI',
    songs: 'Songs',
    sfx: 'SFX',
    samples: 'Samples',
    instruments: 'Instruments'
  };
  /** The order the sections appear in. */
  const ORDER = [CATEGORY.midi, CATEGORY.songs, CATEGORY.sfx, CATEGORY.samples, CATEGORY.instruments];
  /** Sections that start collapsed. */
  const COLLAPSED = [CATEGORY.samples, CATEGORY.instruments];
  return { CATEGORY, ORDER, COLLAPSED };
});
