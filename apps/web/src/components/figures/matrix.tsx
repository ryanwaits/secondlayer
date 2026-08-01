import type { ReactNode } from "react";

export type MatrixCell = {
	/** Small uppercase lead-in above the term ("you lose the"). */
	kicker?: string;
	title: string;
	/** Lighter-weight parenthetical after the title. */
	titleNote?: string;
	role?: "a" | "b";
	body: ReactNode;
	cost?: { label: string; tone: "cheap" | "dear" };
};

/**
 * A3 Matrix — side-by-side tradeoff/asymmetry cards. Role is carried by a
 * dot marker before the term (never an accent stripe); costs are chips in
 * the ok/alarm semantic colors.
 */
export function Matrix({ cells }: { cells: MatrixCell[] }) {
	return (
		<div className="fig-asym">
			{cells.map((cell) => (
				<div
					key={cell.title}
					className={`fig-asym-card${cell.role ? ` role-${cell.role}` : ""}`}
				>
					{cell.kicker && <div className="fig-asym-kicker">{cell.kicker}</div>}
					<h4>
						{cell.title}
						{cell.titleNote && <span className="soft"> {cell.titleNote}</span>}
					</h4>
					{cell.body}
					{cell.cost && (
						<p>
							<span className={`fig-cost ${cell.cost.tone}`}>
								{cell.cost.label}
							</span>
						</p>
					)}
				</div>
			))}
		</div>
	);
}
