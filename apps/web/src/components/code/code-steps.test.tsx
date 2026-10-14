import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Code } from "./code";
import { CodeSteps, Step } from "./code-steps";

async function html(node: Awaited<ReturnType<typeof CodeSteps>>) {
	return renderToStaticMarkup(node);
}

describe("CodeSteps", () => {
	const children = [
		<Step key="a" ref="open" title="Start where you stopped">
			<p>Load the cursor.</p>
		</Step>,
		<Step key="b" ref="save" title="Write together">
			<p>One transaction.</p>
		</Step>,
		<Code
			key="c"
			lang="ts"
			code={["// !ref open", "load();", "// !ref save", "save();"].join("\n")}
		/>,
	];

	test("each step carries its ref and the block sits in the sticky column", async () => {
		const out = await html(await CodeSteps({ children }));
		expect(out).toContain('data-step="open"');
		expect(out).toContain('data-step="save"');
		expect(out).toContain("Step 1");
		expect(out).toContain("Step 2");
		expect(out).toContain('class="cs-stick"');
		expect(out).toContain('data-refs="open"');
		// The step's own prose is never mistaken for the block.
		expect(out).not.toContain("[object Object]");
	});

	test("steps without a block draw nothing", async () => {
		expect(await CodeSteps({ children: children.slice(0, 2) })).toBeNull();
	});
});
