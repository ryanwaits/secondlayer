"use client";

import { PulseScreen } from "@/components/mobile/pulse/pulse-screen";
import { useCompact } from "@/components/mobile/use-compact";
import type { ReactNode } from "react";
import { type OverviewInitial, OverviewSection } from "./overview-section";

export function AccountOverview(props: {
	firstRowsCode: ReactNode;
	firstRowsPrompt: ReactNode;
	/** What the server read for this visit. */
	initial?: OverviewInitial | null;
}) {
	const compact = useCompact();
	return compact ? (
		<PulseScreen initial={props.initial} />
	) : (
		<OverviewSection {...props} />
	);
}
