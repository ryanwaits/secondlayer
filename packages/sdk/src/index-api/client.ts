import { BaseClient } from "../base.ts";
import type { SecondLayerOptions } from "../base.ts";

export type IndexTip = {
	block_height: number;
	lag_seconds: number;
};

export type FtTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};

export type FtTransfersEnvelope = {
	events: FtTransfer[];
	next_cursor: string | null;
	tip: IndexTip;
	// Reserved envelope field. v1 currently always emits [].
	reorgs: never[];
};

export type FtTransfersListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	contractId?: string;
	sender?: string;
	recipient?: string;
	fromHeight?: number;
	toHeight?: number;
};

export type FtTransfersWalkParams = Omit<FtTransfersListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

export type NftTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "nft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: string;
};

export type NftTransfersEnvelope = {
	events: NftTransfer[];
	next_cursor: string | null;
	tip: IndexTip;
	// Reserved envelope field. v1 currently always emits [].
	reorgs: never[];
};

export type NftTransfersListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	contractId?: string;
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	fromHeight?: number;
	toHeight?: number;
};

export type NftTransfersWalkParams = Omit<NftTransfersListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

function appendSearchParam(
	params: URLSearchParams,
	name: string,
	value: number | string | null | undefined,
): void {
	if (value === undefined || value === null) return;
	params.set(name, String(value));
}

function firstWalkFromHeight(params: {
	cursor?: string | null;
	fromCursor?: string | null;
	fromHeight?: number;
}): number | undefined {
	if (params.fromHeight !== undefined) return params.fromHeight;
	if (params.cursor || params.fromCursor) return undefined;
	return 0;
}

export class Index extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	readonly ftTransfers: {
		list: (params?: FtTransfersListParams) => Promise<FtTransfersEnvelope>;
		walk: (params?: FtTransfersWalkParams) => AsyncIterable<FtTransfer>;
	} = {
		list: (params: FtTransfersListParams = {}): Promise<FtTransfersEnvelope> =>
			this.listFtTransfers(params),
		walk: (params: FtTransfersWalkParams = {}): AsyncIterable<FtTransfer> =>
			this.walkFtTransfers(params),
	};

	readonly nftTransfers: {
		list: (params?: NftTransfersListParams) => Promise<NftTransfersEnvelope>;
		walk: (params?: NftTransfersWalkParams) => AsyncIterable<NftTransfer>;
	} = {
		list: (
			params: NftTransfersListParams = {},
		): Promise<NftTransfersEnvelope> => this.listNftTransfers(params),
		walk: (params: NftTransfersWalkParams = {}): AsyncIterable<NftTransfer> =>
			this.walkNftTransfers(params),
	};

	private async listFtTransfers(
		params: FtTransfersListParams = {},
	): Promise<FtTransfersEnvelope> {
		const searchParams = new URLSearchParams();
		appendSearchParam(searchParams, "cursor", params.cursor);
		appendSearchParam(searchParams, "from_cursor", params.fromCursor);
		appendSearchParam(searchParams, "limit", params.limit);
		appendSearchParam(searchParams, "contract_id", params.contractId);
		appendSearchParam(searchParams, "sender", params.sender);
		appendSearchParam(searchParams, "recipient", params.recipient);
		appendSearchParam(searchParams, "from_height", params.fromHeight);
		appendSearchParam(searchParams, "to_height", params.toHeight);

		const query = searchParams.toString();
		return this.request<FtTransfersEnvelope>(
			"GET",
			`/v1/index/ft-transfers${query ? `?${query}` : ""}`,
		);
	}

	private async listNftTransfers(
		params: NftTransfersListParams = {},
	): Promise<NftTransfersEnvelope> {
		const searchParams = new URLSearchParams();
		appendSearchParam(searchParams, "cursor", params.cursor);
		appendSearchParam(searchParams, "from_cursor", params.fromCursor);
		appendSearchParam(searchParams, "limit", params.limit);
		appendSearchParam(searchParams, "contract_id", params.contractId);
		appendSearchParam(searchParams, "asset_identifier", params.assetIdentifier);
		appendSearchParam(searchParams, "sender", params.sender);
		appendSearchParam(searchParams, "recipient", params.recipient);
		appendSearchParam(searchParams, "from_height", params.fromHeight);
		appendSearchParam(searchParams, "to_height", params.toHeight);

		const query = searchParams.toString();
		return this.request<NftTransfersEnvelope>(
			"GET",
			`/v1/index/nft-transfers${query ? `?${query}` : ""}`,
		);
	}

	private async *walkFtTransfers(
		params: FtTransfersWalkParams = {},
	): AsyncGenerator<FtTransfer> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listFtTransfers({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const event of envelope.events) {
				if (params.signal?.aborted) return;
				yield event;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.events.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async *walkNftTransfers(
		params: NftTransfersWalkParams = {},
	): AsyncGenerator<NftTransfer> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listNftTransfers({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const event of envelope.events) {
				if (params.signal?.aborted) return;
				yield event;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.events.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}
}
