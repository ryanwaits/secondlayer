"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Stream } from "@/lib/types";
import { queryKeys } from "./keys";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

// ── Queries ──

export function useStreams(initialData?: Stream[]) {
  return useQuery({
    queryKey: queryKeys.streams.all,
    queryFn: () =>
      fetchJson<{ streams: Stream[]; total: number }>("/api/streams?limit=100&offset=0")
        .then((r) => r.streams),
    initialData,
  });
}

export function useStream(id: string, initialData?: Stream) {
  return useQuery({
    queryKey: queryKeys.streams.detail(id),
    queryFn: () => fetchJson<Stream>(`/api/streams/${id}`),
    initialData,
  });
}

// ── Mutations ──

export function usePauseStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/streams/${id}/pause`, { method: "POST" }),
    onSuccess: (_data, id) => {
      // Optimistic: update cache immediately
      qc.setQueryData<Stream[]>(queryKeys.streams.all, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: "paused" } : s)),
      );
      qc.setQueryData<Stream>(queryKeys.streams.detail(id), (old) =>
        old ? { ...old, status: "paused" } : old,
      );
      qc.invalidateQueries({ queryKey: queryKeys.streams.all });
      qc.invalidateQueries({ queryKey: queryKeys.streams.detail(id) });
    },
  });
}

export function useResumeStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Stream["status"] }) => {
      const endpoint = status === "failed" || status === "inactive" ? "enable" : "resume";
      return fetchJson(`/api/streams/${id}/${endpoint}`, { method: "POST" });
    },
    onSuccess: (_data, { id }) => {
      qc.setQueryData<Stream[]>(queryKeys.streams.all, (old) =>
        old?.map((s) =>
          s.id === id ? { ...s, status: "active", enabled: true, errorMessage: null } : s,
        ),
      );
      qc.setQueryData<Stream>(queryKeys.streams.detail(id), (old) =>
        old ? { ...old, status: "active", enabled: true, errorMessage: null } : old,
      );
      qc.invalidateQueries({ queryKey: queryKeys.streams.all });
      qc.invalidateQueries({ queryKey: queryKeys.streams.detail(id) });
    },
  });
}

export function useDisableStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "enable" | "disable" }) =>
      fetchJson(`/api/streams/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, { id, action }) => {
      const newStatus = action === "disable" ? "inactive" : "active";
      const enabled = action === "enable";
      qc.setQueryData<Stream[]>(queryKeys.streams.all, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: newStatus, enabled } : s)),
      );
      qc.setQueryData<Stream>(queryKeys.streams.detail(id), (old) =>
        old ? { ...old, status: newStatus, enabled } : old,
      );
      qc.invalidateQueries({ queryKey: queryKeys.streams.all });
      qc.invalidateQueries({ queryKey: queryKeys.streams.detail(id) });
    },
  });
}

export function useDeleteStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/streams/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      qc.setQueryData<Stream[]>(queryKeys.streams.all, (old) =>
        old?.filter((s) => s.id !== id),
      );
      qc.removeQueries({ queryKey: queryKeys.streams.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.streams.all });
    },
  });
}

export function useReplayFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/streams/${id}/replay-failed`, { method: "POST" }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.streams.detail(id) });
    },
  });
}
