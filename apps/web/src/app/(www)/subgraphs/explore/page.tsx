import { CopyButton } from "@/components/copy-button";
import { PLATFORM_API_URL } from "@/lib/api";
import type { Metadata } from "next";
import Link from "next/link";
import type { ExploreList, ExploreSummary } from "./types";
import { FEATURED } from "./types";

export const metadata: Metadata = {
	title: "Explore Subgraphs | secondlayer",
	description:
		"Public subgraphs deployed on Secondlayer — live, custom indexed views of Stacks, readable by anyone. No key needed.",
};

export const revalidate = 30;

// R1 curation: hardcoded featured allowlist (first-party seeds). Curation =
// git commit until non-first-party listings exist; then a featured flag.

const fmt = new Intl.NumberFormat("en-US");

async function fetchList(): Promise<ExploreSummary[]> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/v1/subgraphs`, {
			next: { revalidate: 30 },
		});
		if (!res.ok) return [];
		const body = (await res.json()) as ExploreList;
		// Directory lists managed public subgraphs only — public BYO reads hit
		// the owner's own database, so we don't aim anonymous traffic at them.
		return body.subgraphs.filter(
			(s) => s.visibility === "public" && s.total_rows !== null,
		);
	} catch {
		return [];
	}
}

function Freshness({ sg }: { sg: ExploreSummary }) {
	const lagging = sg.blocks_behind > 2;
	return (
		<span className="explore-stat">
			<span className={`explore-dot${lagging ? " lag" : ""}`} />
			{lagging ? `${fmt.format(sg.blocks_behind)} behind` : "synced"}
		</span>
	);
}

function Card({
	sg,
	wide,
	featured,
}: { sg: ExploreSummary; wide?: boolean; featured?: boolean }) {
	const firstTable = sg.tables[0];
	const path = `/v1/subgraphs/${sg.name}${firstTable && wide ? `/${firstTable}` : ""}`;
	return (
		<Link href={`/subgraphs/explore/${sg.name}`} className="explore-card-link">
			<article className="explore-card">
				<div className="explore-card-top">
					<span className="explore-name">{sg.name}</span>
					{featured && <span className="explore-by">by secondlayer</span>}
					<Freshness sg={sg} />
				</div>
				<p className="explore-desc">{sg.description ?? "—"}</p>
				<div className="explore-ep">
					<span className="explore-ep-method">GET</span>
					<span className="explore-ep-path">
						{wide && firstTable ? (
							<>
								/v1/subgraphs/{sg.name}
								<span className="dim">/{firstTable}</span>
							</>
						) : (
							path
						)}
					</span>
					<CopyButton code={`curl ${PLATFORM_API_URL}${path}`} />
				</div>
				<div className="explore-card-foot">
					{sg.tables.slice(0, 4).map((t) => (
						<span key={t} className="explore-tchip">
							{t}
						</span>
					))}
					{sg.total_rows !== null && (
						<span className="explore-rows">
							{fmt.format(sg.total_rows)} rows
						</span>
					)}
				</div>
			</article>
		</Link>
	);
}

export default async function ExplorePage() {
	const all = await fetchList();
	const featured = FEATURED.map((n) => all.find((s) => s.name === n)).filter(
		(s): s is ExploreSummary => s !== undefined,
	);
	const rest = all.filter((s) => !FEATURED.includes(s.name));

	return (
		<main className="explore-wrap">
			<nav className="explore-crumb" aria-label="Breadcrumb">
				<Link href="/subgraphs">Subgraphs</Link>
				<span>/</span>Explore
			</nav>

			<section className="explore-hero">
				<h1>Explore</h1>
				<span className="explore-hero-note" aria-hidden="true">
					live views, <em>no key needed</em>
				</span>
				<p>
					Public subgraphs deployed on Secondlayer — custom indexed views of
					Stacks, readable by anyone. Every card is a live API. Copy the
					endpoint and you&apos;re querying.
				</p>
			</section>

			{featured.length > 0 && (
				<>
					<section className="explore-sect">
						<h2>Pinned</h2>
						<span className="explore-count">curated</span>
					</section>
					<div className="explore-grid featured">
						{featured.map((sg) => (
							<Card key={sg.name} sg={sg} wide featured />
						))}
					</div>
				</>
			)}

			{rest.length > 0 && (
				<>
					<section className="explore-sect">
						<h2>All public subgraphs</h2>
						<span className="explore-count">{all.length} listed</span>
					</section>
					<div className="explore-grid">
						{rest.map((sg) => (
							<Card key={sg.name} sg={sg} />
						))}
					</div>
				</>
			)}

			{all.length === 0 && (
				<p className="explore-desc" style={{ marginTop: "2rem" }}>
					Nothing public yet — be the first:{" "}
					<code>sl subgraphs deploy my-view.ts</code>
				</p>
			)}

			<div className="explore-machine">
				<div className="explore-machine-head">
					<span className="t">machine access</span>
					<CopyButton code={`curl ${PLATFORM_API_URL}/v1/subgraphs`} />
				</div>
				<pre>
					<span className="c"># all public subgraphs, as JSON — no key</span>
					{"\n"}
					<span className="m">curl</span> {PLATFORM_API_URL}/v1/subgraphs
				</pre>
			</div>

			<div className="explore-listed">
				<span className="lead">Get listed.</span>
				<code>sl subgraphs publish &lt;name&gt;</code>
				<span className="fine">
					Managed deploys are public by default — publishing claims your name
					globally and adds it here.
				</span>
			</div>
		</main>
	);
}
