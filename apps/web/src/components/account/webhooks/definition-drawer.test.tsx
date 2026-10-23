import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DefinitionSections } from "./definition-drawer";
import { activityFor, detail } from "./webhook.fixtures";

const render = (over: Parameters<typeof detail>[0] = {}) =>
	renderToStaticMarkup(
		<DefinitionSections webhook={detail(over)} activity={activityFor(4)} />,
	);

describe("DefinitionSections", () => {
	test("has what it listens for, where it sends, how to change it and the record", () => {
		const html = render();
		for (const heading of ["Sends to", "Change it", "Record"]) {
			expect(html).toContain(`<h3>${heading}</h3>`);
		}
		// ListensFor carries its own heading, so the drawer adds none.
		expect(html).not.toContain("<h3>Listens for</h3>");
		expect(html).toContain('<span class="dash-label">Listens for</span>');
		expect(html).toContain('<span class="lf-type">stx_transfer</span>');
		expect(html).toContain("https://hooks.example.dev/stacks");
		expect(html).toContain("7 tries, then it gives up");
		expect(html).toContain("10,000ms");
		expect(html).toContain("wh_deposits");
		expect(html).not.toContain("<dt>TLS</dt>");
	});

	test("the change commands name the webhook, and delete has no button", () => {
		const html = render({ name: "alex-swaps" });
		for (const command of [
			"sl webhooks update alex-swaps",
			"sl webhooks rotate-secret alex-swaps",
			"sl webhooks doctor alex-swaps",
		]) {
			expect(html).toContain(command);
		}
		expect(html).toContain("There&#x27;s no button for it.");
	});

	test("a probed certificate shows when it expires", () => {
		const html = render({ receiverCertExpiresAt: "2027-01-03T00:00:00.000Z" });
		expect(html).toContain("<dt>TLS</dt>");
		expect(html).toContain("Certificate valid until");
	});
});
