"use client";

import type { SystemStatus } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./keys";

export function useStatus() {
	return useQuery({
		queryKey: queryKeys.status,
		queryFn: async () => {
			const res = await fetch("/api/status", { credentials: "same-origin" });
			// Throw (not `return null`) on failure: returning null counts as a
			// success, so React Query cached it and the topbar stuck on "—" until a
			// full remount. Throwing lets it retry with backoff and keep the last
			// good data through a transient /status hiccup.
			if (!res.ok) throw new Error(`/api/status responded ${res.status}`);
			return res.json() as Promise<SystemStatus>;
		},
		staleTime: 15_000,
		retry: 3,
		retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
		refetchInterval: 60_000,
	});
}
