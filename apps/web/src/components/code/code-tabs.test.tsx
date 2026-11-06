import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
	test("a label from the fence is escaped", async () => {
		const html = await tabs({ children: fence("ts", "x", "<b>.ts") });
		expect(html).not.toContain("<b>");
	});
});
