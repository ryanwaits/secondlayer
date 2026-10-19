"use client";

import { PulseScreen } from "@/components/mobile/pulse/pulse-screen";
import { useCompact } from "@/components/mobile/use-compact";
import type { ReactNode } from "react";
import { OverviewSection } from "./overview-section";

export function AccountOverview(props: {
	firstRowsCode: ReactNode;
	firstRowsPrompt: ReactNode;
}) {
	const compact = useCompact();
	return compact ? <PulseScreen /> : <OverviewSection {...props} />;
}
