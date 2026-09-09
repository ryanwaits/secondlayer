import { describe, expect, test } from "bun:test";
import { SecondLayer } from "../client.ts";
import { ApiError } from "../errors.ts";

function urlOf(input: string | URL | Request): string {
	return typeof input === "string"
		? input
		: input instanceof URL
			? input.toString()
			: input.url;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const emptyIndexStatus = {
	status: "degraded",
	chainTip: null,
	chainIntegrity: { ok: true, maxHeight: 0, reason: null },
	streams: { status: "unavailable", tip: null },
	index: {
		status: "unavailable",
		decoders: Array.from({ length: 8 }, (_, i) => ({
			decoder: `decode.d${i}.v1`,
			status: "unavailable",
		})),
	},
	services: [
		{ name: "api", status: "ok" },
		{ name: "database", status: "ok" },
		{ name: "indexer", status: "ok" },
		{ name: "decoder", status: "unavailable" },
	],
};

const against = "https://archive.secondlayer.tools/latest.json";

describe("archive.verify + instance.status", () => {
	test("verify POSTs snake_case body to instance /v1/archive/verify", async () => {
		const requests: { url: string; method: string; body: unknown }[] = [];
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			archiveOpsUrl: "https://api.secondlayer.tools",
			fetchImpl: async (input, init) => {
				const url = urlOf(input);
				const method = init?.method ?? "GET";
				const body = init?.body ? JSON.parse(String(init.body)) : undefined;
				requests.push({ url, method, body });
				return json({
					status: "clean",
					target: "raw",
					against,
					signature: { verified: true },
					ranges: [],
				});
			},
		});
		await sl.archive.verify({
			against,
			target: "raw",
			fromBlock: 0,
			toBlock: 99,
			insecure: false,
			publicKeyPem: "PEM",
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("http://127.0.0.1:3800/v1/archive/verify");
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.body).toEqual({
			against,
			target: "raw",
			from_block: 0,
			to_block: 99,
			insecure: false,
			public_key_pem: "PEM",
		});
	});

	test("200 unanchored does not throw", async () => {
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			fetchImpl: async () =>
				json({
					status: "unanchored",
					target: "raw",
					against,
					signature: { verified: false, reason: "no public key" },
					ranges: [],
					reason: "no public key",
				}),
		});
		const result = await sl.archive.verify({ against });
		expect(result.status).toBe("unanchored");
		expect(result.reason).toBe("no public key");
	});

	test("400 throws ApiError", async () => {
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			fetchImpl: async () =>
				json({ error: "against is required", code: "VALIDATION_ERROR" }, 400),
		});
		try {
			await sl.archive.verify({ against });
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			expect((err as ApiError).status).toBe(400);
		}
	});

	test("verify does not call archiveOpsUrl", async () => {
		const urls: string[] = [];
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			archiveOpsUrl: "https://api.secondlayer.tools",
			fetchImpl: async (input) => {
				urls.push(urlOf(input));
				return json({
					status: "clean",
					target: "raw",
					against,
					signature: { verified: true },
					ranges: [],
				});
			},
		});
		await sl.archive.verify({ against });
		expect(urls).toEqual(["http://127.0.0.1:3800/v1/archive/verify"]);
		expect(urls.some((u) => u.includes("api.secondlayer.tools"))).toBe(false);
	});

	test("instance.status() GETs /public/status on the instance", async () => {
		const urls: string[] = [];
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			archiveOpsUrl: "https://api.secondlayer.tools",
			fetchImpl: async (input) => {
				urls.push(urlOf(input));
				return json(emptyIndexStatus);
			},
		});
		const status = await sl.instance.status();
		expect(urls).toEqual(["http://127.0.0.1:3800/public/status"]);
		expect(status.status).toBe("degraded");
		expect(status.chainTip).toBeNull();
	});

	test("instance.diagnose() names empty-index", async () => {
		const sl = new SecondLayer({
			baseUrl: "http://127.0.0.1:3800",
			fetchImpl: async () => json(emptyIndexStatus),
		});
		const diagnosis = await sl.instance.diagnose();
		expect(diagnosis.state).toBe("empty-index");
		expect(diagnosis.issues[0]?.nextSteps[0]).toContain(
			"secondlayer bootstrap --against <manifest>",
		);
	});
});
