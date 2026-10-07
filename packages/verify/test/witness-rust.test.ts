import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hex, parseWitness } from "../src/index.ts";

// Witnesses written by the Rust extractor (stacks-core contrib/marf-witness, wire
// format v3): three from a local stackslib MARF and one from mainnet block 1,230,200.
// The TypeScript parser must recompute the same root and leaf count byte for byte.
const dir = join(import.meta.dir, "fixtures", "witness-rust");
const witnesses = readdirSync(dir).filter((f) => f.endsWith(".witness"));

describe("witnesses written by the Rust extractor", () => {
	test("fixture set is present", () => {
		expect(witnesses.length).toBe(4);
	});

	for (const file of witnesses) {
		const meta = JSON.parse(
			readFileSync(join(dir, file.replace(".witness", ".json")), "utf8"),
		);
		test(`recomputes the extractor's root and leaf count at height ${meta.height}`, () => {
			const witness = parseWitness(
				new Uint8Array(readFileSync(join(dir, file))),
			);
			expect(hex(witness.root)).toBe(meta.root_hex);
			expect(witness.leaves.length).toBe(meta.leaves);
		});
	}
});
