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
const SYSTEM_COLS = ["_id", "_block_height", "_tx_id", "_created_at"];

function pickDisplayCols(allCols: string[]): string[] {
  // Show _id, _block_height, then up to 2 user columns
  const user = allCols.filter((c) => !SYSTEM_COLS.includes(c));
  return ["_id", "_block_height", ...user.slice(0, 2)];
}

function truncate(val: unknown, max = 32): string {
  if (val == null) return "";
  const s = typeof val === "object" ? JSON.stringify(val) : String(val);
  return s.length > max ? s.slice(0, max) + "..." : s;
}

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
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
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
  const allCols = rows.length > 0 ? Object.keys(rows[0]) : [];
  const displayCols = pickDisplayCols(allCols);

  // Collapse expanded row on page/table change
  useEffect(() => { setExpandedIdx(null); }, [page, activeTable]);

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
      <div className="tab-row">
        {tables.map((t) => (
          <button
            key={t}
            className={`tab-item${t === activeTable ? " active" : ""}`}
            onClick={() => handleTableSwitch(t)}
          >
            {t}
          </button>
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
                  {displayCols.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isExpanded = expandedIdx === i;
                  return (
                    <tbody key={i}>
                      <tr
                        className={isExpanded ? "selected" : ""}
                        style={{
                          opacity: isFetching ? 0.5 : 1,
                          transition: "opacity 150ms",
                          cursor: "pointer",
                        }}
                        onClick={() => setExpandedIdx(isExpanded ? null : i)}
                      >
                        {displayCols.map((col) => (
                          <td key={col}>{truncate(row[col])}</td>
                        ))}
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={displayCols.length} style={{ padding: 0 }}>
                            <div className="row-detail">
                              <pre>{JSON.stringify(row, null, 2)}</pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && (
            <div className="pagination">
              <span>
                Showing {page * PAGE_SIZE + 1}&ndash;
                {Math.min((page + 1) * PAGE_SIZE, meta.total)} of{" "}
                {meta.total.toLocaleString()}
              </span>
              <div className="pg-btns">
                <button
                  className="dash-btn"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  onMouseEnter={() => prefetchPage(page - 2)}
                >
                  &larr; Prev
                </button>
                <button
                  className="dash-btn"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                  onMouseEnter={() => prefetchPage(page + 2)}
                >
                  Next &rarr;
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
