import { describe, expect, test } from "bun:test";
import { findElements } from "../lib/test-render";
import { AmountPicker } from "./amount-picker";

const OPTIONS = [
	{ value: "10", label: "$10", caption: "about 12 days" },
	{ value: "25", label: "$25", caption: "about 30 days" },
	{ value: "50", label: "$50" },
];

describe("AmountPicker", () => {
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
