import { describe, expect, test } from "bun:test";
import {
	blockId,
	hex,
	parseEpoch2Header,
	parseNakamotoHeader,
	signerSignatureHash,
	unhex,
} from "../src/index.ts";
import {
	epoch2File,
	epoch2Header,
	epoch2Ids,
	headerFile,
	loadHeaders,
} from "./fixtures.ts";

const H = "2e5962b00b8f243e1a4b5a1b7ff3076618ce5e737e30c019bc61e461c92f57ff";

describe("parseNakamotoHeader", () => {
	test("every mainnet header, Nakamoto and 2.x, hashes to the block id it was fetched by", () => {
		const headers = loadHeaders();
		expect(headers.size).toBe(11 + 6);
		for (const [id, h] of headers) expect(hex(blockId(h))).toBe(id);
	});

	test("reads an epoch 4.0 (v1) header including problematic_txs", () => {
		const h = parseNakamotoHeader(headerFile(H));
		expect(h.version & 0x7f).toBe(1);
		expect(h.chainLength).toBe(9137005n);
		expect(h.signerSignatures.length).toBe(25);
		expect(hex(h.stateIndexRoot)).toBe(
			"8103be4b31c6549fe58dd453d9ea357286c874ac0f4f81f4326791e8191f0cd5",
		);
	});

	test("signer signature hash ignores the signer signatures themselves", () => {
		const raw = headerFile(H);
		const h = parseNakamotoHeader(raw);
		const sigsAt = 1 + 8 + 8 + 20 + 32 + 32 + 32 + 8 + 65 + 4;
		const forged = raw.slice();
		forged[sigsAt + 10] = (forged[sigsAt + 10] as number) ^ 1;
		const f = parseNakamotoHeader(forged);
		expect(hex(signerSignatureHash(f))).toBe(hex(signerSignatureHash(h)));
		expect(hex(blockId(f))).toBe(H);
	});

	test("changing the state root changes the block id", () => {
		const raw = headerFile(H);
		const rootAt = 1 + 8 + 8 + 20 + 32 + 32;
		raw[rootAt] = (raw[rootAt] as number) ^ 1;
		expect(hex(blockId(parseNakamotoHeader(raw)))).not.toBe(H);
	});

	test("truncated header bytes are rejected", () => {
		expect(() => parseNakamotoHeader(headerFile(H).subarray(0, 200))).toThrow();
	});
});

// Mainnet 2.x headers from node `/v2/headers/3?tip=<150,000>`: 150,000 and its
// two parents.
const E150000 =
	"7172a926a42a9356074c71facea8c6450398c97d717fd900884af2bb9102ffa1";
const E149999 =
	"d281730546550e66a5b734c49cba0867c3e379c6d39f7e819be44c64a9c03b9f";
const E149998 =
	"7cdd53c34f42bf619a8e310993fa9a4d35ef887a1c3018c7aa73c19ddff5efbc";

describe("parseEpoch2Header", () => {
	test("every 2.x fixture hashes, with its consensus hash, to the id it was fetched by", () => {
		const ids = epoch2Ids();
		expect(ids.length).toBe(6);
		for (const id of ids) expect(hex(blockId(epoch2Header(id)))).toBe(id);
	});

	test("total_work.work is the Stacks height", () => {
		expect(epoch2Header(E150000).chainLength).toBe(150000n);
		expect(epoch2Header(E149998).chainLength).toBe(149998n);
	});

	test("each header commits to its parent's block hash, not its index block hash", () => {
		const [a, b, c] = [E150000, E149999, E149998].map(epoch2Header);
		expect(hex(a?.parentBlockHash as Uint8Array)).toBe(
			hex(b?.blockHash as Uint8Array),
		);
		expect(hex(b?.parentBlockHash as Uint8Array)).toBe(
			hex(c?.blockHash as Uint8Array),
		);
		expect(hex(a?.parentBlockHash as Uint8Array)).not.toBe(E149999);
		expect(epoch2File(E150000).parent_block_id).toBe(E149999);
	});

	test("a changed header byte or another consensus hash names another block", () => {
		const f = epoch2File(E150000);
		const raw = unhex(f.header);
		const ch = unhex(f.consensus_hash);
		const forged = raw.slice();
		forged[200] = (forged[200] as number) ^ 1; // state root
		expect(hex(blockId(parseEpoch2Header(forged, ch)))).not.toBe(E150000);
		const otherCh = ch.slice();
		otherCh[0] = (otherCh[0] as number) ^ 1;
		expect(hex(blockId(parseEpoch2Header(raw, otherCh)))).not.toBe(E150000);
	});

	test("truncated bytes and a short consensus hash are rejected", () => {
		const f = epoch2File(E150000);
		const ch = unhex(f.consensus_hash);
		expect(() =>
			parseEpoch2Header(unhex(f.header).subarray(0, 200), ch),
		).toThrow();
		expect(() =>
			parseEpoch2Header(unhex(f.header), ch.subarray(0, 19)),
		).toThrow("20");
	});
});
