import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { EmptyState } from "@/components/console/empty-state";
import type { Stream, ViewSummary, AccountInsight } from "@/lib/types";
import { DashboardContent } from "@/components/console/dashboard-content";

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

  return (
    <DashboardContent
      streams={streams}
      views={views}
      insights={insights}
      sessionToken={session}
    />
  );
}
