import Link from "next/link";
import type { ReactNode } from "react";

/** Rows only: reads need a key. A link to Keys, never a button (the button lives on Keys). */
export function ReadsKeyLine({ state }: { state: "first" | "none_active" }) {
	return (
		<p className="ob-key">
			<span className="ob-key-text">
				<span className="dash-dot hi" />
				{state === "first"
					? "Reads need a key."
					: "No active key. New reads need one."}
			</span>
			<Link href="/account/keys" className="dash-link">
				Make one on Keys ›
			</Link>
		</p>
	);
}

export interface ChecklistStep {
	title: string;
	body: ReactNode;
	done: boolean;
	/** The step to do next: gets the blue ring. */
	current: boolean;
	/** Shown under the body while this step is the current one. */
	extra?: ReactNode;
}

/** A short ordered list: a numbered circle per step, a check when done. */
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
	/** Real text for the first cell, or a grey bar when absent. */
	name?: string;
	/** Bar widths, in percent, for the state and count cells. */
	state?: number;
	count?: number;
}

/** Faint rows that preview what fills in. Not interactive, hidden from readers. */
export function PlaceholderRows({
	rows,
	note,
}: {
	rows: readonly PlaceholderRow[];
	/** A line under the rows, such as "These fill in as you go." */
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
