import { Hono } from "hono";
import {
	DEFAULT_INDEX_TOKENS,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
import {
	type FtTransfersReader,
	getFtTransfersResponse,
} from "../index/ft-transfers.ts";
import { indexRateLimit } from "../index/rate-limit.ts";
import { type IndexTipProvider, getIndexTip } from "../index/tip.ts";

export type IndexRouterOptions = {
	tokens?: IndexTokenStore;
	getTip?: IndexTipProvider;
	readFtTransfers?: FtTransfersReader;
};

export function createIndexRouter(opts: IndexRouterOptions = {}) {
	const getTip = opts.getTip ?? getIndexTip;
	const router = new Hono<IndexEnv>();

	router.use(
		"*",
		indexBearerAuth({ tokens: opts.tokens ?? DEFAULT_INDEX_TOKENS }),
	);
	router.use("*", indexRateLimit());

	router.get("/ft-transfers", async (c) => {
		const tip = await getTip();
		c.set("indexTip", tip);
		return c.json(
			await getFtTransfersResponse({
				query: new URL(c.req.url).searchParams,
				tip,
				readTransfers: opts.readFtTransfers,
			}),
		);
	});

	return router;
}

export default createIndexRouter();
