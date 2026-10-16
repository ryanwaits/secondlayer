import { formatUsd } from "@/lib/account-data";
import { creditDate, creditWhat } from "@/lib/billing-view";
import type { CreditAdded } from "@/lib/types";

/** The latest top-ups and grants, newest first. */
export function CreditsAddedTable({
	credits,
}: {
	/** Null until the list has loaded. */
	credits: CreditAdded[] | null;
}) {
	return (
		<section className="dash-panel bl-panel" aria-label="Credits added">
			<span className="dash-label">Credits added</span>
			<div className="wd-tbl-wrap">
				<table className="wd-tbl">
					<thead>
						<tr>
							<th>Date</th>
							<th>What</th>
							<th className="r">Amount</th>
						</tr>
					</thead>
					<tbody>
						{credits === null ? (
							<tr>
								<td className="wd-empty" colSpan={3}>
									Loading...
								</td>
							</tr>
						) : credits.length === 0 ? (
							<tr>
								<td className="wd-empty" colSpan={3}>
									No credits added yet.
								</td>
							</tr>
						) : (
							credits.map((credit) => (
								<tr
									key={`${credit.occurredAt}-${credit.kind}-${credit.source}`}
								>
									<td>{creditDate(credit.occurredAt)}</td>
									<td>
										{creditWhat(credit)}
										{credit.kind === "grant" && credit.source ? (
											<span className="bl-faint"> {credit.source}</span>
										) : null}
									</td>
									<td className="r good">+{formatUsd(credit.usdMicros)}</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
