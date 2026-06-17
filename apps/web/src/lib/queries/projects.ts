"use client";

import type { Project } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "./fetch";
import { queryKeys } from "./keys";

export function useProjects() {
	return useQuery({
		queryKey: queryKeys.projects.all,
		queryFn: () =>
			fetchJson<{ projects: Project[] }>("/api/projects").then(
				(r) => r.projects,
			),
		staleTime: 60_000,
	});
}

export function useProject(slug: string) {
	return useQuery({
		queryKey: queryKeys.projects.detail(slug),
		queryFn: () => fetchJson<Project>(`/api/projects/${slug}`),
		staleTime: 60_000,
		enabled: !!slug,
	});
}

export function useUpdateProject() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, data }: { slug: string; data: Partial<Project> }) =>
			fetchJson<Project>(`/api/projects/${slug}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
