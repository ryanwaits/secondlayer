import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { EmptyState } from "@/components/console/empty-state";
import type { Stream, ViewSummary, AccountInsight } from "@/lib/types";
import { triageStreams, triageViews } from "@/lib/intelligence/dashboard";
import { InsightCard } from "@/components/console/intelligence/insight-card";
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

export default async function DashboardPage() {
  const session = await getSessionFromCookies();
  if (!session) {
    return (
      <>
        <div className="dash-page-header">
          <h1 className="dash-page-title">Dashboard</h1>
        </div>
        <EmptyState message="Sign in to view your dashboard." />
      </>
    );
  }

  let streams: Stream[] = [];
  let views: ViewSummary[] = [];
  let insights: AccountInsight[] = [];
  let chainTip: number | null = null;

  try {
    const data = await apiRequest<{ streams: Stream[]; total: number }>(
      "/api/streams?limit=100&offset=0",
      { sessionToken: session },
    );
    streams = data.streams;
  } catch {}

  try {
    const data = await apiRequest<{ data: ViewSummary[] }>("/api/views", {
      sessionToken: session,
    });
    views = data.data;
  } catch {}

  try {
    const data = await apiRequest<{ insights: AccountInsight[] }>(
      "/api/insights",
      { sessionToken: session },
    );
    insights = data.insights;
  } catch {}

  try {
    const status = await apiRequest<{ chainTip: number | null }>("/status", {
      sessionToken: session,
    });
    chainTip = status.chainTip;
  } catch {}

  const totalDeliveries = streams.reduce((sum, s) => sum + (s.totalDeliveries ?? 0), 0);
  const hasData = streams.length > 0 || views.length > 0;

  const { needsAttention: streamAttention, allGood } = triageStreams(streams);
  const viewAttention = triageViews(views, chainTip);
  const needsAttention = [...streamAttention, ...viewAttention];

  if (!hasData) {
    return (
      <>
        <div className="dash-page-header">
          <h1 className="dash-page-title">Dashboard</h1>
        </div>
        <EmptyState
          message="No streams or views yet."
          action={{ label: "Create a stream", href: "/streams/create" }}
        />
      </>
    );
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Dashboard</h1>
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{formatCount(streams.length)}</span>
          <span className="dash-stat-label">streams</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{formatCount(views.length)}</span>
          <span className="dash-stat-label">views</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{formatCount(totalDeliveries)}</span>
          <span className="dash-stat-label">deliveries</span>
        </div>
      </div>

      {insights.length > 0 && (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Insights</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} sessionToken={session} />
            ))}
          </div>
        </>
      )}

      {needsAttention.length > 0 && (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Needs attention</h2>
          </div>
          <div className="dash-activity-list">
            {needsAttention.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="dash-activity-item"
              >
                <span
                  className={`dash-activity-dot ${item.status === "failed" || item.status === "error" ? "red" : "yellow"}`}
                />
                <span className="dash-activity-name">{item.name}</span>
                <span className="dash-activity-time">{item.reason}</span>
                <span className="dash-activity-action">View</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {allGood.length > 0 && (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">All good</h2>
          </div>
          <div className="dash-activity-list">
            {allGood.map((stream) => (
              <Link
                key={stream.id}
                href={`/streams/${stream.id}`}
                className="dash-activity-item"
              >
                <span className="dash-activity-dot green" />
                <span className="dash-activity-name">{stream.name}</span>
                <span className="dash-activity-time">
                  {stream.totalDeliveries > 0
                    ? `${formatCount(stream.totalDeliveries)} deliveries, ${((((stream.totalDeliveries - stream.failedDeliveries) / stream.totalDeliveries) * 100)).toFixed(1)}% success`
                    : formatRelativeTime(stream.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
