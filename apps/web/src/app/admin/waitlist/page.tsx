"use client";

import {
	useAdminWaitlist,
	useApproveWaitlist,
	useBulkApprove,
} from "@/lib/queries/admin";
import Link from "next/link";
import { useState } from "react";

const STATUS_FILTERS = [
	{ label: "All", value: undefined },
	{ label: "Pending", value: "pending" },
	{ label: "Approved", value: "approved" },
] as const;

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export default function WaitlistPage() {
	const [filter, setFilter] = useState<string | undefined>(undefined);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const { data: entries, isLoading } = useAdminWaitlist(filter);
	const approve = useApproveWaitlist();
	const bulkApprove = useBulkApprove();

	const toggleSelect = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleAll = () => {
		if (!entries) return;
		const pending = entries.filter((e) => e.status === "pending");
		if (selected.size === pending.length) {
			setSelected(new Set());
		} else {
			setSelected(new Set(pending.map((e) => e.id)));
		}
	};

	const handleBulkApprove = () => {
		if (selected.size === 0) return;
		bulkApprove.mutate([...selected], {
			onSuccess: () => setSelected(new Set()),
		});
	};

	const pendingCount =
		entries?.filter((e) => e.status === "pending").length ?? 0;

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
						Waitlist
					</div>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						marginBottom: 16,
					}}
				>
					<div className="mode-tabs">
						{STATUS_FILTERS.map((f) => (
							<button
								type="button"
								key={f.label}
								className={`mode-tab ${filter === f.value ? "active" : ""}`}
								onClick={() => {
									setFilter(f.value);
									setSelected(new Set());
								}}
							>
								{f.label}
							</button>
						))}
					</div>

					{selected.size > 0 && (
						<button
							type="button"
							onClick={handleBulkApprove}
							disabled={bulkApprove.isPending}
							style={{
								fontFamily: "var(--font-sans-stack)",
								fontSize: 12,
								fontWeight: 500,
								padding: "6px 14px",
								borderRadius: 6,
								border: "1px solid var(--green)",
								background: "var(--green-bg)",
								color: "var(--green)",
								cursor: "pointer",
							}}
						>
							{bulkApprove.isPending
								? "Approving..."
								: `Approve ${selected.size} selected`}
						</button>
					)}
				</div>

				{isLoading ? (
					<div className="dash-hint">Loading...</div>
				) : entries && entries.length > 0 ? (
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
									{(!filter || filter === "pending") && (
										<th style={{ width: 36, padding: "8px 12px" }}>
											<input
												type="checkbox"
												checked={
													pendingCount > 0 && selected.size === pendingCount
												}
												onChange={toggleAll}
												style={{ cursor: "pointer" }}
											/>
										</th>
									)}
									<th
										style={{
											padding: "8px 12px",
											textAlign: "left",
											fontFamily: "var(--font-mono-stack)",
											fontSize: 10,
											fontWeight: 600,
											letterSpacing: "0.04em",
											textTransform: "uppercase",
											color: "var(--text-muted)",
										}}
									>
										Email
									</th>
									<th
										style={{
											padding: "8px 12px",
											textAlign: "left",
											fontFamily: "var(--font-mono-stack)",
											fontSize: 10,
											fontWeight: 600,
											letterSpacing: "0.04em",
											textTransform: "uppercase",
											color: "var(--text-muted)",
										}}
									>
										Source
									</th>
									<th
										style={{
											padding: "8px 12px",
											textAlign: "left",
											fontFamily: "var(--font-mono-stack)",
											fontSize: 10,
											fontWeight: 600,
											letterSpacing: "0.04em",
											textTransform: "uppercase",
											color: "var(--text-muted)",
										}}
									>
										Status
									</th>
									<th
										style={{
											padding: "8px 12px",
											textAlign: "left",
											fontFamily: "var(--font-mono-stack)",
											fontSize: 10,
											fontWeight: 600,
											letterSpacing: "0.04em",
											textTransform: "uppercase",
											color: "var(--text-muted)",
										}}
									>
										Signed Up
									</th>
									<th style={{ width: 100, padding: "8px 12px" }} />
								</tr>
							</thead>
							<tbody>
								{entries.map((entry) => (
									<tr
										key={entry.id}
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
										{(!filter || filter === "pending") && (
											<td style={{ padding: "8px 12px" }}>
												{entry.status === "pending" && (
													<input
														type="checkbox"
														checked={selected.has(entry.id)}
														onChange={() => toggleSelect(entry.id)}
														style={{ cursor: "pointer" }}
													/>
												)}
											</td>
										)}
										<td
											style={{
												padding: "8px 12px",
												fontWeight: 460,
												color: "var(--text-main)",
											}}
										>
											{entry.email}
										</td>
										<td
											style={{
												padding: "8px 12px",
												color: "var(--text-muted)",
												fontFamily: "var(--font-mono-stack)",
												fontSize: 11,
											}}
										>
											{entry.source}
										</td>
										<td style={{ padding: "8px 12px" }}>
											<span
												className={`ov-list-status ${entry.status === "approved" ? "active" : entry.status === "pending" ? "syncing" : ""}`}
											>
												{entry.status}
											</span>
										</td>
										<td
											style={{
												padding: "8px 12px",
												color: "var(--text-muted)",
												fontSize: 12,
											}}
										>
											{formatDate(entry.createdAt)}
										</td>
										<td style={{ padding: "8px 12px", textAlign: "right" }}>
											{entry.status === "pending" && (
												<button
													type="button"
													onClick={() => approve.mutate(entry.id)}
													disabled={approve.isPending}
													style={{
														fontFamily: "var(--font-sans-stack)",
														fontSize: 11,
														fontWeight: 500,
														padding: "4px 10px",
														borderRadius: 4,
														border: "1px solid var(--border)",
														background: "transparent",
														color: "var(--text-main)",
														cursor: "pointer",
														transition: "all 0.12s",
													}}
													onMouseEnter={(e) => {
														e.currentTarget.style.borderColor = "var(--green)";
														e.currentTarget.style.color = "var(--green)";
													}}
													onMouseLeave={(e) => {
														e.currentTarget.style.borderColor = "var(--border)";
														e.currentTarget.style.color = "var(--text-main)";
													}}
												>
													Approve
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="dash-hint">No waitlist entries found.</div>
				)}
			</div>
		</div>
	);
}
