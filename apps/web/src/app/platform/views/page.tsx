import Link from "next/link";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { EmptyState } from "@/components/console/empty-state";
import type { ViewSummary } from "@/lib/types";

export default async function ViewsPage() {
  const session = await getSessionFromCookies();
  let views: ViewSummary[] = [];

  if (session) {
    try {
      const data = await apiRequest<{ data: ViewSummary[] }>("/api/views", {
        sessionToken: session,
      });
      views = data.data;
    } catch {}
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Views</h1>
        <p className="dash-page-desc">
          {views.length === 0
            ? "No deployed views yet."
            : `${views.length} deployed view${views.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {views.length === 0 ? (
        <EmptyState
          message="Deploy a view to start indexing blockchain data."
          action={{ label: "Read the docs", href: "/site/views" }}
        />
      ) : (
        <div className="dash-index-group">
          {views.map((view) => (
            <div key={view.name} className="dash-index-item">
              <Link
                href={`/views/${view.name}`}
                className="dash-index-link"
              >
                <span className="dash-index-label">
                  {view.name}
                </span>
                <span className="dash-index-meta">
                  <span className="dash-badge version">v{view.version}</span>
                  {view.lastProcessedBlock != null &&
                    `#${view.lastProcessedBlock.toLocaleString()}`}
                </span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
