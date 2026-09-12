import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import type { ArchivePartition } from "../archive/types.ts";
import { SecondLayer } from "../client.ts";
import {
	ArchiveAuthError,
	ArchiveGateNotConfiguredError,
	ArchiveSignatureError,
	InsufficientArchiveCreditsError,
	createArchiveClient,
} from "../index.ts";

const ARCHIVE_BASE = "https://archive.test";
const OPS_BASE = "https://ops.test";

const parquet = new Uint8Array([1, 2, 3, 4, 5]);
const sha256 = createHash("sha256").update(parquet).digest("hex");

const partition: ArchivePartition = {
	dataset: "blocks",
	from_block: 0,
	to_block: 9,
	path: "blocks/0-9.parquet",
	row_count: 10,
	byte_size: parquet.byteLength,
	sha256,
};

function signingKeys() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
	};
}

const unsignedSnapshot = {
	coverage: { from_block: 0, to_block: 9 },
	partitions: [partition],
};

function snapshotDigest(snapshot: Record<string, unknown>): string {
	const { signature: _s, key_id: _k, ...rest } = snapshot;
	return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function urlOf(input: string | URL | Request): string {
	return typeof input === "string"
		? input
		: input instanceof URL
			? input.toString()
			: input.url;
}

const quoteOk = {
	partitions: 1,
	bundles: 1 / 3,
	usd_micros: 1_000_000,
	usd: "1.00",
	free_allowance_applied_micros: 0,
	allowance_remaining_bundles: 6,
	balance_usd_micros: 5_000_000,
	sufficient: true,
};

function fetchOk(paths: string[]) {
	return {
		urls: paths.map((path) => ({
			path,
			url: `https://presign.test/${path}`,
			expires_at: "2099-01-01T00:00:00.000Z",
			charged_usd_micros: 100,
		})),
		charged_total_usd_micros: paths.length * 100,
		balance_after_usd_micros: 4_000_000,
	};
}

describe("archive", () => {
	test("latest() follows pointer and verifies signature when verifyManifest on", async () => {
		const { privatePem, publicPem } = signingKeys();
		const signed = signStreamsBulkManifest(unsignedSnapshot, privatePem);
		const digest = snapshotDigest(signed);
		const pointer = {
			snapshot_path: `snapshots/${digest}.json`,
			snapshot_digest: digest,
		};
		const c = createArchiveClient({
			publicKeyPem: publicPem,
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async (input) => {
				const url = urlOf(input);
				if (url === `${ARCHIVE_BASE}/latest.json`) {
					return new Response(JSON.stringify(pointer), { status: 200 });
				}
				if (url === `${ARCHIVE_BASE}/snapshots/${digest}.json`) {
					return new Response(JSON.stringify(signed), { status: 200 });
				}
				return new Response("not found", { status: 404 });
			},
		});
		const ref = await c.latest();
		expect(ref.signature.verified).toBe(true);
		expect(ref.manifest.partitions).toHaveLength(1);
		expect(ref.root).toBe(`${ARCHIVE_BASE}/`);
	});

	test("bad signature throws ArchiveSignatureError", async () => {
		const { publicPem } = signingKeys();
		const digest = snapshotDigest(unsignedSnapshot);
		const pointer = {
			snapshot_path: `snapshots/${digest}.json`,
			snapshot_digest: digest,
		};
		const c = createArchiveClient({
			publicKeyPem: publicPem,
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async (input) => {
				const url = urlOf(input);
				if (url.endsWith("/latest.json")) {
					return new Response(JSON.stringify(pointer), { status: 200 });
				}
				if (url.includes("/snapshots/")) {
					return new Response(JSON.stringify(unsignedSnapshot), {
						status: 200,
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
		await expect(c.latest()).rejects.toBeInstanceOf(ArchiveSignatureError);
	});

	test("insecure: true returns signature.verified === false and does not throw", async () => {
		const digest = snapshotDigest(unsignedSnapshot);
		const pointer = {
			snapshot_path: `snapshots/${digest}.json`,
			snapshot_digest: digest,
		};
		const c = createArchiveClient({
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async (input) => {
				const url = urlOf(input);
				if (url.endsWith("/latest.json")) {
					return new Response(JSON.stringify(pointer), { status: 200 });
				}
				if (url.includes("/snapshots/")) {
					return new Response(JSON.stringify(unsignedSnapshot), {
						status: 200,
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
		const ref = await c.latest(undefined, { insecure: true });
		expect(ref.signature.verified).toBe(false);
	});

	test("quote POSTs { paths, flow } to {archiveOpsUrl}/api/archive/quote with Bearer", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const c = createArchiveClient({
			apiKey: "sk-sl_test",
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async (input, init) => {
				requests.push({ url: urlOf(input), init });
				return new Response(JSON.stringify(quoteOk), { status: 200 });
			},
		});
		const quote = await c.quote({
			paths: [partition.path],
			flow: "bootstrap",
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe(`${OPS_BASE}/api/archive/quote`);
		expect(requests[0]?.init?.method).toBe("POST");
		expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe(
			"Bearer sk-sl_test",
		);
		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
			paths: [partition.path],
			flow: "bootstrap",
		});
		expect(quote.usdMicros).toBe(1_000_000);
		expect(quote.sufficient).toBe(true);
	});

	test("quote 401 → ArchiveAuthError", async () => {
		const c = createArchiveClient({
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
				}),
		});
		await expect(
			c.quote({ paths: [partition.path], flow: "bootstrap" }),
		).rejects.toBeInstanceOf(ArchiveAuthError);
	});

	test("fetch 402 → InsufficientArchiveCreditsError with shortfall", async () => {
		const c = createArchiveClient({
			apiKey: "sk-sl_test",
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						error: "insufficient_credits",
						shortfall_usd_micros: 2500000,
					}),
					{ status: 402 },
				),
		});
		try {
			await c.fetch({ paths: [partition.path], flow: "bootstrap" });
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(InsufficientArchiveCreditsError);
			expect((err as InsufficientArchiveCreditsError).shortfallUsdMicros).toBe(
				2_500_000,
			);
		}
	});

	test("fetch 503 → ArchiveGateNotConfiguredError", async () => {
		const c = createArchiveClient({
			apiKey: "sk-sl_test",
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: "archive_gate_not_configured" }), {
					status: 503,
				}),
		});
		await expect(
			c.fetch({ paths: [partition.path], flow: "bootstrap" }),
		).rejects.toBeInstanceOf(ArchiveGateNotConfiguredError);
	});

	test("fetch of 65 paths issues two POSTs (64 + 1)", async () => {
		const bodies: string[][] = [];
		const c = createArchiveClient({
			apiKey: "sk-sl_test",
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async (input, init) => {
				expect(urlOf(input)).toBe(`${OPS_BASE}/api/archive/fetch`);
				const body = JSON.parse(String(init?.body)) as { paths: string[] };
				bodies.push(body.paths);
				return new Response(JSON.stringify(fetchOk(body.paths)), {
					status: 200,
				});
			},
		});
		const paths = Array.from({ length: 65 }, (_, i) => `blocks/${i}.parquet`);
		const result = await c.fetch({ paths, flow: "repair" });
		expect(bodies).toEqual([paths.slice(0, 64), paths.slice(64)]);
		expect(result.urls).toHaveLength(65);
		expect(result.chargedTotalUsdMicros).toBe(65 * 100);
		expect(result.balanceAfterUsdMicros).toBe(4_000_000);
	});

	test("download sha256 match returns bytes", async () => {
		const c = createArchiveClient({
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () => new Response(parquet, { status: 200 }),
		});
		const bytes = await c.download(partition, {
			url: `${ARCHIVE_BASE}/${partition.path}`,
		});
		expect(bytes).toEqual(parquet);
	});

	test("download sha256 mismatch throws", async () => {
		const c = createArchiveClient({
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () =>
				new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
		});
		await expect(
			c.download(partition, { url: `${ARCHIVE_BASE}/${partition.path}` }),
		).rejects.toBeInstanceOf(ArchiveSignatureError);
	});

	test("download of official-host partition without url throws", async () => {
		const c = createArchiveClient({
			archiveBaseUrl: "https://archive.secondlayer.tools",
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () => {
				throw new Error("download must not fetch without a presigned url");
			},
		});
		await expect(c.download(partition)).rejects.toThrow(/presigned URL/);
	});

	test("status() GETs status.json and returns the payload", async () => {
		const body = {
			schema_version: 1,
			state: "lagging",
			source: { decoder_head: 8_975_100, tip_height: 8_975_151 },
		};
		const c = createArchiveClient({
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async (input) => {
				expect(urlOf(input)).toBe(`${ARCHIVE_BASE}/status.json`);
				return new Response(JSON.stringify(body), { status: 200 });
			},
		});
		expect(await c.status()).toMatchObject(body);
	});

	test("createArchiveClient performs zero fetches before a method", () => {
		let calls = 0;
		const c = createArchiveClient({
			apiKey: "sk-sl_test",
			fetchImpl: async () => {
				calls++;
				return new Response("{}", { status: 200 });
			},
		});
		expect(c).toBeDefined();
		expect(calls).toBe(0);
	});

	test("SecondLayer archive.quote hits api.secondlayer.tools, not loopback", async () => {
		const urls: string[] = [];
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			accountKey: "sk-sl_test",
			fetchImpl: async (input) => {
				urls.push(urlOf(input));
				return new Response(JSON.stringify(quoteOk), { status: 200 });
			},
		});
		await sl.archive.quote({ paths: [partition.path], flow: "bootstrap" });
		expect(urls).toHaveLength(1);
		expect(new URL(urls[0] ?? "").hostname).toBe("api.secondlayer.tools");
		expect(new URL(urls[0] ?? "").pathname).toBe("/api/archive/quote");
	});

	test("archiveOpsUrl override is honored", async () => {
		const urls: string[] = [];
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			accountKey: "sk-sl_test",
			archiveOpsUrl: "https://ops.override.test",
			fetchImpl: async (input) => {
				urls.push(urlOf(input));
				return new Response(JSON.stringify(quoteOk), { status: 200 });
			},
		});
		await sl.archive.quote({ paths: [partition.path], flow: "bootstrap" });
		expect(new URL(urls[0] ?? "").hostname).toBe("ops.override.test");
	});

	test("hex accountKey throws ArchiveAuthError and does not send the request", async () => {
		let calls = 0;
		const c = createArchiveClient({
			accountKey: "a".repeat(64),
			archiveBaseUrl: ARCHIVE_BASE,
			archiveOpsUrl: OPS_BASE,
			fetchImpl: async () => {
				calls++;
				return new Response(JSON.stringify(quoteOk), { status: 200 });
			},
		});
		await expect(
			c.quote({ paths: [partition.path], flow: "bootstrap" }),
		).rejects.toBeInstanceOf(ArchiveAuthError);
		expect(calls).toBe(0);
	});

	test("hex from SL_API_KEY env throws ArchiveAuthError and does not send", async () => {
		const original = process.env.SL_API_KEY;
		const originalAccount = process.env.SECONDLAYER_API_KEY;
		const originalArchive = process.env.SL_ARCHIVE_API_KEY;
		delete process.env.SECONDLAYER_API_KEY;
		delete process.env.SL_ARCHIVE_API_KEY;
		process.env.SL_API_KEY = "b".repeat(64);
		let calls = 0;
		try {
			const c = createArchiveClient({
				archiveBaseUrl: ARCHIVE_BASE,
				archiveOpsUrl: OPS_BASE,
				fetchImpl: async () => {
					calls++;
					return new Response(JSON.stringify(quoteOk), { status: 200 });
				},
			});
			await expect(
				c.quote({ paths: [partition.path], flow: "bootstrap" }),
			).rejects.toBeInstanceOf(ArchiveAuthError);
			expect(calls).toBe(0);
		} finally {
			if (original === undefined) delete process.env.SL_API_KEY;
			else process.env.SL_API_KEY = original;
			if (originalAccount === undefined) delete process.env.SECONDLAYER_API_KEY;
			else process.env.SECONDLAYER_API_KEY = originalAccount;
			if (originalArchive === undefined) delete process.env.SL_ARCHIVE_API_KEY;
			else process.env.SL_ARCHIVE_API_KEY = originalArchive;
		}
	});
});
