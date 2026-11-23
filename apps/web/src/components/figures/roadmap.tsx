export type RoadmapStop = {
	when: string;
	title: string;
	body: string;
	state: "shipped" | "next" | "later";
	note?: string;
};

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
