"use client";

import { OverviewTopbar } from "@/components/console/overview-topbar";
import { useAuth } from "@/lib/auth";
import {
	useDeleteProject,
	useProjects,
	useUpdateProject,
} from "@/lib/queries/projects";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoutButton } from "./logout-button";

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	apiUrl: string;
	trialEndsAt: string;
}

/**
 * Project-level settings. In the dedicated-hosting model every project maps
 * 1:1 to a tenant instance — the Stacks network + node RPC are set at the
 * platform level (not per-project), so we no longer surface them here.
 * Network/nodeRpc columns remain on `projects` for historical compat but
 * aren't user-editable from the dashboard.
 */
export default function SettingsPage() {
	const { account } = useAuth();
	const { data: projects } = useProjects();
	const updateProject = useUpdateProject();
	const deleteProject = useDeleteProject();

	const project = projects?.[0];

	const [name, setName] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [saveStatus, setSaveStatus] = useState<
		"idle" | "saving" | "saved" | "error"
	>("idle");

	const [tenant, setTenant] = useState<TenantSummary | null>(null);
	const [tenantLoading, setTenantLoading] = useState(true);

	// Hydrate form from project data once loaded
	if (project && !initialized) {
		setName(project.name);
		setInitialized(true);
	}

	useEffect(() => {
		const run = async () => {
			try {
				const res = await fetch("/api/tenants/me");
				if (res.ok) {
					const data = (await res.json()) as { tenant: TenantSummary | null };
					setTenant(data.tenant);
				}
			} catch {
				// 404 = no tenant — treat as "not provisioned"
			} finally {
				setTenantLoading(false);
			}
		};
		run();
	}, []);

	const handleSave = useCallback(async () => {
		if (!project) return;
		setSaveStatus("saving");
		try {
			await updateProject.mutateAsync({
				slug: project.slug,
				data: { name },
			});
			setSaveStatus("saved");
			setTimeout(() => setSaveStatus("idle"), 2000);
		} catch {
			setSaveStatus("error");
		}
	}, [project, name, updateProject]);

	const handleDelete = useCallback(async () => {
		if (!project) return;
		const warning = tenant
			? `Delete project "${project.slug}"? Your instance (${tenant.slug}) will stay running and unlinked. Go to the Instance page to tear it down separately.`
			: `Delete project "${project.slug}"? This cannot be undone.`;
		if (!confirm(warning)) return;
		try {
			await deleteProject.mutateAsync(project.slug);
			window.location.href = "/";
		} catch (e) {
			alert(e instanceof Error ? e.message : "Failed to delete project");
		}
	}, [project, tenant, deleteProject]);

	const trialDaysLeft = tenant
		? Math.max(
				0,
				Math.ceil(
					(new Date(tenant.trialEndsAt).getTime() - Date.now()) /
						(24 * 3600 * 1000),
				),
			)
		: 0;

	return (
		<>
			<OverviewTopbar path="Settings" page="Project" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Project settings</h1>
					<p className="settings-desc">
						Manage your project identity, instance, and account.
					</p>

					<div className="settings-section">
						<div className="settings-section-title">General</div>
						<div className="settings-field">
							<label className="settings-label">
								Project name
								<input
									type="text"
									className="settings-input"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</label>
						</div>
						<div className="settings-field">
							<label className="settings-label">
								Slug
								<input
									type="text"
									className="settings-input mono"
									value={project?.slug ?? ""}
									disabled
								/>
							</label>
							<div className="settings-hint">
								Used by <code>sl project use &lt;slug&gt;</code>. Cannot be
								changed after creation.
							</div>
						</div>
						<div className="settings-field">
							<label className="settings-label">
								Email
								<input
									type="text"
									className="settings-input"
									value={account?.email ?? ""}
									disabled
								/>
							</label>
						</div>
						<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
							<button
								type="button"
								className="settings-btn primary"
								onClick={handleSave}
								disabled={
									saveStatus === "saving" || !project || name === project?.name
								}
							>
								{saveStatus === "saving"
									? "Saving..."
									: saveStatus === "saved"
										? "Saved"
										: "Save changes"}
							</button>
							{saveStatus === "error" && (
								<span style={{ fontSize: 12, color: "var(--red)" }}>
									Failed to save
								</span>
							)}
						</div>
					</div>

					<div className="settings-section">
						<div className="settings-section-title">Instance</div>
						{tenantLoading ? (
							<div className="instance-gauge-empty">
								<span className="pulse" />
								Loading…
							</div>
						) : tenant ? (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "12px 14px",
									border: "1px solid var(--border)",
									borderRadius: 8,
								}}
							>
								<div>
									<div style={{ fontSize: 13, fontWeight: 500 }}>
										<span className="mono">{tenant.slug}</span> ·{" "}
										{capitalize(tenant.plan)} · {tenant.status}
									</div>
									<div
										style={{
											fontSize: 12,
											color: "var(--text-muted)",
											marginTop: 2,
										}}
									>
										{tenant.apiUrl}
										{tenant.status === "active" &&
											` · Trial: ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`}
									</div>
								</div>
								<Link className="settings-btn ghost small" href="/instance">
									Manage →
								</Link>
							</div>
						) : (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "12px 14px",
									border: "1px solid var(--border)",
									borderRadius: 8,
								}}
							>
								<div>
									<div style={{ fontSize: 13, fontWeight: 500 }}>
										No instance
									</div>
									<div
										style={{
											fontSize: 12,
											color: "var(--text-muted)",
											marginTop: 2,
										}}
									>
										Provision a dedicated Postgres + API + processor.
									</div>
								</div>
								<Link className="settings-btn primary small" href="/instance">
									Create instance →
								</Link>
							</div>
						)}
					</div>

					<div className="settings-section">
						<div className="settings-section-title">Account</div>
						{account && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "12px 14px",
									border: "1px solid var(--border)",
									borderRadius: 8,
									marginBottom: 12,
								}}
							>
								<div>
									<div style={{ fontSize: 13, fontWeight: 500 }}>Plan</div>
									<div
										style={{
											fontSize: 12,
											color: "var(--text-muted)",
											marginTop: 2,
										}}
									>
										{account.plan} · Member since{" "}
										{new Date(account.createdAt).toLocaleDateString()}
									</div>
								</div>
							</div>
						)}
						<LogoutButton />
					</div>

					<div className="settings-divider" />

					<div className="settings-section">
						<div className="settings-section-title">Danger zone</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "12px 14px",
								border: "1px solid var(--border)",
								borderRadius: 8,
							}}
						>
							<div>
								<div style={{ fontSize: 13, fontWeight: 500 }}>
									Delete project
								</div>
								<div
									style={{
										fontSize: 12,
										color: "var(--text-muted)",
										marginTop: 2,
									}}
								>
									{tenant
										? "Removes the project record. The instance keeps running — delete it separately from the Instance page."
										: "Permanently remove this project. Cannot be undone."}
								</div>
							</div>
							<button
								type="button"
								className="settings-btn danger"
								onClick={handleDelete}
							>
								Delete project
							</button>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
