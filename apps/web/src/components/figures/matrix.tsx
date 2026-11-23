import type { ReactNode } from "react";

export type MatrixCell = {
	kicker?: string;
	title: string;
	titleNote?: string;
	role?: "a" | "b";
	body: ReactNode;
	cost?: { label: string; tone: "cheap" | "dear"; href?: string };
};

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
