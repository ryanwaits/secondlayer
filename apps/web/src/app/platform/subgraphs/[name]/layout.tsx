import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";
import { Insight } from "@/components/console/intelligence/insight";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { detectStalledSubgraph } from "@/lib/intelligence/subgraphs";
import { DetailTabs } from "@/components/console/detail-tabs";

export default async function SubgraphDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const session = await getSessionFromCookies();

  const [subgraphResult, statusResult] = await Promise.allSettled([
    apiRequest<SubgraphDetail>(`/api/subgraphs/${name}`, {
      sessionToken: session ?? undefined,
      tags: ["subgraphs", `subgraph-${name}`],
    }),
    apiRequest<{ chainTip: number | null }>("/status", {
      sessionToken: session ?? undefined,
      tags: ["status"],
    }),
  ]);

  if (subgraphResult.status === "rejected") {
    if (subgraphResult.reason instanceof ApiError && subgraphResult.reason.status === 404) {
      notFound();
    }
    throw subgraphResult.reason;
  }

  const subgraph = subgraphResult.value;
  const chainTip = statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;

  const stalled = chainTip != null ? detectStalledSubgraph(subgraph, chainTip) : null;

  const basePath = `/subgraphs/${name}`;
  const tabs = [
    { label: "Overview", href: basePath },
    { label: "Schema", href: `${basePath}/schema` },
    { label: "Data", href: `${basePath}/data` },
    { label: "Sources", href: `${basePath}/sources` },
    { label: "Reindex", href: `${basePath}/reindex` },
  ];

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">{subgraph.name}</h1>
        <p className="dash-page-desc">
          v{subgraph.version} &middot; {subgraph.status}
          {subgraph.lastProcessedBlock != null && (
            <> &middot; block #{subgraph.lastProcessedBlock.toLocaleString()}</>
          )}
        </p>
      </div>

      {stalled && (
        <Insight variant="warning" id={`stalled-${subgraph.name}`}>
          This subgraph is <strong>{stalled.blocksBehind.toLocaleString()} blocks</strong> behind
          the chain tip (#{stalled.chainTip.toLocaleString()}). Last
          processed: #{stalled.lastProcessedBlock.toLocaleString()}.
        </Insight>
      )}

      {session && (
        <InsightsSection category="subgraph" resourceId={name} sessionToken={session} />
      )}

      <DetailTabs items={tabs} />
      {children}
    </>
  );
}
