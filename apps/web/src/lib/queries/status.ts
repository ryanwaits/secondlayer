"use client";

import type { SystemStatus } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./keys";

export function useStatus() {
	return useQuery({
		queryKey: queryKeys.status,
		queryFn: async () => {
			const res = await fetch("/api/status", { credentials: "same-origin" });
			if (!res.ok) return null;
			return res.json() as Promise<SystemStatus>;
		},
		staleTime: 15_000,
	});
}
