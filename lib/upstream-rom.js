/**
 * Find a retail ROM in an upstream disassembly checkout (tools and tests only; not shipped to the browser).
 * The disassembly repos keep the ROM in the repo folder under any file name (they find it by SHA-1 and size, tools/roms.js there),
 * older checkouts keep it in lst/. findRomIn looks at the files of each folder that have the right size, and returns the one with
 * the right SHA-1, or null.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT = /\.(bin|gen|md|sfc|smc)$/i;
const cache = new Map();                                  // path -> { size, sha1 }

function sha1File(file, size) {
  const hit = cache.get(file);
  if (hit && hit.size === size) return hit.sha1;
  const sha1 = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  cache.set(file, { size, sha1 });
  return sha1;
}

/** dirs: a folder or a list of folders; want: { sha1, size? }. Returns the path of the ROM or null. */
function findRomIn(dirs, want) {
  for (const dir of [].concat(dirs)) {
    for (const folder of [dir, path.join(dir, 'lst')]) {
      let names;
      try { names = fs.readdirSync(folder); } catch (e) { continue; }
      for (const name of names.filter((n) => EXT.test(n))) {
        const file = path.join(folder, name);
        let st;
        try { st = fs.statSync(file); } catch (e) { continue; }
        if (!st.isFile() || (want.size && st.size !== want.size)) continue;
        if (sha1File(file, st.size) === want.sha1) return file;
      }
    }
  }
  return null;
}

/** The known retail ROMs of the upstream disassemblies. */
const ROMS = {
  nhl92: { sha1: '2337ad3c065f46edccf19007d7a5be80a97520d5', size: 0x80000 },
  nhlpa93: { sha1: '8efc1cacb079ea223966dda065c16c49e584cac2', size: 0x80000 },
  nhl94: { sha1: '7b1489ab501258133bf03e5f0892b77d04312580', size: 0x100000 },
  nhl95: { sha1: '09e87b076aa4cd6f057a1d65bb50fd889b509b44', size: 0x200000 },
  nhlpa93snes: { sha1: '76a01492cfb656e9fce0094bca356c312adfea0e', size: 0x80000 },
  nhl94snes: { sha1: '10dcd21be9c5542e82b0b94473bf5ff569b36cf5', size: 0x100000 }
};

module.exports = { findRomIn, ROMS };
