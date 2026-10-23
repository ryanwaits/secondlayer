"use client";

import { useMediaQuery } from "@/components/figures/use-media-query";

/** The phone layout: viewport ≤640px. False on the server. Never sniffs the device. */
const COMPACT_QUERY = "(max-width: 640px)";

export function useCompact(): boolean {
	return useMediaQuery(COMPACT_QUERY);
}
