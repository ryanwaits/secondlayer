import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Summary ratchet for the generated SDK reference. Every public method needs a
 * first-sentence JSDoc summary. `PENDING_DOCS` lists the methods that still
 * lack one; it may only shrink. Document a method, then delete its line.
 *
 * Reads the generated JSON from disk (never imports `scripts/`, which would
 * break this package's `rootDir`). Regenerate with `bun run openpkg`.
 */
const REFERENCE = join(
	import.meta.dir,
	"../../../apps/web/src/generated/reference/sdk",
);

const PENDING_DOCS = new Set([
	"sl.streams.consume",
	"sl.streams.events.list",
	"sl.streams.events.byTxId",
	"sl.streams.events.consume",
	"sl.streams.events.stream",
	"sl.streams.events.subscribe",
	"sl.streams.blocks.events",
	"sl.streams.reorgs.list",
	"sl.streams.canonical",
	"sl.streams.tip",
	"sl.index.ftTransfers.list",
	"sl.index.ftTransfers.walk",
	"sl.index.nftTransfers.list",
	"sl.index.nftTransfers.walk",
	"sl.index.events.list",
	"sl.index.events.walk",
	"sl.index.events.consume",
	"sl.index.contractCalls.list",
	"sl.index.contractCalls.walk",
	"sl.index.contractCalls.consume",
	"sl.index.canonical.list",
	"sl.index.canonical.walk",
	"sl.index.stateWrites.list",
	"sl.index.stateWrites.walk",
	"sl.index.blocks.list",
	"sl.index.blocks.walk",
	"sl.index.blocks.get",
	"sl.index.transactions.list",
	"sl.index.transactions.walk",
	"sl.index.transactions.get",
	"sl.index.transactions.getProof",
	"sl.index.stacking.list",
	"sl.index.stacking.walk",
	"sl.index.mempool.list",
	"sl.index.mempool.walk",
	"sl.index.mempool.get",
	"sl.index.sbtc.deposits.list",
	"sl.index.sbtc.deposits.walk",
	"sl.index.sbtc.withdrawals.list",
	"sl.index.sbtc.withdrawals.walk",
	"sl.index.sbtc.events.list",
	"sl.index.sbtc.events.walk",
	"sl.index.pox.cycles.list",
	"sl.index.pox.cycles.walk",
	"sl.index.pox5.events.list",
	"sl.index.pox5.events.walk",
	"sl.index.runes.activity.list",
	"sl.index.runes.activity.walk",
	"sl.subgraphs.list",
	"sl.subgraphs.openapi",
	"sl.subgraphs.schema",
	"sl.subgraphs.markdown",
	"sl.subgraphs.stop",
	"sl.subgraphs.gaps",
	"sl.subgraphs.delete",
	"sl.subgraphs.getSource",
	"sl.webhooks.list",
	"sl.webhooks.get",
	"sl.webhooks.create",
	"sl.webhooks.update",
	"sl.webhooks.pause",
	"sl.webhooks.resume",
	"sl.webhooks.delete",
	"sl.webhooks.rotateSecret",
	"sl.webhooks.replay",
	"sl.webhooks.dead",
	"sl.archive.latest",
	"sl.archive.load",
	"sl.archive.status",
	"sl.archive.partitions",
	"sl.archive.quote",
	"sl.archive.fetch",
	"sl.archive.download",
	"sl.archive.credits.balance",
	"sl.archive.credits.checkout",
	"sl.archive.credits.refill",
	"sl.archive.verify",
	"sl.instance.status",
	"sl.instance.diagnose",
]);

type Method = { path: string; summary: string };

function readMethods(): Method[] {
	const index = JSON.parse(
		readFileSync(join(REFERENCE, "index.json"), "utf8"),
	) as {
		surfaces: { slug: string }[];
	};
	return index.surfaces.flatMap(
		(s) =>
			(
				JSON.parse(readFileSync(join(REFERENCE, `${s.slug}.json`), "utf8")) as {
					methods: Method[];
				}
			).methods,
	);
}

describe("SDK reference documentation ratchet", () => {
	const methods = readMethods();

	test("every public method without a summary is listed in PENDING_DOCS", () => {
		const missing = methods
			.filter((m) => !m.summary && !PENDING_DOCS.has(m.path))
			.map((m) => m.path);
		expect(missing).toEqual([]);
	});

	test("a method that gained a summary is removed from PENDING_DOCS", () => {
		const stale = methods
			.filter((m) => m.summary && PENDING_DOCS.has(m.path))
			.map((m) => m.path);
		expect(stale).toEqual([]);
	});

	test("PENDING_DOCS names only methods that exist", () => {
		const paths = new Set(methods.map((m) => m.path));
		expect([...PENDING_DOCS].filter((p) => !paths.has(p))).toEqual([]);
	});
});
