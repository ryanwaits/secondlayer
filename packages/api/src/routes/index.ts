import { incrementIndexDecodedEventsReturned } from "@secondlayer/platform/db/queries/usage";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import {
	DEFAULT_INDEX_TOKEN_STORE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
import {
	CONTRACT_CALLS_FILTERS,
	type ContractCallsReader,
	getContractCallsResponse,
} from "../index/contract-calls.ts";
import {
	INDEX_EVENT_TYPES,
	type IndexEventsReader,
	getIndexEventsResponse,
} from "../index/events.ts";
import {
	type FtTransfersReader,
	getFtTransfersResponse,
} from "../index/ft-transfers.ts";
import {
	type NftTransfersReader,
	getNftTransfersResponse,
} from "../index/nft-transfers.ts";
import { indexRateLimit } from "../index/rate-limit.ts";
import { type IndexTipProvider, getIndexTip } from "../index/tip.ts";
import { validateQueryParams } from "../middleware/validation.ts";
import {
	DEFAULT_STREAMS_REORGS_READER,
	type StreamsReorgsReader,
} from "../streams/reorgs.ts";

const INDEX_COMMON = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"contract_id",
	"sender",
	"recipient",
] as const;
const FT_ALLOWED = INDEX_COMMON;
const NFT_ALLOWED = [...INDEX_COMMON, "asset_identifier"] as const;
const EVENTS_ALLOWED = [...INDEX_COMMON, "event_type", "asset_identifier"];

export type IndexRouterOptions = {
	tokens?: IndexTokenStore;
	getTip?: IndexTipProvider;
	readEvents?: IndexEventsReader;
	readContractCalls?: ContractCallsReader;
	readFtTransfers?: FtTransfersReader;
	readNftTransfers?: NftTransfersReader;
	readReorgs?: StreamsReorgsReader;
	recordDecodedEventsReturned?: (
		accountId: string,
		quantity: number,
	) => Promise<void>;
};

export function createIndexRouter(opts: IndexRouterOptions = {}) {
	const getTip = opts.getTip ?? getIndexTip;
	const readReorgs = opts.readReorgs ?? DEFAULT_STREAMS_REORGS_READER;
	const recordDecodedEventsReturned =
		opts.recordDecodedEventsReturned ??
		((accountId, quantity) =>
			incrementIndexDecodedEventsReturned(getDb(), accountId, quantity));
	const router = new Hono<IndexEnv>();

	// Discovery — anonymous, lists endpoints + filters.
	router.get("/", (c) =>
		c.json({
			routes: [
				{
					path: "/v1/index/events",
					method: "GET",
					description:
						"Decoded chain events for a chosen event_type, filterable + cursor-paginated. Returns events[], next_cursor, tip, reorgs[].",
					required: ["event_type"],
					event_types: INDEX_EVENT_TYPES,
					filters: EVENTS_ALLOWED,
					notes:
						"asset_identifier applies to nft_transfer only; allowed filters vary by event_type.",
				},
				{
					path: "/v1/index/ft-transfers",
					method: "GET",
					description:
						"Alias for /events?event_type=ft_transfer. Fungible token transfers, decoded + filterable.",
					filters: FT_ALLOWED,
				},
				{
					path: "/v1/index/nft-transfers",
					method: "GET",
					description:
						"Alias for /events?event_type=nft_transfer. NFT transfers, decoded + filterable.",
					filters: NFT_ALLOWED,
				},
				{
					path: "/v1/index/contract-calls",
					method: "GET",
					description:
						"Decoded contract-call transactions (function args + result), filterable + cursor-paginated. Returns contract_calls[], next_cursor, tip, reorgs[]. Cursor: <block_height>:<tx_index>.",
					filters: CONTRACT_CALLS_FILTERS,
				},
			],
			auth: "optional bearer for higher rate-limit tier; anon allowed",
			cursor: {
				format: "<block_height>:<event_index>",
				semantics:
					"opaque resume token; pass back unchanged to continue. Equals last event's cursor (inclusive on output, exclusive on input).",
			},
		}),
	);

	router.use(
		"*",
		indexBearerAuth({ tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE }),
	);
	router.use("*", indexRateLimit());

	router.get("/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getIndexEventsResponse({
			query,
			tip,
			readEvents: opts.readEvents,
			readReorgs,
		});
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/contract-calls", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, CONTRACT_CALLS_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getContractCallsResponse({
			query,
			tip,
			readContractCalls: opts.readContractCalls,
		});
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.contract_calls.length > 0) {
			await recordDecodedEventsReturned(
				accountId,
				response.contract_calls.length,
			);
		}
		return c.json(response);
	});

	router.get("/ft-transfers", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, FT_ALLOWED);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getFtTransfersResponse({
			query,
			tip,
			readTransfers: opts.readFtTransfers,
			readReorgs,
		});
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/nft-transfers", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, NFT_ALLOWED);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getNftTransfersResponse({
			query,
			tip,
			readTransfers: opts.readNftTransfers,
			readReorgs,
		});
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	return router;
}

export default createIndexRouter();
