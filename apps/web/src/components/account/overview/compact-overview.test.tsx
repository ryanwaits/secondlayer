import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewBody } from "./overview-section";
import {
	exampleKeys,
	exampleOverview,
	exampleWebhooks,
} from "./overview.fixtures";

const now = new Date("2026-10-18T14:30:00.000Z");

const render = (over: Parameters<typeof exampleOverview>[1] = {}) =>
	renderToStaticMarkup(
		<OverviewBody
			{...exampleOverview(now, {
				compact: true,
				subgraphs: <div className="msg-group" />,
				...over,
			})}
		/>,
	);

describe("the phone Account page", () => {
	test("a running account lists webhooks, subgraphs, usage, keys and notifications in that order", () => {
		const html = render();
		const at = (needle: string) => html.indexOf(needle);
		const order = [
			'id="webhooks"',
			'id="subgraphs"',
			'id="usage"',
			'id="keys"',
			'aria-label="Notifications"',
		].map(at);
		expect(order.every((n) => n > -1)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	test("every webhook links to its page", () => {
		const html = render();
		expect(html).toContain('href="/account/webhooks/wh_first"');
		expect(html).toContain("sbtc-deposits");
	});

	test("has no command and no terminal block anywhere", () => {
		for (const html of [
			render(),
			render({ rows: exampleWebhooks(now, { failing: true }) }),
			render({ stage: "no_key", keys: [], rows: [], hasSubgraphs: false }),
			render({ stage: "no_reads", rows: [], hasSubgraphs: false }),
			render({ stage: "reading", rows: [], hasSubgraphs: false }),
		]) {
			expect(html).not.toContain("wh-cli");
			expect(html).not.toContain("sl webhooks");
			expect(html).not.toContain("sl credits");
			expect(html).not.toContain("Work from your terminal");
		}
	});

	test("the top note offers Share the fix and no copy-as-prompt link", () => {
		const html = render({
			rows: exampleWebhooks(now, { failing: true }),
			insights: FIXTURE_INSIGHTS.slice(0, 1),
		});
		expect(html).toContain("Share the fix");
		expect(html).toContain(">Claude<");
		expect(html).toContain(">ChatGPT<");
		expect(html).toContain(">Cursor<");
		expect(html).toContain(">More<");
		expect(html).toContain(">Got it<");
		expect(html).toContain(">Dismiss<");
		expect(html).not.toContain("Copy the fix as a prompt");
	});

	test("usage offers Add credits and Set a limit, which open sheets", () => {
		const html = render();
		expect(html).toContain(">Add credits<");
		expect(html).toContain(">Set a limit<");
		// Sheets mount only when open.
		expect(html).not.toContain('role="dialog"');
	});

	test("keys and apps end in holds, and say where keys are made", () => {
		const html = render({
			apps: [
				{
					id: "a1",
					clientName: "Claude Code",
					createdAt: "2026-09-01T00:00:00.000Z",
					lastUsedAt: "2026-10-18T11:30:00.000Z",
				},
			],
		});
		expect(html).toContain("Hold to revoke");
		expect(html).toContain("Hold to disconnect");
		expect(html).toContain(
			"New keys, webhooks and subgraphs are made at a desk.",
		);
		expect(html).not.toContain(">New key<");
	});

	test("a revoked key has no hold", () => {
		const [key] = exampleKeys(now);
		if (!key) throw new Error("missing key fixture");
		const html = render({
			keys: [{ ...key, status: "revoked" }],
			apps: [],
		});
		expect(html).not.toContain("Hold to revoke");
	});

	test("no key: says keys are made at a desk and offers the link", () => {
		const html = render({
			stage: "no_key",
			keys: [],
			rows: [],
			hasSubgraphs: false,
		});
		expect(html).toContain("Make a key to start.");
		expect(html).toContain("Send yourself the link");
		expect(html).not.toContain("Create a key");
	});

	test("key, no reads: leads with the first read and still shows usage and keys", () => {
		const html = render({
			stage: "no_reads",
			rows: [],
			hasSubgraphs: false,
			onboarding: {
				keyName: "laptop",
				flow: null,
				onCreateKey: () => {},
			},
		});
		expect(html).toContain("Read your first rows");
		expect(html).toContain("<b>laptop</b>");
		expect(html).toContain('id="usage"');
		expect(html).toContain('id="keys"');
		expect(html).not.toContain('id="webhooks"');
	});

	test("reading only: usage and keys, no webhook or subgraph section", () => {
		const html = render({ stage: "reading", rows: [], hasSubgraphs: false });
		expect(html).toContain('id="usage"');
		expect(html).not.toContain('id="webhooks"');
		expect(html).not.toContain('id="subgraphs"');
	});

	test("while loading it shows a skeleton and no section", () => {
		const html = render({ loading: true });
		expect(html).toContain("aria-busy");
		expect(html).not.toContain('id="usage"');
	});
});
