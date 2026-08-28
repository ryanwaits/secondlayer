import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	ArchiveFetchError,
	type ArchivePartition,
	type LoadedReference,
	fetchVerifiedPartition,
	fetchWithRetry,
} from "./archive-reference.ts";

/**
 * Transport resilience for partition fetches. A restore runs for hours over
 * a link that resets, a bucket that rate-limits, and an edge that 5xxs; the
 * loop has to absorb each without the operator seeing it, while a real
 * refusal still stops the run on the first answer.
 */

const bytes = Buffer.from("partition-bytes");
const partition: ArchivePartition = {
	dataset: "blocks",
	from_block: 0,
	to_block: 99,
	path: "blocks/0-99.parquet",
	row_count: 100,
	byte_size: bytes.length,
	sha256: createHash("sha256").update(bytes).digest("hex"),
};
const remote: LoadedReference = {
	manifest: {},
	origin: "https://archive.example/snapshots/x.json",
	root: "https://archive.example",
	isRemote: true,
};

function connectionReset(): Error {
	const err = new TypeError("fetch failed");
	(err as { cause?: unknown }).cause = Object.assign(
		new Error("read ECONNRESET"),
		{ code: "ECONNRESET" },
	);
	return err;
}

function scripted(steps: Array<Error | Response>) {
	const calls: string[] = [];
	const fetchImpl = async (url: string) => {
		calls.push(url);
		const step = steps.shift();
		if (!step) throw new Error("no scripted response left");
		if (step instanceof Error) throw step;
		return step;
	};
	return { calls, fetchImpl };
}

const noSleep = { sleep: async () => {} };

describe("partition fetch retries", () => {
	test("a connection reset followed by a 200 yields the verified bytes without surfacing", async () => {
		const { calls, fetchImpl } = scripted([
			connectionReset(),
			new Response(bytes),
		]);
		const got = await fetchVerifiedPartition(remote, partition, undefined, {
			fetchImpl,
			...noSleep,
		});
		expect(got.equals(bytes)).toBe(true);
		expect(calls).toHaveLength(2);
	});

	test("a 429 waits for Retry-After before the next attempt", async () => {
		const slept: number[] = [];
		const { fetchImpl } = scripted([
			new Response("slow down", {
				status: 429,
				headers: { "retry-after": "2" },
			}),
			new Response(bytes),
		]);
		const got = await fetchVerifiedPartition(remote, partition, undefined, {
			fetchImpl,
			sleep: async (ms) => {
				slept.push(ms);
			},
		});
		expect(got.equals(bytes)).toBe(true);
		expect(slept).toEqual([2_000]);
	});

	test("a 5xx backs off exponentially and gives up after the third retry as a transient failure", async () => {
		const slept: number[] = [];
		const { calls, fetchImpl } = scripted([
			new Response("", { status: 503 }),
			new Response("", { status: 502 }),
			new Response("", { status: 500 }),
			new Response("", { status: 503 }),
		]);
		let caught: unknown;
		try {
			await fetchWithRetry("https://archive.example/p", {
				label: "p",
				fetchImpl,
				sleep: async (ms) => {
					slept.push(ms);
				},
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(ArchiveFetchError);
		expect((caught as ArchiveFetchError).transient).toBe(true);
		expect((caught as ArchiveFetchError).message).toContain("4 attempts");
		expect(calls).toHaveLength(4);
		expect(slept).toEqual([1_000, 2_000, 4_000]);
	});

	test("a 404 is answered once and reported as a refusal, not retried", async () => {
		const { calls, fetchImpl } = scripted([
			new Response("gone", { status: 404 }),
		]);
		let caught: unknown;
		try {
			await fetchVerifiedPartition(remote, partition, undefined, {
				fetchImpl,
				...noSleep,
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(ArchiveFetchError);
		expect((caught as ArchiveFetchError).transient).toBe(false);
		expect(calls).toHaveLength(1);
	});

	test("through the gate, an expired presigned URL is re-issued once and the transient retries still apply", async () => {
		const issued: Array<{ path: string; forceRefresh?: boolean }> = [];
		const gate = {
			getUrl: async (path: string, opts?: { forceRefresh?: boolean }) => {
				issued.push({ path, forceRefresh: opts?.forceRefresh });
				return `https://r2.example/${path}?sig=${issued.length}`;
			},
		};
		const { calls, fetchImpl } = scripted([
			new Response("expired", { status: 403 }),
			connectionReset(),
			new Response(bytes),
		]);
		const got = await fetchVerifiedPartition(remote, partition, gate, {
			fetchImpl,
			...noSleep,
		});
		expect(got.equals(bytes)).toBe(true);
		expect(issued.map((i) => i.forceRefresh)).toEqual([undefined, true]);
		expect(calls).toEqual([
			"https://r2.example/blocks/0-99.parquet?sig=1",
			"https://r2.example/blocks/0-99.parquet?sig=2",
			"https://r2.example/blocks/0-99.parquet?sig=2",
		]);
	});

	test("a malformed URL carries an error code but is not retried as a network failure", async () => {
		const invalid = Object.assign(new TypeError("Invalid URL"), {
			code: "ERR_INVALID_URL",
		});
		const { calls, fetchImpl } = scripted([invalid]);
		await expect(
			fetchWithRetry("not a url", { label: "p", fetchImpl, ...noSleep }),
		).rejects.toThrow("Invalid URL");
		expect(calls).toHaveLength(1);
	});

	test("an undici socket error code is retried like a connection reset", async () => {
		const err = new TypeError("fetch failed");
		(err as { cause?: unknown }).cause = Object.assign(
			new Error("socket hang up"),
			{ code: "UND_ERR_SOCKET" },
		);
		const { calls, fetchImpl } = scripted([err, new Response(bytes)]);
		const got = await fetchVerifiedPartition(remote, partition, undefined, {
			fetchImpl,
			...noSleep,
		});
		expect(got.equals(bytes)).toBe(true);
		expect(calls).toHaveLength(2);
	});

	test("a programming error inside fetch is not mistaken for the network and surfaces immediately", async () => {
		const { calls, fetchImpl } = scripted([
			new TypeError("Cannot read properties of undefined"),
		]);
		await expect(
			fetchWithRetry("https://archive.example/p", {
				label: "p",
				fetchImpl,
				...noSleep,
			}),
		).rejects.toThrow("Cannot read properties");
		expect(calls).toHaveLength(1);
	});
});
