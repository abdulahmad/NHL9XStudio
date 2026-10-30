/**
 * Retail revisions the Studio can place offsets for, per game.
 *
 * A revision is named by the header date at $118 of the Genesis ROM. Rev 0 is the layout the bundled tables describe;
 * the others are applied on top of it by lib/rev-a.js and lib/rev-b.js. A game with one entry has a single retail
 * layout, so the Revision picker stays hidden for it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rev-a'), require('./rev-b'));
  } else {
    root.NhlRevisions = factory(root.NhlRevA, root.NhlRevB);
  }
})(typeof self !== 'undefined' ? self : this, function (RevA, RevB) {
  const REVISIONS = {
    nhlpa93: [
      { id: '0', label: 'Rev 0', date: '1992.JUL' },
      { id: 'a', label: 'Rev A', date: '1992.OCT' },
      { id: 'b', label: 'Rev B', date: '1993.FEB' }
    ]
  };

  function list(gameId) {
    return REVISIONS[gameId] || [];
  }

  function byId(gameId, revId) {
    return list(gameId).find((rev) => rev.id === revId) || null;
  }

  // Header date to revision id. An unknown date is Rev 0, which the bundled tables describe.
  function fromDate(gameId, date) {
    const revs = list(gameId);
    if (!revs.length) return '';
    const hit = revs.find((rev) => rev.date === date);
    return (hit || revs[0]).id;
  }

  // The game status (images, sheet, banks) placed for a revision. `status` must be the retail (Rev 0) layout.
  function adjust(status, revId) {
    const rev = status && byId(status.id, revId);
    if (!rev) return status;
    let out = status;
    if (RevA) out = RevA.adjustGameStatus(out, rev.date);
    if (RevB) out = RevB.adjustGameStatus(out, rev.date);
    return out;
  }

  return { REVISIONS, list, byId, fromDate, adjust };
});
