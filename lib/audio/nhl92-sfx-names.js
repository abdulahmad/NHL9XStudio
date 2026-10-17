/**
 * NHL '92 SFX and song names by ID. The IDs are what the game passes to `sfx` / `initune`
 * (middle.asm). Labels and descriptions are EA's sound list (SOUNDTAB.DOC), as named in the
 * equates at the top of NHL92Genesis src/sound/sound.asm; the sfx_pointer_table handlers
 * (handle_sfx_<label>), command streams and PCM files use the same labels. ID 31 (oooh) and
 * IDs 32-34 (duplicates of 30) are not in SOUNDTAB.DOC. Songs use the game's Sng... names.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92SfxNames = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /** [label, description] by SFX ID, from SOUNDTAB.DOC. */
  const SFX = [
    ['siren', 'FM siren'],
    ['skating1', 'FM skate and stop short'],
    ['skating2', 'FM skate and stop short'],
    ['skating3', 'FM skating turn short'],
    ['skating4', 'FM skating turn short'],
    ['hitpuck', 'FM hit puck'],
    ['hitboard', 'FM hit board loud'],
    ['hitboard2', 'FM hit board lower pitch loud'],
    ['puck_faceoff', 'FM puck hits ice on face off'],
    ['bounce_goal', 'FM puck bounce off goal post'],
    ['whistle', 'FM whistle'],
    ['sam_pass1', 'sample pass shot #1'],
    ['sam_pass2', 'sample pass shot #2 more beef'],
    ['sam_puck2_slap', 'sample slap shot'],
    ['whiff', 'FM whiff (miss puck on slap shot)'],
    ['sam_hitboard1', 'sample player hits boards 1'],
    ['sam_hitboard2', 'ditto at different playback rate'],
    ['sam_hitboard3', 'ditto at different playback rate'],
    ['sam_hit1', 'sample player hits (checks) another player 1'],
    ['sam_hit2', 'ditto at different playback rate'],
    ['sam_hit3', 'ditto at different playback rate'],
    ['sam_punch1', 'sample fighting punch sound'],
    ['sam_punch2', 'ditto at different playback rate'],
    ['sam_punch3', 'ditto at different playback rate'],
    ['foghorn', 'FM fog horn end of period'],
    ['sam_crowdgoal', 'sample crowd cheer'],
    ['sam_booing', 'sample short booing'],
    ['hitboardvolm', 'hit board1 medium volume'],
    ['hitboardvols', 'hit board1 softer volume'],
    ['hitboard2volm', 'hit board2 medium volume'],
    ['hitboard2vols', 'hit board2 softer volume'],
    ['oooh', 'crowd oooh (not in soundtab.doc)']
  ];
  /** IDs 32-34 are past the last SFX: the table repeats ID 30's handler. */
  const DUPLICATE_OF = 30;
  const LABELS = SFX.map((e) => e[0]);
  const DESCRIPTIONS = SFX.map((e) => e[1]);

  /** The game's own equates for the same numbers (src/ram.asm SFX... / Sng...), by value. */
  const EQUATES = {
    0: ['SFXsiren'], 1: ['SFXbeep1'], 2: ['SFXbeep2'], 3: ['SFXcheck2'], 5: ['SFXstdef', 'SFXpuckbody'],
    7: ['SFXpuckwall1'], 8: ['SFXpuckget', 'SFXpuckice'], 9: ['SFXpuckpost'], 10: ['SFXwhistle'], 11: ['SFXpass'],
    12: ['SFXshotbh'], 13: ['SFXshotfh'], 14: ['SFXshotwiff'], 15: ['SFXplayerwall'], 18: ['SFXcheck'],
    21: ['SFXhithigh'], 23: ['SFXhitlow'], 24: ['SFXhorn'], 25: ['SFXcrowdcheer'], 26: ['SFXcrowdboo'],
    29: ['SFXpuckwall2'], 30: ['SFXpuckwall3'], 31: ['SFXoooh']
  };

  /**
   * Songs: the game's own names (src/ram.asm SngTitle, SngEOP, SngEOG, SngPO; NHL92Genesis sound.asm adds SngReprise for the
   * Title reprise that follows the Title song). SOUNDTAB.DOC's music list is incomplete.
   */
  const SONGS = [
    ['SngEOP', 'End of Period song'],
    ['SngTitle', 'Title song'],
    ['SngReprise', 'Title reprise'],
    ['SngEOG', 'End of Game song'],
    ['SngPO', 'Playoffs music']
  ];
  const SONG_LABELS = SONGS.map((e) => e[0]);
  const SONG_DESCRIPTIONS = SONGS.map((e) => e[1]);

  /** SFX label: the SOUNDTAB label, or the one it duplicates for IDs 32-34. */
  function label(id) {
    if (id >= LABELS.length) return LABELS[DUPLICATE_OF];
    return LABELS[id];
  }

  function describe(id) {
    if (id >= LABELS.length) return 'unused: duplicate of ' + LABELS[DUPLICATE_OF] + ' (' + DUPLICATE_OF + ')';
    return DESCRIPTIONS[id];
  }

  /** Display name: "ID · label | SFXequate, SFXequate" (the game's own names, when it has any). */
  function name(id) {
    const eq = EQUATES[id];
    return id + ' · ' + label(id) + (eq ? ' | ' + eq.join(', ') : '');
  }

  /** Song display name: "ID · SngLabel". */
  function songName(id) {
    return id + ' · ' + SONG_LABELS[id];
  }

  return { SFX_LABELS: LABELS, SFX_DESCRIPTIONS: DESCRIPTIONS, SONG_LABELS, SONG_DESCRIPTIONS, EQUATES, label, describe, name, songName };
});
