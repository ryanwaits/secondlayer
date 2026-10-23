import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { groupDigits, stateLine } from "@/lib/subgraph-view";
import type { SubgraphListItem } from "@/lib/subgraphs-store";
import { renderToStaticMarkup } from "react-dom/server";
import { SubgraphCompactDetail } from "./compact-detail";
import { SubgraphCompactRow, SubgraphsCompactList } from "./compact-list";
import { SubgraphSheetBody } from "./compact-sheet";
import {
	exampleDetail,
	exampleErrors,
	exampleHealth,
	exampleList,
} from "./subgraph.fixtures";

const healthy = exampleList[0] as SubgraphListItem;
const noop = () => {};

const renderList = (
	items: SubgraphListItem[] | null,
	over: Partial<Parameters<typeof SubgraphsCompactList>[0]> = {},
) =>
	renderToStaticMarkup(
		<SubgraphsCompactList
			items={items}
			health={{}}
			insights={[]}
			notice={null}
			onOpen={noop}
			{...over}
		/>,
	);

const handlerErrors = FIXTURE_INSIGHTS.find(
	(i) => i.rule === "handler_errors",
) as Insight;
// Insights match a subgraph by resource id, which the list passes as its name.
const insightFor = (name: string, over: Partial<Insight> = {}): Insight => ({
	...handlerErrors,
	resource: { kind: "subgraph", id: name, name },
	...over,
});

const renderSheet = (
	over: Partial<Parameters<typeof SubgraphSheetBody>[0]> = {},
) =>
	renderToStaticMarkup(
		<SubgraphSheetBody
			item={healthy}
			detail={exampleDetail}
			health={exampleHealth(0)}
			errors={[]}
			{...over}
		/>,
	);

describe("subgraphs compact list", () => {
	test("a healthy row shows the state line, and the top insight's line replaces it", () => {
		const line = stateLine(1, healthy.totalRows ?? 0, null, healthy.status);
		expect(renderList([healthy])).toContain(line);

		const html = renderList([healthy], {
			insights: [
				insightFor(healthy.name, {
					line: "sbtc-deposits is skipping blocks",
					meta: "3 gaps",
				}),
			],
		});
		expect(html).toContain("sbtc-deposits is skipping blocks · 3 gaps");
		expect(html).not.toContain(line);
	});

	test("a reindexing row carries a progress bar at the reindexed share", () => {
		const reindexing: SubgraphListItem = {
			...healthy,
			status: "reindexing",
			lastProcessedBlock: 300,
			blocksRemaining: 700,
		};
		expect(renderList([reindexing])).toContain('style="width:30%"');
		expect(renderList([healthy])).not.toContain("msg-meter");
	});

	test("a row with handler errors takes the alarm tone", () => {
		const html = renderList([healthy], {
			health: { [healthy.name]: exampleHealth(1204) },
		});
		expect(html).toContain("name-flag");
		expect(html).toContain("msg-line is-bad");
		expect(
			renderList([healthy], { health: { [healthy.name]: exampleHealth(0) } }),
		).not.toContain("msg-line is-bad");
	});

	test("the empty list says what a subgraph is and offers no command", () => {
		const html = renderList([]);
		expect(html).toContain("No subgraphs yet");
		expect(html).not.toContain("sl ");
	});
});

describe("subgraph sheet body", () => {
	test("with errors it lists every group's count and hints to drag up", () => {
		const html = renderSheet({
			health: exampleHealth(1204),
			errors: [
				...exampleErrors,
				{ ...exampleErrors[0], message: "RangeError: amount < 0", count: 1180 },
			] as typeof exampleErrors,
		});
		expect(html).toContain("Drag up for the errors");
		expect(html).toContain("Errors, 24 h");
		expect(html).toContain("2 kinds");
		expect(html).toContain(">3<");
		expect(html).toContain(groupDigits("1180"));
		expect(html).toContain("Last error");
		expect(html).toContain("handlers.ts:41");
	});

	test("without errors there is no error section and no drag hint", () => {
		const html = renderSheet();
		expect(html).not.toContain("Errors, 24 h");
		expect(html).not.toContain("Drag up");
		expect(html).toContain("Last block");
		expect(html).toContain(groupDigits(String(exampleDetail.sync.chainTip)));
	});

	test("Share fix shows only when an open insight with a hand-off prompt exists", () => {
		const share = (insights: Insight[]) =>
			renderSheet({ insights, onShare: noop });
		expect(share([insightFor(healthy.name)])).toContain("Share fix");
		expect(share([])).not.toContain("Share fix");
		expect(share([insightFor("other-subgraph")])).not.toContain("Share fix");
		expect(
			share([insightFor(healthy.name, { severity: "recovered" })]),
		).not.toContain("Share fix");
		expect(
			share([
				insightFor(healthy.name, { handoff: { prompt: "  ", commands: [] } }),
			]),
		).not.toContain("Share fix");
		expect(renderSheet({ insights: [insightFor(healthy.name)] })).not.toContain(
			"Share fix",
		);
	});
});

describe("subgraph compact row", () => {
	test("on the Account page a row links to its page", () => {
		const html = renderToStaticMarkup(
			<SubgraphCompactRow
				item={healthy}
				health={undefined}
				insights={[]}
				href={`/account/subgraphs/${healthy.name}`}
			/>,
		);
		expect(html).toContain(`href="/account/subgraphs/${healthy.name}"`);
		expect(html).toContain(healthy.name);
	});

	test("a failing subgraph's name is flagged, not dotted", () => {
		const html = renderToStaticMarkup(
			<SubgraphCompactRow
				item={healthy}
				health={undefined}
				insights={[insightFor(healthy.name)]}
				onOpen={noop}
			/>,
		);
		expect(html).toContain("name-flag");
	});
});

describe("subgraph compact detail", () => {
	const render = (insights: Insight[] = []) =>
		renderToStaticMarkup(
			<SubgraphCompactDetail
				detail={exampleDetail}
				health={exampleHealth(0)}
				errors={exampleErrors}
				insights={insights}
			/>,
		);

	test("shows the facts, the tables and the newest row, with no query command", () => {
		const html = render();
		for (const label of ["Behind", "Rows", "Errors", "Storage"]) {
			expect(html).toContain(`>${label}<`);
		}
		for (const table of Object.keys(exampleDetail.tables)) {
			expect(html).toContain(table);
		}
		expect(html).toContain("Newest");
		expect(html).not.toContain("wh-cli");
		expect(html).not.toContain("sl subgraphs");
	});

	test("an open insight shows Share the fix instead of its commands", () => {
		const html = render([insightFor(exampleDetail.name)]);
		expect(html).toContain("Share the fix");
		expect(html).not.toContain("wh-cli");
		expect(html).not.toContain("Copy the fix as a prompt");
	});
});
