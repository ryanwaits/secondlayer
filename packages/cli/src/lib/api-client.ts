import { SecondLayer } from "@secondlayer/sdk";
import type { MarketplaceBrowseOptions } from "@secondlayer/sdk/marketplace";
import type {
	BulkPauseResponse,
	BulkResumeResponse,
	CreateStream,
	CreateStreamResponse,
	ListStreamsResponse,
	MarketplaceSubgraphDetail,
	MarketplaceSubgraphSummary,
	ReindexResponse,
	StreamResponse,
	SubgraphDetail,
	SubgraphGapsResponse,
	SubgraphQueryParams,
	SubgraphSummary,
	UpdateStream,
} from "@secondlayer/shared/schemas";
import type {
	DeploySubgraphRequest,
	DeploySubgraphResponse,
} from "@secondlayer/shared/schemas/subgraphs";
import type { QueueStats } from "@secondlayer/shared/types";
import { loadConfig, resolveApiUrl } from "./config.ts";

import { ApiError } from "@secondlayer/sdk";
export { ApiError };
export type { SubgraphQueryParams } from "@secondlayer/shared/schemas";

/**
 * Guard that throws if the response is not ok, extracting the best error message.
 */
export async function assertOk(res: Response): Promise<void> {
	if (res.ok) return;
	const body = await res.text();
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed.error === "string" && parsed.error)
			throw new Error(parsed.error);
	} catch (e) {
		if (e instanceof Error && e.message !== body) throw e;
	}
	throw new Error(`HTTP ${res.status}`);
}

/**
 * Shared error handler for API calls. Prints auth hint on 401, generic message otherwise.
 */
export function handleApiError(err: unknown, action: string): never {
	if (err instanceof ApiError && (err as { status: number }).status === 401) {
		console.error("Error: Authentication required. Run: sl auth login");
		process.exit(1);
	}
	console.error(`Error: Failed to ${action}: ${err}`);
	process.exit(1);
}

async function getClient(): Promise<SecondLayer> {
	const config = await loadConfig();
	const baseUrl = resolveApiUrl(config);
	return new SecondLayer({ baseUrl, apiKey: config.apiKey });
}

/**
 * Build auth headers from config. Use for raw fetch() calls outside the SDK.
 */
export function authHeaders(config: { apiKey?: string }): Record<
	string,
	string
> {
	return SecondLayer.authHeaders(config.apiKey);
}

// ── Streams ───────────────────────────────────────────────────────────────

export async function createStream(
	data: CreateStream,
): Promise<CreateStreamResponse> {
	return (await getClient()).streams.create(data);
}

export async function updateStream(
	id: string,
	data: UpdateStream,
): Promise<StreamResponse> {
	return (await getClient()).streams.update(id, data);
}

export async function updateStreamByName(
	name: string,
	data: CreateStream,
): Promise<StreamResponse> {
	return (await getClient()).streams.updateByName(name, data);
}

export async function listStreams(params?: {
	status?: string;
}): Promise<ListStreamsResponse> {
	return (await getClient()).streams.list(params);
}

export async function resolveStreamId(partialId: string): Promise<string> {
	return (await getClient()).streams.resolveStreamId(partialId);
}

export async function getStream(id: string): Promise<StreamResponse> {
	return (await getClient()).streams.get(id);
}

export async function deleteStream(id: string): Promise<void> {
	return (await getClient()).streams.delete(id);
}

export async function enableStream(id: string): Promise<StreamResponse> {
	return (await getClient()).streams.enable(id);
}

export async function disableStream(id: string): Promise<StreamResponse> {
	return (await getClient()).streams.disable(id);
}

export async function rotateSecret(id: string): Promise<{ secret: string }> {
	return (await getClient()).streams.rotateSecret(id);
}

export async function pauseAllStreams(): Promise<BulkPauseResponse> {
	return (await getClient()).streams.pauseAll();
}

export async function resumeAllStreams(): Promise<BulkResumeResponse> {
	return (await getClient()).streams.resumeAll();
}

export async function getQueueStats(): Promise<QueueStats> {
	return (await getClient()).getQueueStats();
}

// ── Subgraphs ─────────────────────────────────────────────────────────────

export async function listSubgraphsApi(): Promise<{ data: SubgraphSummary[] }> {
	return (await getClient()).subgraphs.list();
}

export async function getSubgraphApi(name: string): Promise<SubgraphDetail> {
	return (await getClient()).subgraphs.get(name);
}

export async function reindexSubgraphApi(
	name: string,
	options?: { fromBlock?: number; toBlock?: number },
): Promise<ReindexResponse> {
	return (await getClient()).subgraphs.reindex(name, options);
}

export async function backfillSubgraphApi(
	name: string,
	options: { fromBlock: number; toBlock: number },
): Promise<ReindexResponse> {
	return (await getClient()).subgraphs.backfill(name, options);
}

export async function stopSubgraphApi(
	name: string,
): Promise<{ message: string }> {
	return (await getClient()).subgraphs.stop(name);
}

export async function deleteSubgraphApi(
	name: string,
): Promise<{ message: string }> {
	return (await getClient()).subgraphs.delete(name);
}

export async function deploySubgraphApi(
	data: DeploySubgraphRequest,
): Promise<DeploySubgraphResponse> {
	return (await getClient()).subgraphs.deploy(data);
}

export async function querySubgraphTable(
	name: string,
	table: string,
	params: SubgraphQueryParams = {},
): Promise<unknown[]> {
	return (await getClient()).subgraphs.queryTable(name, table, params);
}

export async function querySubgraphTableCount(
	name: string,
	table: string,
	params: SubgraphQueryParams = {},
): Promise<{ count: number }> {
	return (await getClient()).subgraphs.queryTableCount(name, table, params);
}

export async function getSubgraphGaps(
	name: string,
	opts?: { limit?: number; offset?: number; resolved?: boolean },
): Promise<SubgraphGapsResponse> {
	return (await getClient()).subgraphs.gaps(name, opts);
}

// ── Account Profile ──────────────────────────────────────────────────

export async function getAccountProfile(): Promise<{
	id: string;
	email: string;
	plan: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
	createdAt: string;
}> {
	const config = await loadConfig();
	const baseUrl = resolveApiUrl(config);
	const res = await fetch(`${baseUrl}/api/accounts/me`, {
		headers: authHeaders(config),
	});
	await assertOk(res);
	return res.json() as any;
}

export async function updateAccountProfile(data: {
	display_name?: string;
	bio?: string;
	slug?: string;
}): Promise<{
	id: string;
	email: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
}> {
	const config = await loadConfig();
	const baseUrl = resolveApiUrl(config);
	const res = await fetch(`${baseUrl}/api/accounts/me`, {
		method: "PATCH",
		headers: authHeaders(config),
		body: JSON.stringify(data),
	});
	await assertOk(res);
	return res.json() as any;
}

// ── Marketplace (public, no auth required) ──────────────────────────

export async function browseMarketplace(
	opts: MarketplaceBrowseOptions = {},
): Promise<{
	data: MarketplaceSubgraphSummary[];
	meta: { total: number; limit: number; offset: number };
}> {
	return (await getClient()).marketplace.browse(opts);
}

export async function getMarketplaceSubgraph(
	name: string,
): Promise<MarketplaceSubgraphDetail> {
	return (await getClient()).marketplace.get(name);
}

export async function forkMarketplaceSubgraph(
	name: string,
	newName?: string,
): Promise<{
	action: string;
	subgraphId: string;
	name: string;
	forkedFrom: string;
}> {
	return (await getClient()).marketplace.fork(name, newName);
}

export async function publishSubgraphApi(
	name: string,
	opts?: { tags?: string[]; description?: string },
): Promise<{ message: string }> {
	const config = await loadConfig();
	const baseUrl = resolveApiUrl(config);
	const res = await fetch(`${baseUrl}/api/subgraphs/${name}/publish`, {
		method: "POST",
		headers: authHeaders(config),
		body: JSON.stringify(opts ?? {}),
	});
	await assertOk(res);
	return res.json() as any;
}

export async function unpublishSubgraphApi(
	name: string,
): Promise<{ message: string }> {
	const config = await loadConfig();
	const baseUrl = resolveApiUrl(config);
	const res = await fetch(`${baseUrl}/api/subgraphs/${name}/unpublish`, {
		method: "POST",
		headers: authHeaders(config),
		body: JSON.stringify({}),
	});
	await assertOk(res);
	return res.json() as any;
}
