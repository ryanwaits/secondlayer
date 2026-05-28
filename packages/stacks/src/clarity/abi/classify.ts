import type { AbiContract, AbiFunction } from "./contract.ts";
import { SIP009_ABI, SIP010_ABI, SIP013_ABI } from "./standards.ts";

/**
 * Static conformance classification — "does this contract's ABI look like a
 * SIP-009/010/013 token?". Powers trait-based discovery for the (many) contracts
 * that conform to a standard without declaring its trait. Lean match: every
 * REQUIRED standard function must be present with the same access + arg arity
 * (optional functions like get-token-uri are ignored). Loose on exact arg/return
 * types to catch real-world variants; consumers wanting certainty use the
 * `declared` traits parsed from source instead.
 */

export type SipStandard = "sip-009" | "sip-010" | "sip-013";

interface StandardSpec {
	id: SipStandard;
	abi: AbiContract;
	/** Functions in the reference ABI that real tokens may omit. */
	optional: ReadonlySet<string>;
}

const STANDARDS: ReadonlyArray<StandardSpec> = [
	{ id: "sip-010", abi: SIP010_ABI, optional: new Set(["get-token-uri"]) },
	{ id: "sip-009", abi: SIP009_ABI, optional: new Set(["get-token-uri"]) },
	{
		id: "sip-013",
		abi: SIP013_ABI,
		optional: new Set([
			"transfer-memo",
			"transfer-many",
			"transfer-many-memo",
			"get-token-uri",
			"get-overall-balance",
			"get-overall-supply",
		]),
	},
];

function indexByName(abi: AbiContract): Map<string, AbiFunction> {
	const m = new Map<string, AbiFunction>();
	for (const f of abi.functions) m.set(f.name, f);
	return m;
}

function conformsTo(candidate: AbiContract, spec: StandardSpec): boolean {
	const fns = indexByName(candidate);
	for (const required of spec.abi.functions) {
		if (spec.optional.has(required.name)) continue;
		const got = fns.get(required.name);
		if (!got) return false;
		if (got.access !== required.access) return false;
		if (got.args.length !== required.args.length) return false;
	}
	return true;
}

/** Return the SIP standards a contract's ABI statically conforms to. */
export function classifyContract(abi: AbiContract): SipStandard[] {
	if (!abi || !Array.isArray(abi.functions)) return [];
	return STANDARDS.filter((s) => conformsTo(abi, s)).map((s) => s.id);
}

/**
 * Parse the standards a contract *declares* via `(impl-trait …)` in its Clarity
 * source. Matched heuristically on the trait-reference name (robust across
 * mainnet/testnet principals + community variants) rather than an exact principal
 * allowlist. The ABI/RPC doesn't carry trait info, so source is the only declared
 * signal. `declared` is the high-confidence signal; `classifyContract` is the
 * catch-all for conforming-but-undeclared contracts.
 */
export function parseDeclaredStandards(claritySource: string): SipStandard[] {
	const out = new Set<SipStandard>();
	const matches = claritySource.matchAll(/\(impl-trait\s+[^)]+\)/gi);
	for (const m of matches) {
		const ref = m[0].toLowerCase();
		if (ref.includes("sip-010") || ref.includes(".ft-trait"))
			out.add("sip-010");
		if (ref.includes("sip-009") || ref.includes("nft-trait"))
			out.add("sip-009");
		if (ref.includes("sip-013") || ref.includes("semi-fungible"))
			out.add("sip-013");
	}
	return [...out];
}
