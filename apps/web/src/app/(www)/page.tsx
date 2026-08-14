import { CtaPill } from "@/components/home/cta-pill";
import { HomeStatusBadge } from "@/components/status/home-status-badge";
import { socialMeta } from "@/lib/og";
import { readStatusSnapshot } from "@/lib/status-snapshot";
import type { SystemStatus } from "@/lib/types";
import type { Metadata } from "next";
import Link from "next/link";
import { CreditsBuy } from "./credits-buy";

export const metadata: Metadata = socialMeta({
	title: "secondlayer — self-hosted Stacks data",
	description:
		"Postgres plus one container beside your node. The signed archive is public to check. Large restore and backfill off our R2 is metered.",
	image: "/og/home.png",
	path: "/",
});

const SURFACES = [
	{
		name: "Streams",
		what: "Raw signed firehose and parquet dumps",
		href: "/docs/streams",
	},
	{
		name: "Index",
		what: "Decoded events, transfers, blocks, transactions",
		href: "/docs/index",
	},
	{
		name: "Subgraphs",
		what: "Your schema on this instance",
		href: "/docs/subgraphs",
	},
] as const;

const HOW = `sl init --network mainnet
cd docker/oss && docker compose up -d
sl observer --mode indexer --endpoint secondlayer:3700
sl bootstrap --against <manifest>
sl verify all --against <manifest>`;

export default async function Home() {
	const status = await readStatusSnapshot();
	return <HomeView status={status} />;
}

export function HomeView({ status }: { status: SystemStatus | null }) {
	return (
		<div className="home">
			<HomeStatusBadge status={status} />

			<section className="home-hero">
				<Link href="/docs/self-host" className="home-pill">
					<span className="home-pill-dot" />
					Postgres plus one container
					<span className="home-pill-arr">→</span>
				</Link>
				<h1>
					Self-hosted
					<br />
					Stacks data.
				</h1>
				<p className="home-sub">
					Run it beside your node. Bootstrap verified history. Query decoded
					data. Deploy TypeScript subgraphs.
				</p>
				<div className="home-ctas">
					<CtaPill />
					<Link href="/docs/self-host" className="home-ghost-cta">
						Self-host <span className="ar">→</span>
					</Link>
				</div>
			</section>

			<section className="home-land">
				<div className="home-wrap">
					<h2>What you run</h2>
					<p>
						One runtime. Three surfaces. Not hosted products — capabilities on
						the machine you operate.
					</p>
					<ul className="home-land-list">
						{SURFACES.map((s) => (
							<li key={s.name}>
								<Link href={s.href}>
									<span className="n">{s.name}</span>
									<span className="w">{s.what}</span>
									<span className="ar">→</span>
								</Link>
							</li>
						))}
					</ul>
				</div>
			</section>

			<section className="home-land" id="history">
				<div className="home-wrap">
					<h2>History</h2>
					<p>
						Follow your node for free. Or restore from the signed archive. The
						signed archive is public to check. Large restore and backfill off
						our R2 is metered.
					</p>
					<table className="home-land-table">
						<thead>
							<tr>
								<th>Free</th>
								<th>Metered</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Runtime, compose, CLI</td>
								<td>Official-archive bootstrap</td>
							</tr>
							<tr>
								<td>Forward-only from your node</td>
								<td>Backfill / reindex that reads our R2</td>
							</tr>
							<tr>
								<td>
									<code>sl verify</code> / <code>sl repair</code>
								</td>
								<td> </td>
							</tr>
						</tbody>
					</table>
					<CreditsBuy />
					<p className="home-land-more">
						<Link href="/docs/archive">
							Verified archive <span className="ar">→</span>
						</Link>
					</p>
				</div>
			</section>

			<section className="home-land">
				<div className="home-wrap">
					<h2>How</h2>
					<p>Bootstrap is optional if you only follow the node forward.</p>
					<pre className="home-land-pre">
						<code>{HOW}</code>
					</pre>
				</div>
			</section>

			<section className="home-final">
				<h2>
					Your node.
					<br />
					Your schema.
				</h2>
				<p className="home-sub">
					Docs for the surfaces. Archive for the check.
				</p>
				<div className="home-ctas">
					<Link href="/docs" className="home-ghost-cta">
						Read the docs <span className="ar">→</span>
					</Link>
				</div>
			</section>
		</div>
	);
}
