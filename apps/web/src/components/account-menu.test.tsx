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
	test("a healthy account shows its initial and balance, nothing alarming", () => {
		const html = renderToStaticMarkup(
			<AccountChip
				account={account}
				balance="$29.62"
				alert={false}
				open={false}
			/>,
		);
		expect(html).toContain("$29.62");
		expect(html).toContain('class="acct-avatar"');
		expect(html).toContain(">Y<");
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
		<AccountMenuPanel balance="$29.62" monthLabel="October" spent="$6.21" />,
	);

	test("rows read Balance, the month, Dashboard, Keys, Billing in order", () => {
		const order = ["Balance", "October", "Dashboard", "Keys", "Billing"].map(
			(w) => panel.indexOf(w),
		);
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((x, y) => x - y)).toEqual(order);
		expect(panel).toContain("$29.62");
		expect(panel).toContain("$6.21");
	});

	test("links Dashboard, Keys and Billing, with no Open account or Webhooks row", () => {
		expect(panel).toContain('href="/account"');
		expect(panel).toContain('href="/account/keys"');
		expect(panel).toContain('href="/account/credits"');
		expect(panel).not.toContain('href="/account/webhooks"');
		expect(panel).not.toContain("Open account");
	});

	test("ends on Add credits and Sign out, side by side", () => {
		const foot = panel.slice(panel.indexOf("acct-menu-foot"));
		expect(foot.indexOf("Add credits")).toBeLessThan(foot.indexOf("Sign out"));
	});

	test("data that has not loaded shows a dash, never an invented number", () => {
		const empty = renderToStaticMarkup(
			<AccountMenuPanel balance={null} monthLabel="October" spent={null} />,
		);
		expect(empty.match(/<small>—<\/small>/g)).toHaveLength(2);
	});
});
