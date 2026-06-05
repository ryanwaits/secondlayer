import { describe, expect, test } from "bun:test";
import { generateEd25519KeyPair } from "@secondlayer/shared/crypto/ed25519";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import { createStreamsDumps } from "./dumps.ts";
import { StreamsSignatureError } from "./errors.ts";

const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

const BASE_MANIFEST = {
	dataset: "stacks-streams",
	network: "mainnet",
	version: "v0",
	schema_version: 0,
	generated_at: "2026-06-05T00:00:00.000Z",
	producer_version: "@secondlayer/indexer@test",
	finality_lag_blocks: 144,
	latest_finalized_cursor: "100:0",
	coverage: { from_block: 1, to_block: 100 },
	files: [
		{
			path: "events/a.parquet",
			from_block: 1,
			to_block: 100,
			min_cursor: "1:0",
			max_cursor: "100:0",
			row_count: 10,
			byte_size: 1024,
			sha256: "deadbeef",
			schema_version: 0,
			created_at: "2026-06-05T00:00:00.000Z",
		},
	],
};

function fetchServing(manifest: unknown) {
	return async () =>
		new Response(JSON.stringify(manifest), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
}

describe("createStreamsDumps manifest verification", () => {
	const opts = {
		baseUrl: "https://dumps.example",
		loadPublicKeyPem: async () => publicKeyPem,
	};

	test("default off: returns even an unsigned manifest", async () => {
		const dumps = createStreamsDumps({
			...opts,
			fetchImpl: fetchServing(BASE_MANIFEST),
		});
		const m = await dumps.list();
		expect(m.coverage.to_block).toBe(100);
	});

	test("on + valid signature: returns the manifest", async () => {
		const signed = signStreamsBulkManifest(BASE_MANIFEST, privateKeyPem);
		const dumps = createStreamsDumps({
			...opts,
			verifyManifest: true,
			fetchImpl: fetchServing(signed),
		});
		const m = await dumps.list();
		expect(m.signature).toBeTruthy();
	});

	test("on + unsigned manifest: throws", async () => {
		const dumps = createStreamsDumps({
			...opts,
			verifyManifest: true,
			fetchImpl: fetchServing(BASE_MANIFEST),
		});
		await expect(dumps.list()).rejects.toBeInstanceOf(StreamsSignatureError);
	});

	test("on + tampered file hash: throws", async () => {
		const signed = signStreamsBulkManifest(BASE_MANIFEST, privateKeyPem);
		const tampered = {
			...signed,
			files: [{ ...signed.files[0], sha256: "00000000" }],
		};
		const dumps = createStreamsDumps({
			...opts,
			verifyManifest: true,
			fetchImpl: fetchServing(tampered),
		});
		await expect(dumps.list()).rejects.toBeInstanceOf(StreamsSignatureError);
	});
});
