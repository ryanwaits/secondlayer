"use client";

import { LivePane, PaneChip } from "../live-pane";
import { useInViewOnce, useStagedCycle } from "../use-demo";

type Col = { name: string; type: string; tag?: string };
const TABLES: { name: string; rows: string; cols: Col[] }[] = [
	{
		name: "transfers",
		rows: "2,418,553 rows",
		cols: [
			{ name: "sender", type: "principal", tag: "indexed" },
			{ name: "recipient", type: "principal", tag: "indexed" },
			{ name: "amount", type: "uint" },
		],
	},
	{
		name: "balances",
		rows: "109,101 rows",
		cols: [
			{ name: "address", type: "principal", tag: "unique" },
			{ name: "balance", type: "uint" },
		],
	},
];

// stage timeline: card1 → its 3 cols → resolve1 → card2 → its 2 cols → resolve2 → head
const MARKS = [800, 1300, 1720, 2140, 2700, 3300, 3800, 4220, 4800, 5400];
const CARD1 = 0;
const COL1_BASE = 1; // stages 1..3
const RESOLVE1 = 4;
const CARD2 = 5;
const COL2_BASE = 6; // stages 6..7
const RESOLVE2 = 8;
const HEAD_DONE = 9;

/** Subgraphs demo: tables appear one at a time — card, columns cascade,
 *  row count resolves — mirroring the defineSubgraph code beside it. */
export function SubgraphSchemaPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 16_000);
	const done = stage >= HEAD_DONE;

	function cardState(i: number) {
		const cardMark = i === 0 ? CARD1 : CARD2;
		const colBase = i === 0 ? COL1_BASE : COL2_BASE;
		const resolveMark = i === 0 ? RESOLVE1 : RESOLVE2;
		return {
			on: stage >= cardMark,
			colsOn: Math.max(0, Math.min(stage - colBase + 1, TABLES[i].cols.length)),
			resolved: stage >= resolveMark,
		};
	}

	return (
		<div ref={ref}>
			<LivePane
				dot={done ? "blue" : "amber"}
				title={done ? "sbtc-flows · public" : "sbtc-flows · creating schema"}
				right={done ? "synced · 0 behind" : "deploying"}
			>
				<div className="home-schemas" key={cycle}>
					{TABLES.map((t, i) => {
						const st = cardState(i);
						return (
							<div className={`home-schema${st.on ? " on" : ""}`} key={t.name}>
								<div className="home-schema-h">
									<span className="tname">{t.name}</span>
									{st.resolved ? (
										<PaneChip state="ok">{t.rows}</PaneChip>
									) : (
										<PaneChip state="busy">creating…</PaneChip>
									)}
								</div>
								{t.cols.map((c, j) => (
									<div
										className={`home-scol${j < st.colsOn ? " on" : ""}`}
										key={c.name}
									>
										<span className="cn">{c.name}</span>
										<span className="ct">{c.type}</span>
										<span className="ci">{c.tag ?? " "}</span>
									</div>
								))}
							</div>
						);
					})}
				</div>
				<div className="home-sysnote">
					+ _id · _block_height · _tx_id on every table
				</div>
			</LivePane>
		</div>
	);
}
