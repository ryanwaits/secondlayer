"use client";

import { ParamExplorer, PointerStrip } from "@/components/figures";

const CELLS = 64;
const TIP_PCT = 97;
const SPAN_BLOCKS = 40_000;

/** Deterministic per-cell noise so the strip is stable across renders. */
function cellNoise(i: number): number {
	return Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
}

function layout(selectivity: number) {
	const density = (1 - selectivity / 100) ** 2.2;
	const hits = Array.from({ length: CELLS }, (_, i) =>
		selectivity >= 98
			? i === 4
			: selectivity === 0 || cellNoise(i) < Math.max(density, 0.02),
	);
	const last = hits.lastIndexOf(true);
	const receiptPct =
		last < 0 ? 2 : Math.min(((last + 0.5) / CELLS) * 100, TIP_PCT);
	return { hits, receiptPct, gap: TIP_PCT - receiptPct };
}

/**
 * Fig 5 of "Why your indexer resumes from the same block": filter
 * selectivity splits/merges the receipt and bookmark pointers. The one
 * explorer of the post, composed from the library's D1 primitives.
 */
export function SelectivityExplorer() {
	return (
		<ParamExplorer
			label="filter selectivity"
			initial={100}
			ariaLabel="Filter selectivity: from deliver everything to one match in forty thousand"
			endLabels={[
				<span key="l">
					deliver everything
					<br />
					(kafka / block walker)
				</span>,
				<span key="r">
					sparse filter
					<br />
					(one contract&rsquo;s sales)
				</span>,
			]}
			readout={(v) => {
				const { gap } = layout(v);
				return gap < 10 ? (
					<>
						dense delivery, <b>one pointer</b>: every block delivers, receipt
						and bookmark coincide
					</>
				) : (
					<>
						sparse delivery: receipt lags the bookmark by{" "}
						<b>
							{Math.round((gap / 100) * SPAN_BLOCKS).toLocaleString("en-US")}
						</b>{" "}
						blocks, none of which contain anything addressed to you
					</>
				);
			}}
		>
			{(v) => {
				const { hits, receiptPct } = layout(v);
				return (
					<PointerStrip
						cells={hits}
						pointers={[
							{
								label: "receipt",
								sub: "last delivered",
								role: "a",
								pos: receiptPct,
							},
							{ label: "bookmark", sub: "scanned", role: "b", pos: TIP_PCT },
						]}
						mergedLabel="receipt = bookmark"
					/>
				);
			}}
		</ParamExplorer>
	);
}
