import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { ViewDetail } from "@/lib/types";
import { Insight } from "@/components/console/intelligence/insight";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { detectHighErrorRate } from "@/lib/intelligence/views";

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function ViewOverviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const session = await getSessionFromCookies();

  let view: ViewDetail;
  try {
    view = await apiRequest<ViewDetail>(`/api/views/${name}`, {
      sessionToken: session ?? undefined,
      tags: ["views", `view-${name}`],
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const tableEntries = Object.entries(view.tables);
  const totalRows = tableEntries.reduce((sum, [, t]) => sum + t.rowCount, 0);
  const errorRate = detectHighErrorRate(view.health);

  return (
    <>
      {errorRate && (
        <Insight
          variant={errorRate.isRecent ? "danger" : "warning"}
          id={`error-rate-${view.name}`}
        >
          {errorRate.isRecent ? (
            <>
              Error rate is <strong>{(errorRate.errorRate * 100).toFixed(1)}%</strong>{" "}
              ({errorRate.totalErrors.toLocaleString()}/{errorRate.totalProcessed.toLocaleString()}).
              Last error {formatTimeAgo(errorRate.lastErrorAt!)}:
              <code style={{ display: "block", marginTop: 4 }}>{errorRate.lastError}</code>
            </>
          ) : (
            <>
              Historical error rate is <strong>{(errorRate.errorRate * 100).toFixed(1)}%</strong>{" "}
              ({errorRate.totalErrors.toLocaleString()}/{errorRate.totalProcessed.toLocaleString()}).
              No errors in the last 24 hours.
            </>
          )}
        </Insight>
      )}

      {session && (
        <InsightsSection category="view" resourceId={name} sessionToken={session} />
      )}

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{totalRows.toLocaleString()}</span>
          <span className="dash-stat-label">total rows</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {(view.health.errorRate * 100).toFixed(1)}%
          </span>
          <span className="dash-stat-label">error rate</span>
        </div>
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Tables</h2>
      </div>

      {tableEntries.length === 0 ? (
        <p className="dash-page-desc">No tables yet.</p>
      ) : (
        <div className="dash-index-group">
          {tableEntries.map(([tableName, table]) => (
            <div key={tableName} className="dash-index-item">
              <div className="dash-index-link">
                <span className="dash-index-label">{tableName}</span>
                <span className="dash-index-meta">
                  {table.rowCount.toLocaleString()} rows
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
