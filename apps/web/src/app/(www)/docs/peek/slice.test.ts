import { describe, expect, test } from "bun:test";
import { type Child, ledeRange, sectionRange } from "./slice";

const wrap = (id: string): Child => ({
	tag: "div",
	className: "section-heading-wrap",
	id,
});
const el = (tag: string, id = "", className = ""): Child => ({
	tag,
	className,
	id,
});

// h1, lede, ## a (p, ### a1 (p, #### a1x (p), p, ### a2 (p)), ## b (p, ### b1 (p))
const page: Child[] = [
	el("h1", "", "page-title"), // 0
	el("p"), // 1
	el("p"), // 2
	wrap("a"), // 3
	el("p"), // 4
	el("h3", "a1"), // 5
	el("p"), // 6
	el("h4", "a1x"), // 7
	el("p"), // 8
	el("h4", "a1y"), // 9
	el("p"), // 10
	el("h3", "a2"), // 11
	el("p"), // 12
	wrap("b"), // 13
	el("p"), // 14
	el("h3", "b1"), // 15
	el("p"), // 16
];

describe("sectionRange", () => {
	test("a ## runs from after its heading to the next ##, through its ### children", () => {
		expect(sectionRange(page, "a")).toEqual({ start: 4, end: 13 });
	});

	test("a ### stops at the next ### or ##", () => {
		expect(sectionRange(page, "a1")).toEqual({ start: 6, end: 11 });
		expect(sectionRange(page, "a2")).toEqual({ start: 12, end: 13 });
	});

	test("a #### stops at the next ####, ### or ##", () => {
		expect(sectionRange(page, "a1x")).toEqual({ start: 8, end: 9 });
		expect(sectionRange(page, "a1y")).toEqual({ start: 10, end: 11 });
	});

	test("the last section runs to the end", () => {
		expect(sectionRange(page, "b")).toEqual({ start: 14, end: 17 });
		expect(sectionRange(page, "b1")).toEqual({ start: 16, end: 17 });
	});

	test("a heading with nothing under it has an empty range", () => {
		const bare = [wrap("x"), wrap("y")];
		expect(sectionRange(bare, "x")).toEqual({ start: 1, end: 1 });
	});

	test("an unknown id, an empty id, or a non-heading with that id is null", () => {
		expect(sectionRange(page, "nope")).toBeNull();
		expect(sectionRange(page, "")).toBeNull();
		expect(sectionRange([el("table", "t"), el("p")], "t")).toBeNull();
	});
});

describe("ledeRange", () => {
	test("takes the paragraphs after the title and stops at a div", () => {
		const children = [
			el("h1", "", "page-title"),
			el("p"),
			el("p"),
			el("div", "", "yields"),
			el("p"),
		];
		expect(ledeRange(children)).toEqual({ start: 1, end: 3 });
	});

	test("a title followed by no paragraph is an empty range", () => {
		const range = ledeRange([el("h1", "", "page-title"), wrap("a"), el("p")]);
		expect(range).toEqual({ start: 1, end: 1 });
	});

	test("a page with no title is null", () => {
		expect(ledeRange([el("p"), el("p")])).toBeNull();
	});
});
