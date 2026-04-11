"use client";

import type { AdminAccount, AdminStats, WaitlistEntry } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "./fetch";
import { queryKeys } from "./keys";

// ── Queries ──

export function useAdminWaitlist(status?: string) {
	return useQuery({
		queryKey: queryKeys.admin.waitlist(status),
		queryFn: () => {
			const qs = status ? `?status=${status}` : "";
			return fetchJson<{ entries: WaitlistEntry[] }>(
				`/api/admin/waitlist${qs}`,
			).then((r) => r.entries);
		},
	});
}

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

// ── Mutations ──

export function useApproveWaitlist() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) =>
			fetchJson(`/api/admin/waitlist/${id}/approve`, { method: "POST" }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["admin", "waitlist"] });
			qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
		},
	});
}

export function useBulkApprove() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (ids: string[]) =>
			fetchJson("/api/admin/waitlist/bulk-approve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids }),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["admin", "waitlist"] });
			qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
		},
	});
}
