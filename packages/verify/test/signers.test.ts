import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { uintCV } from "@secondlayer/stacks/clarity";
import {
	type NakamotoHeader,
	decodeSignerSet,
	hex,
	mapEntryKey,
	marfPath,
	marfValue,
	unhex,
	verifyMarfProof,
	verifySignerSignatures,
} from "../src/index.ts";
import { type SignerChainFixture, loadHeaders, readJson } from "./fixtures.ts";

const headers = loadHeaders();
const chain = readJson<SignerChainFixture>("signers/signer-chain.json");
const header = (id: string) => headers.get(id) as NakamotoHeader;
const B = header(chain.checkpoint);
const A = header(chain.a);
const H = header(chain.h);

/** MARF-prove `cycle-signer-set[cycle]` at its block, then decode it. */
function provenSet(cycle: number) {
	const s = chain.sets[String(cycle)];
	if (!s) throw new Error(`no set ${cycle}`);
	const value = s.data.replace(/^0x/, "");
	const ok = verifyMarfProof({
		proof: unhex(s.proof),
		path: marfPath(s.key),
		value: marfValue(value),
		root: header(s.at).stateIndexRoot,
		headers: [...headers.values()],
	});
	if (!ok) throw new Error(`set ${cycle} proof failed`);
	return decodeSignerSet(value);
}

const set143 = provenSet(143);
const set144 = provenSet(144);

const withSigs = (h: NakamotoHeader, sigs: Uint8Array[]): NakamotoHeader => ({
	...h,
	signerSignatures: sigs,
});

describe("signer sets", () => {
	test("set keys are the .signers cycle-signer-set map entries", () => {
		for (const cycle of [143, 144]) {
			const key = mapEntryKey(
				"SP000000000000000000002Q6VF78.signers",
				"cycle-signer-set",
				uintCV(cycle),
			);
			expect(key).toBe(chain.sets[String(cycle)]?.key as string);
			expect(hex(marfPath(key))).toBe(
				chain.sets[String(cycle)]?.path as string,
			);
		}
	});

	test("set 143 is proven at checkpoint B and set 144 at A", () => {
		expect(chain.sets["143"]?.at).toBe(chain.checkpoint);
		expect(chain.sets["144"]?.at).toBe(chain.a);
		expect(set143.size).toBe(29);
		expect(set144.size).toBe(31);
	});

	test("a forged signer set value fails its MARF proof", () => {
		const s = chain.sets["144"] as SignerChainFixture["sets"][string];
		const forged = s.data
			.replace(/^0x/, "")
			.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
		expect(
			verifyMarfProof({
				proof: unhex(s.proof),
				path: marfPath(s.key),
				value: marfValue(forged),
				root: A.stateIndexRoot,
				headers: [...headers.values()],
			}),
		).toBe(false);
	});
});

describe("verifySignerSignatures", () => {
	test("checkpoint B -> A: 3180/4000 of set 143 signed", () => {
		expect(B.chainLength).toBe(8956304n);
		const r = verifySignerSignatures(A, set143);
		expect(r).toMatchObject({
			valid: true,
			signedWeight: 3180n,
			totalWeight: 4000n,
			threshold: 2800n,
			unknown: [],
			duplicates: [],
			invalid: 0,
		});
		expect(r.signers.length).toBe(20);
	});

	test("A -> H: 2866/4000 of set 144 signed", () => {
		const r = verifySignerSignatures(H, set144);
		expect(r).toMatchObject({
			valid: true,
			signedWeight: 2866n,
			totalWeight: 4000n,
			threshold: 2800n,
		});
		expect(r.signers.length).toBe(25);
	});

	test("H truncated to 21 signatures falls under the threshold", () => {
		const r = verifySignerSignatures(
			withSigs(H, H.signerSignatures.slice(0, 21)),
			set144,
		);
		expect(r.signedWeight).toBeLessThan(r.threshold);
		expect(r.valid).toBe(false);
	});

	test("overlapping sets: H's known signers also clear 70% of set 143", () => {
		// Weight alone passes the previous cycle's set, so the cycle has to come
		// from the burn height; only the 2 signers new in 144 trip the unknown rule.
		const r = verifySignerSignatures(H, set143);
		expect(r.signedWeight).toBe(2892n);
		expect(r.signedWeight).toBeGreaterThanOrEqual(r.threshold);
		expect(r.unknown.length).toBe(2);
		expect(r.valid).toBe(false);
	});

	test("a signer outside the set invalidates the header", () => {
		const first = verifySignerSignatures(H, set144).signers[0] as string;
		const without = new Map(set144);
		without.delete(first);
		const r = verifySignerSignatures(H, without);
		expect(r.unknown).toEqual([first]);
		expect(r.valid).toBe(false);
	});

	test("a repeated signature is rejected, not double counted", () => {
		const sigs = [...H.signerSignatures, H.signerSignatures[0] as Uint8Array];
		const r = verifySignerSignatures(withSigs(H, sigs), set144);
		expect(r.duplicates.length).toBe(1);
		expect(r.signedWeight).toBe(2866n);
		expect(r.valid).toBe(false);
	});

	test("a high-S twin of a real signature does not recover", () => {
		const sig = (H.signerSignatures[0] as Uint8Array).slice();
		const s = secp256k1.Signature.fromBytes(sig, "recovered");
		const n = secp256k1.Point.Fn.ORDER;
		const flipped = new secp256k1.Signature(
			s.r,
			n - s.s,
			(s.recovery as number) ^ 1,
		);
		const sigs = [flipped.toBytes("recovered"), ...H.signerSignatures.slice(1)];
		const r = verifySignerSignatures(withSigs(H, sigs), set144);
		expect(r.invalid).toBe(1);
		expect(r.valid).toBe(false);
	});

	test("signatures over a different header recover to unknown keys", () => {
		const r = verifySignerSignatures(withSigs(A, H.signerSignatures), set144);
		expect(r.signers).toEqual([]);
		expect(r.valid).toBe(false);
	});

	test("an empty signer set never validates", () => {
		expect(verifySignerSignatures(H, new Map()).valid).toBe(false);
	});
});
