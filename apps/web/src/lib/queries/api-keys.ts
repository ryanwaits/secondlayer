"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiKey } from "@/lib/types";
import { queryKeys } from "./keys";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

export function useApiKeys(initialData?: ApiKey[]) {
  return useQuery({
    queryKey: queryKeys.keys.all,
    queryFn: () =>
      fetchJson<{ keys: ApiKey[] }>("/api/keys").then((r) => r.keys),
    initialData,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) =>
      fetchJson<{ key: string; id: string; prefix: string; createdAt: string }>(
        "/api/keys",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name || undefined }),
        },
      ),
    onSuccess: (data, name) => {
      const newKey: ApiKey = {
        id: data.id,
        prefix: data.prefix,
        name: name || "",
        status: "active",
        createdAt: data.createdAt,
        lastUsedAt: null,
      };
      qc.setQueryData<ApiKey[]>(queryKeys.keys.all, (old) =>
        old ? [newKey, ...old] : [newKey],
      );
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
    },
  });
}
