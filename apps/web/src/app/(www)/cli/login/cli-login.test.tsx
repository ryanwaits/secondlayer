import { describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ replace: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { displayClientName } = await import("./cli-login");

describe("displayClientName", () => {
	test("strips control, zero-width and bidi characters", () => {
		expect(displayClientName("ryans\u202Ekoobcam")).toBe("ryanskoobcam");
		expect(displayClientName("a\u0000b\u001bc\u007fd\u200Be\u2066f")).toBe(
			"abcdef",
		);
		expect(displayClientName("my\n\tmac")).toBe("my mac");
	});

	test("caps the length and names an empty result", () => {
		const long = "x".repeat(200);
		expect(displayClientName(long)).toBe(`${"x".repeat(64)}…`);
		expect(displayClientName("\u202E\u200B ")).toBe("an unnamed machine");
		expect(displayClientName("ryans-macbook")).toBe("ryans-macbook");
	});
});
