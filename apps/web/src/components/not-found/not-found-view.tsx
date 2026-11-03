"use client";

import { DocsDrawerProvider } from "@/app/(www)/docs/docs-drawer";
import { DocsSidebar } from "@/app/(www)/docs/docs-sidebar";
import { DASHBOARD_TABS } from "@/components/dashboard/shell/dashboard-tabs";
import { DocsTopNav } from "@/components/docs-top-nav";
import { MarketingNav } from "@/components/marketing-nav";
import { NotFoundTracker } from "@/components/not-found-tracker";
import {
	type DocsSearchDoc,
	buildIndex,
	searchTokens,
	tokenize,
} from "@/lib/docs-bm25";
import {
	type Route,
	closestRoutes,
	correctTokens,
	pathQuery,
} from "@/lib/not-found-match";
import { PRODUCTS } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MissingMark } from "./missing-mark";
import "@/app/(www)/site.css";
import "@/app/(www)/docs/docs.css";
import "./not-found.css";

type Routes = { site: Route[]; docs: Route[] };

const ACCOUNT_ROUTES: Route[] = DASHBOARD_TABS.filter((t) => t.ready).map(
	(t) => ({ href: t.href, title: t.label }),
);

const inSection = (path: string, root: string) =>
	path === root || path.startsWith(`${root}/`);

export function NotFoundView({ routes }: { routes: Routes }) {
	const path = usePathname() ?? "/";
	if (inSection(path, "/docs")) {
		return <DocsNotFound path={path} routes={routes.docs} />;
	}
	if (inSection(path, "/account")) {
		return <AccountNotFound path={path} routes={ACCOUNT_ROUTES} />;
	}
	return <SiteNotFound path={path} routes={routes.site} />;
}

// ── site: block 404 ─────────────────────────────────────────────────────

/** Stacks block 404, from Index. Final since 2021, so it's written down
 *  here instead of read on every 404. */
const BLOCK_404 = {
	hash: "0xe4ab6c9f…f9fcb1cd",
	burnHeight: 666591,
	time: "2021-01-18T09:34:48.000Z",
};

function SiteNotFound({ path, routes }: { path: string; routes: Route[] }) {
	const [best] = closestRoutes(path, routes, 1);
	return (
		<div className="www">
			<NotFoundTracker boundary="root" />
			<MarketingNav />
			<main className="site nf-site">
				<div className="nf-copy">
					<h1>Block 404 exists. This page doesn't.</h1>
					<p>
						Stacks block 404 was mined on 18 January 2021, and it's in the
						index. Nothing is at <code>{path}</code>.
					</p>
					<div className="nf-actions">
						{best && best.href !== "/" ? (
							<>
								<Link className="btn btn-pri" href={best.href}>
									Go to {best.title}
								</Link>
								<Link className="btn btn-sec" href="/">
									Home
								</Link>
							</>
						) : (
							<Link className="btn btn-pri" href="/">
								Home
							</Link>
						)}
					</div>
					<nav className="nf-products" aria-label="Products">
						{PRODUCTS.map((p) => (
							<Link key={p.href} href={p.href}>
								{p.noun}
							</Link>
						))}
					</nav>
				</div>
				<figure
					className="nf-term"
					aria-label="Block 404 is in the index; this page returns 404"
				>
					<div className="nf-term-bar">
						<span>terminal</span>
					</div>
					<pre>
						<span className="nf-p">$</span> secondlayer index blocks get 404
						{"\n{\n"}
						{"  "}
						<span className="nf-k">"block_height"</span>: 404,{"\n  "}
						<span className="nf-k">"block_hash"</span>: "{BLOCK_404.hash}",
						{"\n  "}
						<span className="nf-k">"burn_block_height"</span>:{" "}
						{BLOCK_404.burnHeight},{"\n  "}
						<span className="nf-k">"block_time"</span>: "{BLOCK_404.time}",
						{"\n  "}
						<span className="nf-k">"canonical"</span>: <mark>true</mark>
						{"\n}\n\n"}
						<span className="nf-p">$</span> curl -sI secondlayer.tools{path} |
						head -1{"\n"}
						<span className="nf-bad">HTTP/2 404</span>
					</pre>
				</figure>
			</main>
		</div>
	);
}

// ── docs: closest page and matching sections ────────────────────────────

type DocsHit = { href: string; label: string; sub: string };

/** The search index the docs bar uses, ranked for the words in the path. */
function useDocsHits(path: string, closest: Route | undefined) {
	const closestHref = closest?.href;
	const closestTitle = closest?.title;
	const [state, setState] = useState<{
		lede: string | null;
		hits: DocsHit[];
	}>({ lede: null, hits: [] });
	useEffect(() => {
		let live = true;
		fetch("/docs/search-index.json")
			.then((res) => (res.ok ? (res.json() as Promise<DocsSearchDoc[]>) : []))
			.then((docs) => {
				if (!live || !docs.length) return;
				const index = buildIndex(docs);
				// The closest page's title says what the path was reaching for.
				const tokens = correctTokens(
					tokenize(`${pathQuery(path, "/docs")} ${closestTitle ?? ""}`),
					new Set(index.postings.keys()),
				);
				const byId = new Map(docs.map((d) => [d.id, d]));
				const hits = searchTokens(index, tokens, 12)
					.map((r) => byId.get(r.id))
					.filter((d): d is DocsSearchDoc => d?.kind === "section")
					.slice(0, 4)
					.map((d) => ({ href: d.href, label: d.label, sub: d.sub }));
				const lede = closestHref
					? (byId.get(`docs:${closestHref}`)?.body ?? null)
					: null;
				setState({ lede, hits });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [path, closestHref, closestTitle]);
	return state;
}

function DocsNotFound({ path, routes }: { path: string; routes: Route[] }) {
	const [best] = closestRoutes(path, routes, 1);
	const { lede, hits } = useDocsHits(path, best);
	return (
		<DocsDrawerProvider>
			<NotFoundTracker boundary="docs" />
			<DocsTopNav />
			<div className="docs-shell">
				<DocsSidebar />
				<main className="docs-content">
					<div className="nf-docs">
						<div>
							<span className="nf-eyebrow">404 · no docs page</span>
							<h1>
								Nothing at <code>{path}</code>
							</h1>
						</div>
						{best ? (
							<Link className="nf-near" href={best.href}>
								<span className="nf-near-row">
									<strong>{best.title}</strong>
									<code>{best.href}</code>
								</span>
								{lede ? <span className="nf-near-lede">{lede}</span> : null}
								<span className="nf-near-go">Open {best.title} ›</span>
							</Link>
						) : (
							<p className="nf-muted">
								No page is close to that path. Start from the{" "}
								<Link href="/docs">introduction</Link> or search above.
							</p>
						)}
						{hits.length ? (
							<section className="nf-hits">
								<h2>Sections that match</h2>
								<ul>
									{hits.map((h) => (
										<li key={h.href}>
											<Link href={h.href}>
												<span>{h.label}</span>
												<code>{h.href}</code>
											</Link>
										</li>
									))}
								</ul>
							</section>
						) : null}
						<p className="nf-muted">
							Agents: every page is in{" "}
							<a href="/llms-full.txt">
								<code>/llms-full.txt</code>
							</a>
							.
						</p>
					</div>
				</main>
			</div>
		</DocsDrawerProvider>
	);
}

// ── account: stay in the account chrome ─────────────────────────────────

function AccountNotFound({ path, routes }: { path: string; routes: Route[] }) {
	const near = closestRoutes(path, routes, 1);
	return (
		<div className="www">
			<NotFoundTracker boundary="account" />
			<MarketingNav />
			<main className="site nf-account">
				<div className="nf-gone">
					<MissingMark />
					<div>
						<h1>
							No account page at <code>{path}</code>
						</h1>
						<p>
							{near[0]
								? `You probably meant ${near[0].title}.`
								: "These are the account pages."}
						</p>
					</div>
				</div>
				<nav className="nf-pages" aria-label="Account pages">
					{(near.length ? near : routes).map((r, i) => (
						<Link
							key={r.href}
							href={r.href}
							className={near.length && i === 0 ? "btn btn-pri" : "btn btn-sec"}
						>
							{r.title}
						</Link>
					))}
					{near.length ? (
						<Link className="btn btn-sec" href="/account">
							Overview
						</Link>
					) : null}
				</nav>
			</main>
		</div>
	);
}
