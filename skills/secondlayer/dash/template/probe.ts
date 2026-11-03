// bun probe.ts [network...]
// Prints, as JSON, which networks answer and what they hold: webhooks (id,
// name, status, triggers) and subgraphs (tables → columns). Naming networks
// limits the probe to them. `decision` applies the kit's network rule, so a
// spec can be written straight from this output.
import { decideNetworks } from "./kit.js";
import { NETWORKS, type Network, baseFor, isNetwork } from "./lib/bases.js";

interface ProbeWebhook {
	id: string;
	name: string;
	status: string;
	triggers: unknown[];
}

interface ProbeSubgraph {
	name: string;
	tables: Record<string, string[]>;
}

export interface ProbeNetwork {
	ok: boolean;
	reason?: string;
	webhooks: ProbeWebhook[];
	subgraphs: ProbeSubgraph[];
}

class ProbeError extends Error {}

async function read<T>(network: Network, path: string): Promise<T> {
	const base = baseFor(network);
	const headers: Record<string, string> = { accept: "application/json" };
	if (base.token) headers.authorization = `Bearer ${base.token}`;
	let res: Response;
	try {
		res = await fetch(`${base.url}${path}`, {
			headers,
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw new ProbeError(`not answering at ${base.url}`);
	}
	if (res.status === 401 || res.status === 403) {
		throw new ProbeError(
			network === "devnet"
				? "token missing or wrong: set INSTANCE_TOKEN"
				: "key missing or wrong: set SECONDLAYER_API_KEY",
		);
	}
	if (!res.ok) throw new ProbeError(`${res.status} from ${path}`);
	return (await res.json()) as T;
}

const seg = encodeURIComponent;

async function probeNetwork(network: Network): Promise<ProbeNetwork> {
	try {
		const list = await read<{ data: Array<{ id: string }> }>(
			network,
			"/api/webhooks",
		);
		const webhooks = await Promise.all(
			list.data.map(async ({ id }) => {
				const w = await read<ProbeWebhook>(network, `/api/webhooks/${seg(id)}`);
				return {
					id: w.id,
					name: w.name,
					status: w.status,
					triggers: w.triggers,
				};
			}),
		);
		// Testnet holds webhooks only.
		const subgraphs: ProbeSubgraph[] = [];
		if (network !== "testnet") {
			const names = await read<{ data: Array<{ name: string }> }>(
				network,
				"/api/subgraphs",
			);
			for (const { name } of names.data) {
				const detail = await read<{
					tables: Record<string, { columns: Record<string, unknown> }>;
				}>(network, `/api/subgraphs/${seg(name)}`);
				subgraphs.push({
					name,
					tables: Object.fromEntries(
						Object.entries(detail.tables).map(([t, v]) => [
							t,
							Object.keys(v.columns),
						]),
					),
				});
			}
		}
		return { ok: true, webhooks, subgraphs };
	} catch (err) {
		if (!(err instanceof ProbeError)) throw err;
		return { ok: false, reason: err.message, webhooks: [], subgraphs: [] };
	}
}

export async function probe(named: string[] = []) {
	const unknown = named.filter((n) => !isNetwork(n));
	if (unknown.length) {
		throw new Error(
			`unknown network ${unknown.join(", ")}; use ${NETWORKS.join(", ")}`,
		);
	}
	const networks = named.length ? (named as Network[]) : [...NETWORKS];
	const results = await Promise.all(networks.map(probeNetwork));
	const out = {
		at: new Date().toISOString(),
		networks: Object.fromEntries(networks.map((n, i) => [n, results[i]])),
	};
	return {
		...out,
		decision: {
			webhooks: decideNetworks({ named, probe: out, resource: "webhooks" }),
			subgraphs: decideNetworks({ named, probe: out, resource: "subgraphs" }),
		},
	};
}

if (import.meta.main) {
	console.log(JSON.stringify(await probe(process.argv.slice(2)), null, 2));
}
