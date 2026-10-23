import { describe, expect, mock, test } from "bun:test";
import type { ConnectedApp } from "@/lib/types";
import { renderToStaticMarkup } from "react-dom/server";
import { exampleKeys } from "./overview.fixtures";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { KeysBlockView } = await import("./keys-block");

const now = new Date("2026-10-18T12:00:00.000Z");
const app: ConnectedApp = {
	id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
	clientName: "Claude Code",
	createdAt: "2026-10-18T10:00:00.000Z",
	lastUsedAt: "2026-10-18T11:00:00.000Z",
};

describe("KeysBlockView", () => {
	test("closed: New key button, the keys list and the apps list", () => {
		const html = renderToStaticMarkup(
			<KeysBlockView
				keys={exampleKeys(now)}
				apps={[app]}
				now={now}
				onNew={() => {}}
			/>,
		);
		expect(html).toContain("Keys and apps");
		expect(html).toContain(">New key<");
		expect(html).toContain("prod-indexer");
		expect(html).toContain("“Claude Code”");
	});

	test("open: the flow shows and the New key button hides", () => {
		const html = renderToStaticMarkup(
			<KeysBlockView
				keys={exampleKeys(now)}
				apps={[]}
				now={now}
				onNew={() => {}}
				flow={<div className="the-flow">flow</div>}
			/>,
		);
		expect(html).toContain("the-flow");
		expect(html).not.toContain(">New key<");
	});
});
