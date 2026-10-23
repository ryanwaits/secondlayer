import { describe, expect, mock, test } from "bun:test";
import type { ConnectedApp } from "@/lib/types";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { AppsTable } = await import("./apps-table");

const NOW = new Date("2026-10-18T12:00:00.000Z");
const app = (patch: Partial<ConnectedApp> = {}): ConnectedApp => ({
	id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
	clientName: "Claude Code",
	createdAt: "2026-10-18T10:00:00.000Z",
	lastUsedAt: "2026-10-18T11:00:00.000Z",
	...patch,
});

describe("AppsTable", () => {
	test("each app: its quoted name, unverified, when it was allowed, last use and Revoke", () => {
		const html = renderToStaticMarkup(<AppsTable apps={[app()]} now={NOW} />);
		expect(html).toContain(">Apps<");
		expect(html).toContain("“Claude Code”");
		expect(html).toContain("name unverified");
		expect(html).toContain("Allowed ");
		expect(html).toContain(">Revoke<");
		expect(html).toContain("can&#x27;t make or revoke keys");
	});

	test("a hostile name is escaped plain text", () => {
		const html = renderToStaticMarkup(
			<AppsTable apps={[app({ clientName: "<b>x</b>‮evil" })]} now={NOW} />,
		);
		expect(html).not.toContain("<b>x</b>");
		expect(html).not.toContain("‮");
	});

	test("loading and empty states", () => {
		expect(renderToStaticMarkup(<AppsTable apps={null} now={NOW} />)).toContain(
			"Loading apps…",
		);
		expect(renderToStaticMarkup(<AppsTable apps={[]} now={NOW} />)).toContain(
			"No apps signed in.",
		);
	});
});
