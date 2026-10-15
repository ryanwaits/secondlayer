import {
	LazyBandBarChart,
	LazyContextLineChart,
} from "@/components/charts/lazy";
import { barsRows } from "@/lib/dashboard-charts";
import type { InsightEvidence } from "@/lib/insights";
import { Legend } from "../charts/legend";

type SeriesEvidence = Extract<InsightEvidence, { kind: "series" }>;

/** A shape is loud when the receiver errored, or answered 200 with a new kind of body. */
function isLoudShape(code: string, isNew: boolean): boolean {
	const status = Number(code);
	return status >= 400 || (status >= 200 && status < 300 && isNew);
}

/**
 * Series rendering rule: any `context` series makes a context line chart (the
 * context dashed, then the first `a` series). Otherwise bars from the first `a`
 * series, with indices where a `mark` series is above 0 filled `--ch-mark`.
 */
function SeriesChart({ item }: { item: SeriesEvidence }) {
	const context = item.series.find((s) => s.role === "context");
	const measured = item.series.find((s) => s.role === "a");
	if (!measured) return null;
	if (context) {
		return (
			<>
				<Legend
					items={[
						{ swatch: "dashed", label: context.name },
						{ swatch: "line", label: measured.name },
					]}
				/>
				<LazyContextLineChart
					context={context.points}
					values={measured.points}
					contextName={context.name}
					valueName={measured.name}
					xLabels={item.labels}
					yUnit={item.unit}
				/>
			</>
		);
	}
	const marks = item.series.find((s) => s.role === "mark");
	const highlight = marks
		? marks.points.flatMap((v, i) => (v > 0 ? [i] : []))
		: [];
	return (
		<LazyBandBarChart
			rows={barsRows(
				measured.points.map((n) => ({ n })),
				{ highlight },
			)}
			height={140}
			xLabels={item.labels}
			yUnit={item.unit}
			seriesNames={{ n: measured.name, p: "", f: "" }}
		/>
	);
}

export function Evidence({ item }: { item: InsightEvidence }) {
	return (
		<div className="ins-step">
			<div className="ins-label">{item.title}</div>
			{item.kind === "series" ? <SeriesChart item={item} /> : null}
			{item.kind === "table" ? (
				<table className="ins-table">
					<thead>
						<tr>
							{item.columns.map((c) => (
								<th key={c} scope="col">
									{c}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{item.rows.map((row, r) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are static evidence
							<tr key={r}>
								{row.map((cell, c) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
									<td key={c}>
										{c === 0 && r === item.markRow ? (
											<span className="mark-chip">{cell}</span>
										) : typeof cell === "number" ? (
											cell.toLocaleString("en-US")
										) : (
											cell
										)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			) : null}
			{item.kind === "shapes" ? (
				<div>
					{item.shapes.map((s) => (
						<div className="ins-shape" key={`${s.code}-${s.body}`}>
							<span
								className={`ins-shape-code${isLoudShape(s.code, s.isNew) ? " bad" : ""}`}
							>
								{s.code}
							</span>
							<span className="ins-shape-body" title={s.body}>
								{s.body}
							</span>
							<span className="ins-shape-count">
								{s.count.toLocaleString("en-US")}×
								{s.isNew ? <span className="ins-chip">new</span> : null}
							</span>
						</div>
					))}
				</div>
			) : null}
			{item.kind === "timeline" ? (
				<div
					className="ins-timeline"
					style={{ "--n": item.steps.length } as React.CSSProperties}
				>
					{item.steps.map((s) => (
						<div
							key={`${s.what}-${s.at}`}
							className={s.failed ? "failed" : "ok"}
						>
							<b>{s.what}</b>
							{s.at}
							{s.note ? (
								<>
									<br />
									<small>{s.note}</small>
								</>
							) : null}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
