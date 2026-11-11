/**
 * ISO 9660 reader for NHL 95/96 PC discs (HOCKEY.EXE on CD).
 *
 * Cooked 2048-byte sectors, or 2352-byte Mode 1 (16-byte header + 2048 user).
 * Directory names drop the `;1` version. Joliet names win when present.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlIso9660 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var SECTOR = 2048;

  function u8of(bytes) {
    if (!bytes) return new Uint8Array(0);
    if (bytes instanceof Uint8Array) return bytes;
    return new Uint8Array(bytes);
  }

  function ascii(bytes, off, n) {
    var s = '';
    for (var i = 0; i < n && off + i < bytes.length; i++) {
      var c = bytes[off + i];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  function u16le(bytes, off) {
    return bytes[off] | (bytes[off + 1] << 8);
  }

  function u32le(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
  }

  function setBoth16(buf, off, n) {
    buf[off] = n & 0xff;
    buf[off + 1] = (n >> 8) & 0xff;
    buf[off + 2] = (n >> 8) & 0xff;
    buf[off + 3] = n & 0xff;
  }

  function setBoth32(buf, off, n) {
    buf[off] = n & 0xff;
    buf[off + 1] = (n >> 8) & 0xff;
    buf[off + 2] = (n >> 16) & 0xff;
    buf[off + 3] = (n >> 24) & 0xff;
    buf[off + 4] = (n >> 24) & 0xff;
    buf[off + 5] = (n >> 16) & 0xff;
    buf[off + 6] = (n >> 8) & 0xff;
    buf[off + 7] = n & 0xff;
  }

  function sourceFromBytes(bytes) {
    var u8 = u8of(bytes);
    return {
      size: u8.length,
      read: function (off, len) {
        if (off >= u8.length || len <= 0) return new Uint8Array(0);
        return u8.subarray(off, Math.min(u8.length, off + len));
      }
    };
  }

  function sourceFromFile(filePath) {
    var fs = require('fs');
    var fd = fs.openSync(filePath, 'r');
    var size = fs.fstatSync(fd).size;
    return {
      size: size,
      path: filePath,
      close: function () { try { fs.closeSync(fd); } catch (err) { /* already closed */ } },
      read: function (off, len) {
        if (off >= size || len <= 0) return new Uint8Array(0);
        var buf = Buffer.alloc(len);
        var n = fs.readSync(fd, buf, 0, len, off);
        return n === len ? buf : buf.subarray(0, n);
      }
    };
  }

  function layoutOf(src) {
    var cooked = src.read(16 * SECTOR, 8);
    if (cooked.length >= 6 && ascii(cooked, 1, 5) === 'CD001') return { size: SECTOR, header: 0 };
    var raw = src.read(16 * 2352 + 16, 8);
    if (raw.length >= 6 && ascii(raw, 1, 5) === 'CD001') return { size: 2352, header: 16 };
    return null;
  }

  function readSector(src, layout, lba) {
    return u8of(src.read(lba * layout.size + layout.header, SECTOR));
  }

  function readExtent(src, layout, lba, size) {
    var out = new Uint8Array(size);
    var wrote = 0;
    var sector = lba;
    while (wrote < size) {
      var chunk = readSector(src, layout, sector);
      var n = Math.min(SECTOR, size - wrote, chunk.length);
      out.set(chunk.subarray(0, n), wrote);
      wrote += n;
      sector += 1;
    }
    return out;
  }

  function cleanName(raw) {
    var text = String(raw || '').replace(/\0/g, '').trim();
    var cut = text.indexOf(';');
    if (cut >= 0) text = text.slice(0, cut);
    text = text.replace(/\.$/, '');
    return text;
  }

  function parseIdent(bytes, off, len, joliet) {
    if (len <= 0) return '';
    if (len === 1 && (bytes[off] === 0 || bytes[off] === 1)) return bytes[off] === 0 ? '.' : '..';
    if (!joliet) return cleanName(ascii(bytes, off, len));
    var s = '';
    for (var i = 0; i + 1 < len; i += 2) {
      var code = (bytes[off + i] << 8) | bytes[off + i + 1];
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    return cleanName(s);
  }

  function parseDir(src, layout, lba, size, prefix, joliet, files, depth) {
    if (depth > 16 || size <= 0) return;
    var data = readExtent(src, layout, lba, size);
    var p = 0;
    while (p < data.length) {
      var recLen = data[p];
      if (!recLen) {
        p = Math.ceil((p + 1) / SECTOR) * SECTOR;
        continue;
      }
      if (p + recLen > data.length) break;
      var recLba = u32le(data, p + 2);
      var recSize = u32le(data, p + 10);
      var flags = data[p + 25];
      var nameLen = data[p + 32];
      var name = parseIdent(data, p + 33, nameLen, joliet);
      p += recLen;
      if (!name || name === '.' || name === '..') continue;
      if (flags & 4) continue;
      var rel = prefix ? prefix + '/' + name : name;
      if (flags & 2) parseDir(src, layout, recLba, recSize, rel, joliet, files, depth + 1);
      else files.push({ name: rel, lba: recLba, size: recSize });
    }
  }

  function parsePvdRoot(pvd) {
    if (pvd.length < 190 || pvd[0] !== 1 || ascii(pvd, 1, 5) !== 'CD001') return null;
    return { lba: u32le(pvd, 158), size: u32le(pvd, 166), joliet: false };
  }

  function parseSvdRoot(svd) {
    if (svd.length < 190 || svd[0] !== 2 || ascii(svd, 1, 5) !== 'CD001') return null;
    var esc = ascii(svd, 88, 3);
    if (esc.charAt(0) !== '%') return null;
    return { lba: u32le(svd, 158), size: u32le(svd, 166), joliet: true };
  }

  function openSource(src) {
    var layout = layoutOf(src);
    if (!layout) return null;
    var isoRoot = null;
    var jolietRoot = null;
    for (var i = 16; i < 32; i++) {
      var desc = readSector(src, layout, i);
      if (desc.length < 6 || ascii(desc, 1, 5) !== 'CD001') break;
      var type = desc[0];
      if (type === 255) break;
      if (type === 1 && !isoRoot) isoRoot = parsePvdRoot(desc);
      if (type === 2 && !jolietRoot) jolietRoot = parseSvdRoot(desc);
    }
    var root = jolietRoot || isoRoot;
    if (!root) return null;
    var files = [];
    parseDir(src, layout, root.lba, root.size, '', root.joliet, files, 0);
    var byKey = Object.create(null);
    for (var f = 0; f < files.length; f++) {
      byKey[files[f].name.replace(/\\/g, '/').toLowerCase()] = files[f];
    }
    function lookup(rel) {
      return byKey[String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()] || null;
    }
    return {
      files: files,
      names: function () { return files.map(function (file) { return file.name; }); },
      has: function (rel) { return Boolean(lookup(rel)); },
      read: function (rel) {
        var hit = lookup(rel);
        if (!hit || hit.size <= 0) return null;
        return readExtent(src, layout, hit.lba, hit.size);
      },
      close: src.close || function () {}
    };
  }

  function isIso(bytes) {
    return Boolean(layoutOf(sourceFromBytes(bytes)));
  }

  function open(bytes) {
    return openSource(sourceFromBytes(bytes));
  }

  function openFile(filePath) {
    return openSource(sourceFromFile(filePath));
  }

  function isoIdent(name) {
    var base = String(name || 'FILE.BIN').split(/[\\/]/).pop().toUpperCase();
    if (base.indexOf(';') < 0) base += ';1';
    return base;
  }

  function dirRecord(identBytes, lba, size, isDir) {
    var recLen = 33 + identBytes.length;
    if (recLen % 2) recLen += 1;
    var rec = new Uint8Array(recLen);
    rec[0] = recLen;
    setBoth32(rec, 2, lba);
    setBoth32(rec, 10, size);
    rec[25] = isDir ? 2 : 0;
    rec[32] = identBytes.length;
    rec.set(identBytes, 33);
    return rec;
  }

  function padSectors(n) {
    return Math.ceil(n / SECTOR) * SECTOR;
  }

  function encode(files) {
    var entries = (files || []).map(function (file) {
      return {
        name: String(file.name || 'FILE.BIN').replace(/\\/g, '/'),
        data: u8of(file.data)
      };
    });
    var dirChunks = [];
    dirChunks.push(dirRecord(new Uint8Array([0]), 18, 0, true));
    dirChunks.push(dirRecord(new Uint8Array([1]), 18, 0, true));
    var dataAt = 19;
    var placed = [];
    for (var i = 0; i < entries.length; i++) {
      var ident = isoIdent(entries[i].name);
      var identBytes = new Uint8Array(ident.length);
      for (var c = 0; c < ident.length; c++) identBytes[c] = ident.charCodeAt(c);
      var rec = dirRecord(identBytes, dataAt, entries[i].data.length, false);
      dirChunks.push(rec);
      placed.push({ lba: dataAt, data: entries[i].data });
      dataAt += Math.max(1, Math.ceil(Math.max(1, entries[i].data.length) / SECTOR));
    }
    var dirSize = 0;
    for (var d = 0; d < dirChunks.length; d++) dirSize += dirChunks[d].length;
    var dirBuf = new Uint8Array(padSectors(Math.max(dirSize, 1)));
    var dp = 0;
    for (var r = 0; r < dirChunks.length; r++) {
      if ((Math.floor(dp / SECTOR) !== Math.floor((dp + dirChunks[r].length - 1) / SECTOR)) && (dp % SECTOR)) {
        dp = Math.ceil(dp / SECTOR) * SECTOR;
      }
      dirBuf.set(dirChunks[r], dp);
      dp += dirChunks[r].length;
    }
    dirChunks[0] = dirRecord(new Uint8Array([0]), 18, dirBuf.length, true);
    dirChunks[1] = dirRecord(new Uint8Array([1]), 18, dirBuf.length, true);
    dirBuf.set(dirChunks[0], 0);
    dirBuf.set(dirChunks[1], dirChunks[0].length);

    var totalSectors = dataAt;
    var out = new Uint8Array(totalSectors * SECTOR);
    var pvd = out.subarray(16 * SECTOR, 17 * SECTOR);
    pvd[0] = 1;
    pvd[1] = 0x43; pvd[2] = 0x44; pvd[3] = 0x30; pvd[4] = 0x30; pvd[5] = 0x31;
    pvd[6] = 1;
    for (var v = 40; v < 72; v++) pvd[v] = 0x20;
    var vol = 'NHLPC';
    for (var k = 0; k < vol.length; k++) pvd[40 + k] = vol.charCodeAt(k);
    setBoth32(pvd, 80, totalSectors);
    setBoth16(pvd, 120, SECTOR);
    setBoth32(pvd, 132, 10);
    setBoth32(pvd, 140, 19);
    pvd[156] = 34;
    setBoth32(pvd, 158, 18);
    setBoth32(pvd, 166, dirBuf.length);
    pvd[156 + 25] = 2;
    pvd[156 + 32] = 1;
    pvd[156 + 33] = 0;
    pvd[881] = 1;
    var term = out.subarray(17 * SECTOR, 18 * SECTOR);
    term[0] = 255;
    term[1] = 0x43; term[2] = 0x44; term[3] = 0x30; term[4] = 0x30; term[5] = 0x31;
    term[6] = 1;
    out.set(dirBuf, 18 * SECTOR);
    for (var p = 0; p < placed.length; p++) {
      out.set(placed[p].data, placed[p].lba * SECTOR);
    }
    return out;
  }

  return {
    isIso: isIso,
    open: open,
    openFile: openFile,
    encode: encode,
    layoutOf: function (bytes) { return layoutOf(sourceFromBytes(bytes)); }
  };
});
