import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";

interface ViewDetail {
  name: string;
  health: {
    totalProcessed: number;
    totalErrors: number;
    errorRate: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  tables: Record<string, { rowCount: number; endpoint: string; columns: Record<string, unknown>; example: unknown }>;
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
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const tableEntries = Object.entries(view.tables);
  const totalRows = tableEntries.reduce((sum, [, t]) => sum + t.rowCount, 0);

  return (
    <>
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
