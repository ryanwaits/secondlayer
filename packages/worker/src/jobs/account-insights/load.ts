import {
	getCredits,
	getMonthlyCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import {
	burnRateUsdMicros,
	monthBounds,
} from "@secondlayer/platform/db/queries/usage-ledger";
import type { Database } from "@secondlayer/shared/db";
import { PAGE_CAP_ROWS } from "@secondlayer/shared/insights";
import { type Kysely, sql } from "kysely";
import type { AccountRuleInput } from "./rules.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Safety cap on one account's 24 hours of request-log rows. */
export const REQUEST_LOG_MAX_ROWS = 50_000;

/** Everything the account rules read, for one account. */
export async function loadAccountInput(
	db: Kysely<Database>,
	accountId: string,
	now: Date = new Date(),
	requestLogLimit: number = REQUEST_LOG_MAX_ROWS,
): Promise<AccountRuleInput> {
	const since24h = new Date(now.getTime() - DAY_MS);
	const since1h = new Date(now.getTime() - HOUR_MS);
	const since7d = new Date(now.getTime() - 7 * DAY_MS);
	const { start, end } = monthBounds(now);

	const requestRows = await db
		.selectFrom("api_request_log")
		.select([
			"api_key_id",
			"path_template",
			"params_hash",
			"cursor_hash",
			"page_size",
			"rows",
			"status",
			"created_at",
		])
		.where("account_id", "=", accountId)
		.where("created_at", ">=", since24h)
		.where((eb) =>
			eb.or([
				eb("path_template", "like", "/v1/index%"),
				eb("path_template", "like", "/v1/streams%"),
			]),
		)
		// Newest first so the limit keeps the recent rows the rules need.
		.orderBy("created_at", "desc")
		.limit(requestLogLimit)
		.execute();
	// The rules read oldest first.
	requestRows.reverse();

	const failedRows = await db
		.selectFrom("api_failed_requests")
		.select(["path", "status", "created_at"])
		.where("account_id", "=", accountId)
		.where("status", ">=", 500)
		.where("created_at", ">=", since1h)
		.execute();

	const stackRows = await db
		.selectFrom("api_failed_requests")
		.select(["method", "path", "status", "created_at"])
		.where("account_id", "=", accountId)
		.where("status", "in", [502, 503, 504])
		// 503 while the stack is created or woken is normal, not an outage.
		.where("message", "not in", ["provisioning", "starting"])
		.where((eb) =>
			eb.or([
				eb("path", "like", "/api/webhooks%"),
				eb("path", "like", "/api/subgraphs%"),
			]),
		)
		.where("created_at", ">=", since1h)
		.orderBy("created_at", "asc")
		.execute();

	const revokedRows = await db
		.selectFrom("api_failed_requests as f")
		.innerJoin("api_keys as k", "k.id", "f.api_key_id")
		.select([
			"k.id as key_id",
			"f.path",
			"f.created_at",
			"k.name",
			"k.key_prefix",
			"k.revoked_at",
		])
		.where("f.account_id", "=", accountId)
		.where("f.code", "=", "KEY_REVOKED")
		.where("f.created_at", ">=", since24h)
		.execute();

	const paid = await db
		.selectFrom("usage_ledger")
		.select((eb) => [
			eb.fn.min<Date>("occurred_at").as("first_paid_at"),
			eb.fn.sum<string>("quantity").as("rows"),
			eb.fn.sum<string>("usd_micros").as("usd_micros"),
		])
		.where("account_id", "=", accountId)
		.where("unit", "=", "rows.delivered")
		.where("occurred_at", ">=", start)
		.where("occurred_at", "<", end)
		.where("usd_micros", ">", "0")
		.executeTakeFirst();

	const days = await sql<{
		day: string;
		rows: string;
		pages: string;
		full_pages: string;
		usd_micros: string;
	}>`
		SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
			sum(quantity) AS rows,
			count(*) AS pages,
			count(*) FILTER (WHERE quantity >= ${PAGE_CAP_ROWS}) AS full_pages,
			sum(usd_micros) AS usd_micros
		FROM usage_ledger
		WHERE account_id = ${accountId}
			AND unit = 'rows.delivered'
			AND occurred_at >= ${start}
			AND occurred_at < ${end}
		GROUP BY 1
		ORDER BY 1
	`.execute(db);

	const charges7d = await db
		.selectFrom("usage_ledger")
		.select((eb) => eb.fn.sum<string>("usd_micros").as("total"))
		.where("account_id", "=", accountId)
		.where("occurred_at", ">=", since7d)
		.where("occurred_at", "<=", now)
		.where("usd_micros", ">", "0")
		.executeTakeFirst();

	const keyRows = await db
		.selectFrom("api_keys")
		.select(["id", "name", "key_prefix", "created_at", "last_used_at"])
		.where("account_id", "=", accountId)
		.where("product", "=", "account")
		.where("status", "=", "active")
		.execute();

	const [caps, spentMonth, balance, burn] = await Promise.all([
		getCaps(db, accountId),
		getMonthlyCreditsSpend(db, accountId, now),
		getCredits(db, accountId),
		burnRateUsdMicros(db, accountId, now),
	]);

	const rowsByDay = days.rows.map((d) => ({
		day: d.day,
		rows: Number(d.rows),
		pages: Number(d.pages),
		fullPages: Number(d.full_pages),
		usdMicros: BigInt(d.usd_micros ?? "0"),
	}));

	const revokedByKey = new Map<
		string,
		{
			keyId: string;
			name: string;
			prefix: string;
			revokedAt: Date | null;
			calls: number;
			lastAt: Date;
			paths: Map<string, number>;
		}
	>();
	for (const r of revokedRows) {
		const entry = revokedByKey.get(r.key_id) ?? {
			keyId: r.key_id,
			name: r.name ?? r.key_prefix,
			prefix: r.key_prefix,
			revokedAt: r.revoked_at,
			calls: 0,
			lastAt: r.created_at,
			paths: new Map<string, number>(),
		};
		entry.calls += 1;
		if (r.created_at > entry.lastAt) entry.lastAt = r.created_at;
		entry.paths.set(r.path, (entry.paths.get(r.path) ?? 0) + 1);
		revokedByKey.set(r.key_id, entry);
	}

	return {
		now,
		requests: requestRows.map((r) => ({
			apiKeyId: r.api_key_id,
			pathTemplate: r.path_template,
			paramsHash: r.params_hash,
			cursorHash: r.cursor_hash,
			pageSize: r.page_size,
			rows: r.rows,
			status: r.status,
			createdAt: r.created_at,
		})),
		failed5xx: failedRows.map((r) => ({
			path: r.path,
			status: r.status,
			createdAt: r.created_at,
		})),
		stackFailures: stackRows.map((r) => ({
			method: r.method,
			path: r.path,
			status: r.status,
			createdAt: r.created_at,
		})),
		allowance: {
			firstPaidAt: paid?.first_paid_at ? new Date(paid.first_paid_at) : null,
			paidRows: paid?.rows ? Number(paid.rows) : 0,
			paidUsdMicros: paid?.usd_micros ? BigInt(paid.usd_micros) : 0n,
		},
		monthRows: rowsByDay.reduce((sum, d) => sum + d.rows, 0),
		rowsByDay,
		cap: {
			monthlyCapCents: caps?.monthly_cap_cents ?? null,
			spentMonthUsdMicros: spentMonth,
			last7dChargesUsdMicros: charges7d?.total ? BigInt(charges7d.total) : 0n,
		},
		balanceUsdMicros: balance,
		burnPerDayUsdMicros: burn,
		keys: keyRows.map((k) => ({
			id: k.id,
			name: k.name ?? k.key_prefix,
			prefix: k.key_prefix,
			createdAt: k.created_at,
			lastUsedAt: k.last_used_at,
		})),
		revokedKeyCalls: [...revokedByKey.values()]
			.map(({ paths, ...k }) => ({
				...k,
				topPaths: [...paths]
					.map(([path, calls]) => ({ path, calls }))
					.sort((a, b) => b.calls - a.calls)
					.slice(0, 3),
			}))
			.sort((a, b) => b.calls - a.calls),
	};
}

/**
 * Accounts worth evaluating now: any with a request-log row, ledger row or
 * failed request in the last 24 hours, plus any with an open insight, so an
 * account that went quiet still gets the passes it needs to clear.
 */
export async function listActiveAccountIds(
	db: Kysely<Database>,
	now: Date = new Date(),
): Promise<string[]> {
	const since = new Date(now.getTime() - DAY_MS);
	const { rows } = await sql<{ account_id: string }>`
		SELECT account_id FROM api_request_log WHERE created_at >= ${since}
		UNION
		SELECT account_id FROM usage_ledger WHERE occurred_at >= ${since}
		UNION
		SELECT account_id FROM api_failed_requests WHERE created_at >= ${since}
		UNION
		SELECT account_id FROM insights
			WHERE account_id IS NOT NULL AND resolved_at IS NULL
	`.execute(db);
	return rows.map((r) => r.account_id);
}
