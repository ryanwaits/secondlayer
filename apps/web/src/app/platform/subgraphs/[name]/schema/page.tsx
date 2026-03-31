import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";

const SYSTEM_COLUMNS = new Set(["_id", "_block_height", "_tx_id", "_created_at"]);

export default async function SubgraphSchemaPage({
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

  return (
    <>
      {tableEntries.map(([tableName, table]) => {
        const colEntries = Object.entries(table.columns);
        const userCols = colEntries.filter(([n]) => !SYSTEM_COLUMNS.has(n));
        const filterableCol = userCols[0]?.[0] ?? "name";

        // Build index pills
        const indexPills: string[] = [];
        if (table.uniqueKeys) {
          for (const uk of table.uniqueKeys) {
            indexPills.push(`UNIQUE (${uk.join(", ")})`);
          }
        }
        for (const [colName, col] of colEntries) {
          if (col.indexed) indexPills.push(`INDEX (${colName})`);
          if (col.searchable) indexPills.push(`GIN (${colName})`);
        }
        if (table.indexes) {
          for (const idx of table.indexes) {
            indexPills.push(`INDEX (${idx.join(", ")})`);
          }
        }

        return (
          <div key={tableName}>
            <div className="dash-section-wrap">
              <hr />
              <h2 className="dash-section-title">
                {tableName}
                <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 11, fontFamily: "var(--font-mono-stack)" }}>
                  {table.rowCount.toLocaleString()} rows
                </span>
              </h2>
            </div>

            <div className="col-list">
              {colEntries.map(([colName, col]) => (
                <div key={colName} className="col-row">
                  <span className="col-name">{colName}</span>
                  <span className="col-type">{col.type}</span>
                  <span className="col-badges">
                    {SYSTEM_COLUMNS.has(colName) && <span className="badge-system">system</span>}
                    {col.indexed && <span className="badge-indexed">indexed</span>}
                    {col.searchable && <span className="badge-searchable">searchable</span>}
                    {col.nullable && <span className="badge-system">nullable</span>}
                    {table.uniqueKeys?.some((uk) => uk.length === 1 && uk[0] === colName) && (
                      <span className="badge-unique">unique</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {indexPills.length > 0 && (
              <>
                <div className="dash-section-wrap" style={{ marginTop: 20 }}>
                  <hr />
                  <h2 className="dash-section-title">Indexes</h2>
                </div>
                <div className="index-pills">
                  {indexPills.map((pill, i) => (
                    <span key={i} className="index-pill">{pill}</span>
                  ))}
                </div>
              </>
            )}

            <div className="dash-section-wrap" style={{ marginTop: 20 }}>
              <hr />
              <h2 className="dash-section-title">Query filters</h2>
            </div>

            <div className="op-grid">
              <span className="op-sym">=</span>
              <span className="op-example">{filterableCol}=VALUE</span>
              <span className="op-sym">!=</span>
              <span className="op-example">{filterableCol}.neq=VALUE</span>
              <span className="op-sym">&gt;</span>
              <span className="op-example">_block_height.gt=1000000</span>
              <span className="op-sym">&gt;=</span>
              <span className="op-example">_block_height.gte=500000</span>
              <span className="op-sym">&lt;</span>
              <span className="op-example">_block_height.lt=100000</span>
              <span className="op-sym">&lt;=</span>
              <span className="op-example">_id.lte=1000</span>
              <span className="op-sym">LIKE</span>
              <span className="op-example">{filterableCol}.like=term</span>
            </div>
          </div>
        );
      })}

      {tableEntries.length === 0 && (
        <p className="dash-page-desc">No tables defined.</p>
      )}
    </>
  );
}
