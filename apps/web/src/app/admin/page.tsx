"use client";

import { useAdminStats } from "@/lib/queries/admin";
import Link from "next/link";

function StatCard({
	label,
	value,
	sub,
	color,
}: {
	label: string;
	value: number | string;
	sub?: string;
	color?: string;
}) {
	return (
		<div className="ov-card" style={{ cursor: "default" }}>
			<div className="ov-card-label">{label}</div>
			<div className="ov-card-value" style={{ color }}>
				{typeof value === "number" ? value.toLocaleString() : value}
			</div>
			{sub && <div className="ov-card-sub">{sub}</div>}
		</div>
	);
}

export default function AdminPage() {
	const { data: stats, isLoading } = useAdminStats();

	return (
		<div style={{ flex: 1, overflowY: "auto" }}>
			<div className="overview-inner">
				<div className="dash-page-header" style={{ padding: 0 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: 24,
						}}
					>
						<div>
							<div className="dash-page-title">Admin</div>
							<div className="dash-page-desc">System overview</div>
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<Link href="/admin/waitlist" className="ov-section-link">
								Waitlist &rarr;
							</Link>
							<Link href="/admin/accounts" className="ov-section-link">
								Accounts &rarr;
							</Link>
						</div>
					</div>
				</div>

				{isLoading ? (
					<div className="dash-hint">Loading...</div>
				) : stats ? (
					<div
						className="ov-cards"
						style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
					>
						<StatCard label="Total Accounts" value={stats.totalAccounts} />
						<StatCard
							label="Pending Waitlist"
							value={stats.pendingWaitlist}
							color={stats.pendingWaitlist > 0 ? "var(--yellow)" : undefined}
							sub={stats.pendingWaitlist > 0 ? "needs attention" : "all clear"}
						/>
						<StatCard
							label="Active Subgraphs"
							value={stats.activeSubgraphs}
							sub={`${stats.totalSubgraphs} total`}
							color="var(--green)"
						/>
						<StatCard
							label="Error Subgraphs"
							value={stats.errorSubgraphs}
							color={stats.errorSubgraphs > 0 ? "var(--red)" : undefined}
						/>
						<StatCard label="Total Subgraphs" value={stats.totalSubgraphs} />
					</div>
				) : null}
			</div>
		</div>
	);
}
