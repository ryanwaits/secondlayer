import { describe, expect, test } from "bun:test";
import { findElements } from "../lib/test-render";
import { Choice } from "./choice";

const OPTIONS = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Beta" },
	{ value: "c", label: "Gamma" },
];

describe("Choice", () => {
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
});
