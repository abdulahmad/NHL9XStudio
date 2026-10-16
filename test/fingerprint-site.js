/** Tests for tools/fingerprint-site.js (content-hash cache busting) and lib/http-cache.js (ETags). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { fingerprint, hashOf } = require('../tools/fingerprint-site');
const cache = require('../lib/http-cache');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
put('index.html', '<html><head><link rel="stylesheet" href="a.css"><script src="lib/x.js"></script><script src="https://cdn.example/y.js"></script></head></html>');
put('a.css', 'body{}');
put('lib/x.js', 'var x=1');
put('data/m.json', '{"a":1}');
put('lib/generated/rt.js', 'export const a = 1;');

// --- 1. references get ?v=<hash of the file>, remote ones are left alone ---
const s1 = fingerprint(dir);
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
assert.strictEqual(s1.stamped, 2);
assert.ok(html.includes('href="a.css?v=' + hashOf(path.join(dir, 'a.css')) + '"'));
assert.ok(html.includes('src="lib/x.js?v=' + hashOf(path.join(dir, 'lib/x.js')) + '"'));
assert.ok(html.includes('src="https://cdn.example/y.js"'));
assert.deepStrictEqual(s1.missing, []);

// --- 2. a second run changes nothing; a changed file changes only its own stamp ---
const once = html;
fingerprint(dir);
assert.strictEqual(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), once, 'idempotent');
const cssBefore = /a\.css\?v=(\w+)/.exec(once)[1];
const jsBefore = /x\.js\?v=(\w+)/.exec(once)[1];
put('lib/x.js', 'var x=2');
fingerprint(dir);
html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
assert.strictEqual(/a\.css\?v=(\w+)/.exec(html)[1], cssBefore);
assert.notStrictEqual(/x\.js\?v=(\w+)/.exec(html)[1], jsBefore);
assert.strictEqual((html.match(/data-asset-versions/g) || []).length, 1, 'one injected script');

// --- 3. a reference to a file that isn't in the site is reported ---
put('bad.html', '<html><head><script src="nope.js"></script></head></html>');
assert.deepStrictEqual(fingerprint(dir).missing, ['bad.html: nope.js']);
fs.unlinkSync(path.join(dir, 'bad.html'));

// --- 4. the injected script versions fetch() of data files, and only those ---
{
  const code = /<script data-asset-versions>([\s\S]*?)<\/script>/.exec(html)[1];
  const seen = [];
  const win = { fetch: (u) => { seen.push(String(u)); return Promise.resolve(); } };
  const ctx = { window: win, location: { href: 'https://h.example/app/index.html' }, document: { baseURI: 'https://h.example/app/' }, URL, String };
  vm.runInNewContext(code, ctx);
  win.fetch.call(win, 'https://h.example/app/data/m.json');
  win.fetch.call(win, new URL('data/m.json?x=1', 'https://h.example/app/'));
  win.fetch.call(win, 'https://h.example/app/data/other.json');
  win.fetch.call(win, 'https://elsewhere.example/data/m.json');
  const h = hashOf(path.join(dir, 'data/m.json'));
  assert.deepStrictEqual(seen, [
    'https://h.example/app/data/m.json?v=' + h,
    'https://h.example/app/data/m.json?x=1',
    'https://h.example/app/data/other.json',
    'https://elsewhere.example/data/m.json'
  ]);
}

// --- 4b. a script imported by a computed URL gets its hash from window.assetUrl; others and unknown paths do not ---
{
  const code = /<script data-asset-versions>([\s\S]*?)<\/script>/.exec(html)[1];
  const win = { fetch: () => Promise.resolve() };
  vm.runInNewContext(code, { window: win, location: { href: 'https://h.example/app/index.html' }, document: { baseURI: 'https://h.example/app/' }, URL, String });
  const h = hashOf(path.join(dir, 'lib/generated/rt.js'));
  assert.strictEqual(win.assetUrl('lib/generated/rt.js'), 'https://h.example/app/lib/generated/rt.js?v=' + h);
  assert.strictEqual(win.assetUrl('lib/other.js'), 'https://h.example/app/lib/other.js');
  put('lib/generated/rt.js', 'export const a = 2;');
  fingerprint(dir);
  const code2 = /<script data-asset-versions>([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))[1];
  const win2 = { fetch: () => Promise.resolve() };
  vm.runInNewContext(code2, { window: win2, location: { href: 'https://h.example/app/index.html' }, document: { baseURI: 'https://h.example/app/' }, URL, String });
  assert.notStrictEqual(win2.assetUrl('lib/generated/rt.js'), win.assetUrl('lib/generated/rt.js'), 'a changed runtime gets a new URL');
  html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
}

// --- 5. ETags: stable for the same file state, different when it changes, If-None-Match honoured ---
{
  const st = { size: 255, mtimeMs: 1700000000000.5 };
  const tag = cache.etagFor(st);
  assert.strictEqual(tag, cache.etagFor({ size: 255, mtimeMs: 1700000000000.9 }));
  assert.notStrictEqual(tag, cache.etagFor({ size: 256, mtimeMs: 1700000000000 }));
  assert.ok(cache.notModified(tag, tag));
  assert.ok(cache.notModified('"zzz", ' + tag, tag));
  assert.ok(cache.notModified(tag.replace('W/', ''), tag));
  assert.ok(cache.notModified('*', tag));
  assert.ok(!cache.notModified(undefined, tag));
  assert.ok(!cache.notModified('W/"other"', tag));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('fingerprint-site: all tests passed');
