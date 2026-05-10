import { StatusClient } from "./status-client";

export function StatusPageView({
	incidentHeading,
}: { incidentHeading: string }) {
	return (
		<main className="status-page">
			<header className="status-header">
				<a className="status-brand" href="/">
					secondlayer
				</a>
				<div>
					<p className="status-eyebrow">Public status</p>
					<h1>secondlayer</h1>
					<p className="status-intro">
						Live health for the API, Index decoders, the Foundation Datasets,
						and parquet freshness. Refreshes every 30 seconds.
					</p>
				</div>
			</header>

			<StatusClient incidentHeading={incidentHeading} />

			<footer className="status-footer">
				<a href="https://github.com/ryanwaits/secondlayer/blob/main/docs/incidents/INCIDENTS.md">
					docs/incidents/INCIDENTS.md
				</a>
				<a href="https://github.com/ryanwaits/secondlayer">GitHub</a>
			</footer>
		</main>
	);
}
