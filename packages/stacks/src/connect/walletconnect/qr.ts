const CAPACITIES = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

// Generator polynomials for EC codewords per version (L level)
// [totalCodewords, ecCodewordsPerBlock, numBlocks]
const EC_PARAMS: [number, number, number][] = [
	[0, 0, 0],
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
		// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
		if (len <= CAPACITIES[v]!) return v;
	}
	throw new Error("QR data too long");
}

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
	}
	// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
	for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
	if (a === 0 || b === 0) return 0;
	// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
	return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGenPoly(n: number): Uint8Array {
	let poly = new Uint8Array([1]);
	for (let i = 0; i < n; i++) {
		const next = new Uint8Array(poly.length + 1);
		for (let j = 0; j < poly.length; j++) {
			// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
			next[j] = next[j]! ^ poly[j]!;
			// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
			next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, GF_EXP[i]!);
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
		// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
		const coef = result[i]!;
		if (coef === 0) continue;
		for (let j = 0; j < gen.length; j++) {
			// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
			result[i + j] = result[i + j]! ^ gfMul(gen[j]!, coef);
		}
	}
	return result.subarray(data.length);
}

function encodeData(bytes: Uint8Array, version: number): Uint8Array {
	// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
	const [totalCw, ecPerBlock, numBlocks] = EC_PARAMS[version]!;
	const dataCw = totalCw - ecPerBlock * numBlocks;

	const bits: number[] = [];
	const push = (val: number, len: number) => {
		for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
	};

	push(0b0100, 4);
	push(bytes.length, version <= 9 ? 8 : 16);
	for (const b of bytes) push(b, 8);
	push(0, 4);

	while (bits.length % 8 !== 0) bits.push(0);

	const codewords = new Uint8Array(dataCw);
	for (let i = 0; i < dataCw; i++) {
		let byte = 0;
		for (let j = 0; j < 8; j++) {
			const idx = i * 8 + j;
			// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
			byte = (byte << 1) | (idx < bits.length ? bits[idx]! : 0);
		}
		codewords[i] = byte;
	}

	let padByte = 0xec;
	for (let i = Math.ceil(bits.length / 8); i < dataCw; i++) {
		codewords[i] = padByte;
		padByte = padByte === 0xec ? 0x11 : 0xec;
	}

	const cwPerBlock = Math.floor(dataCw / numBlocks);
	const dataBlocks: Uint8Array[] = [];
	const ecBlocks: Uint8Array[] = [];
	let offset = 0;
	for (let b = 0; b < numBlocks; b++) {
		const blockLen =
			cwPerBlock + (b >= numBlocks - (dataCw % numBlocks) ? 1 : 0);
		const block = codewords.subarray(offset, offset + blockLen);
		dataBlocks.push(block);
		ecBlocks.push(rsEncode(block, ecPerBlock));
		offset += blockLen;
	}

	const result: number[] = [];
	const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
	for (let i = 0; i < maxDataLen; i++) {
		for (const block of dataBlocks) {
			// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
			if (i < block.length) result.push(block[i]!);
		}
	}
	for (let i = 0; i < ecPerBlock; i++) {
		for (const block of ecBlocks) {
			// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
			if (i < block.length) result.push(block[i]!);
		}
	}

	return new Uint8Array(result);
}

type Matrix = Uint8Array[];

const ALIGNMENT: number[][] = [
	[],
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[6, 22, 38],
	[6, 24, 42],
	[6, 26, 46],
	[6, 28, 50],
];

function addVersionInfo(m: Matrix, version: number, res: Matrix) {
	let rem = version;
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
	const bits = (version << 12) | rem;
	const n = m.length;
	for (let i = 0; i < 18; i++) {
		const bit = (bits >> i) & 1;
		const a = Math.floor(i / 3);
		const b = (i % 3) + n - 11;
		setModule(m, a, b, bit, res);
		setModule(m, b, a, bit, res);
	}
}

function createMatrix(size: number): Matrix {
	return Array.from({ length: size }, () => new Uint8Array(size));
}

function setModule(
	m: Matrix,
	r: number,
	c: number,
	val: number,
	reserved: Matrix,
) {
	if (r >= 0 && r < m.length && c >= 0 && c < m.length) {
		// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
		m[r]![c] = val;
		// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
		reserved[r]![c] = 1;
	}
}

function addFinderPattern(m: Matrix, r: number, c: number, res: Matrix) {
	for (let dr = -1; dr <= 7; dr++) {
		for (let dc = -1; dc <= 7; dc++) {
			const rr = r + dr;
			const cc = c + dc;
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
		if (!res[6]?.[i]) setModule(m, 6, i, val, res);
		if (!res[i]?.[6]) setModule(m, i, 6, val, res);
	}
}

function addFormatInfo(m: Matrix, res: Matrix) {
	// EC level L (01), mask 0 (000) → format bits 01000 → with BCH: 0x77C0 ... simplified
	// Use pre-computed format info for L/mask0: 111011111000100
	const fmt = 0b111011111000100;
	const n = m.length;
	for (let i = 0; i < 15; i++) {
		const bit = (fmt >> (14 - i)) & 1;
		if (i < 6) setModule(m, 8, i, bit, res);
		else if (i === 6) setModule(m, 8, 7, bit, res);
		else if (i === 7) setModule(m, 8, 8, bit, res);
		else if (i === 8) setModule(m, 7, 8, bit, res);
		else setModule(m, 14 - i, 8, bit, res);

		if (i < 7) setModule(m, n - 1 - i, 8, bit, res);
		else setModule(m, 8, n - 15 + i, bit, res);
	}
	setModule(m, n - 8, 8, 1, res);
}

function placeData(m: Matrix, res: Matrix, data: Uint8Array) {
	const n = m.length;
	let bitIdx = 0;
	const totalBits = data.length * 8;

	let col = n - 1;
	let upward = true;

	while (col >= 0) {
		if (col === 6) col--;
		const rows = upward
			? Array.from({ length: n }, (_, i) => n - 1 - i)
			: Array.from({ length: n }, (_, i) => i);

		for (const row of rows) {
			for (const dc of [0, -1]) {
				const c = col + dc;
				if (c < 0 || res[row]?.[c]) continue;
				let bit = 0;
				if (bitIdx < totalBits) {
					// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
					bit = (data[bitIdx >> 3]! >> (7 - (bitIdx & 7))) & 1;
					bitIdx++;
				}
				// biome-ignore lint/style/noNonNullAssertion: bit-encoding routine where index is provably bounded by surrounding loop/length checks
				m[row]![c] = bit ^ ((row + c) % 2 === 0 ? 1 : 0);
			}
		}

		col -= 2;
		upward = !upward;
	}
}

function buildMatrix(version: number, codewords: Uint8Array): Matrix {
	const n = version * 4 + 17;
	const m = createMatrix(n);
	const res = createMatrix(n);

	addFinderPattern(m, 0, 0, res);
	addFinderPattern(m, 0, n - 7, res);
	addFinderPattern(m, n - 7, 0, res);

	addTimingPatterns(m, res);
	addFormatInfo(m, res);

	if (version >= 7) addVersionInfo(m, version, res);
	if (version >= 2) {
		const pos = ALIGNMENT[version] ?? [];
		const last = pos.length - 1;
		for (const [i, r] of pos.entries()) {
			for (const [j, c] of pos.entries()) {
				if (
					(i === 0 && j === 0) ||
					(i === 0 && j === last) ||
					(i === last && j === 0)
				)
					continue;
				for (let dr = -2; dr <= 2; dr++) {
					for (let dc = -2; dc <= 2; dc++) {
						const val =
							Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)
								? 1
								: 0;
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
export function qrSvg(
	data: string,
	opts?: { size?: number; dark?: string; light?: string },
): string {
	const size = opts?.size ?? 256;
	const dark = opts?.dark ?? "#000000";
	const light = opts?.light ?? "#ffffff";

	const bytes = new TextEncoder().encode(data);
	const version = selectVersion(bytes.length);
	const codewords = encodeData(bytes, version);
	const matrix = buildMatrix(version, codewords);

	const n = matrix.length;
	const quiet = 4;
	const total = n + quiet * 2;
	const scale = size / total;

	let paths = "";
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (matrix[r]?.[c]) {
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
		"</svg>",
	].join("");
}
