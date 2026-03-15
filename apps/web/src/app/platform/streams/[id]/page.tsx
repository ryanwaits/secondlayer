import { notFound } from "next/navigation";
import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import type { Stream, Delivery, AccountInsight } from "@/lib/types";
import { StreamDetailClient } from "./stream-detail-client";

export default async function StreamOverviewPage({
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

  let deliveries: Delivery[] = [];
  try {
    const data = await apiRequest<{ deliveries: Delivery[] }>(
      `/api/streams/${id}/deliveries?limit=25&offset=0`,
      { sessionToken: session },
    );
    deliveries = data.deliveries;
  } catch {}

  let insights: AccountInsight[] = [];
  try {
    const data = await apiRequest<{ insights: AccountInsight[] }>(
      `/api/insights?resource_id=${id}&category=stream`,
      { sessionToken: session },
    );
    insights = data.insights;
  } catch {}

  return <StreamDetailClient stream={stream} deliveries={deliveries} insights={insights} sessionToken={session} />;
}
