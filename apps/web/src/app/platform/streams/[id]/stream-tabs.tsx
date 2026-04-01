"use client";

import { DetailTabs } from "@/components/console/detail-tabs";

export function StreamTabs({ streamId }: { streamId: string }) {
	return (
		<DetailTabs
			items={[
				{ label: "Overview", href: `/streams/${streamId}` },
				{ label: "Filters", href: `/streams/${streamId}/filters` },
				{ label: "Deliveries", href: `/streams/${streamId}/deliveries` },
				{ label: "Endpoint", href: `/streams/${streamId}/endpoint` },
				{ label: "Replay", href: `/streams/${streamId}/replay` },
			]}
		/>
	);
}
