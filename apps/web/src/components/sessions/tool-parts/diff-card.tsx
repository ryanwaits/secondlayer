"use client";

import type { DiffHunk, DiffLine } from "@/lib/sessions/diff-workflow";

interface DiffCardProps {
	name: string;
	summary: string;
	hunks: DiffHunk[];
	added: number;
	removed: number;
	busy?: boolean;
	staleVersion?: string;
	errorText?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export function DiffCard({
	name,
	summary,
	hunks,
	added,
	removed,
	busy,
	staleVersion,
	errorText,
	onConfirm,
	onCancel,
}: DiffCardProps) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Edit {name} · +{added} −{removed}
			</div>
			<div className="tool-action-row">
				<div className="tool-action-detail">
					<span className="tool-status-name">{summary}</span>
					{staleVersion && (
						<span className="tool-action-reason">
							Stale v{staleVersion} — re-reading…
						</span>
					)}
					{errorText && <span className="tool-action-reason">{errorText}</span>}
				</div>
				<span className="tool-badge">HIL</span>
			</div>
			<div className="tool-diff-body">
				{hunks.length === 0 ? (
					<div className="tool-action-reason">No changes</div>
				) : (
					hunks.map((h, hi) => (
						<DiffHunkBlock
							key={`h-${hi}-${h.oldStart}-${h.newStart}`}
							hunk={h}
						/>
					))
				)}
			</div>
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
					disabled={busy || hunks.length === 0}
					onClick={onConfirm}
				>
					{busy ? "Deploying…" : "Confirm edit"}
				</button>
			</div>
		</div>
	);
}

function DiffHunkBlock({ hunk }: { hunk: DiffHunk }) {
	return (
		<div className="tool-diff-hunk">
			<div className="tool-diff-hunk-header">
				@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
			</div>
			{hunk.lines.map((line, li) => (
				<DiffLineRow key={`l-${li}-${lineKey(line)}`} line={line} />
			))}
		</div>
	);
}

function lineKey(line: DiffLine): string {
	if (line.type === "ctx") return `ctx-${line.oldLine}-${line.newLine}`;
	if (line.type === "add") return `add-${line.newLine}`;
	return `del-${line.oldLine}`;
}

function DiffLineRow({ line }: { line: DiffLine }) {
	const className =
		line.type === "add"
			? "tool-diff-line add"
			: line.type === "del"
				? "tool-diff-line del"
				: "tool-diff-line ctx";
	const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
	return (
		<div className={className}>
			<span className="tool-diff-marker">{marker}</span>
			<span
				className="tool-diff-content"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered shiki HTML
				dangerouslySetInnerHTML={{ __html: line.html }}
			/>
		</div>
	);
}
