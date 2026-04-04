"use client";

import type { ReactNode } from "react";
import { useStatus } from "@/lib/queries/status";

function formatBlock(n: number) {
	return `#${n.toLocaleString()}`;
}

function timeAgo(iso: string) {
	const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

interface OverviewTopbarProps {
	project?: string;
	path?: ReactNode;
	page: string | ReactNode;
	showMeta?: boolean;
	showRefresh?: boolean;
	showTimeRange?: boolean;
}

export function OverviewTopbar({
	project = "my-project",
	path,
	page,
	showMeta = true,
	showRefresh = true,
	showTimeRange = true,
}: OverviewTopbarProps) {
	const { data: status } = useStatus();

	const blockHeight = status?.chainTip ? formatBlock(status.chainTip) : "—";
	const lastUpdated = status?.timestamp ? timeAgo(status.timestamp) : "—";

	return (
		<div className="overview-topbar">
			<div className="overview-breadcrumb">
				<div className="overview-breadcrumb-project">
					{project} / {path ? <>{path} / </> : null}
				</div>
				<div className="overview-breadcrumb-page">{page}</div>
			</div>
			{showMeta && (
				<div className="overview-meta">
					<span className="overview-meta-item">
						Last updated <span className="mono">{lastUpdated}</span>
					</span>
					<span className="overview-meta-sep" />
					<span className="overview-meta-item">
						Block <span className="mono">{blockHeight}</span>
					</span>
					{showRefresh && (
						<>
							<span className="overview-meta-sep" />
							<button type="button" className="overview-meta-btn">
								<svg
									width="12"
									height="12"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M2 8a6 6 0 0 1 10.5-4" />
									<path d="M14 8a6 6 0 0 1-10.5 4" />
									<path d="M10 4h3V1" />
									<path d="M6 12H3v3" />
								</svg>
								Auto-refresh off
								<svg
									width="8"
									height="8"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M4 6l4 4 4-4" />
								</svg>
							</button>
						</>
					)}
					{showTimeRange && (
						<button type="button" className="overview-meta-btn">
							<svg
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<circle cx="8" cy="8" r="6" />
								<path d="M8 4.5V8l2.5 1.5" />
							</svg>
							Past 7 days
							<svg
								width="8"
								height="8"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<path d="M4 6l4 4 4-4" />
							</svg>
						</button>
					)}
				</div>
			)}
		</div>
	);
}
