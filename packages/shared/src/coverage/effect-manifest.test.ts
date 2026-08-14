import { describe, expect, test } from "bun:test";
import {
	type EffectMutation,
	hashEffectManifest,
	manifestsEqual,
} from "./effect-manifest.ts";

const insert: EffectMutation = {
	op: "insert",
	table: "xfers",
	key: { id: "a" },
	value: { amt: "1", to: "sp" },
};

describe("effect manifests", () => {
	test("retry of the same mutations is stable", () => {
		expect(hashEffectManifest([insert])).toBe(hashEffectManifest([insert]));
	});

	test("key/value property order does not fork the digest", () => {
		const a: EffectMutation = {
			op: "insert",
			table: "t",
			key: { b: 1, a: 2 },
			value: { z: 1, y: 2 },
		};
		const b: EffectMutation = {
			op: "insert",
			table: "t",
			key: { a: 2, b: 1 },
			value: { y: 2, z: 1 },
		};
		expect(manifestsEqual([a], [b])).toBe(true);
	});

	test("a historical defect differs", () => {
		const defect: EffectMutation = {
			...insert,
			value: { amt: "2", to: "sp" },
		};
		expect(manifestsEqual([insert], [defect])).toBe(false);
	});
});
