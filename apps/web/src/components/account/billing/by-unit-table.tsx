import { formatUsd } from "@/lib/account-data";
import { totalMicros, unitLines } from "@/lib/billing-view";
import {
	type UsageRow,
	formatUnitQuantity,
	rateLabel,
	unitLabel,
} from "@/lib/usage";

/** What the month was spent on, one line per unit. Sentinel's runs sit last on lines of their own. */
export function ByUnitTable({
	usage,
	monthName,
}: {
	/** Null until the month has loaded. */
	usage: UsageRow[] | undefined;
	monthName: string;
}) {
	const lines = unitLines(usage ?? []);
	const unpaid = new Map(
		(usage ?? []).map((u) => [u.unit, Number(u.unpaidUsdMicros ?? "0")]),
	);
	return (
		<section
			className="dash-panel bl-panel"
			aria-label={`By unit, ${monthName}`}
		>
			<span className="dash-label">By unit · {monthName}</span>
			<div className="wd-tbl-wrap">
				<table className="wd-tbl">
					<thead>
						<tr>
							<th>Unit</th>
							<th className="r">Qty</th>
							<th className="r">Rate</th>
							<th className="r">Cost</th>
						</tr>
					</thead>
					<tbody>
						{usage === undefined ? (
							<tr>
								<td className="wd-empty" colSpan={4}>
									Loading...
								</td>
							</tr>
						) : lines.length === 0 ? (
							<tr>
								<td className="wd-empty" colSpan={4}>
									Nothing billed yet this month.
								</td>
							</tr>
						) : (
							<>
								{lines.map((line) => (
									<tr key={line.unit}>
										<td>{unitLabel(line.unit)[0]}</td>
										<td className="r">
											{formatUnitQuantity(line.unit, line.quantity)}
										</td>
										<td className="r bl-faint">
											{rateLabel(line.unit, line.quantity)}
										</td>
										<td className="r">
											{formatUsd(line.usdMicros)}
											{(unpaid.get(line.unit) ?? 0) > 0 ? (
												<span className="bad">
													{" "}
													{formatUsd(unpaid.get(line.unit) ?? 0)} unpaid
												</span>
											) : null}
										</td>
									</tr>
								))}
								<tr className="bl-total">
									<td>Total</td>
									<td />
									<td />
									<td className="r">{formatUsd(totalMicros(lines))}</td>
								</tr>
							</>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
