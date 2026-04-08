"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useStatus } from "@/lib/queries/status";
import {
	useTopbar,
	REFRESH_OPTIONS,
	type RefreshInterval,
} from "@/lib/topbar-context";

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

function MetaDropdown<T>({
	options,
	value,
	onChange,
	icon,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
	icon: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const current = options.find((o) => o.value === value);

	return (
		<div className="meta-dropdown-wrap" ref={ref}>
			<button
				type="button"
				className="overview-meta-btn"
				onClick={() => setOpen(!open)}
				onBlur={(e) => {
					if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
				}}
			>
				{icon}
				{current?.label}
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
			{open && (
				<div className="meta-dropdown">
					{options.map((opt) => (
						<button
							key={String(opt.value)}
							type="button"
							className={`meta-dropdown-item${opt.value === value ? " active" : ""}`}
							onMouseDown={(e) => {
								e.preventDefault();
								onChange(opt.value);
								setOpen(false);
							}}
						>
							{opt.label}
							{opt.value === value && (
								<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
									<path d="M3 8.5l3.5 3.5 6.5-8" />
								</svg>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

interface OverviewTopbarProps {
	project?: string;
	path?: ReactNode;
	page: string | ReactNode;
	showMeta?: boolean;
	showRefresh?: boolean;
	lastUpdated?: string | null;
}

export function OverviewTopbar({
	project = "my-project",
	path,
	page,
	showMeta = true,
	showRefresh = true,
	lastUpdated,
}: OverviewTopbarProps) {
	const { data: status } = useStatus();
	const { autoRefresh, setAutoRefresh, autoRefreshLabel } = useTopbar();

	const blockHeight = status?.chainTip ? formatBlock(status.chainTip) : "—";

	let lastUpdatedDisplay: string;
	if (lastUpdated === null) {
		lastUpdatedDisplay = "—";
	} else if (lastUpdated !== undefined) {
		lastUpdatedDisplay = timeAgo(lastUpdated);
	} else {
		lastUpdatedDisplay = status?.timestamp ? timeAgo(status.timestamp) : "—";
	}

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
						Last updated <span className="mono">{lastUpdatedDisplay}</span>
					</span>
					<span className="overview-meta-sep" />
					<span className="overview-meta-item">
						Block <span className="mono">{blockHeight}</span>
					</span>
					{showRefresh && (
						<>
							<span className="overview-meta-sep" />
							<MetaDropdown<RefreshInterval>
								options={REFRESH_OPTIONS}
								value={autoRefresh}
								onChange={setAutoRefresh}
								icon={
									<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
										<path d="M2 8a6 6 0 0 1 10.5-4" />
										<path d="M14 8a6 6 0 0 1-10.5 4" />
										<path d="M10 4h3V1" />
										<path d="M6 12H3v3" />
									</svg>
								}
							/>
						</>
					)}
				</div>
			)}
		</div>
	);
}
