import { formatUsd } from "@/lib/account-data";
import { creditDate, creditWhat } from "@/lib/billing-view";
import type { CreditAdded } from "@/lib/types";
import { LoadFailed } from "../load-failed";

/** The latest top-ups and grants, newest first. */
export function CreditsAddedTable({
	credits,
	onRetry,
}: {
	/** Null until the list has loaded. */
	credits: CreditAdded[] | null;
	/** Set when the list failed to load: shown with a Retry. */
	onRetry?: () => void;
}) {
	return (
		<section className="dash-panel bl-panel" aria-label="Credits added">
			<span className="dash-label">Credits added</span>
			<div className="wd-tbl-wrap">
				<table className="wd-tbl">
					<thead>
						<tr>
							<th>Date</th>
							<th>Kind</th>
							<th className="r">Amount</th>
						</tr>
					</thead>
					<tbody>
						{credits === null ? (
							<tr>
								<td className="wd-empty" colSpan={3}>
									{onRetry ? (
										<LoadFailed what="credits" onRetry={onRetry} />
									) : (
										"Loading..."
									)}
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
									<td>{creditWhat(credit)}</td>
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
