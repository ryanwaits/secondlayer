import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedRadios, findElements } from "../lib/test-render";
import { AmountPicker } from "./amount-picker";

const OPTIONS = [
	{ value: "10", label: "$10", caption: "about 12 days" },
	{ value: "25", label: "$25", caption: "about 30 days" },
	{ value: "50", label: "$50" },
];

describe("AmountPicker", () => {
	test("one radio per amount under the field name, the value checked", () => {
		const html = renderToStaticMarkup(
			<AmountPicker
				name="pack"
				legend="Amount"
				options={OPTIONS}
				value="25"
				onChange={() => {}}
			/>,
		);
		expect(html.match(/name="pack"/g)).toHaveLength(3);
		expect(checkedRadios(html)).toEqual({ pack: "25" });
	});

	test("a value outside the options leaves nothing selected", () => {
		const html = renderToStaticMarkup(
			<AmountPicker
				name="pack"
				legend="Amount"
				options={OPTIONS}
				value="37"
				onChange={() => {}}
			/>,
		);
		expect(html).not.toContain("checked");
	});

	test("shows a caption only where one is given", () => {
		const html = renderToStaticMarkup(
			<AmountPicker
				name="pack"
				legend="Amount"
				options={OPTIONS}
				value="10"
				onChange={() => {}}
			/>,
		);
		expect(html.match(/class="amount-caption"/g)).toHaveLength(2);
		expect(html).toContain("about 30 days");
	});

	test("picking an amount reports its value", () => {
		const picked: string[] = [];
		const el = AmountPicker({
			name: "pack",
			legend: "Amount",
			options: OPTIONS,
			value: "10",
			onChange: (v) => picked.push(v),
		});
		const input = findElements(el, "input").find((i) => i.props.value === "50");
		input?.props.onChange?.();
		expect(picked).toEqual(["50"]);
	});
});
