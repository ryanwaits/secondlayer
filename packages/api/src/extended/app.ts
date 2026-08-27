import { CODE_TO_STATUS } from "@secondlayer/shared/errors";
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
	type GetExtendedBlock,
	type ListExtendedBlocks,
	getExtendedBlock,
	listExtendedBlocks,
} from "./blocks.ts";
import { parseExtendedPageQuery } from "./paginate.ts";
import { type ExtendedStatusDeps, createStatusHandler } from "./status.ts";
import {
	type GetExtendedTransaction,
	type ListExtendedTransactions,
	getExtendedTransaction,
	listExtendedTransactions,
	parseTxHeightFilters,
} from "./transactions.ts";

const EXTENDED_EXPOSE_HEADERS = [
	"X-RateLimit-Limit",
	"X-RateLimit-Remaining",
	"X-RateLimit-Reset",
	"Retry-After",
	"ETag",
];

export type CreateExtendedAppOpts = ExtendedStatusDeps & {
	listBlocks?: ListExtendedBlocks;
	getBlock?: GetExtendedBlock;
	listTransactions?: ListExtendedTransactions;
	getTransaction?: GetExtendedTransaction;
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

	app.get("/extended/v1/tx/:tx_id", async (c) => {
		const tx = await getTx(c.req.param("tx_id"));
		if (!tx) return c.json({ error: "Not found" }, 404);
		return c.json(tx);
	});

	return app;
}
