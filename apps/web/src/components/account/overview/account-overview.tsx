"use client";

import { PulseScreen } from "@/components/mobile/pulse/pulse-screen";
import { useCompact } from "@/components/mobile/use-compact";
import type { OpenChoices } from "@/lib/insight-open";
import type { ReactNode } from "react";
import { type OverviewInitial, OverviewSection } from "./overview-section";

export function AccountOverview(props: {
	firstRowsCode: ReactNode;
	firstRowsPrompt: ReactNode;
	/** What the server read for this visit. */
	initial?: OverviewInitial | null;
	/** The findings the reader showed or hid, as the server read them. */
	openChoices?: OpenChoices;
}) {
	const compact = useCompact();
	return compact ? (
		<PulseScreen initial={props.initial} />
	) : (
		<OverviewSection {...props} />
	);
}
