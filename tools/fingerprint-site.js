#!/usr/bin/env node
/**
 * Content-hash cache busting for the static site (the GitHub Pages build).
 *
 *   node tools/fingerprint-site.js <site dir>
 *
 * Nothing is renamed or moved. Every file gets a short hash of its bytes, and:
 *   - each <script src>, <link href> and <img src> in the .html files that names a local file gets ?v=<hash>;
 *   - each .html file gets a small inline script (first thing in <head>) that carries the hash of every other
 *     data file (json, wasm, bin, anim, ...) and adds ?v=<hash> to a fetch() of that file, so data fetched at run time is
 *     versioned too.
 * A file that changes gets a new URL, so a browser never mixes old and new files; a file that didn't change keeps its
 * cached copy. Run it twice and nothing changes (the old stamps and the old script are replaced).
 * Scripts loaded by import() with a computed URL (the generated YM2612 runtime in lib/audio/generated/) can't be seen by
 * fetch(), so their hashes go in a second map and the page asks for them: window.assetUrl('lib/audio/generated/x.js') returns
 * the absolute URL with ?v=<hash> (or without it when the page was not fingerprinted, e.g. a local dev server).
 *
 * A file that never changes costs nothing here: its hash, so its URL, stays the same and the browser keeps its cached copy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MARK = 'asset-versions';
const SKIP_IN_MAP = new Set(['.html', '.js', '.css', '.map']);
const DYNAMIC = /(^|\/)generated\/.*\.js$/; // scripts the page import()s by a computed URL

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function hashOf(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

function inlineScript(versions, prefix, modules) {
  const json = JSON.stringify(versions);
  return '<script data-' + MARK + '>(function(){var V=' + json + ';var M=' + JSON.stringify(modules || {}) + ';var R=new URL(' + JSON.stringify(prefix) + ',location.href).href;var f=window.fetch;'
    + 'window.fetch=function(u,o){try{var a=new URL((u&&u.url)||String(u),document.baseURI);'
    + 'if(a.href.indexOf(R)===0&&!a.search){var h=V[a.pathname.slice(new URL(R).pathname.length)];'
    + 'if(h){a.search="?v="+h;if(typeof u==="string"||u instanceof URL)u=a.href;}}}catch(e){}return f.call(this,u,o);};'
    + 'window.assetUrl=function(p){var a=new URL(p,R);if(M[p])a.search="?v="+M[p];return a.href;};})();</script>';
}

function fingerprint(dir) {
  const files = walk(dir, dir, []);
  const hashes = {};
  for (const f of files) if (!f.endsWith('.html')) hashes[f] = hashOf(path.join(dir, f));
  const versions = {};
  for (const f of Object.keys(hashes)) if (!SKIP_IN_MAP.has(path.extname(f).toLowerCase())) versions[f] = hashes[f];
  const modules = {};
  for (const f of Object.keys(hashes)) if (DYNAMIC.test(f)) modules[f] = hashes[f];
  const stats = { html: 0, stamped: 0, mapped: Object.keys(versions).length, dynamic: Object.keys(modules).length, missing: [] };

  for (const f of files.filter((n) => n.endsWith('.html'))) {
    const file = path.join(dir, f);
    const here = path.posix.dirname(f);
    const prefix = here === '.' ? './' : here.split('/').map(() => '..').join('/') + '/';
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(new RegExp('<script data-' + MARK + '>[\\s\\S]*?</script>', 'g'), '');
    html = html.replace(/(<(?:script|link|img)\b[^>]*?\b(?:src|href)=")([^"#]+)(")/gi, (all, pre, url, post) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|data:)/i.test(url)) return all;
      const clean = url.split('?')[0];
      const target = path.posix.normalize(path.posix.join(here, clean));
      if (target.startsWith('..') || !(target in hashes)) { stats.missing.push(f + ': ' + url); return pre + clean + post; }
      stats.stamped += 1;
      return pre + clean + '?v=' + hashes[target] + post;
    });
    html = html.replace(/<head>/i, (m) => m + inlineScript(versions, prefix, modules));
    fs.writeFileSync(file, html);
    stats.html += 1;
  }
  return stats;
}

module.exports = { fingerprint, inlineScript, hashOf };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) { console.error('usage: fingerprint-site.js <site dir>'); process.exit(2); }
  const s = fingerprint(dir);
  console.log('fingerprinted ' + s.html + ' html files: ' + s.stamped + ' references stamped, ' + s.mapped + ' data files versioned for fetch(), ' + s.dynamic + ' scripts for import()');
  if (s.missing.length) { console.error('references to files that are not in the site:\n  ' + s.missing.join('\n  ')); process.exit(1); }
}
