"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
	formatLag,
	formatLastChecked,
	indexFreshnessColor,
	indexFreshnessLabel,
} from "@/lib/status-page";
import type { FreshnessColor } from "@/lib/status-page";
import type { IndexDecoderFreshness, SystemStatus } from "@/lib/types";

type StatusState = FreshnessColor | "red";

type StatusRow = {
	name: string;
	detail: string;
	value: string;
	state: StatusState;
};

function compactBlockLabel(status: SystemStatus | null): string {
	if (status?.chainTip == null) return "unavailable";
	return `#${status.chainTip.toLocaleString()}`;
}

function compactLagLabel(
	eventType: IndexDecoderFreshness["eventType"],
	status: SystemStatus | null,
): string {
	return indexFreshnessLabel(eventType, status?.index).replace(/_/g, " ");
}

function streamState(status: SystemStatus | null): StatusState {
	const lag = status?.streams?.tip?.lag_seconds;
	if (status?.streams?.status === "unavailable" || lag == null) return "muted";
	return lag >= 60 ? "yellow" : "green";
}

function apiState(status: SystemStatus | null): StatusState {
	if (!status) return "muted";
	return status.status === "healthy" ? "green" : "yellow";
}

function decoderFor(
	status: SystemStatus | null,
	eventType: IndexDecoderFreshness["eventType"],
) {
	return status?.index?.decoders.find(
		(decoder) => decoder.eventType === eventType,
	);
}

function statusRows(status: SystemStatus | null): StatusRow[] {
	const ftDecoder = decoderFor(status, "ft_transfer");
	const nftDecoder = decoderFor(status, "nft_transfer");

	return [
		{
			name: "Public API",
			detail: "Status endpoint",
			value: status ? "200" : "unavailable",
			state: apiState(status),
		},
		{
			name: "Stacks Streams",
			detail: "Raw event ingest",
			value: formatLag(status?.streams?.tip?.lag_seconds),
			state: streamState(status),
		},
		{
			name: "Canonical tip",
			detail:
				status?.chainTip == null
					? "Block unavailable"
					: `Block #${status.chainTip.toLocaleString()}`,
			value: status?.chainTip == null ? "unknown" : "current",
			state: status?.chainTip == null ? "muted" : "green",
		},
		{
			name: "FT decoder",
			detail: "SIP-010 transfers",
			value: formatLag(ftDecoder?.lagSeconds),
			state: indexFreshnessColor(ftDecoder),
		},
		{
			name: "NFT decoder",
			detail: "SIP-009 transfers",
			value: formatLag(nftDecoder?.lagSeconds),
			state: indexFreshnessColor(nftDecoder),
		},
	];
}

function summaryLabel(rows: StatusRow[]): string {
	if (rows.some((row) => row.state === "red")) return "Service degraded";
	if (rows.some((row) => row.state === "yellow")) return "Index catching up";
	if (rows.some((row) => row.state === "muted")) return "Status unavailable";
	return "All public systems fresh";
}

function progressValue(rows: StatusRow[]): number {
	const score = rows.reduce((total, row) => {
		if (row.state === "green") return total + 1;
		if (row.state === "yellow") return total + 0.55;
		return total;
	}, 0);
	return Math.max(8, Math.round((score / rows.length) * 100));
}

function progressState(rows: StatusRow[]): StatusState {
	if (rows.some((row) => row.state === "red")) return "red";
	if (rows.some((row) => row.state === "yellow")) return "yellow";
	if (rows.some((row) => row.state === "muted")) return "muted";
	return "green";
}

function StatusGlyph({ state }: { state: StatusState }) {
	const path =
		state === "green" ? (
			<path
				d="M3.5 7.8 6.1 10.4 12.5 4.6"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
		) : state === "yellow" ? (
			<>
				<path
					d="M8 3.8v5"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="1.8"
				/>
				<path
					d="M8 12.1h.01"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="2.2"
				/>
			</>
		) : state === "red" ? (
			<path
				d="m5 5 6 6m0-6-6 6"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.8"
			/>
		) : (
			<path
				d="M4.5 8h7"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.8"
			/>
		);

	return (
		<span className="home-status-row-glyph" aria-hidden="true">
			<svg viewBox="0 0 16 16">{path}</svg>
		</span>
	);
}

export function HomeStatusBadge({ status }: { status: SystemStatus | null }) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const rows = useMemo(() => statusRows(status), [status]);
	const ftDecoder = decoderFor(status, "ft_transfer");
	const nftDecoder = decoderFor(status, "nft_transfer");
	const progress = progressValue(rows);
	const progressTone = progressState(rows);

	useEffect(() => {
		if (!open) return;

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setOpen(false);
		}

		function onPointerDown(event: PointerEvent) {
			if (
				rootRef.current &&
				event.target instanceof Node &&
				!rootRef.current.contains(event.target)
			) {
				setOpen(false);
			}
		}

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open]);

	return (
		<div
			ref={rootRef}
			className="home-status-shell"
			data-open={open ? "true" : "false"}
			data-progress-state={progressTone}
		>
			<div
				id={panelId}
				className="home-status-panel"
				role="region"
				aria-label="Second Layer public status"
			>
				<div className="home-status-panel-header">
					<div>
						<h2>Network status</h2>
						<p>{summaryLabel(rows)}</p>
					</div>
					<button
						type="button"
						className="home-status-close"
						aria-label="Close status detail"
						onClick={() => setOpen(false)}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path
								d="m4.5 4.5 7 7m0-7-7 7"
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeWidth="1.7"
							/>
						</svg>
					</button>
				</div>
				<div className="home-status-progress" aria-hidden="true">
					<span style={{ width: `${progress}%` }} />
				</div>
				<div className="home-status-rows">
					{rows.map((row) => (
						<div
							key={row.name}
							className="home-status-row"
							data-state={row.state}
						>
							<StatusGlyph state={row.state} />
							<span className="home-status-row-text">
								<span className="home-status-row-name">{row.name}</span>
								<span className="home-status-row-detail">{row.detail}</span>
							</span>
							<span className="home-status-row-value">{row.value}</span>
						</div>
					))}
				</div>
				<div className="home-status-panel-footer">
					<span>
						{formatLastChecked(
							status?.timestamp ? new Date(status.timestamp) : null,
						)}
					</span>
					<a href="/status">Status page</a>
				</div>
			</div>

			<button
				type="button"
				className="home-status-badge"
				aria-label="Streams and Index status"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((value) => !value)}
			>
				<span
					className={`home-status-item home-status-${status?.chainTip == null ? "muted" : "green"}`}
				>
					<span className="home-status-dot" aria-hidden="true" />
					Block <strong>{compactBlockLabel(status)}</strong>
				</span>
				<span
					className={`home-status-item home-status-${indexFreshnessColor(ftDecoder)}`}
				>
					<span className="home-status-dot" aria-hidden="true" />
					{compactLagLabel("ft_transfer", status)}
				</span>
				<span
					className={`home-status-item home-status-${indexFreshnessColor(nftDecoder)}`}
				>
					<span className="home-status-dot" aria-hidden="true" />
					{compactLagLabel("nft_transfer", status)}
				</span>
			</button>
		</div>
	);
}
