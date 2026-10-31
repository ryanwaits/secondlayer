#!/usr/bin/env bun
/**
 * Tells IndexNow engines (Bing and others) which pages a deploy changed.
 *
 * bun scripts/indexnow.ts <www|stacks> --from <sha> --to <sha>   changed pages
 * bun scripts/indexnow.ts <www|stacks> --all                     whole sitemap
 *
 * Only URLs in the live sitemap are sent, so drafts and signed-in routes never
 * leave. The key is public by design: engines fetch it from the site to prove
 * we own the host.
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const KEY = "a047a0d6f603e4724c8f021c46a27170";
const ENDPOINT = "https://api.indexnow.org/indexnow";

const SITES = {
	www: "www.secondlayer.tools",
	stacks: "stacks.secondlayer.tools",
} as const;

type Site = keyof typeof SITES;

/** The page route a changed source file renders, or null if it isn't a page. */
export function routeOf(site: Site, file: string): string | null {
	const match =
		site === "www"
			? file.match(
					/^apps\/web\/src\/app\/\(www\)\/(?:(.*)\/)?page\.(?:mdx|tsx)$/,
				)
			: file.match(/^apps\/stacks-docs\/docs\/pages\/(.*)\.mdx$/);
	if (!match) return null;
	const parts = (match[1] ?? "")
		.split("/")
		.filter((part) => part && !/^\(.*\)$/.test(part));
	// www has real /docs/index and /p/index pages; in stacks docs, index is a root.
	if (site === "stacks" && parts.at(-1) === "index") parts.pop();
	return `/${parts.join("/")}`;
}

/** Sitemap URLs a set of changed files maps to, deduped. */
export function changedUrls(
	site: Site,
	files: readonly string[],
	sitemap: readonly string[],
): string[] {
	const live = new Set(sitemap);
	const urls = new Set<string>();
	for (const file of files) {
		const route = routeOf(site, file);
		if (route === null) continue;
		const url = `https://${SITES[site]}${route === "/" ? "" : route}`;
		for (const candidate of [url, `${url}/`]) {
			if (live.has(candidate)) urls.add(candidate);
		}
	}
	return [...urls];
}

export function parseSitemap(xml: string): string[] {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string);
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			all: { type: "boolean", default: false },
			from: { type: "string" },
			to: { type: "string" },
		},
	});
	const site = positionals[0] as Site;
	const host = SITES[site];
	if (!host || (!values.all && !(values.from && values.to))) {
		throw new Error(
			"usage: indexnow.ts <www|stacks> (--all | --from <sha> --to <sha>)",
		);
	}

	const res = await fetch(`https://${host}/sitemap.xml`);
	if (!res.ok) throw new Error(`sitemap: HTTP ${res.status}`);
	const sitemap = parseSitemap(await res.text());

	const urlList = values.all
		? sitemap
		: changedUrls(
				site,
				execFileSync(
					"git",
					["diff", "--name-only", `${values.from}`, `${values.to}`],
					{ encoding: "utf8" },
				)
					.split("\n")
					.filter(Boolean),
				sitemap,
			);
	if (urlList.length === 0) {
		console.log(`${host}: no changed pages`);
		return;
	}

	const submit = await fetch(ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/json; charset=utf-8" },
		body: JSON.stringify({
			host,
			key: KEY,
			keyLocation: `https://${host}/${KEY}.txt`,
			urlList,
		}),
	});
	console.log(`${host}: ${urlList.length} urls → HTTP ${submit.status}`);
	// 200 accepted, 202 key still being checked. Anything else is a real failure.
	if (submit.status !== 200 && submit.status !== 202) {
		throw new Error(await submit.text());
	}
}

if (import.meta.main) await main();
