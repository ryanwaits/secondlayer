"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface Delivery {
	id: string;
	blockHeight: number;
	statusCode: number;
	responseTimeMs: number | null;
	createdAt: string;
}

interface StreamDeliveriesProps {
	streamId: string;
	sessionToken: string;
}

export function StreamDeliveries({ streamId, sessionToken }: StreamDeliveriesProps) {
	const [page, setPage] = useState(0);
	const limit = 10;

	const { data, isLoading } = useQuery({
		queryKey: ["stream-deliveries", streamId, page],
		queryFn: async () => {
			const res = await fetch(
				`/api/streams/${streamId}/deliveries?limit=${limit}&offset=${page * limit}`,
				{ headers: { Authorization: `Bearer ${sessionToken}` } },
			);
			if (!res.ok) return { deliveries: [], total: 0 };
			return res.json() as Promise<{ deliveries: Delivery[]; total: number }>;
		},
		staleTime: 30_000,
	});

	const deliveries = data?.deliveries ?? [];
	const total = data?.total ?? 0;

	if (isLoading) {
		return <div style={{ padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;
	}

	if (deliveries.length === 0) {
		return <div style={{ padding: "20px 0", color: "var(--text-dim)", fontSize: 13 }}>No deliveries yet.</div>;
	}

	return (
		<>
			<table className="sg-table">
				<thead>
					<tr>
						<th>Block</th>
						<th>Status</th>
						<th>Response</th>
						<th>Time</th>
					</tr>
				</thead>
				<tbody>
					{deliveries.map((d) => {
						const isSuccess = d.statusCode >= 200 && d.statusCode < 300;
						return (
							<tr key={d.id}>
								<td><span className="mono">#{d.blockHeight.toLocaleString()}</span></td>
								<td>
									<span className={`badge ${isSuccess ? "active" : "error"}`}>
										{d.statusCode}
									</span>
								</td>
								<td>
									<span className="mono">
										{d.responseTimeMs != null ? `${d.responseTimeMs}ms` : "timeout"}
									</span>
								</td>
								<td>
									<span className="mono">
										{new Date(d.createdAt).toLocaleString("en-US", {
											month: "short",
											day: "numeric",
											year: "numeric",
											hour: "numeric",
											minute: "2-digit",
											second: "2-digit",
										})}
									</span>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<div className="sg-data-pagination">
				<span>
					Showing {page * limit + 1}&ndash;{Math.min((page + 1) * limit, total)} of{" "}
					{total.toLocaleString()}
				</span>
				<div style={{ display: "flex", gap: 4 }}>
					<button
						type="button"
						className={`sg-data-page-btn${page === 0 ? " disabled" : ""}`}
						onClick={() => setPage(Math.max(0, page - 1))}
					>
						&larr; Prev
					</button>
					<button
						type="button"
						className={`sg-data-page-btn${(page + 1) * limit >= total ? " disabled" : ""}`}
						onClick={() => setPage(page + 1)}
					>
						Next &rarr;
					</button>
				</div>
			</div>
		</>
	);
}
