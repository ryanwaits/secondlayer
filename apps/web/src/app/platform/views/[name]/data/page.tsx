"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

interface TableMeta {
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 20;

export default function ViewDataPage() {
  const { name } = useParams<{ name: string }>();
  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string>("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch view detail to get table names
  useEffect(() => {
    fetch(`/api/views/${name}`)
      .then((r) => r.json())
      .then((data) => {
        const names = Object.keys(data.tables || {});
        setTables(names);
        if (names.length > 0) setActiveTable(names[0]);
      })
      .catch(() => {});
  }, [name]);

  const fetchData = useCallback(
    async (table: string, offset: number, append: boolean) => {
      if (!table) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/views/${name}/${table}?_limit=${PAGE_SIZE}&_offset=${offset}&_sort=_id&_order=desc`,
        );
        const json = await res.json();
        setRows((prev) => (append ? [...prev, ...json.data] : json.data));
        setMeta(json.meta);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [name],
  );

  useEffect(() => {
    if (activeTable) {
      setRows([]);
      setMeta(null);
      fetchData(activeTable, 0, false);
    }
  }, [activeTable, fetchData]);

  function handleLoadMore() {
    if (meta) {
      fetchData(activeTable, meta.offset + meta.limit, true);
    }
  }

  const columns =
    rows.length > 0 ? Object.keys(rows[0]) : [];

  const hasMore = meta ? meta.offset + meta.limit < meta.total : false;

  return (
    <>
      {/* Table selector tabs */}
      <div style={{ marginBottom: 16 }}>
        {tables.map((t) => (
          <span
            key={t}
            className={`dash-tab${t === activeTable ? " active" : ""}`}
            onClick={() => setActiveTable(t)}
          >
            {t}
          </span>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <p className="dash-page-desc">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="dash-page-desc">No data in this table.</p>
      ) : (
        <>
          <div className="dash-data-table-wrap">
            <table className="dash-data-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td key={col}>
                        {row[col] == null
                          ? ""
                          : typeof row[col] === "object"
                            ? JSON.stringify(row[col])
                            : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta && (
            <p className="dash-hint">
              Showing {rows.length.toLocaleString()} of{" "}
              {meta.total.toLocaleString()} rows
            </p>
          )}

          {hasMore && (
            <div style={{ marginTop: 12 }}>
              <button
                className="dash-btn"
                onClick={handleLoadMore}
                disabled={loading}
              >
                {loading ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
