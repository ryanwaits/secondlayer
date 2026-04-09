"use client";

import { type ReactNode, useState } from "react";

interface MetaItem {
	label: string;
	value: ReactNode;
	sub?: string;
	mono?: boolean;
	valueColor?: string;
	tooltip?: string;
	/** When provided, renders a hover-visible copy button alongside the value */
	copyValue?: string;
}

interface MetaGridProps {
	items: MetaItem[];
	columns?: string;
}

function CopyableCard({ item }: { item: MetaItem }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!item.copyValue) return;
		await navigator.clipboard.writeText(item.copyValue);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div key={item.label} className="sg-meta-card sg-meta-card--copyable">
			<div className="sg-meta-label">
				{item.label}
				{item.tooltip && (
					<span className="info" title={item.tooltip}>
						<svg
							width="10"
							height="10"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-label={item.tooltip}
							role="img"
						>
							<circle cx="8" cy="8" r="6" />
							<path d="M8 7v4" />
							<circle cx="8" cy="5" r="0.5" fill="currentColor" />
						</svg>
					</span>
				)}
			</div>
			<div className="sg-meta-card-body">
				<div
					className={`sg-meta-value${item.mono ? " mono" : ""}`}
					style={
						item.valueColor ? { color: `var(--${item.valueColor})` } : undefined
					}
				>
					{item.value}
				</div>
				<button
					type="button"
					className={`sg-meta-copy-btn${copied ? " copied" : ""}`}
					onClick={handleCopy}
					title="Copy"
				>
					{copied ? (
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<polyline points="20 6 9 17 4 12" />
						</svg>
					) : (
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
						</svg>
					)}
				</button>
			</div>
			{item.sub && <div className="sg-meta-sub">{item.sub}</div>}
		</div>
	);
}

export function MetaGrid({ items, columns }: MetaGridProps) {
	return (
		<div
			className="sg-meta-grid"
			style={columns ? { gridTemplateColumns: columns } : undefined}
		>
			{items.map((item) =>
				item.copyValue ? (
					<CopyableCard key={item.label} item={item} />
				) : (
					<div key={item.label} className="sg-meta-card">
						<div className="sg-meta-label">
							{item.label}
							{item.tooltip && (
								<span className="info" title={item.tooltip}>
									<svg
										width="10"
										height="10"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										aria-label={item.tooltip}
										role="img"
									>
										<circle cx="8" cy="8" r="6" />
										<path d="M8 7v4" />
										<circle cx="8" cy="5" r="0.5" fill="currentColor" />
									</svg>
								</span>
							)}
						</div>
						<div
							className={`sg-meta-value${item.mono ? " mono" : ""}`}
							style={
								item.valueColor
									? { color: `var(--${item.valueColor})` }
									: undefined
							}
						>
							{item.value}
						</div>
						{item.sub && <div className="sg-meta-sub">{item.sub}</div>}
					</div>
				),
			)}
		</div>
	);
}
