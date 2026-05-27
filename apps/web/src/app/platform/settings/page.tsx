"use client";

import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { useAuth } from "@/lib/auth";
import {
	useDeleteProject,
	useProjects,
	useUpdateProject,
} from "@/lib/queries/projects";
import { useCallback, useState } from "react";
import { LogoutButton } from "./logout-button";

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

	// Hydrate form from project data once loaded
	if (project && !initialized) {
		setName(project.name);
		setInitialized(true);
	}

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
		if (!confirm(`Delete project "${project.slug}"? This cannot be undone.`))
			return;
		try {
			await deleteProject.mutateAsync(project.slug);
			window.location.href = "/";
		} catch (e) {
			alert(e instanceof Error ? e.message : "Failed to delete project");
		}
	}, [project, deleteProject]);

	return (
		<>
			<OverviewTopbar
				path={<SettingsCrumb />}
				page="Project"
				showRefresh={false}
			/>
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
						<div className="settings-section-title">Account</div>
						{account && (
							<div
								style={{
									fontSize: 12,
									color: "var(--text-muted)",
									marginBottom: 12,
								}}
							>
								Member since {new Date(account.createdAt).toLocaleDateString()}.
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
									Permanently remove this project. Cannot be undone.
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
