/**
 * Browser-safe stream scaffold generator.
 *
 * Unlike workflows/subgraphs, streams are structured JSON (filters + options),
 * not TypeScript source. This helper assembles a fully-shaped CreateStream
 * payload from a minimal `{ name, endpointUrl, filters }` intent, filling in
 * sensible defaults for options. The result is validated against
 * `CreateStreamSchema` by tests and at runtime via the Hetzner API — agents
 * that hand-assemble filters tend to miss required `type` discriminators or
 * use wrong key names, and this helper normalises the shape.
 */

import type { CreateStream, StreamOptions } from "@secondlayer/shared/schemas";

export type { CreateStream, StreamOptions };

/** Stream filter shapes mirror `@secondlayer/shared/schemas/filters` at the type level. */
export type StreamFilter =
	| {
			type: "stx_transfer";
			sender?: string;
			recipient?: string;
			minAmount?: number;
			maxAmount?: number;
	  }
	| { type: "stx_mint"; recipient?: string; minAmount?: number }
	| { type: "stx_burn"; sender?: string; minAmount?: number }
	| { type: "stx_lock"; lockedAddress?: string; minAmount?: number }
	| {
			type: "ft_transfer";
			sender?: string;
			recipient?: string;
			assetIdentifier?: string;
			minAmount?: number;
	  }
	| {
			type: "ft_mint";
			recipient?: string;
			assetIdentifier?: string;
			minAmount?: number;
	  }
	| {
			type: "ft_burn";
			sender?: string;
			assetIdentifier?: string;
			minAmount?: number;
	  }
	| {
			type: "nft_transfer";
			sender?: string;
			recipient?: string;
			assetIdentifier?: string;
			tokenId?: string;
	  }
	| {
			type: "nft_mint";
			recipient?: string;
			assetIdentifier?: string;
			tokenId?: string;
	  }
	| {
			type: "nft_burn";
			sender?: string;
			assetIdentifier?: string;
			tokenId?: string;
	  }
	| {
			type: "contract_call";
			contractId?: string;
			functionName?: string;
			caller?: string;
	  }
	| { type: "contract_deploy"; deployer?: string; contractName?: string }
	| {
			type: "print_event";
			contractId?: string;
			topic?: string;
			contains?: string;
	  };

export interface GenerateStreamConfigInput {
	name: string;
	endpointUrl: string;
	filters: StreamFilter[];
	options?: Partial<StreamOptions>;
	startBlock?: number;
	endBlock?: number;
}

const DEFAULT_OPTIONS: StreamOptions = {
	decodeClarityValues: true,
	includeRawTx: false,
	includeBlockMetadata: true,
	rateLimit: 10,
	timeoutMs: 10_000,
	maxRetries: 3,
};

/**
 * Build a fully-shaped `CreateStream` payload from a minimal intent. The
 * returned object is ready to POST to `/api/streams` — the server revalidates
 * with the same zod schema. The only reason we merge options here instead of
 * letting the server apply defaults is so that chat cards can display the
 * concrete values (rate limit, timeout, retries) the stream will run with.
 */
export function generateStreamConfig(
	input: GenerateStreamConfigInput,
): CreateStream {
	if (!input.name || !input.name.trim()) {
		throw new Error("Stream name is required");
	}
	if (!input.endpointUrl || !/^https?:\/\//.test(input.endpointUrl)) {
		throw new Error("endpointUrl must be an http(s) URL");
	}
	if (!input.filters || input.filters.length === 0) {
		throw new Error("At least one filter is required");
	}
	for (const f of input.filters) {
		if (!f || typeof f !== "object" || typeof f.type !== "string") {
			throw new Error("Each filter must have a `type` discriminator");
		}
	}

	const mergedOptions: StreamOptions = {
		...DEFAULT_OPTIONS,
		...(input.options ?? {}),
	};

	const config: CreateStream = {
		name: input.name,
		endpointUrl: input.endpointUrl,
		filters: input.filters,
		options: mergedOptions,
	};

	if (input.startBlock !== undefined) config.startBlock = input.startBlock;
	if (input.endBlock !== undefined) config.endBlock = input.endBlock;

	return config;
}
