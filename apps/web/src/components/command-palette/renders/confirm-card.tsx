"use client";

import type { ConfirmResource } from "@/lib/command/types";

interface ConfirmCardProps {
	title: string;
	description?: string;
	destructive?: boolean;
	resources: ConfirmResource[];
	onExecute: () => void;
	onCancel: () => void;
}

export function ConfirmCard({
	title,
	description,
	destructive,
	resources,
	onExecute,
	onCancel,
}: ConfirmCardProps) {
	return (
		<div className="palette-confirm">
			<div className="palette-confirm-header">{title}</div>
			{description && <div className="palette-confirm-desc">{description}</div>}
			<div className="palette-confirm-list">
				{resources.map((item, i) => (
					<div key={`${item.name}-${i}`} className="palette-confirm-item">
						{item.status && (
							<span className={`palette-dot palette-dot-${item.status}`} />
						)}
						<span className="palette-confirm-name">{item.name}</span>
						{item.meta && (
							<span className="palette-confirm-meta">{item.meta}</span>
						)}
					</div>
				))}
			</div>
			<div className="palette-confirm-actions">
				<button type="button" className="palette-btn" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className={`palette-btn ${destructive ? "palette-btn-danger" : ""}`}
					onClick={onExecute}
				>
					{title}
				</button>
			</div>
		</div>
	);
}
