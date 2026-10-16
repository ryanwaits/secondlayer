import { describe, expect, test } from "bun:test";
import type { Insight, InsightEvidence } from "@/lib/insights";
import { FIXTURE_INSIGHTS, FIXTURE_STACK } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { Evidence } from "./evidence";
import { HandoffBlock } from "./handoff-block";
import { InsightCard } from "./insight-card";
import { InsightNote } from "./insight-note";
import { InsightStack } from "./insight-stack";

const byRule = (rule: string): Insight => {
	const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
	if (!found) throw new Error(`missing fixture ${rule}`);
	return found;
};

describe("InsightStack", () => {
	const html = renderToStaticMarkup(<InsightStack insights={FIXTURE_STACK} />);

	test("headlines the count, worst first", () => {
		expect(html).toContain("4 insights");
		expect(html).toContain("worst first");
	});

	test("opens exactly one card, the losing one", () => {
		expect(html.match(/class="ins-card"/g)).toHaveLength(1);
		expect(html).toContain("Your receiver is down, not the chain.");
		expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
	});

	test("lists the notes in rank order", () => {
		const order = [
			"Receiver returning 502",
			"The TLS certificate",
			"sbtc-deposits-v2 does the same job",
			"Retries on Oct 12",
		].map((line) => html.indexOf(line));
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	test("opens nothing when the top item only costs money or recovered", () => {
		const quiet = renderToStaticMarkup(
			<InsightStack
				insights={[byRule("duplicate_webhook"), byRule("retries_recovered")]}
			/>,
		);
		expect(quiet).not.toContain('class="ins-card"');
		expect(quiet).toContain("2 insights");
	});

	test("renders nothing for an empty list", () => {
		expect(renderToStaticMarkup(<InsightStack insights={[]} />)).toBe("");
	});
});

describe("InsightNote", () => {
	test("a collapsed note offers Why and hides the card", () => {
		const html = renderToStaticMarkup(
			<InsightNote
				insight={byRule("retries_recovered")}
				open={false}
				onToggle={() => {}}
			/>,
		);
		expect(html).toContain("Why ›");
		expect(html).toContain("recovered");
		expect(html).toContain("ins-dot idle");
		expect(html).not.toContain("ins-card");
	});

	test("an open note offers Hide", () => {
		const html = renderToStaticMarkup(
			<InsightNote insight={byRule("tls_expiring")} open onToggle={() => {}} />,
		);
		expect(html).toContain("Hide ›");
		expect(html).toContain("ins-dot hi");
	});
});

describe("footer on notes and stacks", () => {
	test("an open note renders the footer inside its card", () => {
		const html = renderToStaticMarkup(
			<InsightNote
				insight={byRule("tls_expiring")}
				open
				onToggle={() => {}}
				footer="Note footer"
			/>,
		);
		expect(html).toMatch(/class="ins-foot">Note footer</);
	});

	test("a collapsed note renders no footer", () => {
		const html = renderToStaticMarkup(
			<InsightNote
				insight={byRule("tls_expiring")}
				open={false}
				onToggle={() => {}}
				footer="Note footer"
			/>,
		);
		expect(html).not.toContain("Note footer");
	});

	test("a stack passes each opened insight to the footer", () => {
		const html = renderToStaticMarkup(
			<InsightStack
				insights={FIXTURE_STACK}
				footer={(insight) => `Footer for ${insight.rule}`}
			/>,
		);
		expect(html.match(/class="ins-foot"/g)).toHaveLength(1);
		expect(html).toContain("Footer for receiver_down");
	});

	test("nothing renders without a footer", () => {
		const note = renderToStaticMarkup(
			<InsightNote insight={byRule("tls_expiring")} open onToggle={() => {}} />,
		);
		const stack = renderToStaticMarkup(
			<InsightStack insights={FIXTURE_STACK} />,
		);
		expect(note).not.toContain("ins-foot");
		expect(stack).not.toContain("ins-foot");
	});
});

describe("InsightCard", () => {
	test("says Cause unknown and hides a low-confidence cause", () => {
		const html = renderToStaticMarkup(
			<InsightCard insight={byRule("dns_retries_recovered")} />,
		);
		expect(html).toContain("Cause unknown");
		expect(html).not.toContain("dns_timeout");
	});

	test("names a confident cause in the working", () => {
		const html = renderToStaticMarkup(
			<InsightCard insight={byRule("receiver_down")} />,
		);
		expect(html).toContain("cause=receiver_down");
		expect(html).not.toContain("Cause unknown");
	});

	test("never renders code outside the CLI lines", () => {
		for (const insight of FIXTURE_INSIGHTS) {
			const html = renderToStaticMarkup(<InsightCard insight={insight} />);
			const codeTags = html.match(/<code/g)?.length ?? 0;
			const cliLines = html.match(/class="wh-cli-code"/g)?.length ?? 0;
			expect(codeTags).toBe(cliLines);
			expect(cliLines).toBe(insight.handoff.commands.length);
		}
	});

	test("renders a footer when given", () => {
		const html = renderToStaticMarkup(
			<InsightCard insight={byRule("tls_expiring")} footer="Clears itself" />,
		);
		expect(html).toContain("Clears itself");
	});
});

describe("HandoffBlock", () => {
	const insight = byRule("receiver_down");
	const html = renderToStaticMarkup(
		<HandoffBlock
			prompt={insight.handoff.prompt}
			commands={insight.handoff.commands}
		/>,
	);

	test("shows the label and the plain-English prompt", () => {
		expect(html).toContain("Hand off to your agent");
		expect(html).toContain("returns HTTP 502 from nginx");
	});

	test("shows our CLI commands as $ lines", () => {
		expect(html).toMatch(
			/\$<\/span>(<!-- -->)? (<!-- -->)?sl webhooks doctor sbtc-deposits/,
		);
		expect(html).toContain("sl webhooks dead sbtc-deposits");
	});

	test("offers Copy for agent", () => {
		expect(html).toContain("Copy for agent");
	});
});

describe("Evidence", () => {
	const render = (item: InsightEvidence) =>
		renderToStaticMarkup(<Evidence item={item} />);

	test("table marks the row with a chip on its first cell", () => {
		const html = render({
			kind: "table",
			title: "Calls",
			columns: ["Function", "Calls"],
			rows: [
				["set-impl", "none"],
				["deposit", 12],
			],
			markRow: 0,
		});
		expect(html.match(/mark-chip/g)).toHaveLength(1);
		expect(html).toContain('<span class="mark-chip">set-impl</span>');
	});

	test("shapes colors errors, flags new shapes, and keeps a quiet 200 quiet", () => {
		const html = render({
			kind: "shapes",
			title: "Responses",
			shapes: [
				{ code: "502", body: "bad gateway", count: 214, isNew: true },
				{ code: "200", body: "ok json", count: 0, isNew: false },
				{ code: "200", body: "login page", count: 312, isNew: true },
			],
		});
		expect(html.match(/ins-shape-code bad/g)).toHaveLength(2);
		expect(html.match(/ins-chip/g)).toHaveLength(2);
		expect(html).toContain("214×");
	});

	test("timeline marks failed attempts", () => {
		const html = render({
			kind: "timeline",
			title: "Attempts",
			steps: [
				{ what: "Attempt 1", at: "19:02", failed: true },
				{ what: "Attempt 2", at: "+30s", failed: true },
				{ what: "Attempt 3", at: "+2m", note: "41 ms", failed: false },
			],
		});
		expect(html.match(/class="failed"/g)).toHaveLength(2);
		expect(html.match(/class="ok"/g)).toHaveLength(1);
		expect(html).toContain("--n:3");
	});
});
