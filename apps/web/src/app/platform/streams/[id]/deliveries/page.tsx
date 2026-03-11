import { notFound } from "next/navigation";
import { apiRequest, getSessionFromCookies, ApiError } from "@/lib/api";
import type { Stream, Delivery } from "@/lib/types";
import { DeliveriesClient } from "./deliveries-client";

export default async function StreamDeliveriesPage({
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
      `/api/streams/${id}/deliveries?limit=20&offset=0`,
      { sessionToken: session },
    );
    deliveries = data.deliveries;
  } catch {}

  return (
    <DeliveriesClient
      stream={stream}
      initialDeliveries={deliveries}
    />
  );
}
