/**
 * SPC700 opcodes of the NHL '93 and NHL '94 SNES sound programs (both load at sound RAM $0400), as found by
 * tools/scan-spc700-driver-ops.js from the NHLPA93SNES / NHL94SNES disassembly repos. Only opcode numbers are kept
 * here, nothing from the ROMs.
 *   reached: code reachable from $0400 (branches, jumps, calls, jmp [!a+X] tables).
 *   swept:   linear decode of the whole block, data included: a superset that also covers code the trace cannot reach.
 * test/spc700-singlestep.js requires every reached and every swept opcode to pass 100%.
 */
const DATA = {
  nhl93: {
    bytes: 9959,
    reached: ['08', '09', '0b', '0e', '10', '13', '1c', '1d', '20', '24', '28', '2b', '2d', '2f', '30', '33', '38', '3a', '3d', '3f', '44', '48', '4b', '4d', '4e', '5c', '5d', '5f', '60', '64', '68', '69', '6b', '6d', '6e', '6f', '75', '78', '7a', '7c', '7d', '7e', '80', '84', '88', '8b', '8d', '8f', '90', '95', '96', '97', '98', '9a', '9b', '9c', '9e', '9f', 'a2', 'a8', 'ab', 'ad', 'ae', 'af', 'b0', 'b5', 'b6', 'ba', 'bb', 'bc', 'bd', 'c4', 'c5', 'c8', 'c9', 'cb', 'cc', 'cd', 'ce', 'cf', 'd0', 'd4', 'd5', 'd6', 'd7', 'd8', 'da', 'dc', 'dd', 'de', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'eb', 'ec', 'ed', 'ee', 'f0', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'fb', 'fc', 'fd', 'fe'],
    swept: ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0a', '0b', '0c', '0d', '0e', '0f', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '1a', '1b', '1c', '1d', '1e', '1f', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '2a', '2b', '2c', '2d', '2e', '2f', '30', '31', '32', '33', '34', '35', '38', '39', '3a', '3b', '3c', '3d', '3e', '3f', '40', '41', '43', '44', '45', '46', '48', '4a', '4b', '4d', '4e', '50', '51', '54', '55', '57', '58', '5a', '5b', '5c', '5d', '5e', '5f', '60', '62', '63', '64', '65', '67', '68', '69', '6b', '6c', '6d', '6e', '6f', '70', '72', '73', '74', '75', '78', '79', '7a', '7b', '7c', '7d', '7e', '7f', '80', '81', '82', '83', '84', '85', '86', '87', '88', '89', '8a', '8b', '8c', '8d', '8e', '8f', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99', '9a', '9b', '9c', '9d', '9e', '9f', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'b0', 'b2', 'b4', 'b5', 'b6', 'b7', 'b9', 'ba', 'bb', 'bc', 'bd', 'be', 'c0', 'c2', 'c4', 'c5', 'c8', 'c9', 'ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'd0', 'd2', 'd4', 'd5', 'd6', 'd7', 'd8', 'da', 'dc', 'dd', 'de', 'df', 'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'ea', 'eb', 'ec', 'ed', 'ee', 'ef', 'f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'fa', 'fb', 'fc', 'fd', 'fe', 'ff']
  },
  nhl94: {
    bytes: 1097,
    reached: ['00', '04', '1a', '1c', '1d', '1f', '20', '3a', '3d', '3e', '5d', '5f', '60', '64', '68', '80', '84', '88', '8d', '9c', 'a4', 'ab', 'bd', 'c4', 'cb', 'cd', 'd0', 'd5', 'd7', 'd8', 'dc', 'dd', 'e4', 'e8', 'f0', 'f5', 'f7', 'f8', 'fc', 'fd'],
    swept: ['00', '01', '02', '04', '05', '06', '07', '08', '13', '1a', '1c', '1d', '1f', '20', '31', '3a', '3d', '3e', '40', '5d', '5f', '60', '64', '68', '70', '80', '84', '88', '8d', '9b', '9c', 'a4', 'ab', 'af', 'b4', 'bd', 'c4', 'cb', 'cd', 'd0', 'd5', 'd7', 'd8', 'dc', 'dd', 'e4', 'e8', 'f0', 'f2', 'f5', 'f7', 'f8', 'fc', 'fd']
  }
};

const num = (a) => a.map((h) => parseInt(h, 16));
const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);

module.exports = {
  DATA,
  /** Opcodes of the reachable driver code (default), or the linear-sweep superset with swept = true. */
  opcodes: (swept) => uniq([].concat(...Object.keys(DATA).map((k) => num(swept ? DATA[k].swept : DATA[k].reached)))),
  reached: (game) => num(DATA[game].reached),
  swept: (game) => num(DATA[game].swept)
};
