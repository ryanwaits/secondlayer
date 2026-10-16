import {
	FREE_ROWS_PER_MONTH,
	MEMORY_USD_PER_GB_HOUR,
	ROW_USD_PER_M,
	ROW_USD_PER_M_VOLUME,
	STACK_FLOOR_USD_PER_MONTH,
	VOLUME_TIER_MONTHLY_USD,
	WEBHOOK_USD_PER_M,
} from "@/lib/prices";
import { formatRows } from "@/lib/usage";

/** How an account is billed, one row per meter. Every number comes from
 *  lib/prices.ts, which prices.test.ts keeps equal to the platform table. */
export function RatesTable() {
	return (
		<section className="bl-rates" aria-label="How you're billed">
			<span className="dash-label">How you're billed</span>
			<table>
				<tbody>
					<tr>
						<th scope="row">Rows</th>
						<td>
							<code>{formatRows(FREE_ROWS_PER_MONTH)}</code> free a month, live
							or history. Then <code>${ROW_USD_PER_M}</code> per 1M,{" "}
							<code>${ROW_USD_PER_M_VOLUME}</code> past{" "}
							<code>${VOLUME_TIER_MONTHLY_USD}</code> in a month.
						</td>
					</tr>
					<tr>
						<th scope="row">Webhook events</th>
						<td>
							<code>${WEBHOOK_USD_PER_M}</code> per 1M. Retries are free.
						</td>
					</tr>
					<tr>
						<th scope="row">Hosted stack</th>
						<td>
							<code>${MEMORY_USD_PER_GB_HOUR}</code> per GB-hour of memory, plus
							storage.
						</td>
					</tr>
					<tr>
						<th scope="row">Minimum</th>
						<td>
							<code>${STACK_FLOOR_USD_PER_MONTH.webhooks}/mo</code> webhooks
							only, <code>${STACK_FLOOR_USD_PER_MONTH.subgraphs}/mo</code> with
							subgraphs, while it runs. Pause or delete everything and it stops
							within minutes.
						</td>
					</tr>
					<tr>
						<th scope="row">Always free</th>
						<td>
							Block headers, reads of your own subgraph tables, and self-hosted
							instances.
						</td>
					</tr>
				</tbody>
			</table>
		</section>
	);
}
