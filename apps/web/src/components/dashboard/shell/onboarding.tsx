import { IntentLink } from "@/components/intent-link";
import type { ReactNode } from "react";

export function ReadsKeyLine({ state }: { state: "first" | "none_active" }) {
	return (
		<p className="ob-key">
			<span className="ob-key-text">
				{state === "first"
					? "Reads need a key."
					: "No active key. New reads need one."}
			</span>
			<IntentLink href="/account/keys" className="dash-link">
				Make one on Keys ›
			</IntentLink>
		</p>
	);
}

export interface ChecklistStep {
	title: string;
	body: ReactNode;
	done: boolean;
	current: boolean;
	extra?: ReactNode;
}

export function Checklist({ steps }: { steps: readonly ChecklistStep[] }) {
	return (
		<ol className="ob-steps">
			{steps.map((step, i) => (
				<li
					key={step.title}
					className={`ob-step${step.done ? " done" : ""}${step.current ? " current" : ""}`}
					aria-current={step.current ? "step" : undefined}
				>
					<span className="ob-num" aria-hidden="true">
						{step.done ? "✓" : i + 1}
					</span>
					<div className="ob-step-main">
						<p className="ob-step-title">
							{step.title}
							{step.done ? <span className="ob-sr"> (done)</span> : null}
						</p>
						<p className="ob-step-body">{step.body}</p>
						{step.current && step.extra ? step.extra : null}
					</div>
				</li>
			))}
		</ol>
	);
}

export interface PlaceholderRow {
	name?: string;
	state?: number;
	count?: number;
}

export function PlaceholderRows({
	rows,
	note,
}: {
	rows: readonly PlaceholderRow[];
	note?: string;
}) {
	return (
		<div className="ob-ph-wrap">
			<div className="ob-ph" aria-hidden="true">
				{rows.map((row, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static decoration
						key={i}
						className="ob-ph-row"
					>
						{row.name ? (
							<span className="ob-ph-name">{row.name}</span>
						) : (
							<span className="ob-bar" style={{ width: "46%" }} />
						)}
						<span className="ob-bar" style={{ width: `${row.state ?? 70}%` }} />
						<span className="ob-bar" style={{ width: `${row.count ?? 60}%` }} />
					</div>
				))}
			</div>
			{note ? <p className="ob-ph-note">{note}</p> : null}
		</div>
	);
}
