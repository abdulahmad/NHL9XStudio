/**
 * Sprite frame numbers as people see and type them. Studio keeps every bank 1-based inside (frame 1 is the first
 * picture of the file), but the games count differently:
 *   - Genesis, Sega CD and SNES: 1-based, the same values the SPF symbols in frames.asm use. Shown as stored.
 *   - PC (NHL 94, 95, 96 and 97): 0-based, the game's own index (GetHot, the .PPV / .REF shape order). Shown as
 *     stored - 1, so the first picture is frame 0.
 * Every label, frame box, list range, URL and exported file name goes through shown() / internal() so a PC frame is
 * never shown 1-based. The Images tab (pictures, not sprite frames) keeps its own 1-up numbering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlFrameNumber = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PC_KINDS = ['pc94', 'pc95', 'pc96', 'pc97'];

  /** True for a game (or a game kind / platform string) whose sprite frames count from 0. */
  function zeroBased(game) {
    if (!game) return false;
    if (typeof game === 'string') return game === 'pc' || PC_KINDS.includes(game) || /^nhl9\dpc$/.test(game);
    return game.platform === 'pc' || PC_KINDS.includes(game.kind) || /^nhl9\dpc$/.test(game.id || '');
  }
  /** The first frame number shown for this game: 0 on PC, 1 elsewhere. */
  function base(game) { return zeroBased(game) ? 0 : 1; }
  /** Stored (1-based) frame number to the number shown for this game. */
  function shown(game, stored) { return zeroBased(game) ? stored - 1 : stored; }
  /** A number the person typed or a link carries (in this game's numbering) to the stored 1-based frame. */
  function internal(game, typed) { return zeroBased(game) ? typed + 1 : typed; }

  return { zeroBased, base, shown, internal, PC_KINDS };
});
