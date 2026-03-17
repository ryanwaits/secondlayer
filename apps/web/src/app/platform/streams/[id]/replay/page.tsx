import { notFound } from "next/navigation";
import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import type { Stream } from "@/lib/types";
import { ReplayClient } from "./replay-client";
import { StreamTabs } from "../stream-tabs";

export default async function StreamReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionFromCookies();
  if (!session) notFound();

  const { id } = await params;

  let stream: Stream;
  try {
    stream = await apiRequest<Stream>(`/api/streams/${id}`, {
      sessionToken: session,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">{stream.name}</h1>
      </div>
      <StreamTabs streamId={id} />
      <ReplayClient stream={stream} />
    </>
  );
}
