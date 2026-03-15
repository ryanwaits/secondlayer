import Link from "next/link";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
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
      <div className="dash-page-header" style={views.length === 0 ? { textAlign: "center" } : undefined}>
        <h1 className="dash-page-title">Views</h1>
        {views.length > 0 && (
          <p className="dash-page-desc">
            {views.length} deployed view{views.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

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
