import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Code } from "./code";
import { CodeTabs } from "./code-tabs";

/** CodeTabs is an async server component: resolve it, then render the element it returns. */
async function tabs(props: {
	sync?: string;
	variant?: "docs" | "figure";
	children?: ReactNode;
}): Promise<string> {
	return renderToStaticMarkup((await CodeTabs(props)) as ReactNode);
}

/** The shape MDX hands a component for a fence. */
const fence = (lang: string, code: string, meta?: string) => (
	<pre>
		<code className={`language-${lang}`} data-meta={meta}>
			{code}
		</code>
	</pre>
);

describe("CodeTabs", () => {
	test("each fence is a tab labeled from its language, the first selected", async () => {
		const html = await tabs({
			sync: "lang",
			children: [
				fence("sh", 'curl "$URL/v1/streams/tip"'),
				fence("ts", "await sl.streams.tip();"),
			],
		});
		expect(html).toContain(
			'<button type="button" role="tab" aria-selected="true" data-tab="bash">cURL</button>',
		);
		expect(html).toContain(
			'<button type="button" role="tab" aria-selected="false" data-tab="typescript">TypeScript</button>',
		);
	});

	test("only the first pane is visible, and panes draw no frame of their own", async () => {
		const html = await tabs({
			children: [fence("sh", "echo a"), fence("ts", "const b = 1;")],
		});
		expect(html).toMatch(
			/role="tabpanel" data-tab="bash"><div class="cb tabbed" data-copyable>/,
		);
		expect(html).toMatch(/role="tabpanel" data-tab="typescript" hidden>/);
		// Copy lives in the bar once; each pane says whether it has anything to copy.
		expect(html.match(/data-copy-button/g)).toHaveLength(1);
		expect(html.match(/data-copyable/g)).toHaveLength(2);
	});

	test("the tab strip is the shared mono tab bar in both variants", async () => {
		for (const variant of ["docs", "figure"] as const) {
			const html = await tabs({ variant, children: fence("ts", "x") });
			expect(html).toContain('<span class="tabbar mono" role="tablist">');
		}
	});

	test("the group carries its sync key", async () => {
		const html = await tabs({ sync: "lang", children: fence("ts", "x") });
		expect(html).toContain('data-sync="lang"');
	});

	test("a fence's title is its label and key", async () => {
		const html = await tabs({ children: fence("ts", "x", "consumer.ts") });
		expect(html).toContain('data-tab="consumer.ts">consumer.ts</button>');
	});

	test("a pane that cannot be copied is still a pane", async () => {
		const html = await tabs({
			children: [fence("ts", "x"), fence("text", "out")],
		});
		// Output is not copyable, which is what takes Copy out of the bar.
		expect(html.match(/data-copyable/g)).toHaveLength(1);
	});

	test("a <Code> child keeps its own tip names", async () => {
		const html = await tabs({
			children: [
				<Code key="a" lang="sh" code="curl $URL/v1/streams/tip" />,
				<Code
					key="b"
					lang="ts"
					code="await sl.streams.tip();"
					tips={["sl.streams.tip"]}
				/>,
			],
		});
		// Only the TypeScript pane tips; the cURL pane was given no names.
		expect(html.match(/class="tip"/g)).toHaveLength(1);
		expect(html).not.toContain("<a ");
	});

	test("a label from the fence is escaped", async () => {
		const html = await tabs({ children: fence("ts", "x", "<b>.ts") });
		expect(html).not.toContain("<b>");
	});

	test("a group of nothing renders nothing", async () => {
		expect(await CodeTabs({ children: null })).toBeNull();
	});

	test("a figure group keeps each pane's margin notes inside that pane", async () => {
		const html = await tabs({
			sync: "chain",
			variant: "figure",
			children: [
				fence("ts", "// !callout[/send/] first note\nsend();", "a.ts"),
				fence("sol", "// !callout[/emit/] second note\nemit Sent();", "b.sol"),
			],
		});
		const panels = html.split('role="tabpanel"').slice(1);
		expect(panels).toHaveLength(2);
		// The visible pane holds its own note and not the other pane's.
		expect(panels[0]).toContain("first note");
		expect(panels[0]).not.toContain("second note");
		expect(panels[0]).not.toContain(" hidden>");
		// The hidden pane carries the other note, hidden with it.
		expect(panels[1]).toMatch(/^ data-tab="b.sol" hidden>/);
		expect(panels[1]).toContain("second note");
		expect(html.match(/class="cf-notes"/g)).toHaveLength(2);
		// The tab bar stays above both, outside any pane.
		expect(html.indexOf('role="tablist"')).toBeLessThan(
			html.indexOf('role="tabpanel"'),
		);
		expect(html).toContain("cb cb-tabs figure");
	});
});

describe("CodeTabs docs key", () => {
	test("one control in the group bar when any pane names the key variable", async () => {
		const html = await tabs({
			children: [
				fence(
					"sh",
					'curl -H "Authorization: Bearer $SECONDLAYER_API_KEY" "$URL"',
				),
				fence("ts", "await sl.streams.tip();"),
			],
		});
		expect(html.match(/data-use-key/g)?.length).toBe(1);
		expect(html).toContain(
			'<span class="r"><button type="button" class="ghost use-key"',
		);
	});

	test("no control when no pane names it", async () => {
		const html = await tabs({
			children: [fence("sh", 'curl "$URL"'), fence("ts", "sl.tip();")],
		});
		expect(html).not.toContain("data-use-key");
	});
});
