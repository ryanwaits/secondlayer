"use client";

import { InsightsScreen } from "@/components/mobile/insights/insights-screen";
import { COMPACT_QUERY, useCompact } from "@/components/mobile/use-compact";
import { useInsights } from "@/lib/insights-store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The phone's Insights tab. Desktop has no Insights page: wider windows go to the Overview. */
export function InsightsPage() {
	const compact = useCompact();
	const router = useRouter();
	// Takes the server's insights into the store on the first render, even while
	// the screen below waits for `compact`, so the frame's poll doesn't read them again.
	useInsights();
	useEffect(() => {
		// Read the media query directly: useCompact() is false during hydration.
		if (!window.matchMedia(COMPACT_QUERY).matches) router.replace("/account");
	}, [router]);
	return compact ? <InsightsScreen /> : null;
}
