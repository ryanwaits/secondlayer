"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Stream, Delivery } from "@/lib/types";
import { useBreadcrumbOverrides } from "@/lib/breadcrumb";
import { queryKeys } from "@/lib/queries/keys";
import { relativeTime } from "@/lib/format";

const PAGE_SIZE = 10;

async function fetchDeliveries(
  streamId: string,
  page: number,
): Promise<Delivery[]> {
  const res = await fetch(
    `/api/streams/${streamId}/deliveries?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw new Error("Failed to fetch deliveries");
  const data = await res.json();
  return data.deliveries;
}

function DeliveryPayload({ streamId, deliveryId }: { streamId: string; deliveryId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["delivery", deliveryId],
    queryFn: async () => {
      const res = await fetch(
        `/api/streams/${streamId}/deliveries/${deliveryId}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error("Failed to fetch delivery");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={4} style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: 12 }}>
          Loading payload…
        </td>
      </tr>
    );
  }

  if (isError || !data?.payload) {
    return (
      <tr>
        <td colSpan={4} style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: 12 }}>
          Failed to load payload.
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={4} style={{ padding: 0 }}>
        <pre className="dash-code-block" style={{ margin: "0 16px 12px", fontSize: 11, maxHeight: 300, overflow: "auto" }}>
          {JSON.stringify(data.payload, null, 2)}
        </pre>
      </td>
    </tr>
  );
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

  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const qc = useQueryClient();
  const totalPages = Math.max(1, Math.ceil(stream.totalDeliveries / PAGE_SIZE));

  // Seed page 0 into the cache from server data
  useEffect(() => {
    if (initialDeliveries.length > 0) {
      qc.setQueryData(
        queryKeys.streams.deliveriesPage(stream.id, 0),
        initialDeliveries,
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: deliveries = [], isFetching, isError } = useQuery({
    queryKey: queryKeys.streams.deliveriesPage(stream.id, page),
    queryFn: () => fetchDeliveries(stream.id, page),
    staleTime: 30_000,
  });

  // Prefetch next page
  useEffect(() => {
    if (page < totalPages - 1) {
      qc.prefetchQuery({
        queryKey: queryKeys.streams.deliveriesPage(stream.id, page + 1),
        queryFn: () => fetchDeliveries(stream.id, page + 1),
        staleTime: 30_000,
      });
    }
  }, [page, stream.id, totalPages, qc]);

  const prefetchPage = useCallback((p: number) => {
    if (p >= 0 && p < totalPages) {
      qc.prefetchQuery({
        queryKey: queryKeys.streams.deliveriesPage(stream.id, p),
        queryFn: () => fetchDeliveries(stream.id, p),
        staleTime: 30_000,
      });
    }
  }, [stream.id, totalPages, qc]);

  // Prefetch delivery payload on hover
  const prefetchPayload = useCallback((deliveryId: string) => {
    qc.prefetchQuery({
      queryKey: ["delivery", deliveryId],
      queryFn: () =>
        fetch(`/api/streams/${stream.id}/deliveries/${deliveryId}`, { credentials: "same-origin" })
          .then((r) => r.json()),
      staleTime: 60_000,
    });
  }, [stream.id, qc]);

  // Collapse expanded row on page change
  useEffect(() => {
    setExpandedId(null);
  }, [page]);

  return (
    <>
      {isError ? (
        <div className="dash-empty">Failed to load deliveries. Try refreshing.</div>
      ) : deliveries.length === 0 && !isFetching ? (
        <div className="dash-empty">No deliveries yet</div>
      ) : (
        <>
          <div className="dash-data-table-wrap">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Status</th>
                  <th>Response</th>
                  <th>Time</th>
                </tr>
              </thead>
              {deliveries.map((d) => {
                const isOk = d.statusCode >= 200 && d.statusCode < 300;
                const isExpanded = expandedId === d.id;
                return (
                  <tbody key={d.id}>
                    <tr
                      style={{ opacity: isFetching ? 0.5 : 1, transition: "opacity 150ms", cursor: "pointer" }}
                      className={isExpanded ? "selected" : ""}
                      onClick={() => setExpandedId(isExpanded ? null : d.id)}
                      onMouseEnter={() => prefetchPayload(d.id)}
                    >
                      <td>#{d.blockHeight.toLocaleString()}</td>
                      <td>
                        <span className={`dash-badge ${isOk ? "active" : "failed"}`}>
                          {d.statusCode}
                        </span>
                      </td>
                      <td className="muted">
                        {d.statusCode >= 500 ? "timeout" : `${d.responseTimeMs}ms`}
                      </td>
                      <td className="muted">{relativeTime(d.createdAt)}</td>
                    </tr>
                    {isExpanded && (
                      <DeliveryPayload streamId={stream.id} deliveryId={d.id} />
                    )}
                  </tbody>
                );
              })}
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
        </>
      )}
    </>
  );
}
