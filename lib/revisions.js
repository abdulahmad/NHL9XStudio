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
  // NHL 92 Rev A differs from retail in code only (docs/retail-vs-reva.md in NHL92Genesis): every picture, palette and
  // sound stream is at the same offset, and both header dates read 1991.MAY. The one text change in the data is the
  // credit line, 'Scooter Hanson' in retail and 'Scooter Henson' in Rev A, which tells the two apart.
  const NHL92_CREDIT = 'Mark Hughes and Scooter ';

  const REVISIONS = {
    nhl92: [
      { id: '0', label: 'Retail', date: '1991.MAY' },
      { id: 'a', label: 'Rev A', date: '1991.MAY' }
    ],
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

  function indexOfText(bytes, text) {
    const needle = Array.from(text, (ch) => ch.charCodeAt(0));
    outer: for (let i = 0; i + needle.length + 1 < bytes.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return i + needle.length;
    }
    return -1;
  }

  // Revision id of a ROM body (header stripped) for a game with revisions, '' for one without.
  function fromRom(gameId, bytes) {
    const revs = list(gameId);
    if (!revs.length) return '';
    if (gameId === 'nhl92') {
      const at = indexOfText(bytes, NHL92_CREDIT);
      return at >= 0 && bytes[at + 1] === 0x65 ? 'a' : '0'; // 'e' of Henson
    }
    const date = bytes.length >= 0x120 ? String.fromCharCode.apply(null, bytes.subarray(0x118, 0x120)) : '';
    return fromDate(gameId, date);
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

  return { REVISIONS, list, byId, fromDate, fromRom, adjust };
});
