"use client";

import { useQuery } from "@tanstack/react-query";
import type { AccountInsight } from "@/lib/types";
import { queryKeys } from "./keys";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

export function useInsights(opts?: {
  category?: string;
  resourceId?: string;
}) {
  const { category, resourceId } = opts ?? {};

  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (resourceId) params.set("resource_id", resourceId);
  const qs = params.toString();

  const queryKey = resourceId && category
    ? queryKeys.insights.byResource(category, resourceId)
    : category
      ? queryKeys.insights.byCategory(category)
      : queryKeys.insights.all;

  return useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<{ insights: AccountInsight[] }>(
        `/api/insights${qs ? `?${qs}` : ""}`,
      ).then((r) => r.insights),
    staleTime: 60_000,
  });
}
