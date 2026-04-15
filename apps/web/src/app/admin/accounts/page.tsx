"use client";

import { useAdminAccounts } from "@/lib/queries/admin";
import Link from "next/link";

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatRelative(dateStr: string | null): string {
	if (!dateStr) return "never";
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return days === 1 ? "yesterday" : `${days}d ago`;
	return formatDate(dateStr);
}

const TH_STYLE: React.CSSProperties = {
	padding: "8px 12px",
	textAlign: "left",
	fontFamily: "var(--font-mono-stack)",
	fontSize: 10,
	fontWeight: 600,
	letterSpacing: "0.04em",
	textTransform: "uppercase",
	color: "var(--text-muted)",
};

export default function AccountsPage() {
	const { data: accounts, isLoading } = useAdminAccounts();

	return (
		<div style={{ flex: 1, overflowY: "auto" }}>
			<div className="overview-inner">
				<div style={{ marginBottom: 24 }}>
					<Link
						href="/admin"
						className="dash-hint"
						style={{ textDecoration: "none" }}
					>
						&larr; Admin
					</Link>
					<div className="dash-page-title" style={{ marginTop: 8 }}>
						Accounts
					</div>
					{accounts && (
						<div className="dash-page-desc">{accounts.length} total</div>
					)}
				</div>

				{isLoading ? (
					<div className="dash-hint">Loading...</div>
				) : accounts && accounts.length > 0 ? (
					<div
						style={{
							border: "1px solid var(--border)",
							borderRadius: 8,
							overflow: "hidden",
						}}
					>
						<table
							style={{
								width: "100%",
								borderCollapse: "collapse",
								fontSize: 13,
								fontFamily: "var(--font-sans-stack)",
							}}
						>
							<thead>
								<tr
									style={{
										borderBottom: "1px solid var(--border)",
										background: "var(--code-bg)",
									}}
								>
									<th style={TH_STYLE}>Email</th>
									<th style={TH_STYLE}>Plan</th>
									<th style={{ ...TH_STYLE, textAlign: "center" }}>
										Subgraphs
									</th>
									<th style={TH_STYLE}>Last Active</th>
									<th style={TH_STYLE}>Joined</th>
								</tr>
							</thead>
							<tbody>
								{accounts.map((account) => (
									<tr
										key={account.id}
										style={{
											borderBottom: "1px solid var(--border)",
											transition: "background 0.1s",
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.background = "var(--code-bg)";
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = "transparent";
										}}
									>
										<td
											style={{
												padding: "8px 12px",
												fontWeight: 460,
												color: "var(--text-main)",
											}}
										>
											{account.email}
										</td>
										<td style={{ padding: "8px 12px" }}>
											<span
												style={{
													fontFamily: "var(--font-mono-stack)",
													fontSize: 10,
													fontWeight: 600,
													padding: "2px 8px",
													borderRadius: 10,
													color: "var(--teal)",
													background: "var(--teal-bg)",
												}}
											>
												{account.plan}
											</span>
										</td>
										<td
											style={{
												padding: "8px 12px",
												textAlign: "center",
												fontFamily: "var(--font-mono-stack)",
												fontSize: 12,
												color: "var(--text-muted)",
											}}
										>
											{account.subgraphCount}
										</td>
										<td
											style={{
												padding: "8px 12px",
												color: "var(--text-muted)",
												fontSize: 12,
											}}
										>
											{formatRelative(account.lastActive)}
										</td>
										<td
											style={{
												padding: "8px 12px",
												color: "var(--text-muted)",
												fontSize: 12,
											}}
										>
											{formatDate(account.createdAt)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="dash-hint">No accounts found.</div>
				)}
			</div>
		</div>
	);
}
