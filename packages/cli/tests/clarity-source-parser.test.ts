import { describe, expect, it } from "bun:test";
import type { AbiType } from "@secondlayer/stacks/clarity";
import { parseClarityContent } from "../src/parsers/clarity";

describe("parsing a contract's ABI from Clarity source", () => {
	it("reads every argument of a multi-argument function, not just the first", () => {
		const abi = parseClarityContent(`
			(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
			  (ok true))
		`);

		expect(abi.functions[0].args).toEqual([
			{ name: "amount", type: "uint128" },
			{ name: "sender", type: "principal" },
			{ name: "recipient", type: "principal" },
			{ name: "memo", type: { optional: { buff: { length: 34 } } } },
		]);
	});

	it("keeps the declared length of sized types instead of a fixed default", () => {
		const abi = parseClarityContent(`
			(define-read-only (describe (name (string-ascii 40)) (bio (string-utf8 280)) (sig (buff 65)))
			  true)
		`);

		expect(abi.functions[0].args).toEqual([
			{ name: "name", type: { "string-ascii": { length: 40 } } },
			{ name: "bio", type: { "string-utf8": { length: 280 } } },
			{ name: "sig", type: { buff: { length: 65 } } },
		]);
	});

	it("reads nested list, tuple and response argument types", () => {
		const abi = parseClarityContent(`
			(define-public (batch (entries (list 200 { to: principal, amount: uint })) (outcome (response bool uint)))
			  (ok true))
		`);

		expect(abi.functions[0].args).toEqual([
			{
				name: "entries",
				type: {
					list: {
						length: 200,
						type: {
							tuple: [
								{ name: "to", type: "principal" },
								{ name: "amount", type: "uint128" },
							],
						},
					},
				},
			},
			{
				name: "outcome",
				type: { response: { ok: "bool", error: "uint128" } },
			},
		]);
	});

	it("reads the legacy (tuple (name type)) spelling as a tuple", () => {
		const abi = parseClarityContent(
			"(define-read-only (get (k (tuple (id uint) (owner principal)))) true)",
		);

		expect(abi.functions[0].args[0].type).toEqual({
			tuple: [
				{ name: "id", type: "uint128" },
				{ name: "owner", type: "principal" },
			],
		});
	});

	it("treats a trait argument as a trait reference", () => {
		const abi = parseClarityContent(
			"(define-public (deposit (token <sip-010-trait>)) (ok true))",
		);

		expect(abi.functions[0].args[0].type).toBe("trait_reference");
	});

	it("marks return types unknown rather than guessing, since source does not declare them", () => {
		const abi = parseClarityContent(`
			(define-public (mint (amount uint)) (ok true))
			(define-read-only (get-balance (who principal)) (ft-get-balance token who))
		`);

		// A public function is guaranteed to return a response; the payloads are
		// only knowable to the type checker.
		expect(abi.functions[0].outputs).toEqual({
			response: { ok: "unknown", error: "unknown" },
		} as unknown as AbiType);
		expect(abi.functions[1].outputs).toBe("unknown" as AbiType);
	});

	it("records each function's access level", () => {
		const abi = parseClarityContent(`
			(define-public (a) (ok true))
			(define-read-only (b) true)
			(define-private (c) true)
		`);

		expect(abi.functions.map((f) => [f.name, f.access])).toEqual([
			["a", "public"],
			["b", "read-only"],
			["c", "private"],
		]);
	});

	it("reads map key and value shapes, which source does declare", () => {
		const abi = parseClarityContent(`
			(define-map balances principal uint)
			(define-map orders { id: uint } { owner: principal, filled: bool })
		`);

		expect(abi.maps).toEqual([
			{ name: "balances", key: "principal", value: "uint128" },
			{
				name: "orders",
				key: { tuple: [{ name: "id", type: "uint128" }] },
				value: {
					tuple: [
						{ name: "owner", type: "principal" },
						{ name: "filled", type: "bool" },
					],
				},
			},
		]);
	});

	it("reads data vars and token definitions", () => {
		const abi = parseClarityContent(`
			(define-data-var total-supply uint u0)
			(define-fungible-token my-token u1000000)
			(define-non-fungible-token my-nft uint)
			(impl-trait 'SP123.sip-010-trait.sip-010-trait)
		`);

		expect(abi.variables).toEqual([
			{ name: "total-supply", type: "uint128", access: "variable" },
		]);
		expect(abi.fungible_tokens).toEqual([{ name: "my-token" }]);
		expect(abi.non_fungible_tokens).toEqual([
			{ name: "my-nft", type: "uint128" },
		]);
		expect(abi.implemented_traits).toEqual([
			"SP123.sip-010-trait.sip-010-trait",
		]);
	});

	it("ignores parentheses inside comments and string literals", () => {
		const abi = parseClarityContent(`
			;; (define-public (ghost (a uint)) (ok true))
			(define-read-only (label)
			  "a )( string with (parens)")
		`);

		expect(abi.functions.map((f) => f.name)).toEqual(["label"]);
	});

	it("omits optional ABI sections when the contract defines none", () => {
		const abi = parseClarityContent("(define-read-only (ping) true)");

		expect(abi.maps).toBeUndefined();
		expect(abi.variables).toBeUndefined();
		expect(abi.fungible_tokens).toBeUndefined();
	});

	it("returns no functions for source with no definitions", () => {
		expect(parseClarityContent(";; nothing here\n").functions).toEqual([]);
	});
});
