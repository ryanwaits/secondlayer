"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetch";
import { queryKeys } from "./keys";

export interface TableDataResponse {
	data: Record<string, unknown>[];
	meta: { total: number; limit: number; offset: number };
}

const PAGE_SIZE = 20;

export function useSubgraphTableData(
	name: string,
	table: string,
	page = 0,
	limit: number = PAGE_SIZE,
) {
	return useQuery({
		queryKey: queryKeys.subgraphs.tableDataPage(name, table, page),
		queryFn: () =>
			fetchJson<TableDataResponse>(
				`/api/subgraphs/${name}/${table}?_limit=${limit}&_offset=${page * limit}&_sort=_id&_order=desc`,
			),
		staleTime: 30_000,
		enabled: !!table,
	});
}
