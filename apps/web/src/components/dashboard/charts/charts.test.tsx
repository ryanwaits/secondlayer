import { describe, expect, test } from "bun:test";
import { ChartTooltip } from "@/components/charts/recharts-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { Cadence } from "./cadence";
import { DayStrip } from "./day-strip";
import { HeatStrip, HeatStripSkeleton } from "./heat-strip";
import { Legend } from "./legend";
import { MemoryBand } from "./memory-band";
import { Meter } from "./meter";
import { Sparkline } from "./sparkline";
import { Ticks } from "./ticks";

const NOW = Date.parse("2026-10-15T19:10:00Z");
const HOURS = Array.from({ length: 168 }, (_, i) => ({
	n: i % 7 === 0 ? 0 : 10 + i,
	f: i === 100 ? 2 : 0,
}));

describe("Sparkline", () => {
	test("renders an svg with its label and one alarm tick per failing point", () => {
		const html = renderToStaticMarkup(
			<Sparkline
				points={[1, 3, 2, 5, 4]}
				fails={[0, 2, 0, 1, 0]}
				title="Deliveries, last 5 hours"
			/>,
		);
		expect(html).toContain("<svg");
		expect(html).toContain('aria-label="Deliveries, last 5 hours"');
		expect(html.match(/dc-tick/g)).toHaveLength(2);
	});

	test("renders an empty svg for no points", () => {
		const html = renderToStaticMarkup(<Sparkline points={[]} title="Empty" />);
		expect(html).toContain("<svg");
		expect(html).not.toContain("<circle");
	});
});

describe("HeatStrip", () => {
	const html = renderToStaticMarkup(
		<HeatStrip hours={HOURS} now={NOW} label="Deliveries by hour" />,
	);

	test("renders 8 day rows and 168 cells", () => {
		expect(html.match(/class="dc-heat-day"/g)).toHaveLength(8);
		expect(html.match(/<button/g)).toHaveLength(168);
	});

	test("marks a failed hour with the f class", () => {
		expect(html.match(/dc-heat-cell f"/g)).toHaveLength(1);
		expect(html).toContain("2 failed");
	});

	test("labels an hour with its UTC window", () => {
		expect(html).toContain("23:00–00:00 UTC");
	});

	test("prints hour labels every six hours", () => {
		for (const hr of ["00", "06", "12", "18"]) {
			expect(html).toContain(`>${hr}</span>`);
		}
	});
});

describe("Meter", () => {
	test("clamps the fill to 100%", () => {
		const html = renderToStaticMarkup(
			<Meter used={150} total={100} label="Used" left="150" right="of 100" />,
		);
		expect(html).toContain("width:100%");
		expect(html).toContain("of 100");
	});

	test("an empty total fills nothing", () => {
		expect(
			renderToStaticMarkup(<Meter used={5} total={0} label="Used" />),
		).toContain("width:0%");
	});

	test("shows a paid segment past the free total", () => {
		const html = renderToStaticMarkup(
			<Meter used={100} total={100} over={26} label="Rows" />,
		);
		expect(html).toContain("dc-meter-over");
		expect(html).toContain('aria-valuemax="126"');
	});

	test("has no paid segment without over", () => {
		const html = renderToStaticMarkup(
			<Meter used={40} total={100} label="Rows" />,
		);
		expect(html).not.toContain("dc-meter-over");
		expect(html).toContain('aria-valuemax="100"');
	});
});

describe("Ticks", () => {
	test("draws one blue tick per delivering hour and red where any failed", () => {
		const html = renderToStaticMarkup(
			<Ticks
				delivered={[0, 2, 0, 1, 3]}
				failed={[0, 0, 0, 0, 1]}
				title="Deliveries"
			/>,
		);
		expect(html.match(/dc-fill-a"/g)).toHaveLength(2);
		expect(html.match(/dc-fill-alarm/g)).toHaveLength(1);
	});

	test("draws only the baseline for no deliveries", () => {
		const html = renderToStaticMarkup(
			<Ticks delivered={[0, 0, 0]} title="Deliveries" />,
		);
		expect(html).toContain("dc-tick-base");
		expect(html).not.toContain("<rect");
	});
});

describe("DayStrip", () => {
	test("fills days with reads and draws empty days as short marks", () => {
		const html = renderToStaticMarkup(
			<DayStrip days={[0, 3, 0, 1]} title="Reads" />,
		);
		expect(html.match(/dc-fill-a"/g)).toHaveLength(2);
		expect(html.match(/dc-day-empty/g)).toHaveLength(2);
	});
});

describe("MemoryBand", () => {
	test("draws the size line when capacity is known", () => {
		const html = renderToStaticMarkup(
			<MemoryBand points={[1, 2, 3]} capacity={4} title="Memory" />,
		);
		expect(html).toContain("dc-cap-line");
		expect(html).toContain(`class="dc-stroke-a"`);
	});

	test("leaves headroom above a steady line when the size is unknown", () => {
		const html = renderToStaticMarkup(
			<MemoryBand points={[0.2, 0.2, 0.2]} capacity={0} title="Memory" />,
		);
		expect(html).not.toContain("dc-cap-line");
		// The stroke path starts "M0.0 <y>"; the height is 30, so mid-height is 15.
		const y = Number(
			/class="dc-stroke-a"[^>]* d="M[\d.]+ ([\d.]+)/.exec(html)?.[1],
		);
		expect(y).toBeGreaterThan(30 / 3);
	});

	test("turns the line red when stopped", () => {
		const html = renderToStaticMarkup(
			<MemoryBand points={[1, 2, 0]} capacity={4} stopped title="Memory" />,
		);
		expect(html).toContain("dc-stroke-alarm");
		expect(html).not.toContain(`class="dc-stroke-a"`);
	});
});

describe("Cadence and Legend", () => {
	test("cadence draws one bar per interval", () => {
		const html = renderToStaticMarkup(<Cadence intervals={[8, 9, 12, 7]} />);
		expect(html.match(/<rect/g)).toHaveLength(4);
		expect(html).toContain("Seconds between the last 4 blocks");
	});

	test("legend renders every item", () => {
		const html = renderToStaticMarkup(
			<Legend
				items={[
					{ swatch: "dashed", label: "Matched on chain" },
					{ swatch: "line", label: "Delivered to you" },
				]}
			/>,
		);
		expect(html).toContain("Matched on chain");
		expect(html).toContain("dc-sw-dashed");
	});
});

describe("ChartTooltip", () => {
	const payload = [{ name: "Rows written", value: 1200, dataKey: "value" }];

	test("heads the tooltip with the formatted label, not the raw index", () => {
		const html = renderToStaticMarkup(
			<ChartTooltip
				active
				payload={payload}
				label={11}
				labelFormatter={(i) => `${String(i).padStart(2, "0")}:00 UTC`}
			/>,
		);
		expect(html).toContain("11:00 UTC");
		expect(html).not.toContain(">11<");
	});

	test("drops the heading when the formatter returns nothing", () => {
		const html = renderToStaticMarkup(
			<ChartTooltip
				active
				payload={payload}
				label={3}
				labelFormatter={() => ""}
			/>,
		);
		expect(html).not.toContain("wh-chart-tip-label");
	});
});

describe("HeatStripSkeleton", () => {
	test("lays the same grid as the strip, with no buttons", () => {
		const html = renderToStaticMarkup(<HeatStripSkeleton />);
		expect(html.match(/class="dc-heat-day"/g)).toHaveLength(8);
		expect(html.match(/class="dc-heat-cell s"/g)).toHaveLength(192);
		expect(html).not.toContain("<button");
	});

	test("takes a day count", () => {
		const html = renderToStaticMarkup(<HeatStripSkeleton days={7} />);
		expect(html.match(/class="dc-heat-cell s"/g)).toHaveLength(168);
	});
});
