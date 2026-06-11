import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { StreamsDiagram } from "@/components/diagrams/streams-diagram";
import { InlineKey, KeyTrigger } from "@/components/inline-key";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { SectionHeading } from "@/components/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Streams | secondlayer",
	description:
		"The raw event firehose for Stacks — an immutable, replayable, cursor-paginated log. No node required.",
};

export default function StreamsPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader
				crumb="Home"
				crumbHref="/"
				here="Streams"
				title={<>Streams</>}
			/>
			<div className="mk-body">
				<div className="prose">
					<p>
						Streams is the raw event firehose for Stacks — the feature for
						teams <strong>building their own indexer</strong>. One service
						captures every event a Stacks node emits — STX, FT and NFT
						transfers, contract prints, locks — and saves them as an immutable,
						ordered log. You read that log over a cursor-paginated REST API, or
						pull signed parquet dumps for bulk work.
					</p>
					<p>
						If you just want decoded, queryable chain data, use{" "}
						<Link href="/index-api">Index</Link> — we run the indexer for you.
						Streams hands you the inputs instead: append-only, heavily
						cacheable, trivially replayable — sync, stop, and pick up exactly
						where you left off, without ever running a Stacks node. It's the
						same firehose our own decoders read internally. For push delivery,
						see <Link href="/subscriptions">Subscriptions</Link>.
					</p>
				</div>

				<SectionHeading id="how-it-works">How it works</SectionHeading>

				<StreamsDiagram />

				<div className="prose">
					<p>
						An indexer faces the Stacks node and writes raw, canonical events;
						the Streams API serves them to your consumer over a cursor. Stop and
						resume anytime — the cursor is just <code>height:event_index</code>.
					</p>
				</div>

				<SectionHeading id="auth">Auth</SectionHeading>

				<div className="prose">
					<InlineKey product="streams">
						Streams is read-only but keyed — every request needs an{" "}
						<KeyTrigger>API key</KeyTrigger>, including during open beta.
					</InlineKey>
				</div>

				<CodeBlock
					code={`curl -H "Authorization: Bearer sk-sl_..." \\
  https://api.secondlayer.tools/v1/streams/tip`}
					lang="bash"
				/>

				<SectionHeading id="reading-the-log">Reading the log</SectionHeading>

				<div className="prose">
					<p>
						Every event carries a cursor — <code>height:event_index</code>. Page
						forward from a cursor and the stream is fully{" "}
						<strong>idempotent</strong>: persist the last cursor you saw and a
						restarted job resumes from exactly that point, no duplicates.
						Because the log is append-only it's also reorg-aware — when a fork
						resolves, <code>/v1/streams/reorgs</code> tells you which cursors to
						roll back, so your derived state stays consistent.
					</p>
					<p>The SDK wraps this into a consume loop with checkpointing:</p>
				</div>

				<CodeBlock
					code={`import { createStreamsClient } from "@secondlayer/sdk";

const streams = createStreamsClient({ apiKey: process.env.SL_API_KEY! });

await streams.events.consume({
  fromCursor: lastCheckpoint,
  types: ["print"],
  contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
  batchSize: 500,
  onBatch: async (events, _envelope, { cursor }) => {
    for (const e of events) await handle(e); // key rows by e.cursor
    await saveCheckpoint(cursor);
  },
  onReorg: async (reorg, { cursor }) => {
    await rollbackAbove(reorg.fork_point_height); // SDK rewinds + re-reads
    await saveCheckpoint(cursor);
  },
});`}
				/>

				<Callout label="Full reference">
					<p>
						Every endpoint, the rate and retention tiers, and the full SDK
						surface live in the docs →{" "}
						<Link href="/docs/streams">/docs/streams</Link>.
					</p>
				</Callout>


			</div>
		</main>
	);
}
