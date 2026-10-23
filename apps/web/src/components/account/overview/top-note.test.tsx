import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { TopNote, nextVisible, topNotes } from "./top-note";

const byId = (id: string): Insight => {
	const found = FIXTURE_INSIGHTS.find((i) => i.id === id);
	if (!found) throw new Error(`missing fixture ${id}`);
	return found;
};

const losing = byId("ins-receiver-down");
const willFail = byId("ins-tls-expiring");
const costs = byId("ins-duplicate-webhook");
const recovered = byId("ins-retries-recovered");

const render = (props: Parameters<typeof TopNote>[0]) =>
	renderToStaticMarkup(<TopNote {...props} />);

describe("TopNote", () => {
	test("a healthy account renders no card", () => {
		expect(render({ insights: [], failing: [] })).toBe("");
		expect(render({ insights: [recovered], failing: [] })).toBe("");
	});

	test("one losing note shows its lead, both buttons, commands and prompt link", () => {
		const html = render({ insights: [losing], failing: [] });
		expect(html).toContain(losing.lead);
		expect(html).toContain("Got it");
		expect(html).toContain("Dismiss");
		for (const command of losing.handoff.commands) {
			expect(html).toContain(command.replace(/&/g, "&amp;"));
		}
		expect(html).toContain("See why");
		expect(html).toContain("Copy the fix as a prompt");
		expect(html).toContain("dash-dot alarm");
		expect(html).not.toContain("more note");
	});

	test("more open notes sit behind a line naming only the next target", () => {
		const html = render({ insights: [costs, losing, willFail], failing: [] });
		expect(html).toContain("2 more notes, on sbtc-deposits.");
		expect(html).toContain("Show it");
		expect(html.match(/aria-label="Note"/g)).toHaveLength(1);
		expect(html).toContain(losing.lead);
		expect(html).not.toContain(willFail.lead);
	});

	test("a failing webhook with no open note gets the you're-on-it card", () => {
		const html = render({
			insights: [],
			failing: [{ id: "wh-x", name: "vault-events" }],
		});
		expect(html).toContain("vault-events is failing. You&#x27;re on it.");
		expect(html).toContain("Its row stays red until it delivers again.");
		expect(html).not.toContain("Got it");
	});

	test("credits out is a state with no buttons", () => {
		const html = render({ insights: [], failing: [], state: "credits_out" });
		expect(html).toContain("Your hosted stack stopped.");
		expect(html).toContain("Add credits");
		expect(html).not.toContain("Got it");
		expect(html).not.toContain("Dismiss");
	});

	test("asleep keeps its copy and has no buttons", () => {
		const html = render({ insights: [], failing: [], state: "asleep" });
		expect(html).toContain("Your hosted stack is asleep.");
		expect(html).not.toContain("Got it");
	});
});

describe("topNotes", () => {
	test("ranks worst first and drops recovered incidents", () => {
		const { open } = topNotes([costs, recovered, losing, willFail], []);
		expect(open.map((i) => i.id)).toEqual([losing.id, willFail.id, costs.id]);
	});

	test("only failing webhooks without an open note are unspoken", () => {
		const { unspoken } = topNotes(
			[losing],
			[
				{ id: losing.resource.id, name: losing.resource.name },
				{ id: "wh-other", name: "other" },
			],
		);
		expect(unspoken).toEqual([{ id: "wh-other", name: "other" }]);
	});
});

describe("nextVisible", () => {
	const open = [losing, willFail, costs];

	test("shows the top note and names the next", () => {
		const view = nextVisible(open, []);
		expect(view.visible).toEqual([losing]);
		expect(view.next).toEqual(willFail);
		expect(view.more).toBe(2);
	});

	test("Show it reveals exactly one more sibling", () => {
		const view = nextVisible(open, [willFail.id]);
		expect(view.visible).toEqual([losing, willFail]);
		expect(view.next).toEqual(costs);
		expect(view.more).toBe(1);
	});

	test("nothing left behind once all are shown", () => {
		const view = nextVisible(open, [willFail.id, costs.id]);
		expect(view.next).toBeNull();
		expect(view.more).toBe(0);
	});
});
