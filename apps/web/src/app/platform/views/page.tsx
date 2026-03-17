import Link from "next/link";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { ViewSummary } from "@/lib/types";
import { detectStalledView } from "@/lib/intelligence/views";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { ActionDropdown } from "@/components/console/action-dropdown";
import { ViewsEmpty } from "./views-empty";

export default async function ViewsPage() {
  const session = await getSessionFromCookies();
  let views: ViewSummary[] = [];
  let chainTip: number | null = null;

  if (session) {
    const [viewsResult, statusResult] = await Promise.allSettled([
      apiRequest<{ data: ViewSummary[] }>("/api/views", {
        sessionToken: session,
        tags: ["views"],
      }),
      apiRequest<{ chainTip: number | null }>("/status", {
        sessionToken: session,
        tags: ["status"],
      }),
    ]);

    views = viewsResult.status === "fulfilled" ? viewsResult.value.data : [];
    chainTip = statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;
  }

  return (
    <>
      <div className="dash-page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="dash-page-title">Views</h1>
          {views.length > 0 && (
            <p className="dash-page-desc">
              {views.length} deployed view{views.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <ActionDropdown variant="views" />
      </div>

      {session && (
        <InsightsSection category="view" sessionToken={session} />
      )}

      {views.length === 0 ? (
        <ViewsEmpty />
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
