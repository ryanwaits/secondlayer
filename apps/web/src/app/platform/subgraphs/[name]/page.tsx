import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";
import { Insight } from "@/components/console/intelligence/insight";
import { CopyButton } from "@/components/copy-button";
import { detectHighErrorRate } from "@/lib/intelligence/subgraphs";
import { OverviewExamples } from "./overview-examples";

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

export default async function SubgraphOverviewPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const session = await getSessionFromCookies();

  let subgraph: SubgraphDetail;
  try {
    subgraph = await apiRequest<SubgraphDetail>(`/api/subgraphs/${name}`, {
      sessionToken: session ?? undefined,
      tags: ["subgraphs", `subgraph-${name}`],
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const tableEntries = Object.entries(subgraph.tables);
  const totalRows = tableEntries.reduce((sum, [, t]) => sum + t.rowCount, 0);
  const errorRate = detectHighErrorRate(subgraph.health);
  const firstTable = tableEntries[0]?.[0] ?? "";
  const firstTableCols = firstTable ? Object.keys(subgraph.tables[firstTable].columns).filter((c) => !c.startsWith("_")) : [];
  const baseUrl = `https://api.secondlayer.tools/api/subgraphs/${name}/${firstTable}`;

  // Find a filterable column for examples
  const filterCol = firstTableCols[0] ?? "name";
  const searchCol = firstTable
    ? Object.entries(subgraph.tables[firstTable].columns).find(([, c]) => c.searchable)?.[0] ?? null
    : null;

  return (
    <>
      {errorRate && (
        <Insight
          variant={errorRate.isRecent ? "danger" : "warning"}
          id={`error-rate-${subgraph.name}`}
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

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{totalRows.toLocaleString()}</span>
          <span className="dash-stat-label">total rows</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {(subgraph.health.errorRate * 100).toFixed(1)}%
          </span>
          <span className="dash-stat-label">error rate</span>
        </div>
      </div>

      {firstTable && (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Endpoint</h2>
          </div>

          <div className="code-inline" style={{ marginBottom: 16 }}>
            <code>{baseUrl}</code>
            <CopyButton code={baseUrl} />
          </div>

          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Quick reference</h2>
          </div>

          <div className="endpoint-list">
            <div className="endpoint-row">
              <span className="endpoint-method">GET</span>
              <span className="endpoint-path">/api/subgraphs/{name}/{firstTable}</span>
              <span className="endpoint-desc">Query rows</span>
            </div>
            <div className="endpoint-row">
              <span className="endpoint-method">GET</span>
              <span className="endpoint-path">...{firstTable}?{filterCol}=VALUE</span>
              <span className="endpoint-desc">Filtered</span>
            </div>
            {searchCol && (
              <div className="endpoint-row">
                <span className="endpoint-method">GET</span>
                <span className="endpoint-path">...{firstTable}?_search=term</span>
                <span className="endpoint-desc">Search</span>
              </div>
            )}
            <div className="endpoint-row">
              <span className="endpoint-method">GET</span>
              <span className="endpoint-path">...{firstTable}/count</span>
              <span className="endpoint-desc">Count</span>
            </div>
            <div className="endpoint-row">
              <span className="endpoint-method">GET</span>
              <span className="endpoint-path">...{firstTable}/42</span>
              <span className="endpoint-desc">Get by ID</span>
            </div>
          </div>

          <div className="dash-section-wrap" style={{ marginTop: 20 }}>
            <hr />
            <h2 className="dash-section-title">Examples</h2>
          </div>

          <OverviewExamples
            subgraphName={name}
            tableName={firstTable}
            filterCol={filterCol}
            searchCol={searchCol}
            apiKey={session}
          />
        </>
      )}

      <div className="dash-section-wrap" style={{ marginTop: 20 }}>
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
