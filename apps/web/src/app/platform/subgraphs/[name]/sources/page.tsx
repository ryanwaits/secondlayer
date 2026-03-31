import { notFound } from "next/navigation";
import Link from "next/link";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";

export default async function SubgraphSourcesPage({
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

  const sources = subgraph.sources;

  if (!sources || sources.length === 0) {
    return (
      <>
        <p className="dash-page-desc">
          Source configuration is defined in your subgraph handler code.
        </p>
        <div className="dash-hint" style={{ marginTop: 12 }}>
          <Link href="/site/subgraphs" style={{ color: "var(--accent-purple)" }}>
            Read the docs
          </Link>{" "}
          to learn how to configure data sources.
        </div>
      </>
    );
  }

  // Group sources by contract
  const byContract = new Map<string, string[]>();
  for (const src of sources) {
    const fns = byContract.get(src.contract) ?? [];
    const label = src.function ?? src.event ?? src.type ?? "unknown";
    if (!fns.includes(label)) fns.push(label);
    byContract.set(src.contract, fns);
  }

  return (
    <>
      {Array.from(byContract.entries()).map(([contract, fns]) => (
        <div key={contract} className="source-card">
          <div className="source-contract">
            <span className="source-contract-label">Contract</span>
            {contract}
          </div>
          <div className="source-fns">
            {fns.map((fn) => (
              <span key={fn} className="source-fn">{fn}</span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
