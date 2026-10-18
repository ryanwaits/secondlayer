"use client";

import { OverviewSection } from "@/components/account/overview/overview-section";
import { PulseScreen } from "@/components/mobile/pulse/pulse-screen";
import { useCompact } from "@/components/mobile/use-compact";

export default function AccountOverviewPage() {
	const compact = useCompact();
	return compact ? <PulseScreen /> : <OverviewSection />;
}
