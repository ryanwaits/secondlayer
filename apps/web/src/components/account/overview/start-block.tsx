import { CliLine } from "../webhooks/shared";

/**
 * The two ways to put something on this page, shown the same to every account
 * that has neither yet. Fixed on purpose: it never guesses from what the
 * account reads.
 */
export function StartBlock() {
	return (
		<section className="ov-section" aria-label="Webhooks and subgraphs">
			<div className="ov-section-h">
				<h2>Webhooks and subgraphs</h2>
			</div>
			<div className="ov-opt">
				<h3>Want chain events pushed to you? Webhooks</h3>
				<p>
					We POST each matching event to your server as it lands, like an sBTC
					deposit, a swap or an NFT mint. Signed, retried, recalled on a reorg.
				</p>
				<CliLine label="Webhook" command="sl webhooks create --help" />
			</div>
			<div className="ov-opt">
				<h3>Want your own tables to query? Subgraphs</h3>
				<p>
					Handlers you write fill tables we keep at the chain tip, like token
					holders or pool volume. Query them like the Index.
				</p>
				<CliLine label="Subgraph" command="sl subgraphs create --help" />
			</div>
			<p className="ov-aside">
				Each one shows up here, with its own row and chart, once it exists.
			</p>
		</section>
	);
}
