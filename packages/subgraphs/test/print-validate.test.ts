import { describe, expect, test } from "bun:test";
import { validatePrintPayload } from "../src/runtime/print-validate.ts";
import type { PrintField } from "../src/types.ts";

/**
 * The bns-names class of bug, as a test: BNS-V2 emits `name` as a NESTED
 * tuple, a handler read flat `data.name`, and every event decoded to null for
 * an entire deploy — 0 rows chain-wide while the subgraph tailed happily at
 * the tip. A declared `prints` schema now catches that on the first event.
 */

const NESTED_BNS: Record<string, Record<string, PrintField>> = {
	"name-register": {
		name: { tuple: { name: "text", namespace: "text" } },
		owner: "principal",
	},
};

describe("validatePrintPayload", () => {
	test("a nested-tuple declaration accepts the real BNS-V2 shape", () => {
		const verdict = validatePrintPayload(NESTED_BNS, "name-register", {
			name: { name: "0x616c696365", namespace: "0x627463" },
			owner: "SP1",
		});
		expect(verdict.ok).toBe(true);
	});

	test("the flat shape a handler wrongly assumed is rejected, naming the field", () => {
		const verdict = validatePrintPayload(NESTED_BNS, "name-register", {
			name: "0x616c696365",
			owner: "SP1",
		});
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.reason).toContain("name");
	});

	test("a missing required field is rejected; an optional one is not", () => {
		const declared: Record<string, Record<string, PrintField>> = {
			deposit: {
				amount: "uint",
				memo: { type: "text", optional: true },
			},
		};
		expect(validatePrintPayload(declared, "deposit", { amount: 5n }).ok).toBe(
			true,
		);
		expect(
			validatePrintPayload(declared, "deposit", { amount: 5n, memo: "hi" }).ok,
		).toBe(true);
		const missing = validatePrintPayload(declared, "deposit", { memo: "hi" });
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.reason).toContain("amount");
	});

	test("scalar types are checked", () => {
		const declared: Record<string, Record<string, PrintField>> = {
			t: { amount: "uint", flag: "boolean" },
		};
		expect(
			validatePrintPayload(declared, "t", { amount: 1n, flag: true }).ok,
		).toBe(true);
		expect(
			validatePrintPayload(declared, "t", {
				amount: "not-a-number",
				flag: true,
			}).ok,
		).toBe(false);
		expect(
			validatePrintPayload(declared, "t", { amount: 1n, flag: "yes" }).ok,
		).toBe(false);
	});

	test("lists are checked element-wise", () => {
		const declared: Record<string, Record<string, PrintField>> = {
			batch: { ids: { list: "uint" } },
		};
		expect(validatePrintPayload(declared, "batch", { ids: [1n, 2n] }).ok).toBe(
			true,
		);
		expect(validatePrintPayload(declared, "batch", { ids: [1n, "x"] }).ok).toBe(
			false,
		);
		expect(validatePrintPayload(declared, "batch", { ids: 1n }).ok).toBe(false);
	});

	test("undeclared topics and undeclared sources pass through untouched", () => {
		// A source without `prints` made no claim — nothing to enforce.
		expect(validatePrintPayload(undefined, "anything", { a: 1 }).ok).toBe(true);
		// A topic outside the declaration is likewise not a stated contract.
		expect(validatePrintPayload(NESTED_BNS, "name-renew", { z: 1 }).ok).toBe(
			true,
		);
	});

	test("jsonb is the deliberate escape hatch — any shape passes", () => {
		const declared: Record<string, Record<string, PrintField>> = {
			t: { blob: "jsonb" },
		};
		expect(validatePrintPayload(declared, "t", { blob: { any: 1 } }).ok).toBe(
			true,
		);
		expect(validatePrintPayload(declared, "t", { blob: [1, 2] }).ok).toBe(true);
	});
});
