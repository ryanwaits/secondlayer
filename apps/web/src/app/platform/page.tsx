import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { EmptyState } from "@/components/console/empty-state";
import type { Stream, SubgraphSummary } from "@/lib/types";
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

  const [streamsResult, subgraphsResult] = await Promise.allSettled([
    apiRequest<{ streams: Stream[]; total: number }>(
      "/api/streams?limit=100&offset=0",
      { sessionToken: session, tags: ["streams"] },
    ),
    apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
      sessionToken: session,
      tags: ["subgraphs"],
    }),
  ]);

  const streams = streamsResult.status === "fulfilled" ? streamsResult.value.streams : [];
  const subgraphs = subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];

  return (
    <DashboardContent
      streams={streams}
      subgraphs={subgraphs}
      sessionToken={session}
    />
  );
}
