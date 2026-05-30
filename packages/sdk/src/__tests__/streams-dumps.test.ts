import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	type StreamsDumpFile,
	StreamsSignatureError,
	createStreamsClient,
} from "../index.ts";

const DUMPS_BASE = "https://dumps.secondlayer.test";

const parquet = new Uint8Array([1, 2, 3, 4, 5]);
const sha256 = createHash("sha256").update(parquet).digest("hex");

const file: StreamsDumpFile = {
	path: "stacks-streams/mainnet/v0/events/block_height/0000000000-0000009999/events.parquet",
	from_block: 0,
	to_block: 9999,
	min_cursor: "0:0",
	max_cursor: "9999:3",
	row_count: 10,
	byte_size: parquet.byteLength,
	sha256,
	schema_version: 1,
	created_at: "2026-05-29T00:00:00.000Z",
};

const manifest = {
	dataset: "stacks-streams",
	network: "mainnet",
	version: "v0",
	schema_version: 1,
	generated_at: "2026-05-29T00:00:00.000Z",
	producer_version: "1.0.0",
	finality_lag_blocks: 6,
	latest_finalized_cursor: "9999:3",
	coverage: { from_block: 0, to_block: 9999 },
	files: [file],
};

type FetchImpl = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function client(fetchImpl: FetchImpl) {
	return createStreamsClient({
		apiKey: "sk-test",
		baseUrl: "http://secondlayer.test",
		dumpsBaseUrl: DUMPS_BASE,
		fetchImpl,
	});
}

describe("streams.dumps", () => {
	test("list() fetches and parses the manifest", async () => {
		const c = client(async (input) => {
			expect(String(input)).toBe(`${DUMPS_BASE}/manifest/latest.json`);
			return new Response(JSON.stringify(manifest), { status: 200 });
		});
		const m = await c.dumps.list();
		expect(m.latest_finalized_cursor).toBe("9999:3");
		expect(m.files).toHaveLength(1);
	});

	test("fileUrl() resolves the object key under the base", () => {
		const c = client(async () => new Response("{}"));
		expect(c.dumps.fileUrl(file)).toBe(`${DUMPS_BASE}/${file.path}`);
	});

	test("download() returns bytes when sha256 matches", async () => {
		const c = client(async () => new Response(parquet, { status: 200 }));
		const bytes = await c.dumps.download(file);
		expect(bytes).toEqual(parquet);
	});

	test("download() throws on sha256 mismatch", async () => {
		const c = client(
			async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
		);
		await expect(c.dumps.download(file)).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});

	test("dumps require dumpsBaseUrl", async () => {
		const c = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: (async () => new Response("{}")) as never,
		});
		await expect(c.dumps.list()).rejects.toThrow("dumpsBaseUrl");
	});
});
