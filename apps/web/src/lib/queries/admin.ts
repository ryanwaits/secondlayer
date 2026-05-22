"use client";

import type { AdminAccount, AdminStats } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetch";
import { queryKeys } from "./keys";

// ── Queries ──

export function useAdminAccounts() {
	return useQuery({
		queryKey: queryKeys.admin.accounts,
		queryFn: () =>
			fetchJson<{ accounts: AdminAccount[] }>("/api/admin/accounts").then(
				(r) => r.accounts,
			),
	});
}

export function useAdminStats() {
	return useQuery({
		queryKey: queryKeys.admin.stats,
		queryFn: () => fetchJson<AdminStats>("/api/admin/stats"),
	});
}
