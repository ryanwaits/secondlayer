import { describe, expect, test } from "bun:test";
import { Code } from "./code";
import { CodeSteps, Step } from "./code-steps";

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

	test("steps without a block draw nothing", async () => {
		expect(await CodeSteps({ children: children.slice(0, 2) })).toBeNull();
	});
});
