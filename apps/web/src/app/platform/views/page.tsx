import Link from "next/link";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { ViewSummary, AccountInsight } from "@/lib/types";
import { detectStalledView } from "@/lib/intelligence/views";
import { InsightCard } from "@/components/console/intelligence/insight-card";

export default async function ViewsPage() {
  const session = await getSessionFromCookies();
  let views: ViewSummary[] = [];
  let chainTip: number | null = null;
  let insights: AccountInsight[] = [];

  if (session) {
    try {
      const data = await apiRequest<{ data: ViewSummary[] }>("/api/views", {
        sessionToken: session,
      });
      views = data.data;
    } catch {}

    try {
      const status = await apiRequest<{ chainTip: number | null }>("/status", {
        sessionToken: session,
      });
      chainTip = status.chainTip;
    } catch {}

    try {
      const data = await apiRequest<{ insights: AccountInsight[] }>(
        "/api/insights?category=view",
        { sessionToken: session },
      );
      insights = data.insights;
    } catch {}
  }

  return (
    <>
      <div className="dash-page-header" style={views.length === 0 ? { textAlign: "center" } : undefined}>
        <h1 className="dash-page-title">Views</h1>
        {views.length > 0 && (
          <p className="dash-page-desc">
            {views.length} deployed view{views.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {insights.length > 0 && session && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} sessionToken={session} />
          ))}
        </div>
      )}

      {views.length === 0 ? (
        <div className="dash-empty">
          <p>Deploy a view to start indexing blockchain data.</p>
          <div className="dash-empty-actions">
            <code className="dash-empty-cmd">sl views scaffold {"<contract-id>"} -o views/my-view.ts</code>
            <div className="dash-empty-links">
              <Link href="/platform/views/scaffold">Scaffold from contract</Link>
              <span className="dash-empty-sep">·</span>
              <Link href="/site/views">Read the docs</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="dash-index-group">
          {views.map((view) => {
            const stalled = chainTip != null ? detectStalledView(view, chainTip) : null;
            return (
              <div key={view.name} className="dash-index-item">
                <Link
                  href={`/views/${view.name}`}
                  className="dash-index-link"
                >
                  <span className="dash-index-label">
                    {stalled && <span className="dash-activity-dot yellow" />}
                    {view.name}
                    {stalled && (
                      <span className="dash-index-hint"> (stalled)</span>
                    )}
                  </span>
                  <span className="dash-index-meta">
                    <span className="dash-badge version">v{view.version}</span>
                    {view.lastProcessedBlock != null &&
                      `#${view.lastProcessedBlock.toLocaleString()}`}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
