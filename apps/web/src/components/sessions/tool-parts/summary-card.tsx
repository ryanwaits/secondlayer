"use client";

import type { ReactNode } from "react";

export interface SummaryItem {
	icon: "check" | "stream" | "config";
	label: string;
	value?: string;
}

interface SummaryCardProps {
	title?: string;
	items: SummaryItem[];
}

const ICONS: Record<string, ReactNode> = {
	check: (
		<div className="summary-icon green">
			<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
				<circle cx="8" cy="8" r="6" />
				<path d="M5.5 8l2 2 3.5-3.5" />
			</svg>
		</div>
	),
	stream: (
		<div className="summary-icon blue">
			<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
				<circle cx="8" cy="8" r="2" />
				<path d="M2 8h4M10 8h4" />
			</svg>
		</div>
	),
	config: (
		<div className="summary-icon accent">
			<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
				<path d="M2 4h12M2 8h8M2 12h10" />
			</svg>
		</div>
	),
};

export function SummaryCard({ title, items }: SummaryCardProps) {
	return (
		<div className="tool-card">
			{title && <div className="tool-card-header">{title}</div>}
			{items.map((item, i) => (
				<div key={`summary-${i}`} className="summary-item">
					{ICONS[item.icon]}
					<span className="summary-label">{item.label}</span>
					{item.value && (
						<span className="summary-value">{item.value}</span>
					)}
				</div>
			))}
		</div>
	);
}
