import { mergeMarkers } from "./collide";

export type TimelineEvent = {
	/** Position on the axis, 0–100. */
	pos: number;
	label?: string;
	value?: string;
	role?: "a" | "b";
	major?: boolean;
};

/**
 * B3 Timeline — ordered events on one horizontal axis, with an optional
 * shaded span. Flags obey the B1 collision rule: events within 8% merge
 * their labels into one combined flag (joined with " · ").
 */
export function Timeline({
	events,
	span,
	ariaLabel,
}: {
	events: TimelineEvent[];
	span?: { from: number; to: number; label?: string };
	ariaLabel: string;
}) {
	const groups = mergeMarkers(events);

	return (
		<div className="fig-tl" role="img" aria-label={ariaLabel}>
			<div className="fig-tl-rail" />
			{span && (
				<>
					<div
						className="fig-tl-span"
						style={{ left: `${span.from}%`, right: `${100 - span.to}%` }}
					/>
					{span.label && (
						<span
							className="fig-tl-spanlab"
							style={{ left: `${(span.from + span.to) / 2}%` }}
						>
							{span.label}
						</span>
					)}
				</>
			)}
			{events.map((e) => (
				<div
					key={`tick-${e.pos}`}
					className={[
						"fig-tl-tick",
						e.major && "major",
						e.role && `role-${e.role}`,
					]
						.filter(Boolean)
						.join(" ")}
					style={{ left: `${e.pos}%` }}
				/>
			))}
			{groups.map((g) => {
				const labels = g.members
					.map((m) => m.label)
					.filter(Boolean)
					.join(" · ");
				const value = g.members[g.members.length - 1].value;
				const role = g.members.length === 1 ? g.members[0].role : undefined;
				return (
					<span key={`flag-${g.pos}`}>
						{labels && (
							<span
								className={`fig-tl-flag${role ? ` role-${role}` : ""}`}
								style={{ left: `${g.pos}%` }}
							>
								{labels}
							</span>
						)}
						{value && (
							<span className="fig-tl-val" style={{ left: `${g.pos}%` }}>
								{value}
							</span>
						)}
					</span>
				);
			})}
		</div>
	);
}
