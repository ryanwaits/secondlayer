import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { ViewDetail } from "@/lib/types";
import { Insight } from "@/components/console/intelligence/insight";
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

  let view: ViewDetail;
  try {
    view = await apiRequest<ViewDetail>(`/api/views/${name}`, {
      sessionToken: session ?? undefined,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }

  let chainTip: number | null = null;
  try {
    const status = await apiRequest<{ chainTip: number | null }>("/status", {
      sessionToken: session ?? undefined,
    });
    chainTip = status.chainTip;
  } catch {}

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

      <DetailTabs items={tabs} />
      {children}
    </>
  );
}
