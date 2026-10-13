import GithubSlugger from "github-slugger";
import {
	type Endpoint,
	type ObjectEntry,
	allEndpoints,
	endpointMarkdown,
	objectMarkdown,
	objectsByTag,
} from "./spec";

/**
 * The API reference as six pages by job. Each page owns some OpenAPI tags and
 * splits their endpoints into families (the page's `##` sections). A family
 * lists exact paths, or a prefix when it ends in `*`. Endpoints no family
 * claims land in a trailing "Other" family; the test keeps it empty, so a new
 * path must be assigned here.
 */

export type ApiFamily = {
	title: string;
	summary: string;
	paths: string[];
};

export type ApiPage = {
	slug: string;
	title: string;
	tags: string[];
	families: ApiFamily[];
};

export const API_PAGES: ApiPage[] = [
	{
		slug: "index",
		title: "Index API",
		tags: ["index"],
		families: [
			{
				title: "Events",
				summary: "Decoded events and the transfers and calls built from them.",
				paths: [
					"/v1/index/events",
					"/v1/index/ft-transfers",
					"/v1/index/nft-transfers",
					"/v1/index/contract-calls",
				],
			},
			{
				title: "Blocks and transactions",
				summary: "Canonical blocks, full transactions and inclusion proofs.",
				paths: [
					"/v1/index/canonical",
					"/v1/index/blocks",
					"/v1/index/blocks/*",
					"/v1/index/transactions",
					"/v1/index/transactions/*",
				],
			},
			{
				title: "Mempool",
				summary: "Pending transactions before they confirm.",
				paths: ["/v1/index/mempool", "/v1/index/mempool/*"],
			},
			{
				title: "Contracts",
				summary: "What a contract prints.",
				paths: ["/v1/index/contracts/*"],
			},
			{
				title: "State writes",
				summary: "Every map and variable write, in order.",
				paths: ["/v1/index/state-writes"],
			},
			{
				title: "PoX",
				summary: "Stacking actions, reward cycles and PoX-5 events.",
				paths: ["/v1/index/stacking", "/v1/index/pox/*", "/v1/index/pox5/*"],
			},
			{
				title: "Runes",
				summary: "The rune catalog, activity and balances.",
				paths: ["/v1/index/runes", "/v1/index/runes/*"],
			},
			{
				title: "sBTC",
				summary: "Peg-ins, peg-outs and the peg summary.",
				paths: ["/v1/index/sbtc/*"],
			},
			{
				title: "Discovery",
				summary: "What this index serves.",
				paths: ["/v1/index"],
			},
		],
	},
	{
		slug: "streams",
		title: "Streams API",
		tags: ["streams"],
		families: [
			{
				title: "Firehose",
				summary: "Raw events in chain order, paged by cursor.",
				paths: ["/v1/streams", "/v1/streams/events"],
			},
			{
				title: "Live tail",
				summary: "The same events over server-sent events.",
				paths: ["/v1/streams/events/stream"],
			},
			{
				title: "Reorgs and tip",
				summary: "Which blocks were replaced, and where the chain ends now.",
				paths: [
					"/v1/streams/reorgs",
					"/v1/streams/canonical/*",
					"/v1/streams/tip",
				],
			},
		],
	},
	{
		slug: "proofs",
		title: "Proofs API",
		tags: ["proofs"],
		families: [
			{
				title: "Signed blocks",
				summary: "A block with the signer set that approved it.",
				paths: ["/v1/proofs/block/*", "/v1/proofs/epoch2-header/*"],
			},
			{
				title: "Bitcoin anchoring",
				summary: "The Bitcoin blocks Stacks blocks are anchored to.",
				paths: ["/v1/proofs/burn/*", "/v1/proofs/bitcoin-headers"],
			},
			{
				title: "State proofs",
				summary: "Witnesses, writes and MARF inclusion proofs for state.",
				paths: [
					"/v1/proofs/witness/*",
					"/v1/proofs/writes/*",
					"/v1/proofs/marf/*",
				],
			},
		],
	},
	{
		slug: "subgraphs",
		title: "Subgraphs API",
		tags: ["subgraphs", "deployments"],
		families: [
			{
				title: "Read rows",
				summary: "Query, count, aggregate and stream a table.",
				paths: [
					"/v1/subgraphs/{name}/{table}",
					"/v1/subgraphs/{name}/{table}/*",
				],
			},
			{
				title: "Describe a subgraph",
				summary: "List subgraphs and read their schema and docs.",
				paths: [
					"/v1/subgraphs",
					"/v1/subgraphs/{name}",
					"/v1/subgraphs/{name}/openapi.json",
					"/v1/subgraphs/{name}/schema.json",
					"/v1/subgraphs/{name}/docs.md",
				],
			},
			{
				title: "Deploy and operate",
				summary: "Deploy, reindex, backfill and inspect a subgraph.",
				paths: ["/api/subgraphs", "/api/subgraphs/*"],
			},
		],
	},
	{
		slug: "webhooks",
		title: "Webhooks API",
		tags: ["webhooks"],
		families: [
			{
				title: "Manage",
				summary: "Create, change, pause and delete a webhook.",
				paths: [
					"/api/webhooks",
					"/api/webhooks/{id}",
					"/api/webhooks/{id}/pause",
					"/api/webhooks/{id}/resume",
					"/api/webhooks/{id}/rotate-secret",
				],
			},
			{
				title: "Deliveries",
				summary: "Send a test and read every attempt.",
				paths: ["/api/webhooks/{id}/test", "/api/webhooks/{id}/deliveries"],
			},
			{
				title: "Recovery",
				summary: "Requeue dead events and replay a block range.",
				paths: [
					"/api/webhooks/{id}/dead",
					"/api/webhooks/{id}/dead/*",
					"/api/webhooks/{id}/replay",
				],
			},
		],
	},
	{
		slug: "instance",
		title: "Instance API",
		tags: ["general", "instance", "archive", "node"],
		families: [
			{
				title: "Discovery and batch",
				summary: "Surfaces, batched reads and this OpenAPI document.",
				paths: ["/v1", "/v1/batch", "/v1/openapi.json"],
			},
			{
				title: "Your instance",
				summary: "The catalog, features and vitals of this instance.",
				paths: ["/v1/instance", "/v1/instance/*"],
			},
			{
				title: "Archive check",
				summary: "Verify this instance against a signed archive.",
				paths: ["/v1/archive/*"],
			},
			{
				title: "Node",
				summary: "Reads proxied from the local Stacks node.",
				paths: ["/api/node/*"],
			},
		],
	},
];

const OTHER = "Other";

/** A path list claims a path exactly, or by prefix when the entry ends in `*`. */
function claims(family: ApiFamily, path: string): boolean {
	return family.paths.some((p) =>
		p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : p === path,
	);
}

/** Every family on the page that claims this path (exactly one is correct). */
export function familiesClaiming(page: ApiPage, path: string): ApiFamily[] {
	return page.families.filter((f) => claims(f, path));
}

export type PageFamily = {
	title: string;
	id: string;
	summary: string;
	endpoints: Endpoint[];
};

export type PageContent = {
	page: ApiPage;
	families: PageFamily[];
	objects: ObjectEntry[];
};

/** Family titles as heading ids, the way rehype-slug makes them. */
export function familyId(title: string): string {
	return new GithubSlugger().slug(title);
}

export function pageForTag(tag: string): ApiPage | undefined {
	return API_PAGES.find((p) => p.tags.includes(tag));
}

export function findApiPage(slug: string): ApiPage | undefined {
	return API_PAGES.find((p) => p.slug === slug);
}

/** A page's endpoints grouped into its families, in spec order within each. */
export function pageContent(page: ApiPage): PageContent {
	const byFamily = new Map<string, Endpoint[]>();
	for (const endpoint of allEndpoints()) {
		if (!page.tags.includes(endpoint.tag)) continue;
		const title = familiesClaiming(page, endpoint.path)[0]?.title ?? OTHER;
		byFamily.set(title, [...(byFamily.get(title) ?? []), endpoint]);
	}
	const families = [
		...page.families,
		{ title: OTHER, summary: "Endpoints no family claims yet.", paths: [] },
	]
		.map((family) => ({
			title: family.title,
			id: familyId(family.title),
			summary: family.summary,
			endpoints: byFamily.get(family.title) ?? [],
		}))
		.filter((f) => f.endpoints.length > 0);
	const objects = objectsByTag();
	return {
		page,
		families,
		objects: page.tags.flatMap((tag) => objects.get(tag) ?? []),
	};
}

/** A page's families, endpoints and objects as markdown, one level below the
 *  page's own `#` title. The same spec text the drawer renders. */
export function pageMarkdown(page: ApiPage): string {
	const { families, objects } = pageContent(page);
	const demote = (md: string) => md.replace(/^(#{2,3}) /gm, "#$1 ");
	return [
		...families.map((family) =>
			[
				`## ${family.title}`,
				family.summary,
				...family.endpoints.map((e) => demote(endpointMarkdown(e))),
			].join("\n\n"),
		),
		...(objects.length
			? [
					["## Objects", ...objects.map((o) => demote(objectMarkdown(o)))].join(
						"\n\n",
					),
				]
			: []),
	].join("\n\n");
}

/** Every endpoint and object anchor with the page slug that holds it. */
export function anchorPages(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const endpoint of allEndpoints()) {
		const page = pageForTag(endpoint.tag);
		if (page) out[endpoint.anchor] = page.slug;
	}
	for (const [tag, entries] of objectsByTag()) {
		const page = pageForTag(tag);
		if (!page) continue;
		for (const entry of entries) out[entry.anchor] = page.slug;
	}
	return out;
}

export function apiPageHref(slug: string): string {
	return `/docs/api/${slug}`;
}
