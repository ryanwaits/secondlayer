import { getDb } from "@secondlayer/shared/db";
import { incrementIndexDecodedEventsReturned } from "@secondlayer/shared/db/queries/usage";
import { Hono } from "hono";
import {
	DEFAULT_INDEX_TOKEN_STORE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
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

export type IndexRouterOptions = {
	tokens?: IndexTokenStore;
	getTip?: IndexTipProvider;
	readFtTransfers?: FtTransfersReader;
	readNftTransfers?: NftTransfersReader;
	recordDecodedEventsReturned?: (
		accountId: string,
		quantity: number,
	) => Promise<void>;
};

export function createIndexRouter(opts: IndexRouterOptions = {}) {
	const getTip = opts.getTip ?? getIndexTip;
	const recordDecodedEventsReturned =
		opts.recordDecodedEventsReturned ??
		((accountId, quantity) =>
			incrementIndexDecodedEventsReturned(getDb(), accountId, quantity));
	const router = new Hono<IndexEnv>();

	router.use(
		"*",
		indexBearerAuth({ tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE }),
	);
	router.use("*", indexRateLimit());

	router.get("/ft-transfers", async (c) => {
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getFtTransfersResponse({
			query: new URL(c.req.url).searchParams,
			tip,
			readTransfers: opts.readFtTransfers,
		});
		const accountId = c.get("indexTenant").account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/nft-transfers", async (c) => {
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getNftTransfersResponse({
			query: new URL(c.req.url).searchParams,
			tip,
			readTransfers: opts.readNftTransfers,
		});
		const accountId = c.get("indexTenant").account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	return router;
}

export default createIndexRouter();
