import { isValidAddress } from "../utils/address.ts";

/** A validated Stacks principal (standard or contract). Branded so downstream
 *  code can require "already validated" without re-checking. */
export type Principal = string & { readonly __principal: unique symbol };

/** `true` for a standard (`SP…`/`ST…`) or contract (`SP….name`) principal. */
export function isPrincipal(value: string): value is Principal {
	const parts = value.split(".");
	if (parts.length > 2) return false;
	const [addr, contractName] = parts;
	if (!addr || !isValidAddress(addr)) return false;
	if (parts.length === 2 && !contractName) return false;
	return true;
}

/** Subscriptions match `*` wildcards in principal/identifier patterns; every
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
