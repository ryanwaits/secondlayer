import { afterEach, describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findElements } from "../../../../lib/test-render";
import { ArchiveCredits } from "./archive-credits";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("archive credits", () => {
	test("checkout posts the amount that was selected, as a number", async () => {
		const bodies: unknown[] = [];
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ error: "stop here" }), {
				status: 400,
			});
		}) as typeof fetch;

		let tree: ReactElement | null = null;
		function Probe() {
			tree = ArchiveCredits() as ReactElement;
			return null;
		}
		renderToStaticMarkup(<Probe />);
		const form = findElements(tree, "form")[0];
		const submit = (form.props as unknown as { onSubmit: (e: unknown) => void })
			.onSubmit;
		submit({ preventDefault() {} });
		await Promise.resolve();
		await Promise.resolve();
		expect(bodies).toEqual([{ email: "", amount: 25 }]);
	});
});
