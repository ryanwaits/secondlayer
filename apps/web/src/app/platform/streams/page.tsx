import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import { EmptyState } from "@/components/console/empty-state";
import type { Stream } from "@/lib/types";
import { StreamsList } from "./streams-list";

export default async function StreamsPage() {
  const session = await getSessionFromCookies();
  if (!session) {
    return (
      <>
        <div className="dash-page-header">
          <h1 className="dash-page-title">Streams</h1>
        </div>
        <EmptyState message="Sign in to view streams." />
      </>
    );
  }

  let streams: Stream[] = [];

  try {
    const data = await apiRequest<{ streams: Stream[]; total: number }>(
      "/api/streams?limit=100&offset=0",
      { sessionToken: session },
    );
    streams = data.streams;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return (
        <>
          <div className="dash-page-header">
            <h1 className="dash-page-title">Streams</h1>
          </div>
          <EmptyState message="Session expired. Please sign in again." />
        </>
      );
    }
    // Don't throw on other errors — show empty state
  }

  return <StreamsList initialStreams={streams} />;
}
