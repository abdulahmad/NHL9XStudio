/**
 * Validators for the local server's static files: a weak ETag from size + mtime, and the If-None-Match check.
 * The server still sends Cache-Control: no-cache (always revalidate), so a reload costs a 304 instead of the whole file.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlHttpCache = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function etagFor(stat) {
    return 'W/"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
  }

  /** True when the request's If-None-Match names this ETag (or is *), so a 304 can replace the body. */
  function notModified(ifNoneMatch, etag) {
    if (!ifNoneMatch) return false;
    if (String(ifNoneMatch).trim() === '*') return true;
    var weak = function (t) { return t.trim().replace(/^W\//, ''); };
    return String(ifNoneMatch).split(',').some(function (t) { return weak(t) === weak(etag); });
  }

  return { etagFor: etagFor, notModified: notModified };
});
