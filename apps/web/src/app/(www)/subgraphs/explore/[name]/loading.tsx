// Instant skeleton shown the moment a card is clicked, so navigation always
// gives feedback even when the page renders on-demand (cold) rather than from
// the prebuilt static set. Mirrors the DetailBody two-column shape.
export default function Loading() {
	return (
		<>
			<nav
				className="explore-crumb"
				aria-label="Breadcrumb"
				style={{
					maxWidth: 1180,
					margin: "3rem auto 1rem",
					padding: "0 1.5rem",
				}}
			>
				Subgraphs <span>/</span> Explore <span>/</span> …
			</nav>
			<div
				className="explore-ref"
				aria-busy="true"
				aria-label="Loading subgraph"
			>
				<div className="explore-skel" style={{ display: "block" }}>
					<div
						className="explore-skel-card"
						style={{ height: "auto", gap: "1.1rem" }}
					>
						<span className="explore-skel-line w1" style={{ height: 18 }} />
						<span className="explore-skel-line w2" />
						<span className="explore-skel-line w3" />
					</div>
					{[0, 1, 2].map((i) => (
						<div
							key={i}
							className="explore-skel-card"
							style={{ height: 120, marginTop: "1rem" }}
						>
							<span className="explore-skel-line w1" />
							<span className="explore-skel-line w2" />
							<span className="explore-skel-line w3" />
						</div>
					))}
				</div>
				<aside className="explore-rail" aria-hidden="true">
					<div className="explore-skel-card" style={{ height: 220 }}>
						<span className="explore-skel-line w1" />
						<span className="explore-skel-line w2" />
						<span className="explore-skel-line w3" />
					</div>
				</aside>
			</div>
		</>
	);
}
