// Read-only proxy: GET /api/sl/<network>/<path>. The key stays here, in env;
// the browser never sees it. Only the reads the catalog makes are forwarded,
// so even a public deploy cannot pause, replay, delete or list keys.
// Web-standard handler: runs under dev.ts (Bun) and as a Vercel Function.
import { NETWORKS, type Network, baseFor, isNetwork } from "../../lib/bases.js";

const SEG = "[A-Za-z0-9_-][A-Za-z0-9_.-]*";
const ALL: Network[] = ["mainnet", "testnet", "devnet"];
const SUBGRAPHS: Network[] = ["mainnet", "devnet"];

const ALLOW: Array<{ path: RegExp; networks: Network[] }> = [
	{ path: /^\/api\/webhooks$/, networks: ALL },
	{ path: new RegExp(`^/api/webhooks/${SEG}$`), networks: ALL },
	{
		path: new RegExp(`^/api/webhooks/${SEG}/(activity|deliveries|dead)$`),
		networks: ALL,
	},
	{
		path: new RegExp(`^/api/webhooks/${SEG}/deliveries/${SEG}$`),
		networks: ALL,
	},
	{ path: /^\/api\/subgraphs$/, networks: SUBGRAPHS },
	{ path: new RegExp(`^/api/subgraphs/${SEG}$`), networks: SUBGRAPHS },
	{
		path: new RegExp(`^/v1/subgraphs/${SEG}/${SEG}(/count|/aggregate)?$`),
		networks: SUBGRAPHS,
	},
	{ path: /^\/api\/billing\/usage$/, networks: ["mainnet"] },
];

// Viewers of a hosted page share one upstream read per path per window.
const CACHE_READ = "public, s-maxage=5, stale-while-revalidate=25";
const CACHE_USAGE = "public, s-maxage=300";
const CACHE_HEALTH = "public, s-maxage=60";
const HEALTH_TTL_MS = 60_000;
const DROP_HEADERS = [
	"set-cookie",
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
];

let health: { at: number; body: Record<string, unknown> } | null = null;

const json = (status: number, body: unknown, cache = "no-store") =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "cache-control": cache },
	});

async function probeHealth(): Promise<Record<string, unknown>> {
	if (health && Date.now() - health.at < HEALTH_TTL_MS) return health.body;
	const entries = await Promise.all(
		NETWORKS.map(async (network) => {
			const { url } = baseFor(network);
			// A network answers when its host returns any HTTP response below 500.
			const ok = await fetch(`${url}/health`, {
				signal: AbortSignal.timeout(1_500),
			})
				.then((res) => res.status < 500)
				.catch(() => false);
			return [network, { ok, base: url }] as const;
		}),
	);
	const body = Object.fromEntries(entries);
	health = { at: Date.now(), body };
	return body;
}

export async function GET(request: Request): Promise<Response> {
	if (request.method !== "GET") {
		return json(405, { error: "The dash proxy only reads" });
	}
	const url = new URL(request.url);
	const match = url.pathname.match(/^\/api\/sl\/([^/]+)(\/.*)?$/);
	if (!match) return json(404, { error: "Not a dash read" });
	const [, network, rest = ""] = match;

	if (network === "health" && rest === "") {
		return json(200, await probeHealth(), CACHE_HEALTH);
	}
	if (
		!isNetwork(network) ||
		!ALLOW.some((a) => a.path.test(rest) && a.networks.includes(network))
	) {
		return json(404, { error: `Not a dash read: ${network}${rest}` });
	}

	const base = baseFor(network);
	const headers: Record<string, string> = { accept: "application/json" };
	if (base.token) headers.authorization = `Bearer ${base.token}`;
	let upstream: Response;
	try {
		upstream = await fetch(`${base.url}${rest}${url.search}`, {
			headers,
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		const timedOut = err instanceof Error && err.name === "TimeoutError";
		return json(timedOut ? 504 : 502, {
			error: `${network} is not answering at ${base.url}`,
		});
	}

	const out = new Headers(upstream.headers);
	for (const name of DROP_HEADERS) out.delete(name);
	out.set(
		"cache-control",
		upstream.ok
			? rest === "/api/billing/usage"
				? CACHE_USAGE
				: CACHE_READ
			: "no-store",
	);
	return new Response(upstream.body, { status: upstream.status, headers: out });
}
