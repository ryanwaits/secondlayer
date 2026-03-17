import { notFound } from "next/navigation";
import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import type { Stream } from "@/lib/types";
import { WebhookClient } from "./webhook-client";

export default async function StreamWebhookPage({
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

  return <WebhookClient stream={stream} />;
}
