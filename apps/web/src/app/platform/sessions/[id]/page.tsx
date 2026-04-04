"use client";

import { useSessionTabs } from "@/components/console/tab-bar";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, use } from "react";

// Stubbed mock result data
const MOCK_RESULT = {
	source: "stacking-monitor",
	cycle: 92,
	data: [
		{ label: "Total STX locked", value: "1,847,293,041 STX" },
		{ label: "Active stackers", value: "4,218" },
		{ label: "Cycle progress", value: "68%" },
		{ label: "Reward slots", value: "3,800 / 4,000" },
		{ label: "Estimated APY", value: "8.2%", color: "var(--green)" },
	],
	summary:
		'STX locked up 3.2% from last cycle. 95% reward slots filled. Data from stacking-monitor, block #187,421.',
};

export default function SessionResultPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const searchParams = useSearchParams();
	const query = searchParams.get("q") ?? "Show me the latest stacking cycle data";
	const { addTab } = useSessionTabs();

	useEffect(() => {
		addTab({
			id,
			label: query.slice(0, 30) + (query.length > 30 ? "..." : ""),
			href: `/sessions/${id}?q=${encodeURIComponent(query)}`,
		});
	}, [id, query, addTab]);

	return (
		<div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
			<div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
				<div className="result-container">
					{/* Query echo */}
					<div className="result-query">
						<div className="result-query-avatar">R</div>
						<div className="result-query-text">{query}</div>
					</div>

					{/* Result card */}
					<div className="result-block">
						<div className="result-block-header">
							<span className="result-block-icon">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
									<path d="M9 2L5 14M3 5l-2 3 2 3M13 5l2 3-2 3" />
								</svg>
							</span>
							<span className="result-block-title">
								{MOCK_RESULT.source} &mdash; Cycle #{MOCK_RESULT.cycle}
							</span>
							<span className="badge active">active</span>
						</div>
						<div className="result-block-body">
							{MOCK_RESULT.data.map((row) => (
								<div key={row.label} className="result-row">
									<span className="result-label">{row.label}</span>
									<span
										className="result-value"
										style={row.color ? { color: row.color } : undefined}
									>
										{row.value}
									</span>
								</div>
							))}
						</div>
					</div>

					{/* Summary */}
					<div className="result-summary">{MOCK_RESULT.summary}</div>

					{/* Actions */}
					<div className="result-actions">
						<Link href="/subgraphs/stacking-monitor" className="result-action primary">
							Open stacking-monitor
						</Link>
						<button type="button" className="result-action">Compare cycles</button>
						<button type="button" className="result-action">Top stackers</button>
						<button type="button" className="result-action">Export CSV</button>
					</div>
				</div>
			</div>

			{/* Bottom input */}
			<div className="result-bottom">
				<div className="result-bottom-inner">
					<input
						className="result-bottom-input"
						type="text"
						placeholder="Search or ask another question..."
					/>
				</div>
			</div>
		</div>
	);
}
