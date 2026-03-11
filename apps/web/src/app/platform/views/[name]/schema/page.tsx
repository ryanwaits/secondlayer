import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";

interface ViewDetail {
  name: string;
  tables: Record<
    string,
    {
      endpoint: string;
      columns: Record<string, { type: string; nullable?: boolean }>;
      rowCount: number;
      example: unknown;
    }
  >;
}

const SYSTEM_COLUMNS = new Set(["_id", "_block_height", "_tx_id", "_created_at"]);

export default async function ViewSchemaPage({
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

  return (
    <>
      {tableEntries.map(([tableName, table]) => (
        <div key={tableName}>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">
              {tableName}
              <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 13 }}>
                {table.rowCount.toLocaleString()} rows
              </span>
            </h2>
          </div>

          <div className="dash-props">
            {Object.entries(table.columns).map(([colName, col]) => (
              <div
                key={colName}
                className="dash-prop-row"
                style={SYSTEM_COLUMNS.has(colName) ? { opacity: 0.5 } : undefined}
              >
                <span className="dash-prop-name">{colName}</span>
                <span className="dash-prop-type">{col.type}</span>
                {col.nullable && (
                  <span className="dash-prop-badge">nullable</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {tableEntries.length === 0 && (
        <p className="dash-page-desc">No tables defined.</p>
      )}
    </>
  );
}
