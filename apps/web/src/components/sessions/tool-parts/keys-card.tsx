"use client";

interface KeyInfo {
	id: string;
	name: string;
	prefix: string;
	status: string;
	lastUsedAt: string | null;
	createdAt: string;
}

interface KeysCardProps {
	keys: KeyInfo[];
}

export function KeysCard({ keys }: KeysCardProps) {
	if (keys.length === 0) return null;

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<path d="M5 2v12M2 5h12" />
					<rect x="2" y="2" width="12" height="12" rx="2" />
				</svg>
				API Keys
			</div>
			{keys.map((k) => (
				<div key={k.id} className="tool-status-row">
					<span className="tool-status-name">{k.name}</span>
					<span className="tool-status-meta">
						<code className="tool-key-prefix">{k.prefix}...</code>
						{k.lastUsedAt ? ` ${formatRelative(k.lastUsedAt)}` : " never used"}
					</span>
				</div>
			))}
		</div>
	);
}

function formatRelative(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}
