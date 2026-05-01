"use client";

import { useStatus } from "@/lib/queries/status";
import { useState } from "react";

function formatBlock(n: number): string {
	return n.toLocaleString("en-US");
}

function timeSince(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const secs = Math.floor(diff / 1000);
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	return `${hours}h ago`;
}

export function StatusPill() {
	const { data: status } = useStatus();
	const [expanded, setExpanded] = useState(false);

	if (!status) return null;

	const isHealthy = status.status === "healthy";

	return (
		<div className="status-pill-wrap">
			{expanded && (
				<>
					<div
						className="status-pill-backdrop"
						onClick={() => setExpanded(false)}
						onKeyDown={(e) => {
							if (e.key === "Escape") setExpanded(false);
						}}
					/>
					<div className="status-pill-expanded">
						<div className="status-pill-expanded-row">
							<span className="status-pill-expanded-label">Status</span>
							<span className="status-pill-expanded-value">
								<span className={`dot ${isHealthy ? "green" : "yellow"}`} />
								{isHealthy ? "Operational" : "Degraded"}
							</span>
						</div>
						{status.chainTip != null && (
							<div className="status-pill-expanded-row">
								<span className="status-pill-expanded-label">Chain tip</span>
								<span className="status-pill-expanded-value">
									{formatBlock(status.chainTip)}
								</span>
							</div>
						)}
						<div className="status-pill-expanded-row">
							<span className="status-pill-expanded-label">Last event</span>
							<span className="status-pill-expanded-value">
								{timeSince(status.timestamp)}
							</span>
						</div>
					</div>
				</>
			)}
			<button
				type="button"
				className="status-pill-trigger"
				onClick={() => setExpanded(!expanded)}
			>
				<span className={`dot ${isHealthy ? "green" : "yellow"}`} />
				{status.chainTip != null
					? `Block ${formatBlock(status.chainTip)}`
					: isHealthy
						? "Operational"
						: "Degraded"}
			</button>
		</div>
	);
}
