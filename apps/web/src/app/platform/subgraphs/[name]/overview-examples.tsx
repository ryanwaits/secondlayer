"use client";

import { TabbedCode, type CodeTab } from "@/components/console/tabbed-code";

function maskKey(key: string | null): string {
  if (!key) return "YOUR_API_KEY";
  if (key.length <= 12) return key.slice(0, 6) + "****";
  return key.slice(0, 10) + "****";
}

export function OverviewExamples({
  subgraphName,
  tableName,
  filterCol,
  searchCol,
  apiKey,
}: {
  subgraphName: string;
  tableName: string;
  filterCol: string;
  searchCol: string | null;
  apiKey: string | null;
}) {
  const base = `https://api.secondlayer.tools/api/subgraphs/${subgraphName}/${tableName}`;
  const masked = maskKey(apiKey);
  const realKey = apiKey ?? "YOUR_API_KEY";

  const tabs: CodeTab[] = [
    {
      label: "Query",
      lang: "bash",
      code: `curl -s "${base}?_limit=10&_order=desc&_sort=_block_height" \\
  -H "Authorization: Bearer ${masked}" | jq`,
      copyCode: `curl -s "${base}?_limit=10&_order=desc&_sort=_block_height" \\
  -H "Authorization: Bearer ${realKey}" | jq`,
    },
    {
      label: "Filter",
      lang: "bash",
      code: `curl -s "${base}?${filterCol}=VALUE&_limit=10" \\
  -H "Authorization: Bearer ${masked}" | jq`,
      copyCode: `curl -s "${base}?${filterCol}=VALUE&_limit=10" \\
  -H "Authorization: Bearer ${realKey}" | jq`,
    },
  ];

  if (searchCol) {
    tabs.push({
      label: "Search",
      lang: "bash",
      code: `curl -s "${base}?_search=term&_limit=10" \\
  -H "Authorization: Bearer ${masked}" | jq`,
      copyCode: `curl -s "${base}?_search=term&_limit=10" \\
  -H "Authorization: Bearer ${realKey}" | jq`,
    });
  }

  tabs.push({
    label: "Count",
    lang: "bash",
    code: `curl -s "${base}/count" \\
  -H "Authorization: Bearer ${masked}" | jq`,
    copyCode: `curl -s "${base}/count" \\
  -H "Authorization: Bearer ${realKey}" | jq`,
  });

  return <TabbedCode tabs={tabs} />;
}
