/**
 * Internal helpers shared across plugins (not part of the public plugin API)
 */

export interface ContractFilterOptions {
	/** Include only these contract names (exact match) */
	include?: string[];

	/** Exclude these contract names (exact match) */
	exclude?: string[];
}

/**
 * Exact-match include/exclude filter used by the clarinet, actions, and
 * testing plugins to scope which contracts they process.
 */
export function matchesContractFilters(
	name: string,
	options: ContractFilterOptions,
): boolean {
	if (options.include && !options.include.includes(name)) {
		return false;
	}
	if (options.exclude?.includes(name)) {
		return false;
	}
	return true;
}
