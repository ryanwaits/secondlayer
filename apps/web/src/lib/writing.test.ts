import { describe, expect, test } from "bun:test";
import { type WritingPost, isNew } from "./writing";

const post = (date: string, status: WritingPost["status"] = "published") =>
	({
		slug: "p",
		number: 1,
		title: "",
		dek: "",
		date,
		readingTime: "1 min",
		status,
	}) as WritingPost;

const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

describe("isNew", () => {
	test("a published post is new for two weeks from its date", () => {
		expect(isNew(post("2026-10-14"), at("2026-10-14"))).toBe(true);
		expect(isNew(post("2026-10-14"), at("2026-10-27"))).toBe(true);
		expect(isNew(post("2026-10-14"), at("2026-10-28"))).toBe(false);
	});

	test("drafts and future-dated posts are never new", () => {
		expect(isNew(post("2026-10-14", "draft"), at("2026-10-14"))).toBe(false);
		expect(isNew(post("2026-10-20"), at("2026-10-14"))).toBe(false);
	});
});
