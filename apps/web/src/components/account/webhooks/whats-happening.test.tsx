import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import type { Recovery } from "./use-recovery";
import { WhatsHappening } from "./whats-happening";

const [losing] = FIXTURE_INSIGHTS as [Insight];
const noop = () => {};

const recovery = (count: number | null, requeued: number | null = null) =>
	({
		dead: count === null ? null : { count, since: null },
		requeue: { busy: false, requeued, onRequeue: noop },
	}) satisfies Recovery;

const render = (
	over: { insight?: Insight; recovery?: Recovery } = {},
): string =>
	renderToStaticMarkup(
		<WhatsHappening
			insight={over.insight ?? losing}
			recovery={over.recovery ?? recovery(214)}
			onTest={noop}
			test={{ busy: false, result: null }}
		/>,
	);

const withCause = (confidence: number): Insight => ({
	...losing,
	how: {
		...losing.how,
		label: { cause: "A deploy broke the app", confidence },
	},
});

describe("WhatsHappening", () => {
	test("a losing insight shows its lead, evidence and both buttons", () => {
		const html = render();
		expect(html).toContain("Your receiver is down, not the chain.");
		expect(html).toContain("ins-step");
		expect(html).toContain(">Send a test<");
		expect(html).toContain(">Requeue 214<");
		expect(html).toContain(">Got it<");
		expect(html).toContain(">Dismiss<");
	});

	test("nothing dead means no Requeue button", () => {
		const button = /<button[^>]*>Requeue/;
		expect(render({ recovery: recovery(0) })).not.toMatch(button);
		expect(render({ recovery: recovery(null) })).not.toMatch(button);
	});

	test("after a requeue the button reads how many went out", () => {
		const html = render({ recovery: recovery(214, 214) });
		expect(html).toContain("Requeued 214");
		expect(html).not.toContain(">Requeue 214<");
	});

	test("the likely cause shows only at or above 0.85", () => {
		expect(render({ insight: withCause(0.85) })).toContain(
			"Likely:</b> A deploy broke the app",
		);
		expect(render({ insight: withCause(0.84) })).not.toContain("Likely");
	});

	test("the copy never says your agent", () => {
		expect(render({ insight: withCause(0.9) })).not.toMatch(/your agent/i);
	});
});
