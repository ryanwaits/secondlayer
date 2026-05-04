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

function appendSearchParam(
	params: URLSearchParams,
	name: string,
	value: number | string | null | undefined,
): void {
	if (value === undefined || value === null) return;
	params.set(name, String(value));
}

export class Index extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	readonly ftTransfers: {
		list: (params?: FtTransfersListParams) => Promise<FtTransfersEnvelope>;
	} = {
		list: (params: FtTransfersListParams = {}): Promise<FtTransfersEnvelope> =>
			this.listFtTransfers(params),
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
}
