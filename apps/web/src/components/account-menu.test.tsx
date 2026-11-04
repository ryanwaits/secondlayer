import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountChip, AccountMenuPanel, DashboardButton } from "./account-menu";

const account = {
	id: "a1",
	email: "you@example.com",
	displayName: null,
	bio: null,
	avatarUrl: null,
	createdAt: "2026-04-01T00:00:00Z",
};

describe("DashboardButton", () => {
	test("goes straight to the dashboard in one click", () => {
		const html = renderToStaticMarkup(<DashboardButton />);
		expect(html).toContain('href="/account"');
		expect(html).toContain(">Dashboard<");
	});
});

describe("AccountChip", () => {
	test("a healthy account shows its initial and no money, nothing alarming", () => {
		const html = renderToStaticMarkup(
			<AccountChip account={account} alert={false} open={false} />,
		);
		expect(html).not.toContain("$");
		expect(html).toContain('class="acct-avatar"');
		expect(html).toContain(">Y<");
		expect(html).not.toContain("alert");
		expect(html).not.toContain("needs attention");
	});

	test("an account that needs attention marks the chip as alert and says so", () => {
		const html = renderToStaticMarkup(
			<AccountChip account={account} alert open={false} />,
		);
		expect(html).toContain('class="acct-chip alert"');
		expect(html).toContain("needs attention");
	});
});

describe("AccountMenuPanel", () => {
	const panel = renderToStaticMarkup(
		<AccountMenuPanel balance="$29.62" monthLabel="October" spent="$6.21" />,
	);

	test("rows read Balance, the month, Keys, Billing in order", () => {
		const order = ["Balance", "October", "Keys", "Billing"].map((w) =>
			panel.indexOf(w),
		);
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((x, y) => x - y)).toEqual(order);
		expect(panel).toContain("$29.62");
		expect(panel).toContain("$6.21");
	});

	test("links Keys and Billing, leaving Dashboard to its own button", () => {
		expect(panel).not.toContain('href="/account"');
		expect(panel).not.toContain("Dashboard");
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
