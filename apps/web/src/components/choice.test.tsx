import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedRadios, findElements } from "../lib/test-render";
import { Choice } from "./choice";

const OPTIONS = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Beta" },
	{ value: "c", label: "Gamma" },
];

describe("Choice", () => {
	test("is not compact by default, and size sm adds the sm class", () => {
		const plain = renderToStaticMarkup(
			<Choice name="r" legend="L" options={OPTIONS} />,
		);
		expect(plain).toContain('class="choice"');
		expect(plain).not.toContain("choice sm");
		const small = renderToStaticMarkup(
			<Choice name="r" legend="L" options={OPTIONS} size="sm" />,
		);
		expect(small).toContain('class="choice sm"');
	});

	test("the size container is a div inside the fieldset, not the fieldset", () => {
		const html = renderToStaticMarkup(
			<Choice name="r" legend="L" options={OPTIONS} />,
		);
		expect(html).toContain('<div class="choice-wrap"><div class="choice-row"');
	});

	test("renders one radio per option under the field name", () => {
		const html = renderToStaticMarkup(
			<Choice name="role" legend="I'm a" options={OPTIONS} />,
		);
		expect(html.match(/type="radio"/g)).toHaveLength(3);
		expect(html.match(/name="role"/g)).toHaveLength(3);
		for (const o of OPTIONS) {
			expect(html).toContain(`value="${o.value}"`);
			expect(html).toContain(o.label);
		}
	});

	test("the default value starts checked and nothing else does", () => {
		const html = renderToStaticMarkup(
			<Choice name="role" legend="I'm a" options={OPTIONS} defaultValue="b" />,
		);
		expect(checkedRadios(html)).toEqual({ role: "b" });
	});

	test("a controlled value is the checked one, and picking another reports it", () => {
		const picked: string[] = [];
		const el = Choice({
			name: "view",
			legend: "View",
			options: OPTIONS,
			value: "c",
			onChange: (v) => picked.push(v),
		});
		const inputs = findElements(el, "input");
		const checked = inputs.filter((i) => i.props.checked);
		expect(checked.map((i) => i.props.value)).toEqual(["c"]);
		inputs.find((i) => i.props.value === "a")?.props.onChange?.();
		expect(picked).toEqual(["a"]);
	});

	test("names the group for assistive tech by legend or by a visible label", () => {
		const legend = renderToStaticMarkup(
			<Choice name="x" legend="Volume" options={OPTIONS} />,
		);
		expect(legend).toContain('<legend class="choice-legend">Volume</legend>');
		const labelled = renderToStaticMarkup(
			<Choice name="x" labelledBy="lbl" options={OPTIONS} />,
		);
		expect(labelled).toContain('aria-labelledby="lbl"');
		expect(labelled).not.toContain("<legend");
	});

	test("more than three options are marked to stack on narrow containers", () => {
		const many = renderToStaticMarkup(
			<Choice
				name="x"
				legend="x"
				options={[...OPTIONS, { value: "d", label: "Delta" }]}
			/>,
		);
		expect(many).toContain("data-many");
		const few = renderToStaticMarkup(
			<Choice name="x" legend="x" options={OPTIONS} />,
		);
		expect(few).not.toContain("data-many");
	});
});
