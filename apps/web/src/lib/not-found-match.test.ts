import { describe, expect, test } from "bun:test";
import {
	closestRoutes,
	correctTokens,
	editDistance,
	pathQuery,
} from "./not-found-match";

const docs = [
	{ href: "/docs/mcp", title: "MCP" },
	{ href: "/docs/skills", title: "Agent skill" },
	{ href: "/docs/webhooks", title: "Webhooks" },
	{ href: "/docs/subgraphs", title: "Subgraphs" },
	{ href: "/docs/self-host", title: "Self-host" },
];

const site = [
	{ href: "/", title: "Home" },
	{ href: "/pricing", title: "Pricing" },
	{ href: "/p/webhooks", title: "Webhooks" },
	{ href: "/verify", title: "Verify" },
];

const hrefs = (path: string, routes = docs) =>
	closestRoutes(path, routes).map((r) => r.href);

describe("editDistance", () => {
	test("a swapped pair of letters is one edit", () => {
		expect(editDistance("pricnig", "pricing")).toBe(1);
	});
	test("a dropped letter is one edit", () => {
		expect(editDistance("skils", "skills")).toBe(1);
	});
});

describe("closestRoutes", () => {
	test("a typo in the last segment finds its page", () => {
		expect(hrefs("/docs/skils")[0]).toBe("/docs/skills");
		expect(hrefs("/pricng", site)[0]).toBe("/pricing");
	});

	test("a path that names the page title finds it", () => {
		expect(hrefs("/docs/agent-skill")[0]).toBe("/docs/skills");
	});

	test("a path under a real page sends you to that page", () => {
		expect(hrefs("/docs/webhooks/retry-policy")[0]).toBe("/docs/webhooks");
	});

	test("a typo under a section root beats the root itself", () => {
		const account = [
			{ href: "/account", title: "Overview" },
			{ href: "/account/webhooks", title: "Webhooks" },
		];
		expect(hrefs("/account/webhok", account)).toEqual(["/account/webhooks"]);
	});

	test("case, trailing slashes and a .md suffix don't matter", () => {
		expect(hrefs("/Docs/Subgraphs/")[0]).toBe("/docs/subgraphs");
		expect(hrefs("/docs/self-hostt.md")[0]).toBe("/docs/self-host");
	});

	test("a path like nothing we have returns nothing rather than a guess", () => {
		expect(hrefs("/docs/quantum-ledger")).toEqual([]);
		expect(hrefs("/wp-admin", site)).toEqual([]);
	});
});

describe("pathQuery", () => {
	test("turns path words into a search, dropping the section prefix and ids", () => {
		expect(pathQuery("/docs/webhook-retries/2", "/docs")).toBe(
			"webhook retries",
		);
	});
});

describe("correctTokens", () => {
	const vocab = new Set(["skip", "skill", "webhook", "retri", "subgraph"]);
	test("swaps an unknown token for its nearest known one", () => {
		expect(correctTokens(["skil", "webhok"], vocab)).toEqual([
			"skill",
			"webhook",
		]);
	});
	test("leaves a token alone when nothing is close", () => {
		expect(correctTokens(["zebra"], vocab)).toEqual(["zebra"]);
	});
});
