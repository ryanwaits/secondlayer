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

const { AppsPanel } = await import("./apps-panel");

const NOW = new Date("2026-10-18T12:00:00.000Z");
const app = (patch: Partial<ConnectedApp> = {}): ConnectedApp => ({
	id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
	clientName: "Claude Code",
	createdAt: "2026-10-18T10:00:00.000Z",
	lastUsedAt: "2026-10-18T11:00:00.000Z",
	...patch,
});

describe("AppsPanel", () => {
	test("a hostile name is escaped plain text", () => {
		const html = renderToStaticMarkup(
			<AppsPanel apps={[app({ clientName: "<b>x</b>‮evil" })]} now={NOW} />,
		);
		expect(html).not.toContain("<b>x</b>");
		expect(html).not.toContain("‮");
	});
});
