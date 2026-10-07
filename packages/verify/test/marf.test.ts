import { describe, expect, test } from "bun:test";
import {
	type NakamotoHeader,
	hex,
	marfPath,
	marfValue,
	unhex,
	verifyMarfProof,
} from "../src/index.ts";
import {
	type ProofFixture,
	listFixtures,
	loadHeaders,
	readJson,
} from "./fixtures.ts";

const headers = loadHeaders();

const cases = listFixtures("proofs").map((f) => {
	const fx = readJson<ProofFixture>(`proofs/${f}`);
	const tip = headers.get(fx.tip) as NakamotoHeader;
	// Tip plus every ancestor the fixture's proof crosses, all from header bytes.
	const ids = new Set([fx.tip, ...Object.values(fx.root_to_block)]);
	const chain = [...ids].map((id) => headers.get(id) as NakamotoHeader);
	return { name: f.slice(0, -5), fx, tip, chain };
});

describe("verifyMarfProof", () => {
	test("fixtures cover a tip-only proof and a multi-trie backptr proof", () => {
		const hops = cases.map((c) => Object.keys(c.fx.root_to_block).length);
		expect(Math.min(...hops)).toBe(1);
		expect(Math.max(...hops)).toBeGreaterThan(1);
	});

	for (const { name, fx, tip, chain } of cases) {
		const base = {
			proof: unhex(fx.proof),
			path: marfPath(fx.key),
			value: marfValue(fx.data),
			root: tip.stateIndexRoot,
			headers: chain,
		};

		describe(name, () => {
			test("every root the proof uses comes from a fixture header", () => {
				for (const h of chain) expect(h).toBeDefined();
				expect(hex(tip.stateIndexRoot)).toBe(fx.root);
				for (const [root, id] of Object.entries(fx.root_to_block))
					expect(hex(headers.get(id)?.stateIndexRoot as Uint8Array)).toBe(root);
			});

			test("key hashes to the fixture's trie path", () => {
				expect(hex(base.path)).toBe(fx.path);
			});

			test("real value verifies against the header's state root", () => {
				expect(verifyMarfProof(base)).toBe(true);
			});

			test("forged value is rejected", () => {
				expect(
					verifyMarfProof({ ...base, value: marfValue(`${fx.data}0`) }),
				).toBe(false);
			});

			test("wrong root is rejected", () => {
				const root = base.root.slice();
				root[0] = (root[0] as number) ^ 1;
				expect(verifyMarfProof({ ...base, root })).toBe(false);
			});

			test("wrong path is rejected", () => {
				const path = base.path.slice();
				path[31] = (path[31] as number) ^ 1;
				expect(verifyMarfProof({ ...base, path })).toBe(false);
			});

			test("a flipped proof byte is rejected at 16 positions", () => {
				const survivors: number[] = [];
				for (let k = 0; k < 16; k++) {
					const pos = Math.floor(
						(((k * 2654435761) % 1_000_003) / 1_000_003) * base.proof.length,
					);
					const proof = base.proof.slice();
					proof[pos] = (proof[pos] as number) ^ 1;
					if (verifyMarfProof({ ...base, proof })) survivors.push(pos);
				}
				expect(survivors).toEqual([]);
			});

			test("truncated proof bytes verify false instead of throwing", () => {
				const proof = base.proof.subarray(0, base.proof.length - 1);
				expect(verifyMarfProof({ ...base, proof })).toBe(false);
			});

			if (chain.length > 1)
				test("an ancestor trie without its header is not trusted", () => {
					expect(verifyMarfProof({ ...base, headers: [tip] })).toBe(false);
				});
		});
	}
});
