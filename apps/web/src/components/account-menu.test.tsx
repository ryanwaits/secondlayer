import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountChip, AccountMenuPanel } from "./account-menu";

const account = {
	id: "a1",
	email: "you@example.com",
	displayName: null,
	bio: null,
	avatarUrl: null,
	createdAt: "2026-04-01T00:00:00Z",
};

describe("AccountChip", () => {
	test("a healthy account shows the balance, a status dot and the word Account", () => {
		const html = renderToStaticMarkup(
			<AccountChip
				account={account}
				balance="$29.62"
				alert={false}
				open={false}
			/>,
		);
		expect(html).toContain("$29.62");
		expect(html).toContain("acct-avatar-dot");
		expect(html).toContain(">Account<");
		expect(html).not.toContain("alert");
		expect(html).not.toContain("needs attention");
	});

	test("an account that needs attention marks the chip as alert and says so", () => {
		const html = renderToStaticMarkup(
			<AccountChip account={account} balance="$1.40" alert open={false} />,
		);
		expect(html).toContain('class="acct-chip alert"');
		expect(html).toContain("needs attention");
	});

	test("an unloaded balance shows a placeholder, not $0", () => {
		const html = renderToStaticMarkup(
			<AccountChip
				account={account}
				balance={null}
				alert={false}
				open={false}
			/>,
		);
		expect(html).toContain("···");
		expect(html).not.toContain("$0");
	});
});

describe("AccountMenuPanel", () => {
	const panel = renderToStaticMarkup(
		<AccountMenuPanel
			email="you@example.com"
			caption="hosted · $29.62 · about 86 days"
			keyCount={5}
			spent="$30.32"
			webhooks="7 of 7"
		/>,
	);

	test("the first row opens the account Overview", () => {
		const firstLink = panel.match(/<a [^>]*href="([^"]+)"/);
		expect(firstLink?.[1]).toBe("/account");
		expect(panel.indexOf("Open account")).toBeLessThan(
			panel.indexOf("API keys"),
		);
	});

	test("mirrors the side nav with counts, and links usage and webhooks", () => {
		expect(panel).toContain('href="/account/credits"');
		expect(panel).toContain('href="/account/webhooks"');
		expect(panel).toContain("7 of 7");
		expect(panel).toContain("$30.32");
	});

	test("data that has not loaded shows a dash, never an invented number", () => {
		const empty = renderToStaticMarkup(
			<AccountMenuPanel
				email="you@example.com"
				caption="hosted"
				keyCount={null}
				spent={null}
				webhooks={null}
			/>,
		);
		expect(empty.match(/<small>—<\/small>/g)).toHaveLength(3);
	});
});
