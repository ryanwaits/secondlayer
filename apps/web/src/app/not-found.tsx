import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Not found · secondlayer",
	robots: { index: false, follow: false },
};

export default function NotFound() {
	return (
		<div className="homepage">
			<header className="page-header">
				<h1 className="page-title">404</h1>
				<p className="page-sub">that page does not exist</p>
			</header>

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				<div className="index-year-group">
					<div className="index-year">Try</div>
					<div className="prose www-manifest">
						<p>
							<Link href="/">Home</Link> · the manifest and the five layers.
						</p>
						<p>
							<Link href="/tools">Docs</Link> · subgraphs, SDK, CLI, MCP, Stacks
							helpers.
						</p>
						<p>
							<Link href="/datasets">Datasets</Link> · STX transfers, sBTC,
							PoX-4, BNS, network health.
						</p>
					</div>
				</div>
			</section>
		</div>
	);
}
