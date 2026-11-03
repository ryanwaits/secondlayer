import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import catalogJson from "../../skills/secondlayer/dash/template/catalog.json";
import { missingPrompts } from "../../skills/secondlayer/dash/template/check.ts";
import {
	CATALOG,
	type Catalog,
	type Spec,
	buildPrompt,
	decideNetworks,
	validateSpec,
} from "../../skills/secondlayer/dash/template/kit.js";

const ROOT = join(import.meta.dir, "..", "..");
const catalog = catalogJson as Catalog;

function spec(elements: Spec["elements"], extra: Partial<Spec> = {}): Spec {
	return { version: 1, root: "page", state: {}, elements, ...extra };
}

const page = (children: string[]) => ({
	type: "Page",
	props: { title: "Webhooks" },
	children,
});

describe("validateSpec", () => {
	test("accepts the plan's example spec", () => {
		const good = spec(
			{
				page: page(["tabs"]),
				tabs: {
					type: "NetworkTabs",
					props: { networks: ["mainnet", "testnet", "devnet"] },
					children: ["body"],
				},
				body: { type: "Stack", children: ["sum", "table", "feed"] },
				sum: { type: "Summary", props: { network: { $state: "/network" } } },
				table: {
					type: "WebhookTable",
					props: { network: { $state: "/network" }, days: 30 },
				},
				feed: {
					type: "DeliveryFeed",
					props: { network: { $state: "/network" }, limit: 6 },
				},
			},
			{ state: { network: "mainnet" } },
		);
		expect(validateSpec(good, catalog)).toEqual([]);
	});

	const cases: Array<[string, Spec, { id: string; prop: string | null }]> = [
		[
			"unknown component type",
			spec({ page: page(["x"]), x: { type: "Gauge", props: {} } }),
			{ id: "x", prop: "type" },
		],
		[
			"missing required prop",
			spec({
				page: page(["x"]),
				x: { type: "WebhookHeader", props: { network: "mainnet" } },
			}),
			{ id: "x", prop: "webhookId" },
		],
		[
			"dangling child id",
			spec({ page: page(["ghost"]) }),
			{ id: "page", prop: "children" },
		],
		[
			"cycle between two stacks",
			spec({
				page: page(["a"]),
				a: { type: "Stack", children: ["b"] },
				b: { type: "Stack", children: ["a"] },
			}),
			{ id: "b", prop: "children" },
		],
		[
			"element unreachable from root",
			spec({
				page: page([]),
				orphan: { type: "Empty", props: { reason: "nobody points here" } },
			}),
			{ id: "orphan", prop: null },
		],
		[
			"limit above the catalog bound",
			spec({
				page: page(["feed"]),
				feed: {
					type: "DeliveryFeed",
					props: { network: "mainnet", limit: 50 },
				},
			}),
			{ id: "feed", prop: "limit" },
		],
	];

	for (const [name, bad, want] of cases) {
		test(`reports exactly one error for ${name}`, () => {
			const errors = validateSpec(bad, catalog);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatchObject(want);
		});
	}

	test("an unknown root fails the whole spec with one message", () => {
		const errors = validateSpec(
			spec({ page: page([]) }, { root: "nope" }),
			catalog,
		);
		expect(errors).toEqual([
			{ id: "nope", prop: "root", message: 'root "nope" is not an element id' },
		]);
	});

	test("subgraph components refuse testnet, which holds webhooks only", () => {
		const errors = validateSpec(
			spec({
				page: page(["rows"]),
				rows: {
					type: "DataGrid",
					props: { network: "testnet", subgraph: "s", table: "t" },
				},
			}),
			catalog,
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ id: "rows", prop: "network" });
	});

	test("a $state binding outside NetworkTabs needs a value in state", () => {
		const errors = validateSpec(
			spec({
				page: page(["sum"]),
				sum: { type: "Summary", props: { network: { $state: "/network" } } },
			}),
			catalog,
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ id: "sum", prop: "network" });
	});

	test("a view a row opens can't be placed in a spec", () => {
		const errors = validateSpec(
			spec({ page: page(["p"]), p: { type: "Payload", props: {} } }),
			catalog,
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ id: "p", prop: "type" });
		expect(errors[0]?.message).toContain("opens from a DeliveryFeed row");
	});

	test("Tabs needs one child per label", () => {
		const errors = validateSpec(
			spec({
				page: page(["tabs"]),
				tabs: {
					type: "Tabs",
					props: { labels: ["Rows", "Schema"] },
					children: ["e"],
				},
				e: { type: "Empty", props: { reason: "only one view" } },
			}),
			catalog,
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ id: "tabs", prop: "labels" });
	});

	test("kit.js implements every catalog component and nothing else", () => {
		expect(Object.keys(CATALOG).sort()).toEqual(
			Object.keys(catalog.components).sort(),
		);
	});

	test("every catalog component can describe itself in the page prompt", () => {
		expect(missingPrompts(Object.keys(catalog.components))).toEqual([]);
		expect(missingPrompts(["Gauge"])).toEqual(["Gauge"]);
	});
});

describe("decideNetworks", () => {
	const hooks = (n: number) =>
		Array.from({ length: n }, (_, i) => ({ id: `wh_${i}` }));
	const live = (n: number) => ({ ok: true, webhooks: hooks(n), subgraphs: [] });
	const down = { ok: false, reason: "not answering" };

	test("all three live: tabs across mainnet, testnet, devnet", () => {
		const probe = {
			networks: { mainnet: live(2), testnet: live(2), devnet: live(1) },
		};
		expect(decideNetworks({ named: null, probe })).toEqual({
			networks: ["mainnet", "testnet", "devnet"],
			tabs: true,
		});
	});

	test("asking for testnet shows testnet alone, no tabs", () => {
		const probe = { networks: { testnet: live(2) } };
		expect(decideNetworks({ named: "testnet", probe })).toEqual({
			networks: ["testnet"],
			tabs: false,
		});
	});

	test("a stopped devnet drops out", () => {
		const probe = {
			networks: { mainnet: live(2), testnet: live(2), devnet: down },
		};
		expect(decideNetworks({ named: null, probe })).toEqual({
			networks: ["mainnet", "testnet"],
			tabs: true,
		});
	});

	test("mainnet only: empty testnet and stopped devnet leave no tabs", () => {
		const probe = {
			networks: { mainnet: live(2), testnet: live(0), devnet: down },
		};
		expect(decideNetworks({ named: null, probe })).toEqual({
			networks: ["mainnet"],
			tabs: false,
		});
	});
});

describe("buildPrompt", () => {
	const MAINNET = "https://api.secondlayer.tools";
	const TESTNET = "https://api.secondlayer.tools/testnet";
	const AT = "2026-11-03T14:02:31.000Z";
	const INTRO = [
		"Here's my Secondlayer dashboard. Use it as context for what I ask next.",
		"",
	];
	const READS =
		"## Reads behind this page (read-only, through the dashboard proxy)";

	test("a tabbed page names the open tab and the networks behind the others", () => {
		const tabbed = spec({
			page: page(["tabs"]),
			tabs: {
				type: "NetworkTabs",
				props: { networks: ["mainnet", "testnet"] },
				children: ["body"],
			},
			body: { type: "Stack", children: ["sum", "feed"] },
			sum: { type: "Summary", props: { network: { $state: "/network" } } },
			feed: {
				type: "DeliveryFeed",
				props: { network: { $state: "/network" }, limit: 2 },
			},
		});
		const webhook = {
			id: "wh_t04e",
			name: "pox5-stacking",
			status: "active",
			circuitOpenedAt: null,
			circuitFailures: 0,
			lastSuccessAt: "2026-11-03T14:02:12.000Z",
			url: "https://example.com/hook",
		};
		const prompt = buildPrompt(
			tabbed,
			{
				network: "testnet",
				networks: ["mainnet", "testnet"],
				tabs: {},
				open: null,
				bases: { mainnet: MAINNET, testnet: TESTNET },
				at: AT,
			},
			{
				sum: { webhooks: [webhook], missing: [] },
				feed: {
					missing: [],
					rows: [
						{
							webhook: { id: webhook.id, name: webhook.name },
							delivery: {
								id: "del_2",
								dispatchedAt: "2026-11-03T14:02:12.000Z",
								blockHeight: 3912214,
								attempt: 1,
								statusCode: 200,
								errorMessage: null,
							},
						},
					],
				},
			},
		);
		expect(prompt).toBe(
			[
				...INTRO,
				"Page      Webhooks · Testnet tab (also Mainnet)",
				`Network   Testnet · ${TESTNET}`,
				"Spec      .secondlayer/dash/spec.json",
				"As of     2026-11-03 14:02:31 UTC",
				"",
				"## On screen",
				"1 webhook · 1 delivering",
				"Deliveries, newest first:",
				"  2026-11-03T14:02:12.000Z  pox5-stacking  delivery del_2  block 3912214  → 200",
				"",
				READS,
				"GET /api/webhooks",
				"GET /api/webhooks/{id}/deliveries",
			].join("\n"),
		);
	});

	test("a single-network page describes only the view tab on screen", () => {
		const rows = spec({
			page: {
				type: "Page",
				props: { title: "sbtc-deposits" },
				children: ["views"],
			},
			views: {
				type: "Tabs",
				props: { labels: ["Rows", "Schema"] },
				children: ["grid", "schema"],
			},
			grid: {
				type: "DataGrid",
				props: {
					network: "mainnet",
					subgraph: "sbtc-deposits",
					table: "transfers",
					limit: 2,
				},
			},
			schema: {
				type: "Schema",
				props: {
					network: "mainnet",
					subgraph: "sbtc-deposits",
					table: "transfers",
				},
			},
		});
		const prompt = buildPrompt(
			rows,
			{ tabs: { views: 1 }, open: null, bases: { mainnet: MAINNET }, at: AT },
			{
				grid: { rowCount: 2, columns: ["amount"], rows: [{ amount: "5" }] },
				schema: {
					columns: [
						{ name: "amount", type: "uint", indexed: false, notes: "" },
						{
							name: "_block_height",
							type: "bigint",
							indexed: true,
							notes: "added by secondlayer",
						},
					],
				},
			},
		);
		expect(prompt).toBe(
			[
				...INTRO,
				"Page      sbtc-deposits · Schema tab (also Rows)",
				`Network   Mainnet · ${MAINNET}`,
				"Spec      .secondlayer/dash/spec.json",
				"As of     2026-11-03 14:02:31 UTC",
				"",
				"## On screen",
				"Schema of sbtc-deposits.transfers:",
				"- amount uint",
				"- _block_height bigint, indexed, added by secondlayer",
				"",
				READS,
				"GET /api/subgraphs/sbtc-deposits",
			].join("\n"),
		);
	});

	test("an open delivery adds its response and sent payload", () => {
		const id = "8a12c0de-0000-4000-8000-000000000001";
		const failing = spec({
			page: {
				type: "Page",
				props: { title: "stx-to-treasury" },
				children: ["body"],
			},
			body: { type: "Stack", children: ["head", "feed"] },
			head: {
				type: "WebhookHeader",
				props: { network: "mainnet", webhookId: id },
			},
			feed: {
				type: "DeliveryFeed",
				props: {
					network: "mainnet",
					webhookIds: [id],
					limit: 1,
					open: "newest-failed",
				},
			},
		});
		const delivery = {
			id: "del_4182",
			dispatchedAt: "2026-11-03T14:01:58.000Z",
			blockHeight: 9184506,
			attempt: 3,
			statusCode: 503,
			errorMessage: null,
			responseBody: "upstream connect error",
		};
		const webhook = {
			id,
			name: "stx-to-treasury",
			status: "active",
			circuitOpenedAt: "2026-11-03T13:41:07.000Z",
			circuitFailures: 14,
			lastSuccessAt: "2026-11-03T13:36:22.000Z",
			lastError: "HTTP 503",
			url: "https://api.vaultapp.dev/hooks/treasury",
		};
		const prompt = buildPrompt(
			failing,
			{
				tabs: {},
				open: {
					type: "Payload",
					data: {
						webhook: { id, name: webhook.name },
						delivery,
						detail: {
							payload: {
								type: "chain.stx_transfer.apply",
								data: { amount: "2500000000" },
							},
							responseBody: "upstream connect error",
						},
					},
				},
				bases: { mainnet: MAINNET },
				at: AT,
			},
			{
				head: { webhook },
				feed: {
					missing: [],
					rows: [{ webhook: { id, name: webhook.name }, delivery }],
				},
			},
		);
		expect(prompt).toBe(
			[
				...INTRO,
				"Page      stx-to-treasury",
				`Network   Mainnet · ${MAINNET}`,
				"Spec      .secondlayer/dash/spec.json",
				"As of     2026-11-03 14:02:31 UTC",
				"",
				"## On screen",
				`Webhook stx-to-treasury (${id}): Failing since 2026-11-03T13:41:07.000Z, last success 2026-11-03T13:36:22.000Z`,
				"Endpoint: https://api.vaultapp.dev/hooks/treasury, last error: HTTP 503",
				"Attempts, newest first:",
				"  2026-11-03T14:01:58.000Z  delivery del_4182  block 9184506  attempt 3  → 503",
				"",
				"## Open",
				`Delivery del_4182 of stx-to-treasury (${id}) → 503`,
				"Response: upstream connect error",
				"Sent:",
				"{",
				'  "type": "chain.stx_transfer.apply",',
				'  "data": {',
				'    "amount": "2500000000"',
				"  }",
				"}",
				"",
				READS,
				`GET /api/webhooks/${id}`,
				"GET /api/webhooks",
				"GET /api/webhooks/{id}/deliveries",
				`GET /api/webhooks/${id}/deliveries/del_4182`,
			].join("\n"),
		);
		expect(prompt).not.toMatch(
			/sk-sl_|Bearer|INSTANCE_TOKEN|SECONDLAYER_API_KEY/,
		);
	});
});

describe("kit.css tokens", () => {
	const TOKENS = [
		"paper",
		"soft",
		"ink",
		"sub",
		"faint",
		"line",
		"pri",
		"on-pri",
		"hi",
		"on-hi",
		"ok",
		"alarm",
	];

	function block(css: string, from: number): string {
		const open = css.indexOf("{", from);
		let depth = 0;
		for (let i = open; i < css.length; i++) {
			if (css[i] === "{") depth++;
			if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
		}
		throw new Error("unbalanced braces");
	}

	function vars(body: string): Map<string, string> {
		const out = new Map<string, string>();
		for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
			out.set(m[1], m[2].trim());
		}
		return out;
	}

	function themes(file: string): {
		light: Map<string, string>;
		dark: Map<string, string>;
	} {
		const css = readFileSync(join(ROOT, file), "utf8");
		const lightAt = css.indexOf(":root {");
		const mediaAt = css.indexOf("@media (prefers-color-scheme: dark)");
		if (lightAt < 0 || mediaAt < 0)
			throw new Error(`${file}: theme blocks missing`);
		const light = vars(block(css, lightAt));
		const media = block(css, mediaAt);
		const dark = new Map([
			...light,
			...vars(block(media, media.indexOf(":root"))),
		]);
		const resolve = (map: Map<string, string>) => {
			const get = (value: string, depth = 0): string =>
				value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
					const next = map.get(name) ?? light.get(name);
					if (next === undefined || depth > 8)
						throw new Error(`${file}: --${name} unresolved`);
					return get(next, depth + 1);
				});
			return new Map(
				TOKENS.map((t) => [t, get(map.get(t) ?? "").toLowerCase()]),
			);
		};
		return { light: resolve(light), dark: resolve(dark) };
	}

	const site = themes("apps/web/src/app/globals.css");
	const kit = themes("skills/secondlayer/dash/template/kit.css");

	for (const theme of ["light", "dark"] as const) {
		test(`all 12 ${theme} tokens match the site`, () => {
			expect(Object.fromEntries(kit[theme])).toEqual(
				Object.fromEntries(site[theme]),
			);
			for (const t of TOKENS)
				expect(site[theme].get(t)).toMatch(/^#[0-9a-f]{6}$/);
		});
	}
});
