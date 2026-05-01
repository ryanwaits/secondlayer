"use client";

import { OverviewTopbar } from "@/components/console/overview-topbar";
import {
	useInviteTeamMember,
	useProjects,
	useTeamMembers,
} from "@/lib/queries/projects";
import { useCallback, useState } from "react";

export default function TeamPage() {
	const { data: projects } = useProjects();
	const projectSlug = projects?.[0]?.slug ?? "";
	const { data: teamData } = useTeamMembers(projectSlug);
	const inviteMember = useInviteTeamMember();

	const [showInvite, setShowInvite] = useState(false);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState("member");

	const handleInvite = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!email || !projectSlug) return;
			try {
				await inviteMember.mutateAsync({ projectSlug, email, role });
				setEmail("");
				setShowInvite(false);
			} catch {}
		},
		[email, role, projectSlug, inviteMember],
	);

	const members = teamData?.members ?? [];
	const invitations = teamData?.invitations ?? [];

	return (
		<>
			<OverviewTopbar path="Settings" page="Team" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Team</h1>
					<p className="settings-desc">
						Manage who has access to this project and their roles.
					</p>

					{!showInvite && (
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								marginBottom: 16,
							}}
						>
							<button
								type="button"
								className="settings-btn primary"
								style={{ display: "flex", alignItems: "center", gap: 5 }}
								onClick={() => setShowInvite(true)}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 12 12"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M6 2v8M2 6h8" />
								</svg>
								Invite member
							</button>
						</div>
					)}

					{showInvite && (
						<div
							style={{
								padding: "14px 16px",
								border: "1px solid var(--border)",
								borderRadius: 8,
								marginBottom: 16,
							}}
						>
							<form
								onSubmit={handleInvite}
								style={{ display: "flex", alignItems: "flex-end", gap: 10 }}
							>
								<label style={{ flex: 1 }}>
									<span className="settings-label">Email</span>
									<input
										className="settings-input"
										type="email"
										placeholder="team@example.com"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										autoFocus
									/>
								</label>
								<label>
									<span className="settings-label">Role</span>
									<select
										className="settings-input"
										value={role}
										onChange={(e) => setRole(e.target.value)}
										style={{ width: 120 }}
									>
										<option value="member">Member</option>
										<option value="admin">Admin</option>
									</select>
								</label>
								<button
									type="submit"
									className="settings-btn primary"
									disabled={inviteMember.isPending}
								>
									{inviteMember.isPending ? "..." : "Invite"}
								</button>
								<button
									type="button"
									className="settings-btn ghost"
									onClick={() => {
										setShowInvite(false);
										setEmail("");
									}}
								>
									Cancel
								</button>
							</form>
						</div>
					)}

					<div className="settings-section">
						{members.length === 0 ? (
							<div className="ov-empty">No team members found.</div>
						) : (
							members.map((m) => {
								const initial = (m.displayName ||
									m.email ||
									"U")[0].toUpperCase();
								return (
									<div key={m.id} className="member-row">
										<div className="member-avatar">{initial}</div>
										<div className="member-info">
											<div className="member-name">
												{m.displayName || m.email}
											</div>
											<div className="member-email">{m.email}</div>
										</div>
										<div
											className={`member-role${m.role === "owner" ? " owner" : ""}`}
										>
											{m.role}
										</div>
									</div>
								);
							})
						)}
					</div>

					<div className="settings-divider" />

					<div className="settings-section">
						<div className="settings-section-title">Pending invitations</div>
						{invitations.length === 0 ? (
							<div className="ov-empty">No pending invitations.</div>
						) : (
							invitations.map((inv) => (
								<div key={inv.id} className="member-row">
									<div className="member-avatar">?</div>
									<div className="member-info">
										<div className="member-name">{inv.email}</div>
										<div className="member-email">
											Expires {new Date(inv.expiresAt).toLocaleDateString()}
										</div>
									</div>
									<div className="member-role">{inv.role}</div>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</>
	);
}
