"use client";

import { DetailTabs } from "@/components/console/detail-tabs";

export function StreamTabs({ streamId }: { streamId: string }) {
  return (
    <DetailTabs items={[
      { label: "Overview", href: `/streams/${streamId}` },
      { label: "Filters", href: `/streams/${streamId}/filters` },
      { label: "Deliveries", href: `/streams/${streamId}/deliveries` },
      { label: "Webhook", href: `/streams/${streamId}/webhook` },
      { label: "Replay", href: `/streams/${streamId}/replay` },
    ]} />
  );
}
