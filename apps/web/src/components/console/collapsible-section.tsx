"use client";

import { useState } from "react";

interface CollapsibleSectionProps {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	children: React.ReactNode;
}

export function CollapsibleSection({
	title,
	count,
	defaultOpen = true,
	children,
}: CollapsibleSectionProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div className={`ov-section${open ? "" : " collapsed"}`}>
			<div className="ov-section-header" onClick={() => setOpen(!open)}>
				<span className="ov-section-chevron">
					<svg
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					>
						<path d="M4 6l4 4 4-4" />
					</svg>
				</span>
				<span className="ov-section-title">{title}</span>
				{count != null && <span className="ov-section-count">{count}</span>}
			</div>
			<div className="ov-section-body">{children}</div>
		</div>
	);
}
