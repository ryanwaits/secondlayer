import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsRouter from "../src/routes/subgraphs.ts";

/**
 * Integration tests for POST /api/subgraphs/bundle — the server-side bundler
 * that powers the web chat authoring loop for subgraphs. Mount the router
 * behind a tiny stand-in middleware so `getApiKeyId(c)` succeeds without
 * touching the real auth stack.
 */

type TestVariables = {
	apiKey: { id: string };
	accountId: string;
};

function buildApp() {
	const app = new Hono<{ Variables: TestVariables }>();
	app.onError(errorHandler);
	app.use("/subgraphs/*", async (c, next) => {
		c.set("apiKey", { id: "test-key-subgraphs-bundle" });
		c.set("accountId", "test-account-subgraphs-bundle");
		await next();
	});
	app.route("/subgraphs", subgraphsRouter);
	return app;
}

const validSource = `
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
	name: "bundle-test",
	sources: {
		swap: {
			type: "print_event",
			contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
			topic: "swap",
		},
	},
	schema: {
		swaps: {
			columns: {
				sender: { type: "principal", indexed: true },
				amount: { type: "uint" },
			},
		},
	},
	handlers: {
		swap: (_event, ctx) => {
			ctx.insert("swaps", { sender: ctx.tx.sender, amount: 0 });
		},
	},
});
`;

const invalidIndexSource = `
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
	name: "bad-indexes",
	sources: {
		transfers: {
			type: "contract_call",
			contractId: "SP123.demo",
			functionName: "transfer",
		},
	},
	schema: {
		transfers: {
			columns: {
				sender: { type: "principal" },
				recipient: { type: "principal" },
			},
			indexes: [{ columns: ["sender"] }],
		},
	},
	handlers: {
		transfers: () => {},
	},
});
`;

describe("POST /api/subgraphs/bundle", () => {
	test("happy path: valid source returns bundled handler + metadata", async () => {
		const app = buildApp();
		const res = await app.request("/subgraphs/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: validSource }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			name: string;
			handlerCode: string;
			sourceCode: string;
			bundleSize: number;
			sources: Record<string, unknown>;
			schema: Record<string, unknown>;
		};
		expect(body.ok).toBe(true);
		expect(body.name).toBe("bundle-test");
		expect(body.handlerCode.length).toBeGreaterThan(0);
		expect(body.sourceCode).toBe(validSource);
		expect(body.bundleSize).toBeGreaterThan(0);
		expect(Object.keys(body.sources).length).toBeGreaterThan(0);
		expect(Object.keys(body.schema).length).toBeGreaterThan(0);
	});

	test("missing body returns 400", async () => {
		const app = buildApp();
		const res = await app.request("/subgraphs/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/code/);
	});

	test("invalid JSON body returns 400", async () => {
		const app = buildApp();
		const res = await app.request("/subgraphs/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});

	test("oversized bundle returns 413 with actualBytes/maxBytes", async () => {
		const app = buildApp();
		const oversized = `
import { defineSubgraph } from "@secondlayer/subgraphs";
const BIG = ${JSON.stringify("x".repeat(5_000_000))};
export default defineSubgraph({
	name: "too-big",
	sources: {
		swap: {
			type: "print_event",
			contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
			topic: "swap",
		},
	},
	schema: { swaps: { columns: { amount: { type: "uint" } } } },
	handlers: {
		swap: (_event, ctx) => {
			ctx.insert("swaps", { amount: BIG.length });
		},
	},
});
`;
		const res = await app.request("/subgraphs/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: oversized }),
		});
		expect(res.status).toBe(413);
		const body = (await res.json()) as {
			ok: boolean;
			code: string;
			actualBytes: number;
			maxBytes: number;
		};
		expect(body.ok).toBe(false);
		expect(body.code).toBe("BUNDLE_TOO_LARGE");
		expect(body.actualBytes).toBeGreaterThan(body.maxBytes);
	});

	test("malformed TS returns 400 with BUNDLE_FAILED", async () => {
		const app = buildApp();
		const res = await app.request("/subgraphs/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: "@@@ not valid typescript !!!" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; code: string };
		expect(body.ok).toBe(false);
		expect(body.code).toBe("BUNDLE_FAILED");
	});

	test("object-shaped indexes return a repair hint", async () => {
		const app = buildApp();
		const res = await app.request("/subgraphs/bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: invalidIndexSource }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			ok: boolean;
			code: string;
			error: string;
		};
		expect(body.ok).toBe(false);
		expect(body.code).toBe("BUNDLE_FAILED");
		expect(body.error).toContain(
			'Subgraph schema hint: use indexes: [["sender"], ["recipient"]], not indexes: [{ columns: ["sender"] }].',
		);
	});
});
