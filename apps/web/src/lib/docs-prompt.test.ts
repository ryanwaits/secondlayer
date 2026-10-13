import { describe, expect, test } from "bun:test";
import { accountSummary, keyHint } from "./docs-account-summary";
import { buildPrompt, chipUrl } from "./docs-prompt";
import type { ApiKey } from "./types";

const pageUrl = "https://secondlayer.tools/docs/streams.md";

describe("buildPrompt", () => {
	test("includes the page's agent notes under a rules heading when present", () => {
		const out = buildPrompt({
			task: "add a balances table",
			pageMd:
				"# Streams\n\nBody.\n\n## Notes for agents\n\n- return ctx.cursor\n- never poll",
			pageUrl,
		});
		expect(out).toContain(
			"Rules from these docs:\n- return ctx.cursor\n- never poll",
		);
		expect(out).toContain("Task: add a balances table");
		expect(out.startsWith("Ensure setup once")).toBe(true);
	});

	test("omits the rules heading when the page has no notes", () => {
		const out = buildPrompt({ task: "x", pageMd: "# Page\n\nBody.", pageUrl });
		expect(out).not.toContain("Rules from these docs");
	});

	test("stops the notes at the next section", () => {
		const out = buildPrompt({
			task: "x",
			pageMd: "## Notes for agents\n\n- a\n\n## Setup\n\nEnsure setup once",
			pageUrl,
		});
		expect(out).toContain("Rules from these docs:\n- a\n\nTask");
	});

	test("lists the page first and dedupes extra urls", () => {
		const out = buildPrompt({
			task: "x",
			pageMd: "",
			pageUrl,
			extraUrls: [pageUrl, "https://secondlayer.tools/docs/index.md"],
		});
		expect(out).toContain(
			`Read first:\n- ${pageUrl}\n- https://secondlayer.tools/docs/index.md`,
		);
		expect(out.split(pageUrl).length).toBe(2);
	});
});

const FULL_KEY = "sk-sl_7f3a1234567890abcdefFULLKEY";
const apiKey = {
	id: "k1",
	prefix: "sk-sl_7f3a",
	name: "laptop",
	status: "active",
	product: "account",
	tier: null,
	createdAt: "2026-10-01T00:00:00Z",
	lastUsedAt: null,
	key: FULL_KEY,
} as ApiKey;
const webhook = {
	id: "w1",
	name: "sbtc-deposits",
	status: "active",
	kind: "chain",
	format: "standard-webhooks",
	url: "https://hooks.acme.dev/services/T0/B0/s3cr3t",
	lastDeliveryAt: null,
	lastSuccessAt: null,
	circuitOpenedAt: null,
	circuitFailures: 2,
	createdAt: "x",
	updatedAt: "x",
} as never;

describe("buildPrompt signed in", () => {
	const out = buildPrompt({
		task: "fix my webhook",
		pageMd: "",
		pageUrl,
		account: accountSummary({ keys: [apiKey], webhooks: [webhook] }),
		key: keyHint([apiKey]),
	});

	test("names the key by prefix and carries the account block", () => {
		expect(out).toContain(
			'- Key: your "laptop" key, `sk-sl_7f3a…` (prefix shown; paste the full key from /account/keys)',
		);
		expect(out).toContain(
			'My account (use these names, not placeholders):\n- Key: "laptop" sk-sl_7f3a… (prefix only)\n- Webhook sbtc-deposits → hooks.acme.dev (active, 2 failing)',
		);
		expect(out).toContain(
			"- Live state: the secondlayer MCP, with the key above",
		);
		expect(out).not.toContain("- Hosted/archive:");
	});

	test("never contains a full key or a full receiver url", () => {
		expect(out).not.toContain(FULL_KEY);
		expect(out).not.toContain("s3cr3t");
		expect(out).not.toContain("https://hooks.acme.dev");
		expect(out).not.toContain("export SECONDLAYER_API_KEY=sk-sl_7f3a");
	});

	test("puts the account block before the task", () => {
		expect(out.indexOf("My account")).toBeLessThan(out.indexOf("Task:"));
	});
});

describe("buildPrompt signed out", () => {
	test("keeps the generic key line and has no account block", () => {
		const out = buildPrompt({ task: "x", pageMd: "", pageUrl });
		expect(out).toContain("`sk-sl_*`");
		expect(out).not.toContain("My account");
		expect(out).not.toContain("Live state");
	});
});

describe("chipUrl", () => {
	test("maps pages, headings and endpoints to markdown twins", () => {
		expect(chipUrl({ href: "/docs/webhooks" })).toBe(
			"https://secondlayer.tools/docs/webhooks.md",
		);
		expect(chipUrl({ href: "/docs/webhooks#retries" })).toBe(
			"https://secondlayer.tools/docs/webhooks.md#retries",
		);
		expect(
			chipUrl({
				href: "/docs/api/index#list-pox5-events",
				sub: "endpoint",
			}),
		).toBe("https://secondlayer.tools/docs/api-reference/list-pox5-events.md");
		expect(chipUrl({})).toBeNull();
	});

	test("caps urls at 12", () => {
		const extra = Array.from({ length: 20 }, (_, i) => `https://x/${i}.md`);
		const out = buildPrompt({
			task: "x",
			pageMd: "",
			pageUrl,
			extraUrls: extra,
		});
		expect(out.match(/^- https:\/\//gm)?.length).toBe(12);
	});
});
