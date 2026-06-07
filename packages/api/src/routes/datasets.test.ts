import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import {
	type DatasetManifest,
	resetDatasetManifestCache,
} from "../datasets/manifests.ts";
import { errorHandler } from "../middleware/error.ts";
import { createDatasetsRouter } from "./datasets.ts";

const BASE = "https://r2.example/stacks-datasets/mainnet/v0";
const originalFetch = globalThis.fetch;
const previousEnv = process.env.DATASETS_PUBLIC_BASE_URL;

const SAMPLE_MANIFEST: DatasetManifest = {
	dataset: "x",
	network: "mainnet",
	version: "v0",
	schema_version: 0,
	generated_at: "2026-06-07T00:00:00.000Z",
	producer_version: "test",
	finality_lag_blocks: 144,
	latest_finalized_cursor: "8209999:0",
	coverage: { from_block: 0, to_block: 8_209_999 },
	files: [],
};

function createApp(tip: { block_height: number } | null) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/v1/datasets", createDatasetsRouter({ getTip: async () => tip }));
	return app;
}

interface CatalogFamily {
	family: string;
	freshness: { status: string; lag_blocks: number | null } | null;
	manifest_url: string | null;
}

describe("GET /v1/datasets catalog enrichment", () => {
	beforeEach(() => {
		resetDatasetManifestCache();
		process.env.DATASETS_PUBLIC_BASE_URL = BASE;
		// Every manifest URL resolves to a valid manifest → all bulk-export slugs ok.
		globalThis.fetch = mock(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve(SAMPLE_MANIFEST),
				text: () => Promise.resolve(JSON.stringify(SAMPLE_MANIFEST)),
			} as Response),
		) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (previousEnv === undefined) delete process.env.DATASETS_PUBLIC_BASE_URL;
		else process.env.DATASETS_PUBLIC_BASE_URL = previousEnv;
	});

	test("attaches freshness + manifest_url to covered families, null to the rest", async () => {
		const res = await createApp({ block_height: 8_215_310 }).request(
			"/v1/datasets",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { families: CatalogFamily[] };
		const byFamily = new Map(body.families.map((f) => [f.family, f]));

		const stx = byFamily.get("stx-transfers");
		expect(stx?.freshness?.status).toBe("ok");
		expect(stx?.manifest_url).toBe(
			`${BASE}/stx-transfers/manifest/latest.json`,
		);

		// Family with no bulk export → honest null.
		const burnchain = byFamily.get("burnchain-rewards");
		expect(burnchain?.freshness).toBeNull();
		expect(burnchain?.manifest_url).toBeNull();
	});

	test("bns-events family resolves via the bns-name-events manifest alias", async () => {
		const res = await createApp({ block_height: 8_215_310 }).request(
			"/v1/datasets",
		);
		const body = (await res.json()) as { families: CatalogFamily[] };
		const bns = body.families.find((f) => f.family === "bns-events");
		expect(bns?.freshness?.status).toBe("ok");
		expect(bns?.manifest_url).toBe(
			`${BASE}/bns/name-events/manifest/latest.json`,
		);
	});

	test("returns 200 (not 503) when the chain tip is unavailable", async () => {
		const res = await createApp(null).request("/v1/datasets");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { families: CatalogFamily[] };
		// Manifest reachable → status ok, but lag is unknown without a tip.
		const stx = body.families.find((f) => f.family === "stx-transfers");
		expect(stx?.freshness?.status).toBe("ok");
		expect(stx?.freshness?.lag_blocks).toBeNull();
	});
});
