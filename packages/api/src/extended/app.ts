import { isBnsDecoderEnabled } from "@secondlayer/shared";
import { CODE_TO_STATUS, ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
	allowsAnonymousRead,
	bearerToken,
	invalidCredentialError,
	missingCredentialError,
} from "../auth/read-plane.ts";
import { instanceTokenMatches } from "../instance-bind.ts";
import {
	type GetExtendedStx,
	type ListExtendedFt,
	type ListExtendedNft,
	getExtendedStx,
	listExtendedFt,
	listExtendedNft,
} from "./address.ts";
import {
	type GetExtendedBlock,
	type ListExtendedBlocks,
	getExtendedBlock,
	listExtendedBlocks,
} from "./blocks.ts";
import {
	type GetExtendedBnsName,
	type ListExtendedBnsNames,
	getExtendedBnsName,
	listExtendedBnsNames,
} from "./bns.ts";
import { type ListExtendedTxEvents, listExtendedTxEvents } from "./events.ts";
import { parseExtendedPageQuery } from "./paginate.ts";
import { type ExtendedStatusDeps, createStatusHandler } from "./status.ts";
import {
	type GetExtendedTransaction,
	type ListExtendedTransactions,
	getExtendedTransaction,
	listExtendedTransactions,
	parseTxHeightFilters,
} from "./transactions.ts";
import {
	type ListExtendedNftTransfers,
	listExtendedNftTransfers,
} from "./transfers.ts";

const EXTENDED_EXPOSE_HEADERS = [
	"X-RateLimit-Limit",
	"X-RateLimit-Remaining",
	"X-RateLimit-Reset",
	"Retry-After",
	"ETag",
];

/** Event / nft-transfer list hard cap (Hiro event pages are small). */
const EXTENDED_EVENT_MAX_LIMIT = 50;

export type CreateExtendedAppOpts = ExtendedStatusDeps & {
	listBlocks?: ListExtendedBlocks;
	getBlock?: GetExtendedBlock;
	listTransactions?: ListExtendedTransactions;
	getTransaction?: GetExtendedTransaction;
	listTxEvents?: ListExtendedTxEvents;
	listNftTransfers?: ListExtendedNftTransfers;
	getStx?: GetExtendedStx;
	listFt?: ListExtendedFt;
	listNft?: ListExtendedNft;
	getBnsName?: GetExtendedBnsName;
	listBnsNames?: ListExtendedBnsNames;
	/** When omitted, `isBnsDecoderEnabled()` is read at request time. */
	bnsEnabled?: boolean;
};

/**
 * Separate Hono for the optional `/extended` view (port :3999).
 * Hiro-shaped errors: `{ error: string }` only — no `code`, `path`, or cursor.
 * Never mount this on createApiApp / :3800.
 */
export function createExtendedApp(opts: CreateExtendedAppOpts = {}): Hono {
	const app = new Hono();

	const publicCors = cors({
		origin: "*",
		credentials: false,
		allowMethods: ["GET", "OPTIONS"],
		allowHeaders: ["Authorization", "Content-Type"],
		exposeHeaders: EXTENDED_EXPOSE_HEADERS,
		maxAge: 86400,
	});

	app.use("/extended/*", publicCors);
	app.use("/extended", publicCors);

	// Loopback: open. Non-loopback: INSTANCE_TOKEN required.
	// Do not reuse v1InstanceGate — it skips Index/Streams/subgraphs prefixes.
	app.use("/extended/*", async (c, next) => {
		if (allowsAnonymousRead()) {
			await next();
			return;
		}
		const raw = bearerToken(c);
		if (raw !== null && instanceTokenMatches(raw)) {
			await next();
			return;
		}
		throw raw === null ? missingCredentialError() : invalidCredentialError();
	});

	app.onError((err, c) => {
		const message = err instanceof Error ? err.message : "Error";
		if ("code" in err && typeof (err as { code: unknown }).code === "string") {
			const code = (err as { code: string }).code;
			const status = (
				CODE_TO_STATUS as Record<
					string,
					400 | 401 | 402 | 403 | 404 | 409 | 415 | 422 | 423 | 429 | 503
				>
			)[code];
			if (status) {
				return c.json({ error: message }, status);
			}
		}
		return c.json({ error: message }, 500);
	});

	app.notFound((c) => c.json({ error: "Not found" }, 404));

	app.get("/extended/v1/status", createStatusHandler(opts));
	app.get("/extended", (c) => c.json({ status: "/extended/v1/status" }));

	const listBlocks = opts.listBlocks ?? listExtendedBlocks;
	const getBlock = opts.getBlock ?? getExtendedBlock;
	const listTxs = opts.listTransactions ?? listExtendedTransactions;
	const getTx = opts.getTransaction ?? getExtendedTransaction;
	const listTxEvents = opts.listTxEvents ?? listExtendedTxEvents;
	const listNftTransfers = opts.listNftTransfers ?? listExtendedNftTransfers;
	const getStx = opts.getStx ?? getExtendedStx;
	const listFt = opts.listFt ?? listExtendedFt;
	const listNft = opts.listNft ?? listExtendedNft;
	const getBnsName = opts.getBnsName ?? getExtendedBnsName;
	const listBnsNames = opts.listBnsNames ?? listExtendedBnsNames;

	const bnsOn = (): boolean =>
		opts.bnsEnabled !== undefined ? opts.bnsEnabled : isBnsDecoderEnabled();

	app.get("/extended/v1/block", async (c) => {
		const page = parseExtendedPageQuery(c.req.query());
		const { results, total } = await listBlocks(page);
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	app.get("/extended/v1/block/:hash", async (c) => {
		const block = await getBlock(c.req.param("hash"));
		if (!block) return c.json({ error: "Not found" }, 404);
		return c.json(block);
	});

	app.get("/extended/v1/tx", async (c) => {
		const query = c.req.query();
		const page = parseExtendedPageQuery(query);
		const heights = parseTxHeightFilters(query);
		const { results, total } = await listTxs({
			...page,
			...heights,
		});
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	app.get("/extended/v1/tx/:tx_id/events", async (c) => {
		const txId = c.req.param("tx_id");
		const tx = await getTx(txId);
		if (!tx) return c.json({ error: "Not found" }, 404);
		const events = await listTxEvents(txId);
		return c.json(events);
	});

	app.get("/extended/v1/tx/:tx_id", async (c) => {
		const tx = await getTx(c.req.param("tx_id"));
		if (!tx) return c.json({ error: "Not found" }, 404);
		return c.json(tx);
	});

	app.get("/extended/v1/address/:principal/transactions", async (c) => {
		const page = parseExtendedPageQuery(c.req.query());
		const { results, total } = await listTxs({
			...page,
			sender: c.req.param("principal"),
		});
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	app.get("/extended/v1/address/:principal/stx", async (c) => {
		const totals = await getStx(c.req.param("principal"));
		return c.json(totals);
	});

	app.get("/extended/v1/address/:principal/ft", async (c) => {
		const page = parseExtendedPageQuery(c.req.query());
		const { results, total } = await listFt({
			principal: c.req.param("principal"),
			...page,
		});
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	app.get("/extended/v1/address/:principal/nft", async (c) => {
		const page = parseExtendedPageQuery(c.req.query());
		const { results, total } = await listNft({
			principal: c.req.param("principal"),
			...page,
		});
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	// List before :name so ?address= is not captured as a path param.
	app.get("/extended/v1/names", async (c) => {
		if (!bnsOn()) {
			const page = parseExtendedPageQuery(c.req.query());
			return c.json({
				limit: page.limit,
				offset: page.offset,
				total: 0,
				results: [],
			});
		}
		const query = c.req.query();
		const address = query.address;
		if (address === undefined || address === "") {
			throw new ValidationError("address query parameter is required");
		}
		const page = parseExtendedPageQuery(query);
		const { results, total } = await listBnsNames({
			address,
			...page,
		});
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	app.get("/extended/v1/names/:name", async (c) => {
		if (!bnsOn()) {
			return c.json({});
		}
		const name = await getBnsName(c.req.param("name"));
		if (!name) return c.json({ error: "Not found" }, 404);
		return c.json(name);
	});

	app.get("/extended/v1/tokens/nft/transfers", async (c) => {
		const query = c.req.query();
		const page = parseExtendedPageQuery(query, {
			maxLimit: EXTENDED_EVENT_MAX_LIMIT,
		});
		const assetIdentifier = query.asset_identifier;
		const { results, total } = await listNftTransfers({
			...page,
			assetIdentifier:
				assetIdentifier !== undefined && assetIdentifier !== ""
					? assetIdentifier
					: undefined,
		});
		return c.json({
			limit: page.limit,
			offset: page.offset,
			total,
			results,
		});
	});

	return app;
}
