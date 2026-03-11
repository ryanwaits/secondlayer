import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import { EmptyState } from "@/components/console/empty-state";
import type { Stream } from "@/lib/types";
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
  let viewCount = 0;

  try {
    const data = await apiRequest<{ streams: Stream[]; total: number }>(
      "/api/streams?limit=100&offset=0",
      { sessionToken: session },
    );
    streams = data.streams;
  } catch {}

  try {
    const data = await apiRequest<{ views: unknown[]; total: number }>(
      "/api/views?limit=1&offset=0",
      { sessionToken: session },
    );
    viewCount = Number(data.total) || 0;
  } catch {}

  const totalDeliveries = streams.reduce((sum, s) => sum + (s.totalDeliveries ?? 0), 0);
  const hasData = streams.length > 0 || viewCount > 0;

  // Recent activity: streams sorted by most recent activity (lastTriggeredAt or updatedAt)
  const recentActivity = [...streams]
    .sort((a, b) => {
      const aTime = a.lastTriggeredAt || a.updatedAt;
      const bTime = b.lastTriggeredAt || b.updatedAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    })
    .slice(0, 5);

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
          <span className="dash-stat-value">{formatCount(viewCount)}</span>
          <span className="dash-stat-label">views</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{formatCount(totalDeliveries)}</span>
          <span className="dash-stat-label">deliveries</span>
        </div>
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Recent activity</h2>
      </div>

      <div className="dash-activity-list">
        {recentActivity.map((stream) => (
          <Link
            key={stream.id}
            href={`/streams/${stream.id}`}
            className="dash-activity-item"
          >
            <span
              className={`dash-activity-dot ${stream.status === "active" ? "green" : stream.status === "failed" ? "red" : "muted"}`}
            />
            <span className="dash-activity-name">{stream.name}</span>
            <span className="dash-activity-time">
              {formatRelativeTime(stream.lastTriggeredAt || stream.updatedAt)}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
