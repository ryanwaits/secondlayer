"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";
import {
  useSubgraphTableData,
  type TableDataResponse,
} from "@/lib/queries/subgraphs";
import { fetchJson } from "@/lib/queries/fetch";

const PAGE_SIZE = 20;

export function DataClient({
  subgraphName,
  tables,
  initialTable,
  initialData,
}: {
  subgraphName: string;
  tables: string[];
  initialTable: string;
  initialData: TableDataResponse | null;
}) {
  const [activeTable, setActiveTable] = useState(initialTable);
  const [page, setPage] = useState(0);
  const qc = useQueryClient();

  // Seed page 0 cache from server data
  useEffect(() => {
    if (initialData && initialTable) {
      qc.setQueryData(
        queryKeys.subgraphs.tableDataPage(subgraphName, initialTable, 0),
        initialData,
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isFetching, isError } = useSubgraphTableData(
    subgraphName,
    activeTable,
    page,
  );

  const rows = data?.data ?? [];
  const meta = data?.meta ?? null;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / PAGE_SIZE)) : 1;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  // Prefetch next page
  useEffect(() => {
    if (page < totalPages - 1 && activeTable) {
      qc.prefetchQuery({
        queryKey: queryKeys.subgraphs.tableDataPage(subgraphName, activeTable, page + 1),
        queryFn: () =>
          fetchJson<TableDataResponse>(
            `/api/subgraphs/${subgraphName}/${activeTable}?_limit=${PAGE_SIZE}&_offset=${(page + 1) * PAGE_SIZE}&_sort=_id&_order=desc`,
          ),
        staleTime: 30_000,
      });
    }
  }, [page, subgraphName, activeTable, totalPages, qc]);

  const prefetchPage = useCallback(
    (p: number) => {
      if (p >= 0 && p < totalPages && activeTable) {
        qc.prefetchQuery({
          queryKey: queryKeys.subgraphs.tableDataPage(subgraphName, activeTable, p),
          queryFn: () =>
            fetchJson<TableDataResponse>(
              `/api/subgraphs/${subgraphName}/${activeTable}?_limit=${PAGE_SIZE}&_offset=${p * PAGE_SIZE}&_sort=_id&_order=desc`,
            ),
          staleTime: 30_000,
        });
      }
    },
    [subgraphName, activeTable, totalPages, qc],
  );

  function handleTableSwitch(table: string) {
    setActiveTable(table);
    setPage(0);
  }

  return (
    <>
      {/* Table selector tabs */}
      <div style={{ marginBottom: 16 }}>
        {tables.map((t) => (
          <span
            key={t}
            className={`dash-tab${t === activeTable ? " active" : ""}`}
            onClick={() => handleTableSwitch(t)}
          >
            {t}
          </span>
        ))}
      </div>

      {isError ? (
        <div className="dash-empty">Failed to load data. Try refreshing.</div>
      ) : isFetching && rows.length === 0 ? (
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
                  <tr
                    key={i}
                    style={{ opacity: isFetching ? 0.5 : 1, transition: "opacity 150ms" }}
                  >
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
            <div
              style={{
                marginTop: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              <span>
                Showing {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, meta.total)} of{" "}
                {meta.total.toLocaleString()}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  className="dash-btn"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  onMouseEnter={() => prefetchPage(page - 2)}
                >
                  ← Prev
                </button>
                <button
                  className="dash-btn"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                  onMouseEnter={() => prefetchPage(page + 2)}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
