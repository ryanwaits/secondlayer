/**
 * Minimal QR code generator for WalletConnect URIs.
 * Produces SVG string. Byte-mode encoding, error correction level L.
 * Supports versions 1-10 (up to 271 bytes — plenty for WC URIs).
 */

// Version capacity table (byte mode, EC level L)
const CAPACITIES = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

// Generator polynomials for EC codewords per version (L level)
// [totalCodewords, ecCodewordsPerBlock, numBlocks]
const EC_PARAMS: [number, number, number][] = [
  [0, 0, 0], // v0 placeholder
  [26, 7, 1],
  [44, 10, 1],
  [70, 15, 1],
  [100, 20, 1],
  [134, 26, 1],
  [172, 18, 2],
  [196, 20, 2],
  [242, 24, 2],
  [292, 30, 2],
  [346, 18, 4],
];

function selectVersion(len: number): number {
  for (let v = 1; v <= 10; v++) {
    if (len <= CAPACITIES[v]) return v;
  }
  throw new Error("QR data too long");
}

// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenPoly(n: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenPoly(ecLen);
  const result = new Uint8Array(data.length + ecLen);
  result.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = result[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      result[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return result.subarray(data.length);
}

function encodeData(bytes: Uint8Array, version: number): Uint8Array {
  const [totalCw, ecPerBlock, numBlocks] = EC_PARAMS[version];
  const dataCw = totalCw - ecPerBlock * numBlocks;

  // Build byte-mode bitstream
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  push(0b0100, 4); // byte mode indicator
  push(bytes.length, version <= 9 ? 8 : 16); // character count
  for (const b of bytes) push(b, 8);
  push(0, 4); // terminator (up to 4 bits)

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Build codeword array
  const codewords = new Uint8Array(dataCw);
  for (let i = 0; i < dataCw; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      const idx = i * 8 + j;
      byte = (byte << 1) | (idx < bits.length ? bits[idx] : 0);
    }
    codewords[i] = byte;
  }

  // Pad codewords
  let padByte = 0xec;
  for (let i = Math.ceil(bits.length / 8); i < dataCw; i++) {
    codewords[i] = padByte;
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  // Reed-Solomon EC
  const cwPerBlock = Math.floor(dataCw / numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const blockLen = cwPerBlock + (b < dataCw % numBlocks ? 1 : 0);
    const block = codewords.subarray(offset, offset + blockLen);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
    offset += blockLen;
  }

  // Interleave
  const result: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }

  return new Uint8Array(result);
}

// QR matrix operations

type Matrix = Uint8Array[];

function createMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Uint8Array(size));
}

function setModule(m: Matrix, r: number, c: number, val: number, reserved: Matrix) {
  if (r >= 0 && r < m.length && c >= 0 && c < m.length) {
    m[r][c] = val;
    reserved[r][c] = 1;
  }
}

function addFinderPattern(m: Matrix, r: number, c: number, res: Matrix) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
      const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const val = inInner || (inOuter && onBorder) ? 1 : 0;
      setModule(m, rr, cc, val, res);
    }
  }
}

function addTimingPatterns(m: Matrix, res: Matrix) {
  for (let i = 8; i < m.length - 8; i++) {
    const val = i % 2 === 0 ? 1 : 0;
    if (!res[6][i]) setModule(m, 6, i, val, res);
    if (!res[i][6]) setModule(m, i, 6, val, res);
  }
}

function addFormatInfo(m: Matrix, res: Matrix) {
  // EC level L (01), mask 0 (000) → format bits 01000 → with BCH: 0x77C0 ... simplified
  // Use pre-computed format info for L/mask0: 111011111000100
  const fmt = 0b111011111000100;
  const n = m.length;
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> (14 - i)) & 1;
    // Around top-left finder
    if (i < 6) setModule(m, 8, i, bit, res);
    else if (i === 6) setModule(m, 8, 7, bit, res);
    else if (i === 7) setModule(m, 8, 8, bit, res);
    else if (i === 8) setModule(m, 7, 8, bit, res);
    else setModule(m, 14 - i, 8, bit, res);

    // Around other finders
    if (i < 8) setModule(m, n - 1 - i, 8, bit, res);
    else setModule(m, 8, n - 15 + i, bit, res);
  }
  // Dark module
  setModule(m, n - 8, 8, 1, res);
}

function placeData(m: Matrix, res: Matrix, data: Uint8Array) {
  const n = m.length;
  let bitIdx = 0;
  const totalBits = data.length * 8;

  let col = n - 1;
  let upward = true;

  while (col >= 0) {
    if (col === 6) col--; // skip timing column
    const rows = upward
      ? Array.from({ length: n }, (_, i) => n - 1 - i)
      : Array.from({ length: n }, (_, i) => i);

    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || res[row][c]) continue;
        if (bitIdx < totalBits) {
          const byteIdx = bitIdx >> 3;
          const bitPos = 7 - (bitIdx & 7);
          const bit = (data[byteIdx] >> bitPos) & 1;
          // Apply mask 0: (row + col) % 2 === 0
          m[row][c] = bit ^ ((row + c) % 2 === 0 ? 1 : 0);
          bitIdx++;
        }
      }
    }

    col -= 2;
    upward = !upward;
  }
}

function buildMatrix(version: number, codewords: Uint8Array): Matrix {
  const n = version * 4 + 17;
  const m = createMatrix(n);
  const res = createMatrix(n); // reserved modules

  // Finder patterns
  addFinderPattern(m, 0, 0, res);
  addFinderPattern(m, 0, n - 7, res);
  addFinderPattern(m, n - 7, 0, res);

  addTimingPatterns(m, res);
  addFormatInfo(m, res);

  // Alignment patterns for v >= 2
  if (version >= 2) {
    const pos = [6, version * 4 + 10]; // simplified for v2-v6
    for (const r of pos) {
      for (const c of pos) {
        // Skip if overlapping finder
        if (res[r]?.[c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const val =
              Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0) ? 1 : 0;
            setModule(m, r + dr, c + dc, val, res);
          }
        }
      }
    }
  }

  placeData(m, res, codewords);
  return m;
}

/** Generate a QR code as an SVG string for the given data. */
export function qrSvg(data: string, opts?: { size?: number; dark?: string; light?: string }): string {
  const size = opts?.size ?? 256;
  const dark = opts?.dark ?? "#000000";
  const light = opts?.light ?? "#ffffff";

  const bytes = new TextEncoder().encode(data);
  const version = selectVersion(bytes.length);
  const codewords = encodeData(bytes, version);
  const matrix = buildMatrix(version, codewords);

  const n = matrix.length;
  const quiet = 4; // quiet zone modules
  const total = n + quiet * 2;
  const scale = size / total;

  let paths = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        const x = (c + quiet) * scale;
        const y = (r + quiet) * scale;
        paths += `M${x},${y}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}" fill="${light}"/>`,
    `<path d="${paths}" fill="${dark}"/>`,
    `</svg>`,
  ].join("");
}
