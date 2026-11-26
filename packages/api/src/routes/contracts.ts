import { logger } from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Contract } from "@secondlayer/shared/db";
import {
	type Conformance,
	getContract as defaultGetContract,
	listContractsByTrait as defaultListContractsByTrait,
} from "@secondlayer/shared/db/queries/contracts";
import { RateLimitError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import {
	PayloadType,
	deserializeTransaction,
} from "@secondlayer/stacks/transactions";
import { Hono, type MiddlewareHandler } from "hono";
import { sql } from "kysely";
import { getClientIp, ipBucket } from "../auth/http.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import {
	DEFAULT_INDEX_TOKEN_STORE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
import { clampLimit } from "../parse-query.ts";

const CONFORMANCE = new Set<Conformance>(["declared", "inferred", "any"]);

/** Sliding windows (hosted only). An account key buys the higher limit;
 *  anonymous callers share one window per client IP. Hosted subgraph tenants
 *  call from a shared workload IP with their own key, so they land in their
 *  account window, never the anonymous one. */
export const CONTRACTS_RATE_LIMITS = {
	account: { limit: 20, windowMs: 1_000 },
	anonymous: { limit: 5, windowMs: 1_000 },
} as const;

const MAX_LIMIT = 500;
const MAX_LIMIT_WITH_ABI = 100;

function contractsRateLimit(): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		if (!isPlatformMode()) return next();
		const tenant = c.get("indexTenant");
		if (tenant?.tier === "internal") return next();
		const { limit, windowMs } = tenant
			? CONTRACTS_RATE_LIMITS.account
			: CONTRACTS_RATE_LIMITS.anonymous;
		const key = tenant
			? `contracts:${tenant.tenant_id}`
			: `contracts:anon:${ipBucket(getClientIp(c))}`;
		const result = await getRateLimitStore().check(key, limit, windowMs);
		c.header("X-RateLimit-Limit", String(limit));
		c.header(
			"X-RateLimit-Remaining",
			String(Math.max(0, limit - result.count)),
		);
		c.header("X-RateLimit-Reset", String(result.resetAt));
		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			throw new RateLimitError("Rate limit exceeded");
		}
		return next();
	};
}

/** Injectable seams. Default to the real source-plane db + registry queries;
 *  tests pass fakes here instead of mocking `@secondlayer/shared/db` globally
 *  (Bun leaks module mocks across files — corrupts getDb/sql for later suites). */
export type ContractsRouterOptions = {
	getSourceDb?: typeof getSourceDb;
	listContractsByTrait?: typeof defaultListContractsByTrait;
	getContract?: typeof defaultGetContract;
	getContractSource?: typeof readContractSource;
	tokens?: IndexTokenStore;
};

/** The Clarity source a contract was deployed with, from its canonical deploy
 *  transaction. Null when that transaction is not indexed. */
export async function readContractSource(
	db: ReturnType<typeof getSourceDb>,
	contractId: string,
): Promise<string | null> {
	const row = await db
		.selectFrom("transactions as t")
		.innerJoin("blocks as b", "b.height", "t.block_height")
		.select("t.raw_tx")
		.where("t.contract_id", "=", contractId)
		.where(sql<boolean>`t.type = 'smart_contract'`)
		.where("t.status", "=", "success")
		.where("b.canonical", "=", true)
		.limit(1)
		.executeTakeFirst();
	if (!row) return null;
	try {
		const { payload } = deserializeTransaction(row.raw_tx);
		return payload.payloadType === PayloadType.SmartContract ||
			payload.payloadType === PayloadType.VersionedSmartContract
			? payload.codeBody
			: null;
	} catch (err) {
		logger.warn("contracts.source_undecodable", {
			contractId,
			error: (err as Error).message,
		});
		return null;
	}
}

function parseInclude(raw: string | undefined): Set<string> {
	return new Set((raw ?? "").split(",").map((part) => part.trim()));
}

function toSummary(c: Contract, includeAbi: boolean) {
	return {
		contract_id: c.contract_id,
		deployer: c.deployer,
		block_height: Number(c.block_height),
		declared_traits: c.declared_traits,
		inferred_standards: c.inferred_standards,
		abi_status: c.abi_status,
		classified_at: c.abi_fetched_at
			? new Date(c.abi_fetched_at).toISOString()
			: null,
		...(includeAbi ? { abi: c.abi } : {}),
	};
}

export function createContractsRouter(opts: ContractsRouterOptions = {}) {
	const getDbHandle = opts.getSourceDb ?? getSourceDb;
	const listContractsByTrait =
		opts.listContractsByTrait ?? defaultListContractsByTrait;
	const getContract = opts.getContract ?? defaultGetContract;
	const getContractSource = opts.getContractSource ?? readContractSource;

	const app = new Hono<IndexEnv>();
	app.use(
		"*",
		indexBearerAuth({
			tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE,
			allowAnon: true,
		}),
	);
	app.use("*", contractsRateLimit());

	app.get("/", async (c) => {
		const trait = c.req.query("trait");
		if (!trait) {
			return c.json(
				{
					error: "missing required query param `trait`",
					code: "MISSING_TRAIT",
				},
				400,
			);
		}
		const conformance = (c.req.query("conformance") ?? "any") as Conformance;
		if (!CONFORMANCE.has(conformance)) {
			return c.json(
				{
					error: "conformance must be one of: declared, inferred, any",
					code: "INVALID_CONFORMANCE",
				},
				400,
			);
		}
		const rawClassifiedAfter = c.req.query("classified_after");
		const classifiedAfter = rawClassifiedAfter
			? new Date(rawClassifiedAfter)
			: undefined;
		if (classifiedAfter && Number.isNaN(classifiedAfter.getTime())) {
			return c.json(
				{
					error: "classified_after must be an ISO 8601 timestamp",
					code: "INVALID_CLASSIFIED_AFTER",
				},
				400,
			);
		}
		const includeAbi = parseInclude(c.req.query("include")).has("abi");
		const limit = clampLimit(
			c.req.query("limit"),
			100,
			includeAbi ? MAX_LIMIT_WITH_ABI : MAX_LIMIT,
		);
		const cursor = c.req.query("cursor") || undefined;

		// `contracts` is a SOURCE-plane table (TABLE_TO_DB.contracts === "source"):
		// read from the chain DB, not the control/target DB, or this 500s with the
		// split live (target has no `contracts` table).
		const db = getDbHandle();
		const rows = await listContractsByTrait(db, trait, {
			conformance,
			limit: limit + 1,
			afterId: cursor,
			classifiedAfter,
		});
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;

		return c.json({
			contracts: page.map((row) => toSummary(row, includeAbi)),
			next_cursor: hasMore ? page[page.length - 1]?.contract_id : null,
		});
	});

	app.get("/:contractId", async (c) => {
		const contractId = c.req.param("contractId");
		const include = parseInclude(c.req.query("include"));
		const db = getDbHandle();
		const row = await getContract(db, contractId);
		if (!row) {
			return c.json(
				{
					error: `Contract not found: ${contractId}`,
					code: "CONTRACT_NOT_FOUND",
				},
				404,
			);
		}
		const contract = toSummary(row, include.has("abi"));
		if (!include.has("source")) return c.json({ contract });
		return c.json({
			contract: {
				...contract,
				source: await getContractSource(db, contractId),
			},
		});
	});

	return app;
}

export default createContractsRouter();
