import { describe, expect, mock, test } from "bun:test";
import type { DailySpend } from "@/lib/usage";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedRadios } from "../../lib/test-render";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { AccountSegments } = await import("./compact-account");
const { TopupSheetBody, UsageBody, capHitDate } = await import(
	"./billing/compact-usage"
);
const { KeySheetBody, KeysCompactList } = await import("./keys/compact-keys");
const { EXAMPLE_KEYS, KEYS_EXAMPLE_NOW } = await import("./keys/key.fixtures");

const NOW = new Date("2026-10-17T12:00:00.000Z");
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

/** Days 1 to 10 at $2.26, days 11 to 17 at $2.50: $40.10 spent, $2.50 a day lately. */
const DAILY: DailySpend[] = Array.from({ length: 17 }, (_, i) => ({
	date: day(i + 1),
	unit: "rows.delivered",
	usdMicros: i < 10 ? "2260000" : "2500000",
}));

const usageProps = {
	now: NOW,
	billing: { creditsUsdMicros: "9900000", spentThisMonthUsdMicros: "40100000" },
	capUsd: 50 as number | null,
	usage: [{ unit: "rows.delivered", quantity: "8400000", usdMicros: "0" }],
	daily: DAILY,
	burn: { rateDayUsdMicros: "2360000", windowHours: 24 },
	service: { state: "running" as const, lastChargedAt: null, memory24h: [] },
	onTopUp: () => {},
};

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

describe("phone usage", () => {
	test("near the cap says when the cap is hit, with the fill and the tick", () => {
		const html = renderToStaticMarkup(<UsageBody {...usageProps} />);
		expect(html).toContain("At this pace you hit the cap on Oct 21");
		expect(html).toContain("width:80.2%");
		expect(html).toContain("left:80%");
		expect(html).toContain("$40.10");
		expect(html).toContain("of $50 cap");
	});
	test("under the cap says where the month ends", () => {
		const html = renderToStaticMarkup(
			<UsageBody {...usageProps} capUsd={500} />,
		);
		expect(html).toContain("On pace for $75 by Oct 31");
		expect(html).not.toContain("hit the cap");
	});
	test("with no cap there is no meter and no pace to the cap", () => {
		const html = renderToStaticMarkup(
			<UsageBody {...usageProps} capUsd={null} />,
		);
		expect(html).not.toContain("mac-meter");
		expect(html).not.toContain("hit the cap");
		expect(html).not.toContain("Everything pauses past");
		expect(html).toContain("this month");
	});
	test("lists rows read against the free allowance", () => {
		const html = renderToStaticMarkup(<UsageBody {...usageProps} />);
		expect(html).toContain("8.4M");
		expect(html).toContain("1M free");
	});
});

describe("phone top-up sheet", () => {
	const co = {
		amount: 25,
		valid: true,
		choose: () => {},
		busy: false,
		error: null,
		checkout: async () => {},
	};
	const html = renderToStaticMarkup(
		<TopupSheetBody
			co={co}
			billing={usageProps.billing}
			burn={usageProps.burn}
		/>,
	);
	test("offers 10, 25 and 50 and goes to Stripe", () => {
		expect(html).toContain("$10");
		expect(html).toContain('aria-pressed="true">$25');
		expect(html).toContain("$50");
		expect(html).not.toContain("$100");
		expect(html).toContain("Continue to Stripe");
	});
	test("shows the balance after and how long it lasts", () => {
		expect(html).toContain("$34.90");
		expect(html).toContain("15 days at this pace");
	});
});

describe("phone keys", () => {
	const onOpen = () => {};
	const active = EXAMPLE_KEYS.slice(0, 3);
	const revoked = [
		{ ...active[0], id: "r1", name: "retired", status: "revoked" as const },
	];

	test("an active own key has a Revoke swipe action", () => {
		const html = renderToStaticMarkup(
			<KeysCompactList keys={active} now={KEYS_EXAMPLE_NOW} onOpen={onOpen} />,
		);
		expect(html).toContain("m-act is-alarm");
		expect(html).toContain("Revoke");
		expect(html).toContain("New keys are made on desktop.");
	});
	test("a revoked key has none and says so", () => {
		const html = renderToStaticMarkup(
			<KeysCompactList keys={revoked} now={KEYS_EXAMPLE_NOW} onOpen={onOpen} />,
		);
		expect(html).not.toContain("m-act");
		expect(html).toContain("Revoked");
	});
	test("keys made for the account are not listed", () => {
		const html = renderToStaticMarkup(
			<KeysCompactList
				keys={EXAMPLE_KEYS}
				now={KEYS_EXAMPLE_NOW}
				onOpen={onOpen}
			/>,
		);
		expect(html).not.toContain("hosted stack");
		expect(html).not.toContain("sentinel");
		expect(html).not.toContain("Docs key");
	});
	test("with no keys it points to desktop", () => {
		const html = renderToStaticMarkup(
			<KeysCompactList keys={[]} now={KEYS_EXAMPLE_NOW} onOpen={onOpen} />,
		);
		expect(html).toContain("Make your first key on desktop.");
	});
	test("the key sheet is revoked by a hold, not a button", () => {
		const html = renderToStaticMarkup(
			<KeySheetBody k={active[2]} now={KEYS_EXAMPLE_NOW} onRevoke={() => {}} />,
		);
		expect(html).toContain("Hold to revoke laptop");
		expect(html).toContain("401 KEY_REVOKED");
		expect(html).not.toContain("acct-btn danger");
	});
	test("a revoked key's sheet has no hold", () => {
		const html = renderToStaticMarkup(
			<KeySheetBody
				k={revoked[0]}
				now={KEYS_EXAMPLE_NOW}
				onRevoke={() => {}}
			/>,
		);
		expect(html).not.toContain("Hold to revoke");
	});
});

describe("account segments", () => {
	test("three segments, the current one checked", () => {
		const html = renderToStaticMarkup(
			<AccountSegments current="keys" onSelect={() => {}} />,
		);
		expect(html.match(/type="radio"/g)).toHaveLength(3);
		expect(checkedRadios(html)).toEqual({ "account-segment": "keys" });
		expect(html).toContain("Usage");
		expect(html).toContain("Keys");
		expect(html).toContain("Push");
	});
});
