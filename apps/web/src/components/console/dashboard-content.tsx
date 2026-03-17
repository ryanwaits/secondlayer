"use client";

import { useState } from "react";
import type { Stream, ViewSummary, AccountInsight } from "@/lib/types";
import { usePreferences } from "@/lib/preferences";
import { ActionDropdown } from "@/components/console/action-dropdown";
import { InsightCard } from "@/components/console/intelligence/insight-card";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { ManualSteps } from "@/components/console/manual-steps";
import {
  DASHBOARD_BOTH_PROMPT,
  DASHBOARD_STREAMS_PROMPT,
  DASHBOARD_VIEWS_PROMPT,
} from "@/lib/agent-prompts";
import Link from "next/link";

type Mode = "agent" | "manual";

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

function agentPrompt(streams: boolean, views: boolean) {
  if (streams && views) return DASHBOARD_BOTH_PROMPT;
  if (streams) return DASHBOARD_STREAMS_PROMPT;
  return DASHBOARD_VIEWS_PROMPT;
}

function deliveryRate(streams: Stream[]): string {
  const total = streams.reduce((s, st) => s + (st.totalDeliveries ?? 0), 0);
  const failed = streams.reduce((s, st) => s + (st.failedDeliveries ?? 0), 0);
  if (total === 0) return "—";
  return `${(((total - failed) / total) * 100).toFixed(1)}%`;
}

export function DashboardContent({
  streams,
  views,
  insights,
  sessionToken,
}: {
  streams: Stream[];
  views: ViewSummary[];
  insights: AccountInsight[];
  sessionToken: string;
}) {
  const { preferences } = usePreferences();
  const { streams: streamsEnabled, views: viewsEnabled } = preferences.products;
  const [mode, setMode] = useState<Mode>("agent");

  const hasData = streams.length > 0 || views.length > 0;
  const totalDeliveries = streams.reduce((s, st) => s + (st.totalDeliveries ?? 0), 0);

  // No products enabled at all
  if (!streamsEnabled && !viewsEnabled) {
    return (
      <>
        <div className="dash-page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <h1 className="dash-page-title">Dashboard</h1>
        </div>
        <div className="empty-msg">
          No products enabled.{" "}
          <Link href="/platform/settings">Enable products in Settings</Link>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="dash-page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <h1 className="dash-page-title">Dashboard</h1>
        <ActionDropdown variant="dashboard" />
      </div>

      {/* Stats */}
      <div className="dash-stats">
        {streamsEnabled && (
          <div className="dash-stat">
            <span className={`dash-stat-value${streams.length === 0 ? " zero" : ""}`}>
              {formatCount(streams.length)}
            </span>
            <span className="dash-stat-label">streams</span>
          </div>
        )}
        {viewsEnabled && (
          <div className="dash-stat">
            <span className={`dash-stat-value${views.length === 0 ? " zero" : ""}`}>
              {formatCount(views.length)}
            </span>
            <span className="dash-stat-label">views</span>
          </div>
        )}
        {streamsEnabled && (
          <>
            <div className="dash-stat">
              <span className={`dash-stat-value${totalDeliveries === 0 ? " zero" : ""}`}>
                {totalDeliveries === 0 ? "—" : deliveryRate(streams)}
              </span>
              <span className="dash-stat-label">delivery rate</span>
            </div>
            <div className="dash-stat">
              <span className={`dash-stat-value${totalDeliveries === 0 ? " zero" : ""}`}>
                {formatCount(totalDeliveries)}
              </span>
              <span className="dash-stat-label">deliveries</span>
            </div>
          </>
        )}
      </div>

      {/* Get started (empty) OR Insights (data) */}
      {!hasData ? (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Get started</h2>
          </div>

          <div className="mode-tabs">
            <button
              className={`mode-tab${mode === "agent" ? " active" : ""}`}
              onClick={() => setMode("agent")}
            >
              Agent
            </button>
            <button
              className={`mode-tab${mode === "manual" ? " active" : ""}`}
              onClick={() => setMode("manual")}
            >
              Manual
            </button>
          </div>

          {mode === "agent" ? (
            <AgentPromptBlock
              title="Paste this into your agent to get started"
              code={agentPrompt(streamsEnabled, viewsEnabled)}
            />
          ) : (
            <ManualSteps streams={streamsEnabled} views={viewsEnabled} />
          )}
        </>
      ) : insights.length > 0 ? (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Insights</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} sessionToken={sessionToken} />
            ))}
          </div>
        </>
      ) : null}

      {/* Streams */}
      {streamsEnabled && (
        <>
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
                >
                  <span
                    className={`dash-activity-dot ${
                      stream.status === "failed" ? "red" :
                      stream.status === "paused" ? "yellow" : "green"
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
        </>
      )}

      {/* Views */}
      {viewsEnabled && (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Views</h2>
          </div>
          {views.length > 0 ? (
            <div className="dash-activity-list">
              {views.map((view) => (
                <Link
                  key={view.name}
                  href={`/views/${view.name}`}
                  className="dash-activity-item"
                >
                  <span
                    className={`dash-activity-dot ${
                      view.status === "error" ? "red" :
                      view.status === "syncing" ? "yellow" : "green"
                    }`}
                  />
                  <span className="dash-activity-name">{view.name}</span>
                  <span className="dash-activity-time">
                    {view.lastProcessedBlock
                      ? `block ${view.lastProcessedBlock.toLocaleString()} · ${view.tables.length} table${view.tables.length !== 1 ? "s" : ""}`
                      : `${view.tables.length} table${view.tables.length !== 1 ? "s" : ""}`}
                  </span>
                  <span className={`dash-badge ${view.status === "synced" ? "active" : view.status}`}>{view.status}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="dash-section-empty">No views</div>
          )}
        </>
      )}
    </>
  );
}
