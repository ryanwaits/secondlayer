import type { ReactNode } from "react";

export type MatrixCell = {
	/** Small uppercase lead-in above the term ("you lose the"). */
	kicker?: string;
	title: string;
	/** Lighter-weight parenthetical after the title. */
	titleNote?: string;
	role?: "a" | "b";
	body: ReactNode;
	/** The outcome line under the card; `href` makes it a link to that path. */
	cost?: { label: string; tone: "cheap" | "dear"; href?: string };
};

/**
 * A3 Matrix: side-by-side tradeoff cards in one bordered grid. Role is
 * carried by a dot marker before the term (never an accent stripe); each
 * card ends on its outcome line in the ok/alarm semantic colors.
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
							{cell.cost.href ? (
								<a
									className={`fig-cost ${cell.cost.tone}`}
									href={cell.cost.href}
								>
									{cell.cost.label}
								</a>
							) : (
								<span className={`fig-cost ${cell.cost.tone}`}>
									{cell.cost.label}
								</span>
							)}
						</p>
					)}
				</div>
			))}
		</div>
	);
}
