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

function readReferenceText(): string {
	const index = JSON.parse(
		readFileSync(join(REFERENCE, "index.json"), "utf8"),
	) as { surfaces: { slug: string }[] };
	return index.surfaces
		.map((s) => readFileSync(join(REFERENCE, `${s.slug}.json`), "utf8"))
		.join("\n");
}

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

	test("public documentation never cites an internal plan number", () => {
		expect(readReferenceText().match(/\bplan \d+/gi) ?? []).toEqual([]);
	});
});
