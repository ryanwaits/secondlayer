import type {
	CreatorProfile,
	MarketplaceSubgraphDetail,
	MarketplaceSubgraphSummary,
	SubgraphQueryParams,
} from "@secondlayer/shared/schemas";
import { BaseClient } from "../base.ts";

export interface MarketplaceBrowseOptions {
	tags?: string[];
	search?: string;
	sort?: "recent" | "popular" | "name";
	limit?: number;
	offset?: number;
}

function buildMarketplaceQuery(opts: MarketplaceBrowseOptions): string {
	const qs = new URLSearchParams();
	if (opts.tags?.length) qs.set("tags", opts.tags.join(","));
	if (opts.search) qs.set("search", opts.search);
	if (opts.sort) qs.set("_sort", opts.sort);
	if (opts.limit !== undefined) qs.set("_limit", String(opts.limit));
	if (opts.offset !== undefined) qs.set("_offset", String(opts.offset));
	const str = qs.toString();
	return str ? `?${str}` : "";
}

function buildSubgraphQueryString(params: SubgraphQueryParams): string {
	const qs = new URLSearchParams();
	if (params.sort) qs.set("_sort", params.sort);
	if (params.order) qs.set("_order", params.order);
	if (params.limit !== undefined) qs.set("_limit", String(params.limit));
	if (params.offset !== undefined) qs.set("_offset", String(params.offset));
	if (params.fields) qs.set("_fields", params.fields);
	if (params.filters) {
		for (const [key, value] of Object.entries(params.filters)) {
			qs.set(key, String(value));
		}
	}
	const str = qs.toString();
	return str ? `?${str}` : "";
}

export class Marketplace extends BaseClient {
	async browse(
		opts: MarketplaceBrowseOptions = {},
	): Promise<{
		data: MarketplaceSubgraphSummary[];
		meta: { total: number; limit: number; offset: number };
	}> {
		return this.request("GET", `/api/marketplace/subgraphs${buildMarketplaceQuery(opts)}`);
	}

	async get(name: string): Promise<MarketplaceSubgraphDetail> {
		return this.request("GET", `/api/marketplace/subgraphs/${name}`);
	}

	async creator(slug: string): Promise<CreatorProfile> {
		return this.request("GET", `/api/marketplace/creators/${slug}`);
	}

	async fork(
		name: string,
		newName?: string,
	): Promise<{
		action: string;
		subgraphId: string;
		name: string;
		forkedFrom: string;
	}> {
		return this.request("POST", `/api/marketplace/subgraphs/${name}/fork`, {
			newName,
		});
	}

	async queryTable(
		name: string,
		table: string,
		params: SubgraphQueryParams = {},
	): Promise<{
		data: unknown[];
		meta: { total: number; limit: number; offset: number };
	}> {
		return this.request(
			"GET",
			`/api/marketplace/subgraphs/${name}/${table}${buildSubgraphQueryString(params)}`,
		);
	}
}
