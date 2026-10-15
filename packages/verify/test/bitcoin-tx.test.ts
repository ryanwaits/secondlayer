import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doubleSha256 } from "@secondlayer/stacks/bitcoin";
import {
	BlockVerifier,
	type ProofSource,
	type SpvProof,
	hex,
	unhex,
} from "../src/index.ts";
import { FakeSource } from "./fake-source.ts";

const DIR = join(import.meta.dir, "fixtures", "bitcoin");
const STAKER = "bc1q9fkjx3s9ufz90k4jzgmdkzlyt22h0tp3x92ua9";
const AMOUNT = 398_000n;

// Real mainnet sBTC withdrawal sweeps that pay the staker.
const ABOVE = {
	txid: "f80a188d012dbb733748db003b987cc98fc4a636cbd071734decb298c1bad80b",
	height: 968_461,
	vout: 6,
};
const BELOW = {
	txid: "9aaa088d7c7a88c946e4c644f5349b38b806638240fdc423f22411bc01a33a4b",
	height: 967_410,
	vout: 21,
};

interface WireProof {
	txid: string;
	block_height: number;
	header: string;
	raw_tx: string;
	tx_index: number;
	tx_count: number;
	siblings: string[];
}

const wire = (txid: string): WireProof =>
	JSON.parse(readFileSync(join(DIR, `tx-${txid}.json`), "utf8"));

function toProof(w: WireProof): SpvProof {
	return {
		rawTx: unhex(w.raw_tx),
		txidInternal: unhex(w.txid).reverse(),
		header: unhex(w.header),
		height: w.block_height,
		merkle: {
			siblings: w.siblings.map(unhex),
			txIndex: w.tx_index,
			txCount: w.tx_count,
		},
	};
}

const proofOf = (txid: string) => toProof(wire(txid));

function headerRows(file: string): Map<number, string> {
	return new Map(
		readFileSync(join(DIR, file), "utf8")
			.trim()
			.split("\n")
			.map((l) => {
				const [h, raw] = l.split(" ");
				return [Number(h), raw as string];
			}),
	);
}
const bitcoinRows = new Map([
	...headerRows("headers-967410-967679.txt"),
	...headerRows("headers-967680-970300.txt"),
]);

/** A fake source whose Bitcoin headers also reach below the checkpoint. */
function makeSource(extra: Partial<ProofSource> = {}) {
	const fake = new FakeSource();
	const requests: string[] = [];
	const source: ProofSource = {
		...fake,
		getBitcoinHeaders: async (from, count) => {
			requests.push(`${from}+${count}`);
			return Array.from(
				{ length: count },
				(_, i) => bitcoinRows.get(from + i) as string,
			).filter((h) => h !== undefined);
		},
		...extra,
	};
	return { source, requests };
}

const verifier = (extra: Partial<ProofSource> = {}) =>
	new BlockVerifier({ source: makeSource(extra).source });

const expectStaker = { address: STAKER, amount: AMOUNT };

describe("verifyBitcoinTx", () => {
	test("a sweep above the checkpoint is proven and its output pays the staker", async () => {
		const result = await verifier().verifyBitcoinTx(proofOf(ABOVE.txid), {
			expect: expectStaker,
		});
		expect(result.failures).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.matched).toBe(ABOVE.vout);
		expect(result.height).toBe(ABOVE.height);
		expect(result.txid).toBe(ABOVE.txid);
		expect(result.outputs?.[ABOVE.vout]?.amount).toBe(AMOUNT);
	});

	test("a sweep below the checkpoint is proven by prev-hash links back from the checkpoint", async () => {
		const { source, requests } = makeSource();
		const v = new BlockVerifier({ source });
		const result = await v.verifyBitcoinTx(proofOf(BELOW.txid), {
			expect: expectStaker,
		});
		expect(result.failures).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.matched).toBe(BELOW.vout);
		expect(result.height).toBe(BELOW.height);
		expect(requests).toEqual([`${BELOW.height}+${967_680 - BELOW.height}`]);
		// The walked headers are remembered: a second proof costs no fetches.
		await v.verifyBitcoinTx(proofOf(BELOW.txid));
		expect(requests).toHaveLength(1);
	});

	test("a txid is fetched through the source's getBitcoinTxProof", async () => {
		const asked: string[] = [];
		const result = await verifier({
			getBitcoinTxProof: async (txid) => {
				asked.push(txid);
				return proofOf(txid);
			},
		}).verifyBitcoinTx(ABOVE.txid, { expect: expectStaker });
		expect(result.ok).toBe(true);
		expect(asked).toEqual([ABOVE.txid]);
	});

	test("a txid with no source method fails as unavailable", async () => {
		const result = await verifier().verifyBitcoinTx(ABOVE.txid);
		expect(result.ok).toBe(false);
		expect(result.failures[0]).toMatchObject({
			step: "bitcoin-tx",
			code: "unavailable",
		});
	});

	test("a source that throws is unavailable, never a thrown error", async () => {
		const result = await verifier({
			getBitcoinTxProof: async () => {
				throw new Error("bitcoind down");
			},
		}).verifyBitcoinTx(ABOVE.txid);
		expect(result.failures[0]).toMatchObject({ code: "unavailable" });
		expect(result.failures[0]?.message).toContain("bitcoind down");
	});

	test("a changed output value fails the txid", async () => {
		const w = wire(ABOVE.txid);
		const proof = toProof(w);
		// The 8-byte value sits right before the 1-byte script length and the script.
		const out = proof.rawTx;
		const script = hex(
			(await verifier().verifyBitcoinTx(proof)).outputs?.[ABOVE.vout]
				?.script as Uint8Array,
		);
		const at = w.raw_tx.indexOf(script) / 2 - 9;
		out[at] = (out[at] as number) ^ 0x01;
		const result = await verifier().verifyBitcoinTx(proof);
		expect(result.ok).toBe(false);
		expect(result.failures[0]?.code).toBe("txid-mismatch");
	});

	test("a wrong sibling fails the merkle root", async () => {
		const proof = proofOf(ABOVE.txid);
		(proof.merkle.siblings[0] as Uint8Array)[0] ^= 0x01;
		const result = await verifier().verifyBitcoinTx(proof);
		expect(result.failures[0]?.code).toBe("merkle-mismatch");
	});

	test("a branch of the wrong length is refused", async () => {
		const proof = proofOf(ABOVE.txid);
		proof.merkle.siblings.pop();
		const result = await verifier().verifyBitcoinTx(proof);
		expect(result.failures[0]?.code).toBe("merkle-mismatch");
		expect(result.failures[0]?.message).toContain("needs");
	});

	test("a tx index outside the block is refused", async () => {
		const proof = proofOf(ABOVE.txid);
		proof.merkle.txIndex = proof.merkle.txCount;
		const result = await verifier().verifyBitcoinTx(proof);
		expect(result.failures[0]?.code).toBe("merkle-mismatch");
	});

	test("a 64-byte transaction is refused", async () => {
		// version, 1 input (zero txid, empty scriptSig), 1 output with a 4-byte script.
		const rawTx = unhex(
			[
				"01000000",
				"01",
				"00".repeat(32),
				"00000000",
				"00",
				"ffffffff",
				"01",
				"0000000000000000",
				"04",
				"deadbeef",
				"00000000",
			].join(""),
		);
		expect(rawTx.length).toBe(64);
		const proof = proofOf(ABOVE.txid);
		const result = await verifier().verifyBitcoinTx({
			...proof,
			rawTx,
			txidInternal: doubleSha256(rawTx),
		});
		expect(result.ok).toBe(false);
		expect(result.failures[0]?.code).toBe("tx-parse");
	});

	test("a header not in the checkpoint chain fails", async () => {
		const proof = proofOf(ABOVE.txid);
		// Changing the nonce keeps the merkle root, so only the chain check can catch it.
		proof.header[79] = (proof.header[79] as number) ^ 0x01;
		const result = await verifier().verifyBitcoinTx(proof);
		expect(result.ok).toBe(false);
		expect(["merkle-mismatch", "bitcoin-header-not-in-chain"]).toContain(
			result.failures[0]?.code as string,
		);
		expect(result.failures[0]?.code).toBe("bitcoin-header-not-in-chain");
	});

	test("a header claimed at the wrong height fails", async () => {
		const proof = { ...proofOf(ABOVE.txid), height: ABOVE.height + 1 };
		const result = await verifier().verifyBitcoinTx(proof);
		expect(result.failures[0]?.code).toBe("bitcoin-header-not-in-chain");
	});

	test("a below-checkpoint header that does not link to the checkpoint fails", async () => {
		const proof = proofOf(BELOW.txid);
		// Serve a forged header one block up: the walk breaks at the link after it.
		const forged = headerRows("headers-967410-967679.txt");
		const real = forged.get(BELOW.height + 1) as string;
		forged.set(
			BELOW.height + 1,
			`${real.slice(0, 158)}${real.endsWith("00") ? "01" : "00"}`,
		);
		const result = await verifier({
			getBitcoinHeaders: async (from, count) =>
				Array.from(
					{ length: count },
					(_, i) =>
						(forged.get(from + i) ?? bitcoinRows.get(from + i)) as string,
				),
		}).verifyBitcoinTx(proof);
		expect(result.ok).toBe(false);
		expect(result.failures[0]?.code).toBe("bitcoin-header-not-in-chain");
	});

	test("an output that does not match expect fails", async () => {
		const result = await verifier().verifyBitcoinTx(proofOf(ABOVE.txid), {
			expect: { address: STAKER, amount: 1n },
		});
		expect(result.ok).toBe(false);
		expect(result.failures[0]?.code).toBe("output-not-found");
		expect(result.matched).toBeUndefined();
	});

	test("a proof for one output checks that output only", async () => {
		const proof = { ...proofOf(ABOVE.txid), vout: 0 };
		const result = await verifier().verifyBitcoinTx(proof, {
			expect: expectStaker,
		});
		expect(result.failures[0]?.code).toBe("output-not-found");
	});
});
