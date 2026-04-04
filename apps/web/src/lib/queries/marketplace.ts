"use client";

import type {
	CreatorProfile,
	MarketplaceSubgraphDetail,
	MarketplaceSubgraphSummary,
} from "@/lib/marketplace-types";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetch";
import { queryKeys } from "./keys";

export interface MarketplaceBrowseParams {
	search?: string;
	tags?: string[];
	sort?: "recent" | "popular" | "name";
	limit?: number;
	offset?: number;
}

interface BrowseResponse {
	data: MarketplaceSubgraphSummary[];
	meta: { total: number; limit: number; offset: number };
}

function buildBrowseUrl(params: MarketplaceBrowseParams): string {
	const qs = new URLSearchParams();
	if (params.search) qs.set("search", params.search);
	if (params.tags?.length) qs.set("tags", params.tags.join(","));
	if (params.sort) qs.set("_sort", params.sort);
	if (params.limit !== undefined) qs.set("_limit", String(params.limit));
	if (params.offset !== undefined) qs.set("_offset", String(params.offset));
	const str = qs.toString();
	return `/api/marketplace/subgraphs${str ? `?${str}` : ""}`;
}

export function useMarketplaceBrowse(params: MarketplaceBrowseParams = {}) {
	const url = buildBrowseUrl(params);
	return useQuery({
		queryKey: queryKeys.marketplace.browse(url),
		queryFn: () => fetchJson<BrowseResponse>(url),
		staleTime: 30_000,
	});
}

export function useMarketplaceDetail(name: string) {
	return useQuery({
		queryKey: queryKeys.marketplace.detail(name),
		queryFn: () =>
			fetchJson<MarketplaceSubgraphDetail>(
				`/api/marketplace/subgraphs/${name}`,
			),
		staleTime: 30_000,
		enabled: !!name,
	});
}

export function useMarketplaceCreator(slug: string) {
	return useQuery({
		queryKey: queryKeys.marketplace.creator(slug),
		queryFn: () =>
			fetchJson<CreatorProfile>(`/api/marketplace/creators/${slug}`),
		staleTime: 30_000,
		enabled: !!slug,
	});
}
