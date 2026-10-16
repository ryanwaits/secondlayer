import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { WebhookDetailBody } from "./detail-panel";
import type { Range } from "./view";
import { activityFor, attempt, detail } from "./webhook.fixtures";

const noop = () => {};

type Props = Parameters<typeof WebhookDetailBody>[0];

const render = (props: Partial<Props> = {}) =>
	renderToStaticMarkup(
		<WebhookDetailBody
			webhook={detail()}
			deliveries={[attempt()]}
			activity={activityFor(4)}
			days={undefined}
			insights={[]}
			range={"7d" as Range}
			onRange={noop}
			hour={null}
			hourDeliveries={null}
			onClearHour={noop}
			pauseBusy={false}
			onTogglePause={noop}
			onRename={async () => true}
			{...props}
		/>,
	);

const [down, tls] = FIXTURE_INSIGHTS;

describe("WebhookDetailBody header", () => {
	test("an unmanaged webhook can be renamed", () => {
		const html = render();
		expect(html).toContain(">Rename<");
		expect(html).not.toContain("named by");
	});

	test("a Sentinel-managed webhook shows the chip and no Rename", () => {
		const html = render({ webhook: detail({ managedBy: "Sentinel" }) });
		expect(html).toContain("named by Sentinel");
		expect(html).toContain("Sentinel finds this webhook by its name");
		expect(html).not.toContain(">Rename<");
	});

	test("the facts name the window they cover", () => {
		const html = render();
		for (const label of [
			"Delivered · 7d",
			"Gave up · 7d",
			"Retried · last 100",
			"p50 / p95 · last 100",
			"Receiver",
			"Created",
		]) {
			expect(html).toContain(label);
		}
		expect(html).toContain("hooks.example.dev");
	});

	test("one Pause button, which reads Resume when paused", () => {
		expect(render()).toContain(">Pause<");
		const paused = render({ webhook: detail({ status: "paused" }) });
		expect(paused).toContain(">Resume<");
		expect(paused).not.toContain(">Pause<");
	});

	test("the range choice offers 24h, 48h, 7d and 30d", () => {
		const html = render();
		for (const range of ["24h", "48h", "7d", "30d"]) {
			expect(html).toContain(`<span>${range}</span>`);
		}
	});
});

describe("WebhookDetailBody insights", () => {
	test("two or more insights show the ranked stack header", () => {
		const html = render({ insights: [down as never, tls as never] });
		expect(html).toContain("2 insights");
		expect(html).toContain("worst first");
		expect(html).toContain("Losing events now");
	});

	test("a single insight shows its note without a stack header", () => {
		const html = render({ insights: [down as never] });
		expect(html).toContain("Receiver returning 502 since 16:06");
		expect(html).not.toContain("worst first");
		// A losing insight opens on its own: its hand-off is already on the page.
		expect(html).toContain("Hand off to your agent");
	});

	test("the open card ends in the dismiss actions", () => {
		const html = render({ insights: [down as never, tls as never] });
		expect(html.match(/Got it/g)).toHaveLength(1);
		expect(html).toContain("This is expected");
	});

	test("no insights shows no insight block", () => {
		const html = render();
		expect(html).not.toContain("ins-stack");
	});
});

describe("WebhookDetailBody chart", () => {
	test("without a usual range it explains the missing band on the hourly views", () => {
		const html = render({ range: "48h" });
		expect(html).toContain("No &quot;usual range&quot; band");
	});

	test("with a usual range there is no such note and the legend names the band", () => {
		const usual = Array.from({ length: 24 }, () => ({ lo: 1, hi: 8 }));
		const html = render({
			range: "48h",
			activity: activityFor(4, { usualByHourOfDay: usual }),
		});
		expect(html).not.toContain("No &quot;usual range&quot; band");
		expect(html).toContain("Usual for this hour");
	});

	test("the 30 day view is daily", () => {
		const html = render({ range: "30d", days: [] });
		expect(html).toContain("Deliveries per day");
	});
});

describe("WebhookDetailBody listens for", () => {
	test("renders the trigger sentence and says it is defined in code", () => {
		const html = render({
			webhook: detail({
				triggers: [
					{
						type: "stx_transfer",
						sender: "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP",
					},
				],
			}),
		});
		expect(html).toContain("Any STX transfer sent by SP21YT…EFFP");
		expect(html).toContain("Defined in code");
	});
});

describe("WebhookDetailBody unfiltered trigger", () => {
	test("omits the daily volume clause when nothing has matched", () => {
		const html = render({
			webhook: detail({ triggers: [{ type: "sbtc_deposit" }] }),
			activity: activityFor(0),
		});
		expect(html).toContain("matches every sBTC deposit on chain.");
		expect(html).not.toContain("events a day");
	});
});

describe("WebhookDetailBody deliveries", () => {
	const three = [
		attempt({ id: "a3", attempt: 3, statusCode: 200 }),
		attempt({ id: "a2", attempt: 2, statusCode: 502 }),
		attempt({ id: "a1", attempt: 1, statusCode: 502 }),
	];

	test("three attempts of one event are one row with three dots", () => {
		const html = render({ deliveries: three });
		expect(html.match(/<tr[^>]*class="click"/g)).toHaveLength(1);
		expect(html).toContain('aria-label="3 attempts"');
		expect(html.match(/<i class="f"><\/i>/g)).toHaveLength(2);
	});

	test("an hour filter shows its chip and the clear control", () => {
		const html = render({
			hour: { label: "Thu, Oct 8 · 16:00–17:00 UTC" },
			hourDeliveries: three,
		});
		expect(html).toContain("Thu, Oct 8 · 16:00–17:00 UTC");
		expect(html).toContain("Clear filter");
		expect(html).not.toContain("Recent deliveries");
	});

	test("an hour with nothing kept says so", () => {
		const html = render({
			hour: { label: "Thu, Oct 8 · 16:00–17:00 UTC" },
			hourDeliveries: [],
		});
		expect(html).toContain("No deliveries kept for this hour.");
	});

	test("with no filter the panel is the recent deliveries", () => {
		const html = render({ deliveries: three });
		expect(html).toContain("Recent deliveries");
		expect(html).toContain("click a row for its attempts");
	});
});
