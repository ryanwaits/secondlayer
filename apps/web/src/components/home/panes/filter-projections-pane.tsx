import { FILTERS_GATE_SNIPPET, FILTERS_PROJECTIONS } from "@/lib/home-snippets";

/**
 * V1 "projection board" right column: one destination row per surface, plus
 * the member-gating row rendered as the compile error it is. Static server
 * markup — the shell IS the argument, no animation needed.
 */
export function FilterProjectionsPane() {
	const [gateCall, gateComment] = FILTERS_GATE_SNIPPET.split("\n");
	return (
		<div className="home-proj-dests">
			{FILTERS_PROJECTIONS.map((p) => (
				<div key={p.surface} className="home-proj-dest">
					<div className="home-proj-dest-top">
						<span className="home-proj-surface">{p.surface}</span>
						<span className="home-proj-note">{p.note}</span>
					</div>
					<pre>
						<code>{p.code}</code>
					</pre>
				</div>
			))}
			<div className="home-proj-dest home-proj-gate">
				<div className="home-proj-dest-top">
					<span className="home-proj-surface">member gating</span>
					<span className="home-proj-note">
						<span className="x">✗</span> compile error, not an empty result
					</span>
				</div>
				<pre>
					<code>
						{gateCall}
						{"\n"}
						<span className="cm">{gateComment}</span>
					</code>
				</pre>
			</div>
		</div>
	);
}

/** The rails between the filter and its projections (desktop only). */
export function FilterProjectionRails() {
	return (
		<div className="home-proj-rails" aria-hidden="true">
			<svg viewBox="0 0 56 400" preserveAspectRatio="none">
				<title>projection rails</title>
				<path d="M0,200 C28,200 28,52 56,52" />
				<path d="M0,200 C28,200 28,150 56,150" />
				<path d="M0,200 C28,200 28,248 56,248" />
				<path d="M0,200 C28,200 28,348 56,348" />
				<circle cx="3" cy="200" r="3" />
			</svg>
		</div>
	);
}
