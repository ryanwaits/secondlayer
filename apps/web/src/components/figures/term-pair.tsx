/**
 * A2 TermPair — two concepts held apart, side by side. The role colors
 * established here follow both terms through every later figure in the
 * post (blue = role a, amber = role b, never cycled).
 */
export function TermPair({
	a,
	b,
}: {
	a: { term: string; body: string };
	b: { term: string; body: string };
}) {
	return (
		<div className="fig-pair">
			<div className="fig-pair-card role-a">
				<h4>{a.term}</h4>
				<p>{a.body}</p>
			</div>
			<div className="fig-pair-card role-b">
				<h4>{b.term}</h4>
				<p>{b.body}</p>
			</div>
		</div>
	);
}
