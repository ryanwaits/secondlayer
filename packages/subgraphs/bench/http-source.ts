/**
 * Sprint-0 bench (S0.T2): HTTP (Index API) data-acquisition ceiling.
 *
 * Measures how fast the SAME block data can be pulled over the public Index
 * API — `/v1/index/blocks` enumeration + `/v1/index/events` per referenced
 * type (+ `/v1/index/contract-calls` when requested) — in blocks/sec over the
 * SAME height range as db-tap.ts. Pure data acquisition; no raw-row
 * reconstruction (the upper bound on the HTTP path's speed).
 *
 * Runs cold then warm (back-to-back) to expose the finalized-page cache delta.
 * Run in-cluster against http://api:3800 for a fair comparison.
 *
 *   bun run packages/subgraphs/bench/http-source.ts --from H1 --to H2 \
 *     [--event-type ft_transfer] [--contract-calls] [--page-size 1000] \
 *     [--base-url http://api:3800] [--api-key sk-…]
 */
import { Index } from "@secondlayer/sdk";

function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
}
function flag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function fetchRange(
	idx: Index,
	eventTypes: string[],
	withContractCalls: boolean,
	from: number,
	to: number,
	batchSize: number,
): Promise<{ blocks: number; events: number; contractCalls: number }> {
	let blocks = 0;
	let events = 0;
	let contractCalls = 0;

	for await (const _b of idx.blocks.walk({
		fromHeight: from,
		toHeight: to,
		batchSize,
	})) {
		blocks++;
	}
	for (const et of eventTypes) {
		for await (const _e of idx.events.walk({
			// biome-ignore lint/suspicious/noExplicitAny: event-type union, validated server-side
			eventType: et as any,
			fromHeight: from,
			toHeight: to,
			batchSize,
		})) {
			events++;
		}
	}
	if (withContractCalls) {
		for await (const _c of idx.contractCalls.walk({
			fromHeight: from,
			toHeight: to,
			batchSize,
		})) {
			contractCalls++;
		}
	}
	return { blocks, events, contractCalls };
}

async function main(): Promise<void> {
	const from = Number(arg("from"));
	const to = Number(arg("to"));
	const baseUrl = arg(
		"base-url",
		process.env.STREAMS_API_URL ?? "http://api:3800",
	);
	const apiKey = arg("api-key", process.env.INDEX_API_KEY);
	const eventTypes = (arg("event-type", "ft_transfer") as string).split(",");
	const withContractCalls = flag("contract-calls");
	const batchSize = Number(arg("page-size", "1000"));
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
		console.error(
			"usage: bun http-source.ts --from H1 --to H2 [--event-type ft_transfer] [--contract-calls] [--page-size 1000] [--base-url] [--api-key]",
		);
		process.exit(1);
	}

	const idx = new Index({ baseUrl, apiKey });
	const span = to - from + 1;

	const passes: Record<string, unknown>[] = [];
	for (const label of ["cold", "warm"]) {
		const t0 = performance.now();
		const r = await fetchRange(
			idx,
			eventTypes,
			withContractCalls,
			from,
			to,
			batchSize,
		);
		const wallSec = (performance.now() - t0) / 1000;
		passes.push({
			pass: label,
			...r,
			wallSec: +wallSec.toFixed(2),
			blocksPerSec: Math.round(span / wallSec),
			eventsPerSec: Math.round(r.events / wallSec),
		});
	}

	console.log(
		JSON.stringify(
			{
				path: "http-index",
				baseUrl,
				eventTypes,
				contractCalls: withContractCalls,
				pageSize: batchSize,
				from,
				to,
				span,
				passes,
			},
			null,
			2,
		),
	);
}

void main();
