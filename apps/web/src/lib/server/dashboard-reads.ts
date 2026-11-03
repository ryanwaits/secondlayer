import { tableCode } from "@/components/account/subgraphs/describe-table";
// Server-only: never import from client code (pulls in undici).
import {
	RECENT_ROWS_QUERY,
	type RecentRow,
	type RecentRowsData,
	biggestTables,
	foldRecentRows,
} from "@/components/account/subgraphs/recent-rows-model";
import { listensForCode } from "@/components/account/webhooks/describe-trigger";
import { PLATFORM_API_URL } from "@/lib/api";
import type { RenderedBlock } from "@/lib/code/blocks";
import {
	type WebhooksResult,
	resultFromResponse,
} from "@/lib/dashboard-results";
import { HEALTH_WEEK_HOURS } from "@/lib/subgraph-view";
import type {
	SubgraphDetailData,
	SubgraphErrorGroup,
	SubgraphHealthData,
	SubgraphListItem,
	SubgraphSource,
} from "@/lib/subgraphs-store";
import { upstreamAgent } from "@/lib/upstream-agent";
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
export async function readApi<T>(
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

// ── Webhooks ─────────────────────────────────────────────────────────────

export interface WebhooksListInitial {
	list: WebhooksResult<WebhookSummary[]>;
	summary: WebhooksResult<WebhooksActivitySummary>;
}

export async function webhooksListReads(
	token: string,
): Promise<WebhooksListInitial> {
	const [list, summary] = await Promise.all([
		readApi<{ data: WebhookSummary[] }>(token, "/api/webhooks"),
		readApi<WebhooksActivitySummary>(token, "/api/webhooks/activity"),
	]);
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
	const [webhook, deliveries, activity] = await Promise.all([
		readApi<WebhookDetail>(token, base),
		readApi<{ data: DeliveryRow[] }>(token, `${base}/deliveries`),
		readApi<WebhookActivity>(token, `${base}/activity`),
	]);
	const rows = rowsOf(deliveries);
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
		deliveries:
			rows.kind === "ok"
				? { kind: "ok", data: rows.data.map(normalizeDeliveryRow) }
				: rows,
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
	const [detail, health, errors, source] = await Promise.all([
		readApi<SubgraphDetailData>(token, base),
		readApi<SubgraphHealthData>(
			token,
			`${base}/health?hours=${HEALTH_WEEK_HOURS}`,
		),
		readApi<{ data: SubgraphErrorGroup[] }>(token, `${base}/errors?limit=20`),
		readApi<SubgraphSource>(token, `${base}/source`),
	]);
	const publicSourceResult: WebhooksResult<SubgraphSource> =
		source.kind === "ok"
			? { kind: "ok", data: publicSource(source.data) as SubgraphSource }
			: source;

	let rows: RecentRowsData | null = null;
	let tableBlocks: RenderedBlock[] | null = null;
	if (detail.kind === "ok") {
		const tables = biggestTables(detail.data.tables);
		const sourceCode =
			publicSourceResult.kind === "ok"
				? publicSourceResult.data.sourceCode
				: null;
		const [results, blocks] = await Promise.all([
			Promise.all(
				tables.map(async (table): Promise<RecentRow[] | null> => {
					if (!SEGMENT_RE.test(table)) return null;
					const page = await readApi<{ rows: Record<string, unknown>[] }>(
						token,
						`/v1/subgraphs/${name}/${table}?${RECENT_ROWS_QUERY}`,
					);
					return page.kind === "ok"
						? page.data.rows.map((row) => ({ table, row }))
						: null;
				}),
			),
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
		]);
		rows = foldRecentRows(tables, results);
		tableBlocks = blocks;
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
