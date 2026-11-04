import { tableCode } from "@/components/account/subgraphs/describe-table";
// Server-only: never import from client code (pulls in undici).
import {
	type RecentRow,
	type RecentRowsData,
	recentRowsData,
} from "@/components/account/subgraphs/recent-rows-model";
import { listensForCode } from "@/components/account/webhooks/describe-trigger";
import {
	FIRST_DELIVERIES,
	VISIBLE_GROUPS,
	groupAttempts,
} from "@/components/account/webhooks/view";
import type { AccountSeed, Billing, Caps } from "@/lib/account-data";
import { PLATFORM_API_URL } from "@/lib/api";
import type { RenderedBlock } from "@/lib/code/blocks";
import {
	type WebhooksResult,
	resultFromResponse,
} from "@/lib/dashboard-results";
import type { RowsResponse } from "@/lib/rows";
import { HEALTH_WEEK_HOURS } from "@/lib/subgraph-view";
import type {
	SubgraphDetailData,
	SubgraphErrorGroup,
	SubgraphHealthData,
	SubgraphListItem,
	SubgraphSource,
} from "@/lib/subgraphs-store";
import type { ApiKey, ConnectedApp, CreditAdded } from "@/lib/types";
import { upstreamAgent } from "@/lib/upstream-agent";
import {
	type UsageResponse,
	currentUtcMonth,
	monthParam,
	withUsageMonth,
} from "@/lib/usage";
import { normalizeDeliveryRow } from "@/lib/webhooks-data";
import type { WebhooksActivitySummary } from "@/lib/webhooks-data";
import type { DetailFetch } from "@/lib/webhooks-store";
import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";
import type { Agent } from "undici";
import { publicSource } from "./public-source";
import { renderBlocks } from "./render-blocks";
import { getTiming, redactPath } from "./render-timing";

/**
 * What a dashboard page reads on the server, so its HTML arrives with the
 * data in it. These go straight to the platform API with the session cookie
 * as the bearer (the same calls the `/api/*` proxies make for the browser),
 * and map every status to the same `WebhooksResult` kinds the browser side
 * uses, so a starting, asleep or unfunded stack reads the same either way.
 * Reads only: nothing here starts a stack.
 */

/** A path segment from the URL; same rule as the proxies. */
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** One authenticated GET against the platform API. Never throws. */
export function readApi<T>(
	token: string,
	path: string,
): Promise<WebhooksResult<T>> {
	return getTiming().step("readApi", () => fetchApi<T>(token, path), {
		path: redactPath(path),
	});
}

async function fetchApi<T>(
	token: string,
	path: string,
): Promise<WebhooksResult<T>> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}${path}`, {
			headers: { Authorization: `Bearer ${token}` },
			cache: "no-store",
			// Why: reuse warm connections to the API; undici's default drops idle ones after 4 s.
			dispatcher: upstreamAgent,
		} as RequestInit & { dispatcher: Agent });
		let body: unknown = null;
		try {
			body = await res.json();
		} catch {
			// An empty error body falls through to the status-only message.
		}
		return resultFromResponse<T>(res, body);
	} catch {
		return { kind: "error", message: "Couldn't reach the API" };
	}
}

const NOT_FOUND: WebhooksResult<never> = { kind: "not_found" };

/** `{ data: T[] }` list responses as their rows. */
function rowsOf<T>(res: WebhooksResult<{ data: T[] }>): WebhooksResult<T[]> {
	return res.kind === "ok" ? { kind: "ok", data: res.data.data } : res;
}

/** A 404 on a list or summary means the account has no stack or none of the
 *  resource yet, so it reads as empty, never as `not_found`. */
function emptyOnNotFound<T>(
	res: WebhooksResult<T>,
	empty: T,
): WebhooksResult<T> {
	return res.kind === "not_found" ? { kind: "ok", data: empty } : res;
}

// ── Account ──────────────────────────────────────────────────────────────

/** The account reads a page can ask for, one per store slice. */
export type AccountRead =
	| "billing"
	| "caps"
	| "alerts"
	| "credits"
	| "keys"
	| "apps"
	| "usage"
	| "rows";

/** Reads the asked-for slices at once and returns the ones that came back ok,
 *  in store shape. A slice that failed is left out, and the browser loads it
 *  when the page mounts. */
export async function accountReads(
	token: string,
	wanted: readonly AccountRead[],
): Promise<AccountSeed> {
	const month = monthParam(currentUtcMonth());
	const seed: AccountSeed = {};
	const readers: Record<AccountRead, () => Promise<void>> = {
		billing: async () => {
			const res = await readApi<{
				creditsUsdMicros: string;
				creditsSpentThisMonthUsdMicros: string;
			}>(token, "/api/billing/status");
			if (res.kind === "ok") {
				seed.billing = {
					creditsUsdMicros: res.data.creditsUsdMicros,
					spentThisMonthUsdMicros: res.data.creditsSpentThisMonthUsdMicros,
				} satisfies Billing;
			}
		},
		caps: async () => {
			const res = await readApi<Caps>(token, "/api/billing/caps");
			if (res.kind === "ok") seed.caps = res.data;
		},
		alerts: async () => {
			const res = await readApi<NonNullable<AccountSeed["alerts"]>>(
				token,
				"/api/billing/alerts",
			);
			if (res.kind === "ok") seed.alerts = res.data;
		},
		credits: async () => {
			const res = await readApi<{ credits: CreditAdded[] }>(
				token,
				"/api/billing/credits",
			);
			if (res.kind === "ok") seed.credits = res.data.credits;
		},
		keys: async () => {
			const res = await readApi<{ keys: ApiKey[] }>(token, "/api/keys");
			if (res.kind === "ok") seed.keys = res.data.keys ?? [];
		},
		apps: async () => {
			const res = await readApi<{ grants: ConnectedApp[] }>(
				token,
				"/api/oauth/grants",
			);
			if (res.kind === "ok") seed.apps = res.data.grants;
		},
		usage: async () => {
			const res = await readApi<UsageResponse>(
				token,
				`/api/billing/usage?month=${month}`,
			);
			if (res.kind !== "ok") return;
			seed.usage = withUsageMonth({}, month, res.data.usage);
			seed.daily = { [month]: res.data.daily };
			seed.burn = res.data.burn;
			seed.service = res.data.service;
		},
		rows: async () => {
			const res = await readApi<RowsResponse>(token, "/api/billing/rows");
			if (res.kind === "ok") seed.rows = res.data;
		},
	};
	await getTiming().step("wave:accountReads", () =>
		Promise.all(wanted.map((name) => readers[name]())),
	);
	return seed;
}

// ── Webhooks ─────────────────────────────────────────────────────────────

export interface WebhooksListInitial {
	list: WebhooksResult<WebhookSummary[]>;
	summary: WebhooksResult<WebhooksActivitySummary>;
}

export async function webhooksListReads(
	token: string,
): Promise<WebhooksListInitial> {
	const [list, summary] = await getTiming().step("wave:webhooksList", () =>
		Promise.all([
			readApi<{ data: WebhookSummary[] }>(token, "/api/webhooks"),
			readApi<WebhooksActivitySummary>(token, "/api/webhooks/activity"),
		]),
	);
	return {
		list: emptyOnNotFound(rowsOf(list), []),
		summary: emptyOnNotFound(summary, { hours: [], webhooks: [] }),
	};
}

export interface WebhookDetailInitial extends DetailFetch {
	/** The "Listens for" code frames, rendered for this webhook's version. */
	listens: RenderedBlock[] | null;
}

export async function webhookDetailReads(
	token: string,
	id: string,
): Promise<WebhookDetailInitial> {
	if (!SEGMENT_RE.test(id)) {
		return {
			webhook: NOT_FOUND,
			deliveries: NOT_FOUND,
			activity: NOT_FOUND,
			listens: null,
		};
	}
	const base = `/api/webhooks/${id}`;
	const [webhook, deliveries, activity] = await getTiming().step(
		"wave:webhookDetail",
		() =>
			Promise.all([
				readApi<WebhookDetail>(token, base),
				readApi<{ data: DeliveryRow[] }>(
					token,
					`${base}/deliveries?_limit=${FIRST_DELIVERIES}`,
				),
				readApi<WebhookActivity>(token, `${base}/activity`),
			]),
	);
	let rows = rowsOf(deliveries);
	let first = rows.kind === "ok" ? rows.data.map(normalizeDeliveryRow) : null;
	// Retries of a few events can fill the first page with fewer groups than
	// the panel shows; read the full list then, as the page always did.
	if (
		first &&
		first.length >= FIRST_DELIVERIES &&
		groupAttempts(first).length < VISIBLE_GROUPS
	) {
		rows = rowsOf(
			await readApi<{ data: DeliveryRow[] }>(token, `${base}/deliveries`),
		);
		first = rows.kind === "ok" ? rows.data.map(normalizeDeliveryRow) : null;
	}
	let listens: RenderedBlock[] | null = null;
	if (webhook.kind === "ok") {
		try {
			const activityData = activity.kind === "ok" ? activity.data : null;
			listens = await renderBlocks(
				listensForCode(webhook.data, activityData).blocks,
			);
		} catch {
			// The page falls back to plain code and `/api/code`.
		}
	}
	return {
		webhook,
		deliveries: first ? { kind: "ok", data: first } : rows,
		activity,
		listens,
	};
}

// ── Subgraphs ────────────────────────────────────────────────────────────

export type SubgraphsListInitial = WebhooksResult<SubgraphListItem[]>;

/** The list with every subgraph's week of hourly health, as the browser asks. */
export async function subgraphsListReads(
	token: string,
): Promise<SubgraphsListInitial> {
	const res = await readApi<{ data: SubgraphListItem[] }>(
		token,
		`/api/subgraphs?health=${HEALTH_WEEK_HOURS}`,
	);
	return emptyOnNotFound(rowsOf(res), []);
}

export interface SubgraphDetailInitial {
	detail: WebhooksResult<SubgraphDetailData>;
	health: WebhooksResult<SubgraphHealthData>;
	errors: WebhooksResult<SubgraphErrorGroup[]>;
	source: WebhooksResult<SubgraphSource>;
	/** The newest rows of the biggest tables; null when the detail didn't load. */
	rows: RecentRowsData | null;
	/** The "Tables" code frames, rendered for this subgraph's version. */
	tableBlocks: RenderedBlock[] | null;
}

export async function subgraphDetailReads(
	token: string,
	name: string,
): Promise<SubgraphDetailInitial> {
	if (!SEGMENT_RE.test(name)) {
		return {
			detail: NOT_FOUND,
			health: NOT_FOUND,
			errors: NOT_FOUND,
			source: NOT_FOUND,
			rows: null,
			tableBlocks: null,
		};
	}
	const base = `/api/subgraphs/${name}`;
	const [detail, health, errors, source, recent] = await getTiming().step(
		"wave:subgraphDetail1",
		() =>
			Promise.all([
				readApi<SubgraphDetailData>(token, base),
				readApi<SubgraphHealthData>(
					token,
					`${base}/health?hours=${HEALTH_WEEK_HOURS}`,
				),
				readApi<{ data: SubgraphErrorGroup[] }>(
					token,
					`${base}/errors?limit=20`,
				),
				readApi<SubgraphSource>(token, `${base}/source`),
				readApi<{ data: RecentRow[] }>(token, `${base}/recent`),
			]),
	);
	const publicSourceResult: WebhooksResult<SubgraphSource> =
		source.kind === "ok"
			? { kind: "ok", data: publicSource(source.data) as SubgraphSource }
			: source;

	let rows: RecentRowsData | null = null;
	let tableBlocks: RenderedBlock[] | null = null;
	if (detail.kind === "ok") {
		rows = recentRowsData(recent.kind === "ok" ? recent.data.data : null);
		const sourceCode =
			publicSourceResult.kind === "ok"
				? publicSourceResult.data.sourceCode
				: null;
		tableBlocks = await getTiming().step("wave:subgraphDetail2", () =>
			publicSourceResult.kind === "ok"
				? renderBlocks(
						tableCode({
							name,
							tables: detail.data.tables,
							sources: detail.data.sources,
							sourceCode,
						}).blocks,
					).catch(() => null)
				: Promise.resolve(null),
		);
	}
	return {
		detail,
		health,
		errors: rowsOf(errors),
		source: publicSourceResult,
		rows,
		tableBlocks,
	};
}
