// Fixture loaders. Mainnet proofs/headers/signers/burn; witnesses come from a
// local stackslib MARF (synthetic chain, real trie code).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	type NakamotoHeader,
	blockId,
	hex,
	parseNakamotoHeader,
} from "../src/index.ts";

const DIR = join(import.meta.dir, "fixtures");

export const readJson = <T>(rel: string): T =>
	JSON.parse(readFileSync(join(DIR, rel), "utf8")) as T;

/** Every fixture header, keyed by its recomputed block id. */
export function loadHeaders(): Map<string, NakamotoHeader> {
	const out = new Map<string, NakamotoHeader>();
	for (const f of readdirSync(join(DIR, "headers"))) {
		const h = parseNakamotoHeader(
			new Uint8Array(readFileSync(join(DIR, "headers", f))),
		);
		out.set(hex(blockId(h)), h);
	}
	return out;
}

export const headerFile = (id: string): Uint8Array =>
	new Uint8Array(readFileSync(join(DIR, "headers", `${id}.bin`)));

export const listFixtures = (dir: string): string[] =>
	readdirSync(join(DIR, dir))
		.filter((f) => f.endsWith(".json"))
		.sort();

export interface ProofFixture {
	key: string;
	path: string;
	data: string;
	proof: string;
	root: string;
	tip: string;
	root_to_block: Record<string, string>;
}

export interface WitnessFixture {
	block: string;
	height: number;
	parent: string;
	expected_root: string;
	witness_v2: string;
	writes: [string, string][];
	internal: [string, string][];
	carried_parent_values: Record<string, string>;
	expect: { writes: number; carried: number; internal_leaves: number };
}

export interface SignerChainFixture {
	checkpoint: string;
	a: string;
	h: string;
	cycle_h: number;
	sets: Record<
		string,
		{ at: string; key: string; path: string; data: string; proof: string }
	>;
}

export interface BurnFixture {
	consensus_hash: string;
	preimage: string;
	burn_height: number;
	stacks_block: string;
	reward_cycle: number;
}
