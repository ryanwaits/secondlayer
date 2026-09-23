import { apiRequest } from "@/lib/api";

type Demand = {
	tokens: { symbol: string; requests: number; team: boolean }[];
	others: number;
};

/**
 * The public demand board: which tokens people want bridged, how many asked,
 * and whether a team is behind it. Aggregates only; the API already drops
 * contacts and anything that isn't a ticker two people asked for. Renders
 * nothing until a token qualifies, or if the API is unreachable.
 */
export async function RequestedTokens() {
	let demand: Demand;
	try {
		demand = await apiRequest<Demand>("/api/public/waitlist/robinhood/demand", {
			tags: ["waitlist-demand"],
		});
	} catch {
		return null;
	}
	if (demand.tokens.length === 0) return null;

	const top = demand.tokens[0].requests;
	return (
		<div className="rh-demand">
			<div className="rh-demand-head">
				<span>Most requested</span>
				<span>signups</span>
			</div>
			<ol className="rh-demand-list">
				{demand.tokens.map((t) => (
					<li key={t.symbol}>
						<span className="rh-demand-sym">{t.symbol}</span>
						<span className="rh-demand-bar" aria-hidden="true">
							<i style={{ width: `${(t.requests / top) * 100}%` }} />
						</span>
						<span className="rh-demand-n">{t.requests}</span>
						<span
							className={t.team ? "rh-demand-team" : "rh-demand-team is-none"}
						>
							{t.team ? "team" : ""}
						</span>
					</li>
				))}
			</ol>
			{demand.others > 0 && (
				<p className="rh-demand-others">
					+ {demand.others} other{demand.others === 1 ? "" : "s"} with fewer
					requests
				</p>
			)}
		</div>
	);
}
