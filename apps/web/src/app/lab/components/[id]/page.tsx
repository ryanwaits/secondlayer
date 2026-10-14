import { Code } from "@/components/code/code";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STORIES, type Story, getStory } from "../../stories";
import { StoryView } from "../../story-controls";

type Params = { id: string };

export function generateStaticParams(): Params[] {
	return STORIES.map((story) => ({ id: story.id }));
}

export async function generateMetadata({
	params,
}: { params: Promise<Params> }): Promise<Metadata> {
	const story = getStory((await params).id);
	return { title: story ? `${story.title} · Lab` : "Lab" };
}

const MODES = [
	{ mode: "light", label: "Light" },
	{ mode: "dark", label: "Dark" },
] as const;

function Rules({ story }: { story: Story }) {
	return (
		<div className="lab-rules">
			{story.dos && (
				<section>
					<h3>Do</h3>
					<ul>
						{story.dos.map((rule) => (
							<li key={rule}>{rule}</li>
						))}
					</ul>
				</section>
			)}
			{story.donts && (
				<section>
					<h3>Don't</h3>
					<ul>
						{story.donts.map((rule) => (
							<li key={rule}>{rule}</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

export default async function StoryPage({
	params,
}: { params: Promise<Params> }) {
	const story = getStory((await params).id);
	if (!story) notFound();

	// Every variant renders once per theme frame, all on the server.
	const variants = story.variants.map((variant) => ({
		id: variant.id,
		label: variant.label,
		node: (
			<div className="lab-frames">
				{MODES.map(({ mode, label }) => (
					<section key={mode} className="lab-fr" data-mode={mode}>
						<span className="lab-fr-cap">{label}</span>
						<div className="site lab-in">
							{story.width ? (
								<div className="lab-w">
									{variant.render(`${variant.id}-${mode}`)}
								</div>
							) : (
								variant.render(`${variant.id}-${mode}`)
							)}
						</div>
					</section>
				))}
			</div>
		),
	}));

	const panes = [
		story.props && {
			id: "props",
			label: "Props",
			node: (
				<table className="lab-props">
					<thead>
						<tr>
							<th>Prop</th>
							<th>Type</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{story.props.map((prop) => (
							<tr key={prop.name}>
								<td>
									<code>{prop.name}</code>
								</td>
								<td>
									<code>{prop.type}</code>
								</td>
								<td>{prop.note}</td>
							</tr>
						))}
					</tbody>
				</table>
			),
		},
		story.usage && {
			id: "usage",
			label: "Usage",
			node: (
				<Code
					lang={story.usage.startsWith(".") ? "css" : "tsx"}
					code={story.usage}
				/>
			),
		},
		(story.dos || story.donts) && {
			id: "rules",
			label: "Rules",
			node: <Rules story={story} />,
		},
	].filter((pane) => !!pane);

	return (
		<article className="lab-story">
			<header className="lab-head">
				<p className="lab-eyebrow">{story.group}</p>
				<h1>{story.title}</h1>
				<p className="lab-rule">{story.rule}</p>
				<dl className="lab-meta">
					<div>
						<dt>Source</dt>
						<dd>
							{story.src.map((path) => (
								<code key={path}>{path}</code>
							))}
						</dd>
					</div>
					<div>
						<dt>DESIGN.md</dt>
						<dd>{story.design ?? "silent"}</dd>
					</div>
				</dl>
			</header>
			<StoryView
				key={story.id}
				variants={variants}
				width={story.width}
				stack={story.stack}
				panes={panes}
			/>
		</article>
	);
}
