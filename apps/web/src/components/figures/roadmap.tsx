export type RoadmapStop = {
	/** Short mono label: "Phase 0", "Today". */
	when: string;
	title: string;
	body: string;
	/** shipped: ink pin. next: the yellow mark. later: an outline. */
	state: "shipped" | "next" | "later";
	/** Optional status words under the body ("built · grant pending"). */
	note?: string;
};

/**
 * B11 Roadmap — stops on one track, read left to right (top to bottom on a
 * phone). Static on purpose: direction, not dates. Ink means shipped, yellow
 * marks the next stop, outlines are everything after it.
 */
export function Roadmap({
	stops,
	ariaLabel,
}: {
	stops: RoadmapStop[];
	ariaLabel: string;
}) {
	return (
		<ol className="fig-road" aria-label={ariaLabel}>
			{stops.map((s) => (
				<li key={s.when} className={`fig-road-stop is-${s.state}`}>
					<span className="fig-road-pin" aria-hidden="true" />
					<span className="fig-road-when">{s.when}</span>
					<span className="fig-road-title">{s.title}</span>
					<span className="fig-road-body">{s.body}</span>
					{s.note && <span className="fig-road-note">{s.note}</span>}
				</li>
			))}
		</ol>
	);
}
