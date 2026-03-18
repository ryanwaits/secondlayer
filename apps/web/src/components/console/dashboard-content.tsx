"use client";

import { useState, useCallback } from "react";
import type { Stream, SubgraphSummary } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { ActionDropdown } from "@/components/console/action-dropdown";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { DASHBOARD_BOTH_PROMPT } from "@/lib/agent-prompts";
import { queryKeys } from "@/lib/queries/keys";
import Link from "next/link";

function formatRelativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toString();
}

function deliveryRate(streams: Stream[]): string {
  const total = streams.reduce((s, st) => s + (st.totalDeliveries ?? 0), 0);
  const failed = streams.reduce((s, st) => s + (st.failedDeliveries ?? 0), 0);
  if (total === 0) return "\u2014";
  return `${(((total - failed) / total) * 100).toFixed(1)}%`;
}

export function DashboardContent({
  streams,
  subgraphs,
  sessionToken,
}: {
  streams: Stream[];
  subgraphs: SubgraphSummary[];
  sessionToken: string;
}) {
  const qc = useQueryClient();

  const prefetchStream = useCallback(
    (id: string) => {
      qc.prefetchQuery({
        queryKey: queryKeys.streams.detail(id),
        queryFn: () =>
          fetch(`/api/streams/${id}`, { credentials: "same-origin" }).then((r) => r.json()),
        staleTime: 30_000,
      });
    },
    [qc],
  );

  const prefetchSubgraph = useCallback(
    (name: string) => {
      qc.prefetchQuery({
        queryKey: queryKeys.subgraphs.detail(name),
        queryFn: () =>
          fetch(`/api/subgraphs/${name}`, { credentials: "same-origin" }).then((r) => r.json()),
        staleTime: 30_000,
      });
    },
    [qc],
  );

  const hasData = streams.length > 0 || subgraphs.length > 0;
  const totalDeliveries = streams.reduce((s, st) => s + (st.totalDeliveries ?? 0), 0);

  return (
    <>
      {/* Header */}
      <div className="dash-page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <h1 className="dash-page-title">Dashboard</h1>
        <ActionDropdown variant="dashboard" />
      </div>

      {/* Stats */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className={`dash-stat-value${streams.length === 0 ? " zero" : ""}`}>
            {formatCount(streams.length)}
          </span>
          <span className="dash-stat-label">streams</span>
        </div>
        <div className="dash-stat">
          <span className={`dash-stat-value${subgraphs.length === 0 ? " zero" : ""}`}>
            {formatCount(subgraphs.length)}
          </span>
          <span className="dash-stat-label">subgraphs</span>
        </div>
        <div className="dash-stat">
          <span className={`dash-stat-value${totalDeliveries === 0 ? " zero" : ""}`}>
            {totalDeliveries === 0 ? "\u2014" : deliveryRate(streams)}
          </span>
          <span className="dash-stat-label">delivery rate</span>
        </div>
        <div className="dash-stat">
          <span className={`dash-stat-value${totalDeliveries === 0 ? " zero" : ""}`}>
            {formatCount(totalDeliveries)}
          </span>
          <span className="dash-stat-label">deliveries</span>
        </div>
      </div>

      {/* Get started (empty) OR Insights (data) */}
      {!hasData ? (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Get started</h2>
          </div>

          <AgentPromptBlock
            title="Paste this into your agent to get started"
            code={DASHBOARD_BOTH_PROMPT}
          />
        </>
      ) : (
        <InsightsSection sessionToken={sessionToken} title="Insights" />
      )}

      {/* Streams */}
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Streams</h2>
      </div>
      {streams.length > 0 ? (
        <div className="dash-activity-list">
          {streams.map((stream) => (
            <Link
              key={stream.id}
              href={`/streams/${stream.id}`}
              className="dash-activity-item"
              onMouseEnter={() => prefetchStream(stream.id)}
            >
              <span
                className={`dash-activity-dot ${
                  stream.status === "failed" ? "red" :
                  stream.status === "paused" ? "yellow" :
                  stream.status === "inactive" ? "muted" : "green"
                }`}
              />
              <span className="dash-activity-name">{stream.name}</span>
              <span className="dash-activity-time">
                {stream.totalDeliveries > 0
                  ? `${formatCount(stream.totalDeliveries)} deliveries, ${(((stream.totalDeliveries - stream.failedDeliveries) / stream.totalDeliveries) * 100).toFixed(1)}% success`
                  : formatRelativeTime(stream.updatedAt)}
              </span>
              <span className={`dash-badge ${stream.status}`}>{stream.status}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="dash-section-empty">No streams</div>
      )}

      {/* Subgraphs */}
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Subgraphs</h2>
      </div>
      {subgraphs.length > 0 ? (
        <div className="dash-activity-list">
          {subgraphs.map((subgraph) => (
            <Link
              key={subgraph.name}
              href={`/subgraphs/${subgraph.name}`}
              className="dash-activity-item"
              onMouseEnter={() => prefetchSubgraph(subgraph.name)}
            >
              <span
                className={`dash-activity-dot ${
                  subgraph.status === "error" ? "red" :
                  subgraph.status === "syncing" ? "yellow" : "green"
                }`}
              />
              <span className="dash-activity-name">{subgraph.name}</span>
              <span className="dash-activity-time">
                {subgraph.lastProcessedBlock
                  ? `block ${subgraph.lastProcessedBlock.toLocaleString()} \u00b7 ${subgraph.tables.length} table${subgraph.tables.length !== 1 ? "s" : ""}`
                  : `${subgraph.tables.length} table${subgraph.tables.length !== 1 ? "s" : ""}`}
              </span>
              <span className={`dash-badge ${subgraph.status === "synced" ? "active" : subgraph.status}`}>{subgraph.status}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="dash-section-empty">No subgraphs</div>
      )}
    </>
  );
}
