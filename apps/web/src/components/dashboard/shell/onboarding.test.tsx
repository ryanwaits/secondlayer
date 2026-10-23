import { describe, expect, test } from "bun:test";
import { hasNoKey, onboardingProgress } from "@/lib/onboarding";
import type { ApiKey } from "@/lib/types";
import { renderToStaticMarkup } from "react-dom/server";
import { Checklist, PlaceholderRows, ReadsKeyLine } from "./onboarding";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sk-sl_abc12345",
	name: "laptop",
	status: "active",
	product: "account",
	tier: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	lastUsedAt: null,
	...patch,
});

describe("ReadsKeyLine", () => {
	test("first run says reads need a key and links to Keys, not a button", () => {
		const html = renderToStaticMarkup(<ReadsKeyLine state="first" />);
		expect(html).toContain("Reads need a key.");
		expect(html).toContain('href="/account#keys"');
		expect(html).toContain("Make one on Keys");
		expect(html).not.toContain("acct-btn");
	});

	test("all keys revoked says new reads need one", () => {
		const html = renderToStaticMarkup(<ReadsKeyLine state="none_active" />);
		expect(html).toContain("No active key. New reads need one.");
		expect(html).toContain('href="/account#keys"');
		expect(html).not.toContain("acct-btn");
	});
});

describe("Checklist", () => {
	const steps = [
		{ title: "One", body: "first", done: true, current: false },
		{
			title: "Two",
			body: "second",
			done: false,
			current: true,
			extra: <b>cmd</b>,
		},
		{
			title: "Three",
			body: "third",
			done: false,
			current: false,
			extra: <i>no</i>,
		},
	];

	test("checks a done step, rings the current one and shows its extra only", () => {
		const html = renderToStaticMarkup(<Checklist steps={steps} />);
		expect(html).toContain("✓");
		expect(html.match(/aria-current="step"/g)).toHaveLength(1);
		expect(html).toContain("<b>cmd</b>");
		expect(html).not.toContain("<i>no</i>");
	});
});

describe("PlaceholderRows", () => {
	test("is hidden from readers and carries the note outside the faint block", () => {
		const html = renderToStaticMarkup(
			<PlaceholderRows rows={[{ name: "laptop" }, {}]} note="These fill in." />,
		);
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("laptop");
		expect(html.indexOf("These fill in.")).toBeGreaterThan(
			html.lastIndexOf('aria-hidden="true"'),
		);
	});
});

describe("onboarding progress", () => {
	test("no key until the list has loaded and shows none of your own", () => {
		expect(hasNoKey(null, NOW)).toBe(false);
		expect(hasNoKey([], NOW)).toBe(true);
		expect(hasNoKey([key({ product: "tenant" })], NOW)).toBe(true);
		expect(hasNoKey([key({ status: "revoked" })], NOW)).toBe(true);
		expect(hasNoKey([key({})], NOW)).toBe(false);
	});

	test("a key and then a first read, or a webhook or subgraph, complete it", () => {
		expect(onboardingProgress([], NOW, false)).toMatchObject({ key: false });
		expect(onboardingProgress([key({})], NOW, false)).toMatchObject({
			key: true,
			read: false,
			complete: false,
		});
		const read = [key({ lastUsedAt: "2026-10-15T11:00:00.000Z" })];
		expect(onboardingProgress(read, NOW, false).complete).toBe(true);
		expect(onboardingProgress([key({})], NOW, true).complete).toBe(true);
	});
});
