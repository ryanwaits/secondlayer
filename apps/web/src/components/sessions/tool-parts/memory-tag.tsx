"use client";

interface RecalledSession {
	id: string;
	title: string | null;
	createdAt: string;
	summary: string;
}

interface MemoryRecallCardProps {
	sessions: RecalledSession[];
}

export function MemoryRecallCard({ sessions }: MemoryRecallCardProps) {
	if (sessions.length === 0) return null;

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<circle cx="8" cy="8" r="6" />
					<path d="M8 5v3l2 1" />
				</svg>
				Previous sessions
			</div>
			{sessions.map((s) => (
				<div key={s.id} className="tool-status-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">{s.title || "Untitled"}</span>
						<span className="tool-action-reason">{s.summary}</span>
					</div>
					<span className="memory-date">{formatDate(s.createdAt)}</span>
				</div>
			))}
		</div>
	);
}

export function MemoryTag({ date }: { date: string }) {
	return (
		<span className="memory-tag">
			<svg
				aria-hidden="true"
				width="8"
				height="8"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			>
				<circle cx="8" cy="8" r="6" />
				<path d="M8 5v3l2 1" />
			</svg>
			Recalled from {formatDate(date)} session
		</span>
	);
}

function formatDate(dateStr: string): string {
	const d = new Date(dateStr);
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
