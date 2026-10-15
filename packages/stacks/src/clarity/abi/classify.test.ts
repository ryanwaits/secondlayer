import { describe, expect, test } from "bun:test";
import { classifyContract, parseDeclaredStandards } from "./classify.ts";
import type { AbiContract } from "./contract.ts";
import { SIP009_ABI, SIP010_ABI, SIP013_ABI } from "./standards.ts";

describe("classifyContract (shape inference)", () => {
	test("reference ABIs classify as their own standard", () => {
		expect(classifyContract(SIP010_ABI)).toContain("sip-010");
		expect(classifyContract(SIP009_ABI)).toContain("sip-009");
		expect(classifyContract(SIP013_ABI)).toContain("sip-013");
	});

	test("SIP-010 token missing optional get-token-uri still classifies", () => {
		const abi: AbiContract = {
			functions: SIP010_ABI.functions.filter((f) => f.name !== "get-token-uri"),
			fungible_tokens: [{ name: "token" }],
		};
		expect(classifyContract(abi)).toContain("sip-010");
		expect(classifyContract(abi)).not.toContain("sip-009");
	});

	test("token missing a required function does NOT classify", () => {
		const abi: AbiContract = {
			functions: SIP010_ABI.functions.filter((f) => f.name !== "get-balance"),
		};
		expect(classifyContract(abi)).not.toContain("sip-010");
	});

	test("non-token contract classifies as nothing", () => {
		const abi: AbiContract = {
			functions: [
				{ name: "do-thing", access: "public", args: [], outputs: "bool" },
			],
		};
		expect(classifyContract(abi)).toEqual([]);
	});

	test("SIP-009 and SIP-010 are disambiguated (transfer arity differs)", () => {
		// SIP-009 transfer = 3 args, SIP-010 transfer = 4 args; full required sets differ.
		expect(classifyContract(SIP009_ABI)).not.toContain("sip-010");
		expect(classifyContract(SIP010_ABI)).not.toContain("sip-009");
	});
});

describe("classifyContract (ABI straight from a Stacks node)", () => {
	// Node contract-interface spells read-only access `read_only`.
	const toNode = (abi: AbiContract) =>
		({
			...abi,
			functions: abi.functions.map((f) => ({
				...f,
				access: f.access === "read-only" ? "read_only" : f.access,
			})),
		}) as unknown as AbiContract;

	test("a node ABI (access read_only) classifies as sip-010", () => {
		const abi = {
			...toNode(SIP010_ABI),
			fungible_tokens: [{ name: "token" }],
		} as AbiContract;
		expect(classifyContract(abi)).toContain("sip-010");
	});

	test("a node ABI (access read_only) classifies as sip-009", () => {
		const abi = {
			...toNode(SIP009_ABI),
			non_fungible_tokens: [{ name: "nft", type: "uint128" }],
		} as AbiContract;
		expect(classifyContract(abi)).toContain("sip-009");
	});
});

describe("parseDeclaredStandards (Clarity source)", () => {
	test("extracts impl-trait declarations by trait name", () => {
		const src = `
			(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
			(define-fungible-token my-token)
		`;
		expect(parseDeclaredStandards(src)).toEqual(["sip-010"]);
	});

	test("recognizes the nft-trait reference for SIP-009", () => {
		const src = `(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)`;
		expect(parseDeclaredStandards(src)).toEqual(["sip-009"]);
	});

	test("no impl-trait → empty", () => {
		expect(parseDeclaredStandards("(define-public (foo) (ok true))")).toEqual(
			[],
		);
	});
});
