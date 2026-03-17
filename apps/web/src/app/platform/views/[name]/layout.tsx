import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { ViewDetail } from "@/lib/types";
import { Insight } from "@/components/console/intelligence/insight";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { detectStalledView } from "@/lib/intelligence/views";
import { DetailTabs } from "@/components/console/detail-tabs";

export default async function ViewDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const session = await getSessionFromCookies();

  const [viewResult, statusResult] = await Promise.allSettled([
    apiRequest<ViewDetail>(`/api/views/${name}`, {
      sessionToken: session ?? undefined,
      tags: ["views", `view-${name}`],
    }),
    apiRequest<{ chainTip: number | null }>("/status", {
      sessionToken: session ?? undefined,
      tags: ["status"],
    }),
  ]);

  if (viewResult.status === "rejected") {
    if (viewResult.reason instanceof ApiError && viewResult.reason.status === 404) {
      notFound();
    }
    throw viewResult.reason;
  }

  const view = viewResult.value;
  const chainTip = statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;

  const stalled = chainTip != null ? detectStalledView(view, chainTip) : null;

  const basePath = `/views/${name}`;
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
        <h1 className="dash-page-title">{view.name}</h1>
        <p className="dash-page-desc">
          v{view.version} &middot; {view.status}
          {view.lastProcessedBlock != null && (
            <> &middot; block #{view.lastProcessedBlock.toLocaleString()}</>
          )}
        </p>
      </div>

      {stalled && (
        <Insight variant="warning" id={`stalled-${view.name}`}>
          This view is <strong>{stalled.blocksBehind.toLocaleString()} blocks</strong> behind
          the chain tip (#{stalled.chainTip.toLocaleString()}). Last
          processed: #{stalled.lastProcessedBlock.toLocaleString()}.
        </Insight>
      )}

      {session && (
        <InsightsSection category="view" resourceId={name} sessionToken={session} />
      )}

      <DetailTabs items={tabs} />
      {children}
    </>
  );
}
