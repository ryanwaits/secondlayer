import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HeartbeatView } from "./chain-heartbeat";

const now = 1_000_000_000;
const view = (over: Partial<Parameters<typeof HeartbeatView>[0]>) =>
	renderToStaticMarkup(
		<HeartbeatView
			height={9_219_695}
			seenAt={now - 5_000}
			avgBlockSec={null}
			beat={3}
			now={now}
			{...over}
		/>,
	);

describe("HeartbeatView", () => {
	test("renders nothing before the first height", () => {
		expect(view({ height: null })).toBe("");
	});

	test("fresh block pulses and prints no age", () => {
		const html = view({});
		expect(html).toContain("dash-dot pulse");
		expect(html).not.toContain("no block for");
		expect(html).toContain("#9,219,695");
	});

	test("stale block shows age with the highlight dot and no pulse", () => {
		const html = view({ seenAt: now - 90_000 });
		expect(html).toContain("no block for 1m");
		expect(html).toContain("dash-dot hi");
		expect(html).not.toContain("pulse");
	});

	test("down block uses the alarm dot", () => {
		const html = view({ seenAt: now - 15 * 60_000 });
		expect(html).toContain("dash-dot alarm");
		expect(html).not.toContain("pulse");
	});

	test("title mentions the usual interval only once it is known", () => {
		expect(view({ avgBlockSec: null })).not.toContain("usually");
		expect(view({ avgBlockSec: 9 })).toContain("usually every 9s");
	});
});
