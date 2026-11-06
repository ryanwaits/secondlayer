import { describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { capHitDate } = await import("./billing/compact-usage");

const NOW = new Date("2026-10-17T12:00:00.000Z");

describe("capHitDate", () => {
	test("is the first day the flat rate reaches the cap", () => {
		expect(capHitDate(40.1, 2.5, 50, NOW)?.toISOString().slice(0, 10)).toBe(
			"2026-10-21",
		);
		expect(capHitDate(40.1, 2.36, 50, NOW)?.toISOString().slice(0, 10)).toBe(
			"2026-10-22",
		);
	});
	test("is null when nothing is burning", () => {
		expect(capHitDate(40.1, 0, 50, NOW)).toBeNull();
	});
});
