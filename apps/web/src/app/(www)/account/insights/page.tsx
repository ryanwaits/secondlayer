"use client";

import { InsightsScreen } from "@/components/mobile/insights/insights-screen";
import { COMPACT_QUERY, useCompact } from "@/components/mobile/use-compact";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The phone's Insights tab. Desktop has no Insights page: wider windows go to the Overview. */
export default function InsightsPage() {
	const compact = useCompact();
	const router = useRouter();
	useEffect(() => {
		// Read the media query directly: useCompact() is false during hydration.
		if (!window.matchMedia(COMPACT_QUERY).matches) router.replace("/account");
	}, [router]);
	return compact ? <InsightsScreen /> : null;
}
