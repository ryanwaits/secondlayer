import { describe, expect, test } from "bun:test";
import {
	blockId,
	hex,
	parseNakamotoHeader,
	signerSignatureHash,
} from "../src/index.ts";
import { headerFile, loadHeaders } from "./fixtures.ts";

const H = "2e5962b00b8f243e1a4b5a1b7ff3076618ce5e737e30c019bc61e461c92f57ff";

describe("parseNakamotoHeader", () => {
	test("every mainnet header hashes to the block id it was fetched by", () => {
		const headers = loadHeaders();
		expect(headers.size).toBe(10);
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
