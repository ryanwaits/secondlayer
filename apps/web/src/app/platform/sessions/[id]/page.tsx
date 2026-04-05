"use client";

import { useSessionTabs } from "@/components/console/tab-bar";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, use, useState } from "react";

export default function SessionResultPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const searchParams = useSearchParams();
	const router = useRouter();
	const query = searchParams.get("q") ?? "";
	const { addTab } = useSessionTabs();
	const [followUp, setFollowUp] = useState("");

	useEffect(() => {
		if (query) {
			addTab({
				id,
				label: query.slice(0, 30) + (query.length > 30 ? "..." : ""),
				href: `/sessions/${id}?q=${encodeURIComponent(query)}`,
			});
		}
	}, [id, query, addTab]);

	function handleFollowUp() {
		if (!followUp.trim()) return;
		const newId = Math.random().toString(36).slice(2, 10);
		router.push(`/sessions/${newId}?q=${encodeURIComponent(followUp.trim())}`);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
			<div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
				<div className="result-container">
					{/* Query echo */}
					<div className="result-query">
						<div className="result-query-avatar">R</div>
						<div className="result-query-text">{query || "No query"}</div>
					</div>

					{/* Placeholder — real session execution engine will replace this */}
					<div className="ov-empty" style={{ marginTop: 16 }}>
						Session execution is not yet available. Results will appear here when the query engine is connected.
					</div>
				</div>
			</div>

			{/* Bottom input */}
			<div className="result-bottom">
				<div className="result-bottom-inner">
					<input
						className="result-bottom-input"
						type="text"
						placeholder="Ask a follow-up question..."
						value={followUp}
						onChange={(e) => setFollowUp(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleFollowUp();
						}}
					/>
				</div>
			</div>
		</div>
	);
}
