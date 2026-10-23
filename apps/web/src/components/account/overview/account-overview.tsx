"use client";

import { useCompact } from "@/components/mobile/use-compact";
import type { ReactNode } from "react";
import { OverviewSection } from "./overview-section";

export function AccountOverview(props: {
	firstRowsCode: ReactNode;
	firstRowsPrompt: ReactNode;
}) {
	return <OverviewSection {...props} compact={useCompact()} />;
}
