import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

const API_URL = (
	process.env.SECOND_LAYER_API_URL ?? "https://api.secondlayer.tools"
).replace(/\/+$/, "");

const TIMEOUT_MS = 15_000;

async function fetchJson(path: string): Promise<Response> {
	return fetch(`${API_URL}${path}`, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
}

describe("Phase 2 smoke: dataset surfaces", () => {
	test("/v1/datasets/stx-transfers returns shape", async () => {
		const res = await fetchJson("/v1/datasets/stx-transfers?limit=1");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			events: unknown[];
			next_cursor: string | null;
			tip: unknown;
		};
		expect(Array.isArray(body.events)).toBe(true);
		expect(body.tip).toBeDefined();
	});

	test("/v1/datasets/network-health/summary returns shape", async () => {
		const res = await fetchJson(
			"/v1/datasets/network-health/summary?days=7",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { days: unknown[] };
		expect(Array.isArray(body.days)).toBe(true);
	});

	test("/public/status exposes streams.dumps and datasets[]", async () => {
		const res = await fetchJson("/public/status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			streams: { dumps: unknown };
			datasets: Array<{ slug: string }>;
		};
		expect(body.streams.dumps).toBeDefined();
		expect(Array.isArray(body.datasets)).toBe(true);
	});

	test("/public/streams/dumps/manifest is reachable (200 or 503)", async () => {
		const res = await fetchJson("/public/streams/dumps/manifest");
		expect([200, 503]).toContain(res.status);
		if (res.status === 200) {
			const body = (await res.json()) as { dataset: string; files: unknown[] };
			expect(body.dataset).toBeDefined();
			expect(Array.isArray(body.files)).toBe(true);
		}
	});
});

describe("Phase 2 smoke: parquet checksum (when manifest published)", () => {
	test("verifies one parquet object's SHA-256 against the manifest", async () => {
		const res = await fetchJson("/public/streams/dumps/manifest");
		if (res.status !== 200) {
			console.log("skipping parquet checksum: manifest not yet published");
			return;
		}
		const manifest = (await res.json()) as {
			files: Array<{ path: string; sha256: string; byte_size: number }>;
		};
		const baseUrl = process.env.STREAMS_BULK_PUBLIC_BASE_URL?.replace(/\/+$/, "");
		const file = manifest.files[0];
		if (!baseUrl || !file) {
			console.log("skipping parquet checksum: no public base URL or no files");
			return;
		}
		const objectUrl = `${baseUrl}/${file.path.replace(/^stacks-streams\/mainnet\/v0\//, "")}`;
		const objectRes = await fetch(objectUrl, {
			signal: AbortSignal.timeout(60_000),
		});
		expect(objectRes.status).toBe(200);
		const buffer = Buffer.from(await objectRes.arrayBuffer());
		expect(buffer.byteLength).toBe(file.byte_size);
		const sha256 = createHash("sha256").update(buffer).digest("hex");
		expect(sha256).toBe(file.sha256);
	}, 90_000);
});
