import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { SignerTable } from "@/components/data/signer-table";
import { StatsStrip } from "@/components/data/stats-strip";
import { JsonLd } from "@/components/json-ld";
import { ButtonLink, Eyebrow, Split } from "@/components/site";
import {
	type DataTopic,
	dataPath,
	dataTopic,
	liveDataTopics,
} from "@/lib/data-topics";
import { socialMeta } from "@/lib/og";
import {
	type TopicStats,
	datasetJsonLd,
	getTopicStats,
	liveDescription,
	stripItems,
} from "@/lib/protocol-stats";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ topic: string }> };

export const dynamicParams = false;
/** Live numbers refresh every minute; the page stays statically generated. */
export const revalidate = 60;

export function generateStaticParams() {
	return liveDataTopics().map(({ slug }) => ({ topic: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const topic = dataTopic((await params).topic);
	if (!topic) return {};
	return socialMeta({
		title: topic.metaTitle,
		description: liveDescription(topic, await getTopicStats(topic)),
		image: "/og/index.png",
		path: dataPath(topic),
	});
}

function Call({ topic }: { topic: DataTopic }) {
	return (
		<div className="art">
			<CodeTabs variant="figure">
				<Code lang="bash" title="cURL" code={topic.curl} />
				<Code lang="ts" title="TypeScript" code={topic.sdk} />
			</CodeTabs>
			<Code
				lang="json"
				variant="figure"
				title="response.json"
				meta="status=200"
				code={topic.sampleResponse}
			/>
		</div>
	);
}

function ExtraLine({ topic }: { topic: DataTopic }) {
	const { extraLine } = topic;
	if (!extraLine) return null;
	return (
		<p>
			{extraLine.text}
			{extraLine.link ? (
				<>
					{" "}
					<Link className="more" href={extraLine.link.href}>
						{extraLine.link.label} →
					</Link>
				</>
			) : null}
		</p>
	);
}

/** The current answer: big numbers, and for PoX-5 the signers behind them. */
function Live({ topic, stats }: { topic: DataTopic; stats: TopicStats }) {
	const { items, sub } = stripItems(stats);
	return (
		<div className="live">
			<div className="live-head">
				<Eyebrow noun={topic.eyebrow} />
				<h1>{topic.title}</h1>
				<p className="lede">
					The current answer, free with no key. Refreshed every minute.
				</p>
			</div>
			<StatsStrip
				items={items}
				sub={sub}
				blockHeight={stats.data.blockHeight}
				generatedAt={stats.data.generatedAt}
			/>
			{stats.kind === "pox" ? (
				<>
					<SignerTable signers={stats.data.signers} />
					<ExtraLine topic={topic} />
				</>
			) : null}
		</div>
	);
}

export default async function DataTopicPage({ params }: Props) {
	const topic = dataTopic((await params).topic);
	if (!topic) notFound();
	const stats = await getTopicStats(topic);
	const { webhook } = topic;
	return (
		<main className="site product">
			{stats ? (
				<>
					<JsonLd data={datasetJsonLd(topic, stats, dataPath(topic))} />
					<div className="shell">
						<Live topic={topic} stats={stats} />
					</div>
				</>
			) : null}
			<div className={stats ? "band-ruled" : undefined}>
				<div className="shell">
					<div className="hero">
						<div className="hero-copy">
							{stats ? (
								<h2>Read it in your app</h2>
							) : (
								<>
									<Eyebrow noun={topic.eyebrow} />
									<h1>{topic.title}</h1>
								</>
							)}
							<p className="lede">{topic.lede}</p>
							{/* PoX-5's line is about checking the numbers above, so it sits there. */}
							{stats?.kind === "pox" ? null : <ExtraLine topic={topic} />}
							<div className="btns">
								<ButtonLink href="/signin">Get a key</ButtonLink>
								<ButtonLink href={topic.docsHref} variant="secondary">
									Read the docs
								</ButtonLink>
							</div>
						</div>
						<Call topic={topic} />
					</div>
				</div>
			</div>

			{webhook ? (
				<div className="band band-soft">
					<div className="shell">
						<Split
							copy={
								<>
									<Eyebrow noun="Webhooks" verb="push" />
									<h2>Get pushed instead</h2>
									<p className="lede">{webhook.lede}</p>
								</>
							}
							art={
								<div className="art">
									<Code
										lang="ts"
										variant="figure"
										title="webhook.ts"
										code={webhook.code}
									/>
								</div>
							}
						/>
					</div>
				</div>
			) : null}

			<div className="band-ruled">
				<div className="shell">
					<div className="data-links">
						<ButtonLink href={topic.docsHref} variant="secondary">
							Index docs
						</ButtonLink>
						<ButtonLink href={topic.apiHref} variant="secondary">
							API reference
						</ButtonLink>
						{topic.libraryHref ? (
							<ButtonLink href={topic.libraryHref} variant="secondary">
								Stacks library
							</ButtonLink>
						) : null}
					</div>
				</div>
			</div>
		</main>
	);
}
