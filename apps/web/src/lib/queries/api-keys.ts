"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiKey } from "@/lib/types";
import { queryKeys } from "./keys";
import { fetchJson } from "./fetch";

export function useApiKeys(initialData?: ApiKey[]) {
  return useQuery({
    queryKey: queryKeys.keys.all,
    queryFn: () =>
      fetchJson<{ keys: ApiKey[] }>("/api/keys").then((r) => r.keys),
    initialData,
    staleTime: 60_000,
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
