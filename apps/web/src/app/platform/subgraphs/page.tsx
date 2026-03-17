import Link from "next/link";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { SubgraphSummary } from "@/lib/types";
import { detectStalledSubgraph } from "@/lib/intelligence/subgraphs";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { ActionDropdown } from "@/components/console/action-dropdown";
import { SubgraphsEmpty } from "./subgraphs-empty";

export default async function SubgraphsPage() {
  const session = await getSessionFromCookies();
  let subgraphs: SubgraphSummary[] = [];
  let chainTip: number | null = null;

  if (session) {
    const [subgraphsResult, statusResult] = await Promise.allSettled([
      apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
        sessionToken: session,
        tags: ["subgraphs"],
      }),
      apiRequest<{ chainTip: number | null }>("/status", {
        sessionToken: session,
        tags: ["status"],
      }),
    ]);

    subgraphs = subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
    chainTip = statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;
  }

  return (
    <>
      <div className="dash-page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="dash-page-title">Subgraphs</h1>
          {subgraphs.length > 0 && (
            <p className="dash-page-desc">
              {subgraphs.length} deployed subgraph{subgraphs.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <ActionDropdown variant="subgraphs" />
      </div>

      {session && (
        <InsightsSection category="subgraph" sessionToken={session} />
      )}

      {subgraphs.length === 0 ? (
        <SubgraphsEmpty />
      ) : (
        <div className="dash-index-group">
          {subgraphs.map((subgraph) => {
            const stalled = chainTip != null ? detectStalledSubgraph(subgraph, chainTip) : null;
            return (
              <div key={subgraph.name} className="dash-index-item">
                <Link
                  href={`/subgraphs/${subgraph.name}`}
                  className="dash-index-link"
                >
                  <span className="dash-index-label">
                    {stalled && <span className="dash-activity-dot yellow" />}
                    {subgraph.name}
                    {stalled && (
                      <span className="dash-index-hint"> (stalled)</span>
                    )}
                  </span>
                  <span className="dash-index-meta">
                    <span className="dash-badge version">v{subgraph.version}</span>
                    {subgraph.lastProcessedBlock != null &&
                      `#${subgraph.lastProcessedBlock.toLocaleString()}`}
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
