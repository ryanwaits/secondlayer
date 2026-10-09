import { describe, expect, test } from "bun:test";
import {
	type Bytes,
	MAINNET_CHECKPOINT,
	type VerifyCheckpoint,
	blockId,
	hex,
	marfPath,
	marfProofAncestors,
	parseEpoch2Header,
	parseNakamotoHeader,
	unhex,
	verifyBlock,
	verifyMarfProof,
} from "../src/index.ts";
import { heightToHashKey, marfProofValue } from "../src/marf.ts";
import { FakeSource, signerChain } from "./fake-source.ts";
import { epoch2File, epoch2Header, headerFile } from "./fixtures.ts";
import { type HeightProof, buildHeightProof } from "./marf-builder.ts";

// Mainnet 2.x block 2,000 (its witness is a fixture) and its parent 1,999.
const B2000 =
	"113e01ba3dd3e340af346d641e79887628e318e10f259eda0a692bed9f9d2f31";
const B1999 =
	"fba1e3bb7ebe53a2227db42df5a2238da7e636a2b9918e9c2b53ff0eaea10800";
// Nakamoto 9,137,005 (a fixture) and its parent 9,137,004 (witness fixture).
const H = signerChain.h;
const P = hex(parseNakamotoHeader(headerFile(H)).parentBlockId);
const CHECKPOINT_HEIGHT = 8956304;

/** Ancestor trie A's header: mainnet 2.x block 150,000's bytes with A's root. */
const A = epoch2File(
	"7172a926a42a9356074c71facea8c6450398c97d717fd900884af2bb9102ffa1",
);

const heightProof = (
	height: number,
	id: string,
	tipBytes: Bytes = unhex(MAINNET_CHECKPOINT.stacks.header),
): HeightProof =>
	buildHeightProof({
		height,
		id,
		tipBytes,
		ancestorBytes: unhex(A.header),
		ancestorCh: unhex(A.consensus_hash),
	});

/** Leaf value bytes start after: u32 step count, kind, chr, u32 path length, 31-byte path. */
const VALUE_AT = 4 + 1 + 1 + 4 + 31;

describe("a __MARF_BLOCK_HEIGHT_TO_HASH proof", () => {
	const p = heightProof(2000, B2000);
	const path = marfPath(heightToHashKey(2000));
	const check = (over: Partial<Parameters<typeof verifyMarfProof>[0]> = {}) =>
		verifyMarfProof({
			proof: p.proof,
			path,
			value: marfProofValue(p.proof) as Bytes,
			root: p.tipHeader.stateIndexRoot,
			headers: [p.tipHeader, p.ancestorHeader],
			...over,
		});

	test("names the ancestor's id, through a backptr into a 2.x trie", () => {
		const value = marfProofValue(p.proof) as Bytes;
		expect(hex(value.subarray(0, 32))).toBe(B2000);
		expect(value.subarray(32).every((b) => b === 0)).toBe(true);
		expect(marfProofAncestors(p.proof)).toEqual([p.ancestorId]);
		expect(check()).toBe(true);
	});

	test("a leaf naming another id does not recompute the tip's root", () => {
		const forged = p.proof.slice();
		forged[VALUE_AT] = (forged[VALUE_AT] as number) ^ 1;
		expect(
			check({ proof: forged, value: marfProofValue(forged) as Bytes }),
		).toBe(false);
	});

	test("an ancestor header forged around the same state root is rejected", () => {
		const raw = p.ancestor.header.slice();
		raw[1] = (raw[1] as number) ^ 1; // total_work.burn
		const forged = parseEpoch2Header(raw, p.ancestor.consensusHash);
		expect(hex(forged.stateIndexRoot)).toBe(
			hex(p.ancestorHeader.stateIndexRoot),
		);
		expect(check({ headers: [p.tipHeader, forged] })).toBe(false);
	});

	test("the ancestor's header under another consensus hash is rejected", () => {
		const ch = p.ancestor.consensusHash.slice();
		ch[0] = (ch[0] as number) ^ 1;
		const forged = parseEpoch2Header(p.ancestor.header, ch);
		expect(check({ headers: [p.tipHeader, forged] })).toBe(false);
	});

	test("does not answer for another height", () => {
		expect(check({ path: marfPath(heightToHashKey(2001)) })).toBe(false);
	});
});

/** A checkpoint whose state root is the synthetic tip's: what the proof is checked against. */
const checkpointAt = (tip: Bytes): VerifyCheckpoint => ({
	...MAINNET_CHECKPOINT,
	stacks: { ...MAINNET_CHECKPOINT.stacks, header: hex(tip) },
});

/** Fixtures plus the proof at the tip and the ancestor trie's 2.x header. */
function jumpSource(p: HeightProof, height: number): FakeSource {
	const source = new FakeSource();
	const tipId = hex(blockId(p.tipHeader));
	source.marf.set(`${hex(marfPath(heightToHashKey(height)))}@${tipId}`, {
		data: "",
		proof: p.proof,
	});
	source.epoch2.set(p.ancestorId, p.ancestor);
	return source;
}

describe("verifyBlock below the checkpoint, by MARF proof", () => {
	test("2.x block 2,000: one proof, its header by id, its witness against its root", async () => {
		const p = heightProof(2000, B2000);
		const source = jumpSource(p, 2000);
		const tipId = hex(blockId(p.tipHeader));
		const r = await verifyBlock(2000, {
			source,
			checkpoint: checkpointAt(p.tip),
		});
		expect(r).toMatchObject({
			ok: true,
			height: 2000,
			blockId: B2000,
			stateRoot: hex(epoch2Header(B2000).stateIndexRoot),
			ancestry: {
				via: "marf",
				fromHeight: CHECKPOINT_HEIGHT,
				fromBlockId: tipId,
			},
			failures: [],
		});
		// No signatures or signer sets below the checkpoint; the burn block
		// predates the Bitcoin checkpoint (here: the source has no preimage).
		expect(r.signerWeight).toBeUndefined();
		expect(r.burnHeight).toBeUndefined();
		// The parent id comes from 2,000's own trie: its bookkeeping leaves
		// classify as internal, not as writes.
		const d = r.diff;
		if (!d) throw new Error("no diff");
		expect(d.internal.length).toBe(5);
		expect(d.internal.some((l) => l.key === heightToHashKey(1999))).toBe(true);
		const ch = (id: string) => hex(epoch2Header(id).consensusHash);
		expect(source.log).toEqual([
			`marf ${hex(marfPath(heightToHashKey(2000)))}@${tipId}`,
			`block ${p.ancestorId}`,
			`epoch2 ${p.ancestorId}`,
			`block ${B2000}`,
			`epoch2 ${B2000}`,
			`burn ${ch(B2000)}`,
			`witness ${B2000}`,
			`block ${B1999}`,
			`epoch2 ${B1999}`,
			`witness ${B1999}`,
		]);
		expect(r.notes[0]).toContain("burn block not checked");
	});

	test("by index block hash, the proof must name that block", async () => {
		const p = heightProof(2000, B2000);
		const r = await verifyBlock(B2000, {
			source: jumpSource(p, 2000),
			checkpoint: checkpointAt(p.tip),
		});
		expect(r).toMatchObject({ ok: true, height: 2000, blockId: B2000 });
	});

	test("a block the checkpoint's chain does not hold at its height is not an ancestor", async () => {
		// The proof names 1,999's id at height 2,000: 2,000 is off the chain.
		const p = heightProof(2000, B1999);
		const r = await verifyBlock(B2000, {
			source: jumpSource(p, 2000),
			checkpoint: checkpointAt(p.tip),
		});
		expect(r.ok).toBe(false);
		expect(r.failures[0]).toMatchObject({
			step: "ancestry",
			code: "not-ancestor",
			blockId: B2000,
		});
	});

	test("a proof whose leaf was altered fails ancestry", async () => {
		const p = heightProof(2000, B2000);
		const source = jumpSource(p, 2000);
		const forged = p.proof.slice();
		forged[VALUE_AT] = (forged[VALUE_AT] as number) ^ 1;
		for (const [k, v] of source.marf)
			if (v.proof === p.proof) source.marf.set(k, { ...v, proof: forged });
		const r = await verifyBlock(2000, {
			source,
			checkpoint: checkpointAt(p.tip),
		});
		expect(r.failures[0]).toMatchObject({
			step: "ancestry",
			code: "ancestry-proof-invalid",
		});
		expect(r.blockId).toBeUndefined();
	});

	test("a forged header served for the proven id fails the block link", async () => {
		const p = heightProof(2000, B2000);
		const source = jumpSource(p, 2000);
		const real = source.epoch2.get(B2000);
		if (!real) throw new Error("no 2,000 fixture");
		const header = real.header.slice();
		header[200] = (header[200] as number) ^ 1; // state root
		source.epoch2.set(B2000, { ...real, header });
		const r = await verifyBlock(2000, {
			source,
			checkpoint: checkpointAt(p.tip),
		});
		expect(r.failures[0]).toMatchObject({ step: "block", code: "id-mismatch" });
	});

	test("a source with no __MARF_ proofs cannot reach past the parent-link distance", async () => {
		const r = await verifyBlock(2000, { source: new FakeSource() });
		expect(r.failures[0]).toMatchObject({
			step: "ancestry",
			code: "unavailable",
		});
		expect(r.failures[0]?.message).toContain("parent links reach 16");
	});

	test("Nakamoto 9,137,004 from a tip 62,996 above it binds its burn block too", async () => {
		// H's bytes as a tip at 9,200,000: its proof names P at 9,137,004.
		const tipBytes = headerFile(H);
		new DataView(tipBytes.buffer, tipBytes.byteOffset).setBigUint64(
			1,
			9200000n,
		);
		const p = heightProof(9137004, P, tipBytes);
		const r = await verifyBlock(9137004, {
			source: jumpSource(p, 9137004),
			checkpoint: checkpointAt(p.tip),
		});
		expect(r).toMatchObject({
			ok: true,
			blockId: P,
			ancestry: { via: "marf", fromHeight: 9200000 },
			// Same tenure as H: burn 970,269 is above the Bitcoin checkpoint.
			burnHeight: 970269,
		});
		expect(r.signerWeight).toBeUndefined();
	});
});

describe("verifyBlock below the checkpoint, by parent links", () => {
	// H as the checkpoint, holding cycle 144's set: P is one link below.
	const checkpointH: VerifyCheckpoint = {
		stacks: {
			header: hex(headerFile(H)),
			cycle: 144,
			signerSet: (signerChain.sets["144"]?.data as string).replace(/^0x/, ""),
		},
		bitcoin: MAINNET_CHECKPOINT.bitcoin,
	};

	test("9,137,004: its header hashes to the parent id H commits to", async () => {
		const source = new FakeSource();
		const r = await verifyBlock(9137004, { source, checkpoint: checkpointH });
		expect(r).toMatchObject({
			ok: true,
			height: 9137004,
			blockId: P,
			ancestry: { via: "parents", fromHeight: 9137005, fromBlockId: H },
			burnHeight: 970269,
		});
		expect(source.log.filter((l) => l.startsWith("marf"))).toEqual([]);
		expect(source.log[0]).toBe(`block ${P}`);
	});

	test("tampered parent bytes break the link", async () => {
		const source = new FakeSource();
		const raw = headerFile(P);
		const rootAt = 1 + 8 + 8 + 20 + 32 + 32;
		raw[rootAt] = (raw[rootAt] as number) ^ 1;
		source.blocks.set(P, raw);
		const r = await verifyBlock(9137004, { source, checkpoint: checkpointH });
		expect(r.failures[0]).toMatchObject({
			step: "ancestry",
			code: "id-mismatch",
			blockId: P,
		});
	});
});
