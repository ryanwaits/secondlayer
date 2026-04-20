"use client";

import type { Project, TeamMember, TeamInvitation } from "@/lib/types";
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

export function useTeamMembers(projectSlug: string) {
	return useQuery({
		queryKey: queryKeys.projects.team(projectSlug),
		queryFn: () =>
			fetchJson<{ members: TeamMember[]; invitations: TeamInvitation[] }>(
				`/api/projects/${projectSlug}/team`,
			),
		staleTime: 60_000,
		enabled: !!projectSlug,
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

export function useDeleteProject() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (slug: string) =>
			fetchJson(`/api/projects/${slug}`, { method: "DELETE" }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useInviteTeamMember() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			projectSlug,
			email,
			role,
		}: { projectSlug: string; email: string; role?: string }) =>
			fetchJson(`/api/projects/${projectSlug}/team`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, role }),
			}),
		onSuccess: (_, vars) => {
			qc.invalidateQueries({
				queryKey: queryKeys.projects.team(vars.projectSlug),
			});
		},
	});
}
