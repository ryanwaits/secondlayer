import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { ButtonLink, Eyebrow, Split } from "@/components/site";
import {
	type DataTopic,
	dataPath,
	dataTopic,
	liveDataTopics,
} from "@/lib/data-topics";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ topic: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
	return liveDataTopics().map(({ slug }) => ({ topic: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const topic = dataTopic((await params).topic);
	if (!topic) return {};
	return socialMeta({
		title: topic.metaTitle,
		description: topic.description,
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

export default async function DataTopicPage({ params }: Props) {
	const topic = dataTopic((await params).topic);
	if (!topic) notFound();
	const { webhook, extraLine } = topic;
	return (
		<main className="site product">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun={topic.eyebrow} />
						<h1>{topic.title}</h1>
						<p className="lede">{topic.lede}</p>
						{extraLine ? (
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
						) : null}
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
