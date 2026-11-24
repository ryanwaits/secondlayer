import { BaseClient, type SecondLayerOptions, buildQuery } from "../base.ts";

/**
 * Typed client for the contract-discovery API (`GET /v1/contracts`).
 *
 * "Find all contracts conforming to a trait" — backed by the contract registry:
 * `declared` traits parsed from Clarity source, `inferred` standards from static
 * ABI shape-matching. Keyless on a loopback self-host; hosted needs your
 * account key. `trait` is required; the ABI blob is omitted unless
 * `include: "abi"` is passed.
 */

/** Whether a trait match must be declared in source, inferred from ABI, or either. */
export type ContractConformance = "declared" | "inferred" | "any";

/** Trait, conformance, and paging for listing contracts. */
export interface ContractsListParams {
	/** Required. Trait identifier to match (e.g. "sip-010", or a fully-qualified trait). */
	trait: string;
	/** Match source. Defaults to "any" server-side. */
	conformance?: ContractConformance;
	/** Set to "abi" to include the full ABI blob in each row. */
	include?: "abi";
	/** Page size, 1–500 (default 100 server-side). */
	limit?: number;
	/** Opaque cursor from a prior response's `next_cursor`. */
	cursor?: string;
}

/** A deployed contract with its traits, standards, and ABI status. */
export interface ContractSummary {
	contract_id: string;
	deployer: string;
	block_height: number;
	declared_traits: string[] | null;
	inferred_standards: string[] | null;
	abi_status: string;
	/** When the ABI was read and classified, or `null`. */
	classified_at: string | null;
	/** Present only when `include: "abi"` was requested. */
	abi?: unknown;
	/** The Clarity source from the deploy transaction, present only with
	 *  `includeSource`. `null` when the deploy transaction is not indexed. */
	source?: string | null;
}

/** One page of contracts and the cursor for the next page. */
export interface ContractsEnvelope {
	contracts: ContractSummary[];
	next_cursor: string | null;
}

export class Contracts extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	/** Find contracts conforming to `trait`. `trait` is required (server 400s without it). */
	list(params: ContractsListParams): Promise<ContractsEnvelope> {
		return this.request<ContractsEnvelope>(
			"GET",
			`/v1/contracts${buildQuery({
				trait: params.trait,
				conformance: params.conformance,
				include: params.include,
				limit: params.limit,
				cursor: params.cursor,
			})}`,
		);
	}

	/**
	 * Get one contract from the registry by id, or `null`.
	 *
	 * `includeAbi` adds the full ABI; `includeSource` adds the Clarity source
	 * it was deployed with. Neither needs a Stacks node. Resolves to `null` on
	 * 404.
	 */
	async get(
		contractId: string,
		opts: { includeAbi?: boolean; includeSource?: boolean } = {},
	): Promise<ContractSummary | null> {
		const include = [
			...(opts.includeAbi ? ["abi"] : []),
			...(opts.includeSource ? ["source"] : []),
		];
		const result = await this.requestOrNull<{ contract: ContractSummary }>(
			"GET",
			`/v1/contracts/${encodeURIComponent(contractId)}${buildQuery({ include })}`,
		);
		return result?.contract ?? null;
	}
}
