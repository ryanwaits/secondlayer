import {
	type WorkflowTemplate,
	type WorkflowTemplateCategory,
	templates,
} from "@secondlayer/workflows/templates";
import { BoxBadge } from "@/components/box-badge";
import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const CATEGORY_ORDER: WorkflowTemplateCategory[] = [
	"monitoring",
	"defi",
	"webhook",
	"digest",
	"ops",
];

const CATEGORY_LABEL: Record<WorkflowTemplateCategory, string> = {
	monitoring: "Monitoring",
	defi: "DeFi",
	webhook: "Webhooks",
	digest: "Digests",
	ops: "Ops",
};

function groupByCategory(list: WorkflowTemplate[]) {
	const byCategory = new Map<WorkflowTemplateCategory, WorkflowTemplate[]>();
	for (const t of list) {
		const bucket = byCategory.get(t.category) ?? [];
		bucket.push(t);
		byCategory.set(t.category, bucket);
	}
	return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
		category: c,
		label: CATEGORY_LABEL[c],
		items: byCategory.get(c) ?? [],
	}));
}

const TRIGGER_LABEL: Record<WorkflowTemplate["trigger"], string> = {
	event: "event trigger",
	schedule: "schedule trigger",
	manual: "manual trigger",
};

export default function WorkflowsTemplatesPage() {
	const grouped = groupByCategory(templates);
	const toc: TocItem[] = templates.map((t) => ({
		label: t.name,
		href: `#${t.id}`,
	}));

	return (
		<div className="article-layout">
			<Sidebar title="Templates" toc={toc} backHref="/workflows" backLabel="Workflows" />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Templates <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Ready-to-deploy workflow seeds. Fork, tweak, ship. Install the SDK
						with <code>bun add @secondlayer/workflows</code> and copy any
						template below into <code>workflows/&lt;name&gt;.ts</code>, then
						deploy with <code>sl workflows deploy workflows/&lt;name&gt;.ts</code>.
					</p>
					<p>
						Also available from the CLI —{" "}
						<code>sl workflows templates</code> lists every template,{" "}
						<code>sl workflows templates &lt;id&gt;</code> pipes the source to
						stdout.
					</p>
				</div>

				{grouped.map((group) => (
					<section key={group.category}>
						<SectionHeading id={`category-${group.category}`}>
							{group.label}
						</SectionHeading>

						{group.items.map((template) => (
							<div key={template.id} style={{ marginBottom: "var(--spacing-xl)" }}>
								<SectionHeading id={template.id}>{template.name}</SectionHeading>

								<div className="prose">
									<p>
										<code>{template.id}</code> · {TRIGGER_LABEL[template.trigger]} ·{" "}
										{CATEGORY_LABEL[template.category]}
									</p>
									<p>{template.description}</p>
								</div>

								<CodeBlock code={template.code} />
							</div>
						))}
					</section>
				))}
			</main>
		</div>
	);
}
