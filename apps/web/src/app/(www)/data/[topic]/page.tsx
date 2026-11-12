import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { ExamplePicker } from "@/components/data/example-picker";
import { RunesTable } from "@/components/data/runes-table";
import { SignerTable } from "@/components/data/signer-table";
import { LiveStamp, StatsStrip } from "@/components/data/stats-strip";
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
	type StripStats,
	type TopicStats,
	datasetJsonLd,
	getTopicStats,
	liveDescription,
	liveExamples,
	outputLang,
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

/** One example: its command beside what it prints, in one frame. */
function ExamplePair({
	sync,
	tabs,
}: {
	/** Tabs that share a key switch together, the output following the command. */
	sync?: string;
	tabs: readonly {
		title: string;
		lang: string;
		code: string;
		output: string;
	}[];
}) {
	return (
		<div className="pick-fig">
			<div className="pick-code">
				<CodeTabs variant="figure" sync={sync}>
					{tabs.map((tab) => (
						<Code
							key={tab.title}
							lang={tab.lang}
							title={tab.title}
							code={tab.code}
						/>
					))}
				</CodeTabs>
			</div>
			<div className="pick-out">
				<CodeTabs variant="figure" sync={sync}>
					{tabs.map((tab) => (
						<Code
							key={tab.title}
							lang={outputLang(tab.output)}
							title={tab.title}
							meta="nocopy"
							code={tab.output}
						/>
					))}
				</CodeTabs>
			</div>
		</div>
	);
}

/** "Get these numbers yourself": the chips, and under them the one figure the chosen chip shows. */
function Run({ topic, stats }: { topic: DataTopic; stats: TopicStats | null }) {
	const { free, ts, curl } = liveExamples(topic, stats);
	return (
		<section className="pick-sec">
			<div className="pick-head">
				<h2>{topic.pick.heading}</h2>
				<p className="lede">{topic.pick.lede}</p>
				{/* PoX-5's line is about checking the numbers above, so it sits there. */}
				{stats?.kind === "pox" ? null : <ExtraLine topic={topic} />}
			</div>
			<ExamplePicker
				labels={["These numbers", ...topic.recipes.map((r) => r.label)]}
			>
				<ExamplePair
					sync={`numbers-${topic.slug}`}
					tabs={[
						{ title: "No key", lang: "bash", ...free },
						{ title: "TypeScript", lang: "ts", ...ts },
						{ title: "cURL", lang: "bash", ...curl },
					]}
				/>
				{topic.recipes.map((recipe) => (
					<ExamplePair
						key={recipe.label}
						tabs={[{ title: "TypeScript", lang: "ts", ...recipe }]}
					/>
				))}
			</ExamplePicker>
			<div className="btns">
				<ButtonLink href="/signin">Get a key</ButtonLink>
				<ButtonLink href={topic.docsHref} variant="secondary">
					Read the docs
				</ButtonLink>
			</div>
		</section>
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

/** The four big numbers and the stamp under them. */
function StripBody({ stats }: { stats: StripStats }) {
	const { items, sub } = stripItems(stats);
	return (
		<StatsStrip
			items={items}
			sub={sub}
			blockHeight={stats.data.blockHeight}
			generatedAt={stats.data.generatedAt}
		/>
	);
}

/** The current answer: big numbers, and for PoX-5 the signers behind them. */
function Live({ topic, stats }: { topic: DataTopic; stats: TopicStats }) {
	return (
		<div className="live">
			<div className="live-head">
				<Eyebrow noun={topic.eyebrow} />
				<h1>{topic.title}</h1>
				<p className="lede">{topic.liveLede}</p>
			</div>
			{stats.kind === "runes" ? (
				<>
					<RunesTable runes={stats.data.runes} />
					<LiveStamp
						chain="Bitcoin"
						blockHeight={stats.data.blockHeight}
						generatedAt={stats.data.generatedAt}
					/>
				</>
			) : (
				<StripBody stats={stats} />
			)}
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
					{stats ? null : (
						<div className="pick-head pick-top">
							<Eyebrow noun={topic.eyebrow} />
							<h1>{topic.title}</h1>
							<p className="lede">{topic.lede}</p>
						</div>
					)}
					<Run topic={topic} stats={stats} />
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
