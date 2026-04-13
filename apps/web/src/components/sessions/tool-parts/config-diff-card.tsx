"use client";

import { useState } from "react";

type CurrentConfig = {
	name: string;
	endpointUrl: string;
	filters: Array<Record<string, unknown>>;
	options: Record<string, unknown>;
};

type ProposedConfig = Partial<CurrentConfig>;

interface ConfigDiffCardProps {
	name: string;
	summary: string;
	current: CurrentConfig;
	proposed: ProposedConfig;
	onConfirm: () => Promise<void> | void;
	onCancel: () => void;
	busy?: boolean;
	errorText?: string;
}

/**
 * Structured diff for streams — not a line-based text diff. Shows which
 * top-level fields change and renders filter add/remove visually. Far more
 * readable than dumping two JSON blobs side-by-side for the user.
 */
export function ConfigDiffCard({
	name,
	summary,
	current,
	proposed,
	onConfirm,
	onCancel,
	busy = false,
	errorText,
}: ConfigDiffCardProps) {
	const [confirmed, setConfirmed] = useState(false);

	const changedFields: Array<{
		field: string;
		before: string;
		after: string;
	}> = [];

	if (proposed.name !== undefined && proposed.name !== current.name) {
		changedFields.push({
			field: "name",
			before: current.name,
			after: proposed.name,
		});
	}
	if (
		proposed.endpointUrl !== undefined &&
		proposed.endpointUrl !== current.endpointUrl
	) {
		changedFields.push({
			field: "endpointUrl",
			before: current.endpointUrl,
			after: proposed.endpointUrl,
		});
	}
	if (proposed.options !== undefined) {
		for (const [k, v] of Object.entries(proposed.options)) {
			const before = current.options[k];
			if (JSON.stringify(before) !== JSON.stringify(v)) {
				changedFields.push({
					field: `options.${k}`,
					before: JSON.stringify(before),
					after: JSON.stringify(v),
				});
			}
		}
	}

	const filterChanges = diffFilters(
		current.filters,
		proposed.filters ?? current.filters,
	);

	const hasChanges = changedFields.length > 0 || filterChanges.length > 0;

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Edit stream {name} — {summary}
			</div>
			{!hasChanges && (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						<span className="tool-action-reason">
							No changes between current and proposed config.
						</span>
					</div>
				</div>
			)}
			{changedFields.length > 0 && (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						{changedFields.map((c) => (
							<span key={c.field} className="tool-action-reason">
								<strong>{c.field}</strong>: {c.before} → {c.after}
							</span>
						))}
					</div>
				</div>
			)}
			{filterChanges.length > 0 && (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						{filterChanges.map((c) => (
							<span
								key={`${c.marker}-${c.text}`}
								className="tool-action-reason"
							>
								{c.marker} {c.text}
							</span>
						))}
					</div>
				</div>
			)}
			{errorText && <pre className="tool-error-body">{errorText}</pre>}
			<div className="tool-card-footer">
				<button
					type="button"
					className="tool-btn ghost"
					disabled={busy}
					onClick={onCancel}
				>
					Cancel
				</button>
				<button
					type="button"
					className="tool-btn primary"
					disabled={busy || !hasChanges || confirmed}
					onClick={async () => {
						setConfirmed(true);
						await onConfirm();
					}}
				>
					{busy ? "Applying…" : "Apply edit"}
				</button>
			</div>
		</div>
	);
}

function filterKey(f: Record<string, unknown>): string {
	return JSON.stringify(f, Object.keys(f).sort());
}

function filterSummary(f: Record<string, unknown>): string {
	const type = (f.type as string) ?? "unknown";
	const extras = Object.entries(f)
		.filter(([k]) => k !== "type")
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(" ");
	return extras ? `${type} · ${extras}` : type;
}

function diffFilters(
	current: Array<Record<string, unknown>>,
	proposed: Array<Record<string, unknown>>,
): Array<{ marker: string; text: string }> {
	const currentKeys = new Set(current.map(filterKey));
	const proposedKeys = new Set(proposed.map(filterKey));
	const out: Array<{ marker: string; text: string }> = [];
	for (const f of current) {
		if (!proposedKeys.has(filterKey(f))) {
			out.push({ marker: "-", text: filterSummary(f) });
		}
	}
	for (const f of proposed) {
		if (!currentKeys.has(filterKey(f))) {
			out.push({ marker: "+", text: filterSummary(f) });
		}
	}
	return out;
}
