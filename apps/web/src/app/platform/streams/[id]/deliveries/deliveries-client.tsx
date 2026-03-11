"use client";

import { useState, useCallback, useEffect } from "react";
import type { Stream, Delivery } from "@/lib/types";
import { useBreadcrumbOverrides } from "@/lib/breadcrumb";

const PAGE_SIZE = 20;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function DeliveriesClient({
  stream,
  initialDeliveries,
}: {
  stream: Stream;
  initialDeliveries: Delivery[];
}) {
  const { set: setBreadcrumb } = useBreadcrumbOverrides();
  useEffect(() => {
    setBreadcrumb(`/streams/${stream.id}`, stream.name);
  }, [stream.id, stream.name, setBreadcrumb]);

  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(stream.totalDeliveries / PAGE_SIZE));

  const goToPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/streams/${stream.id}/deliveries?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`,
      );
      if (res.ok) {
        const data = await res.json();
        setDeliveries(data.deliveries);
        setPage(p);
      }
    } finally {
      setLoading(false);
    }
  }, [stream.id]);

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Deliveries</h1>
        <p className="dash-page-desc">
          {stream.totalDeliveries.toLocaleString()} total &mdash;{" "}
          {stream.failedDeliveries.toLocaleString()} failed
        </p>
      </div>

      {deliveries.length === 0 ? (
        <div className="dash-empty">No deliveries yet</div>
      ) : (
        <>
          <div className="dash-data-table-wrap">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Status</th>
                  <th>Txs</th>
                  <th>Events</th>
                  <th>Response</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const isOk = d.statusCode >= 200 && d.statusCode < 300;
                  return (
                    <tr key={d.id}>
                      <td>#{d.blockHeight.toLocaleString()}</td>
                      <td>
                        <span className={`dash-badge ${isOk ? "active" : "failed"}`}>
                          {d.statusCode}
                        </span>
                      </td>
                      <td className="muted">&mdash;</td>
                      <td className="muted">&mdash;</td>
                      <td className="muted">
                        {d.statusCode >= 500 ? "timeout" : `${d.responseTimeMs}ms`}
                      </td>
                      <td className="muted">{relativeTime(d.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, stream.totalDeliveries)} of {stream.totalDeliveries.toLocaleString()}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className="dash-btn"
                style={{ padding: "4px 10px", fontSize: 12 }}
                disabled={page === 0 || loading}
                onClick={() => goToPage(page - 1)}
              >
                ← Prev
              </button>
              <button
                className="dash-btn"
                style={{ padding: "4px 10px", fontSize: 12 }}
                disabled={page >= totalPages - 1 || loading}
                onClick={() => goToPage(page + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
