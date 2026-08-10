import { parsePrincipal } from "../utils/address.ts";

/** A validated Stacks principal (standard or contract). Branded so downstream
 *  code can require "already validated" without re-checking. */
export type Principal = string & { readonly __principal: unique symbol };

/**
 * `<contract>::<asset-name>` — the shape a fungible/non-fungible asset filter
 * takes, expressed so the compiler can check it.
 *
 * The most common mistake in this API is passing a CONTRACT ID
 * (`SP….sbtc-token`) where an asset identifier (`SP….sbtc-token::sbtc-token`)
 * belongs, and the failure mode is a query that quietly returns zero rows. The
 * two differ structurally by `::`, so a template-literal type catches it at the
 * call site — no brand, no cast, literals just work.
 *
 * A value that is only known at runtime (config, env) is not narrow enough on
 * purpose; run it through {@link assetId} once, which validates and narrows.
 *
 * Wildcard patterns (Subscriptions/Subgraphs-only) are admitted by the second arm — they
 * are legitimately not full identifiers (`SPB.*`), and the runtime validator
 * short-circuits on them for the same reason.
 */
export type AssetIdentifier = `${string}::${string}` | `${string}*${string}`;

/**
 * Narrow a runtime string to an {@link AssetIdentifier}, validating it.
 *
 * The escape hatch for config-driven values: `assetId(process.env.ASSET!)`
 * throws on a contract id instead of letting it through to a zero-row query.
 */
export function assetId(value: string): AssetIdentifier {
	assertAssetIdentifier("assetIdentifier", value);
	return value as AssetIdentifier;
}

/** `true` for a standard (`SP…`/`ST…`) or contract (`SP….name`) principal.
 *  Shares {@link parsePrincipal} with the ABI guards so the two surfaces can't
 *  disagree about what a principal is. */
export function isPrincipal(value: string): value is Principal {
	return parsePrincipal(value) !== null;
}

/** Subscriptions and Subgraph sources match `*` wildcards in
 *  principal/identifier patterns; every
 *  other surface treats the value literally. */
export function hasWildcard(value: string): boolean {
	return value.includes("*");
}

/** Throw unless `value` is a principal or a wildcard pattern. The factories
 *  call this so a swapped argument (asset id where a sender belongs, typo'd
 *  address) fails at construction — not as a silent zero-row query. */
export function assertPrincipalish(field: string, value: string): void {
	if (hasWildcard(value)) return;
	if (!isPrincipal(value)) {
		throw new Error(
			`${field} "${value}" is not a valid Stacks principal (SP…/ST…, optionally .contract-name).`,
		);
	}
}

/** Throw unless `value` looks like `SP….contract::asset` (or a wildcard). */
export function assertAssetIdentifier(field: string, value: string): void {
	if (hasWildcard(value)) return;
	const [contractId, assetName, ...rest] = value.split("::");
	if (
		!contractId ||
		!assetName ||
		rest.length > 0 ||
		!contractId.includes(".") ||
		!isPrincipal(contractId)
	) {
		throw new Error(
			`${field} "${value}" is not a valid asset identifier (SP….contract-name::asset-name). Passing a bare contract id here matches zero rows — use contractId for that.`,
		);
	}
}

/** Throw unless `value` is a contract id `SP….name` (or a wildcard). */
export function assertContractId(field: string, value: string): void {
	if (hasWildcard(value)) return;
	if (value.includes("::")) {
		throw new Error(
			`${field} "${value}" is an asset identifier, not a contract id — use assetIdentifier for that.`,
		);
	}
	if (!value.includes(".") || !isPrincipal(value)) {
		throw new Error(
			`${field} "${value}" is not a valid contract id (SP….contract-name).`,
		);
	}
}
