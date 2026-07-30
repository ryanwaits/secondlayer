import { CodeBlock } from "@/components/code-block";
import { FILTERS_SNIPPET, TESTING_SNIPPET } from "@/lib/home-snippets";
import Link from "next/link";
import type { ReactNode } from "react";
import {
	FilterProjectionRails,
	FilterProjectionsPane,
} from "./panes/filter-projections-pane";
import { TestRunPane } from "./panes/test-run-pane";
import { TypedHandlerPane } from "./panes/typed-handler-pane";

function SectionHead({
	title,
	docsHref,
	docsLabel,
	children,
}: {
	title: string;
	docsHref: string;
	docsLabel: string;
	children: ReactNode;
}) {
	return (
		<div className="home-feature-head">
			<h3>{title}</h3>
			<p>{children}</p>
			<Link href={docsHref} className="home-docs-link">
				{docsLabel} <span className="ar">→</span>
			</Link>
		</div>
	);
}

/** The three capability sections: Filters → Typed handlers → Testing. */
export function HomeFeatures() {
	return (
		<section className="home-block">
			<div className="home-wrap">
				{/* V1 · projection board — the `on` union */}
				<div className="home-feature">
					<SectionHead
						title="Say it once. Send it anywhere."
						docsHref="/docs/filters"
						docsLabel="Read about filters"
					>
						One typed filter describes the chain event. Each surface gets its
						own explicit projection — including the conversions and
						disagreements a spread would hide.
					</SectionHead>
					<div className="home-proj">
						<div className="home-proj-src">
							<span className="home-proj-label">the filter</span>
							<CodeBlock code={FILTERS_SNIPPET} />
						</div>
						<FilterProjectionRails />
						<FilterProjectionsPane />
					</div>
					<p className="home-proj-foot">
						Principals are validated at construction: a contract id where an
						asset identifier belongs throws naming the field, instead of quietly
						matching zero rows.
					</p>
				</div>

				{/* V4 · IDE moment — ABI-typed handlers */}
				<div className="home-feature">
					<SectionHead
						title="The ABI already knows."
						docsHref="/docs/subgraphs"
						docsLabel="Read about typed handlers"
					>
						Give a source its contract&apos;s ABI and{" "}
						<code className="home-inline-code">event.input</code> is typed per
						function — names checked, integers as{" "}
						<code className="home-inline-code">bigint</code>, wrong fields
						caught before deploy.
					</SectionHead>
					<TypedHandlerPane />
				</div>

				{/* V3 · editor + test run — handler testing */}
				<div className="home-feature">
					<SectionHead
						title="Production is not a test environment."
						docsHref="/docs/subgraphs#testing-a-handler-before-you-deploy"
						docsLabel="Read about testing"
					>
						Run real chain events through your local handler code before you
						deploy. The first run records a cassette, so every run after is free
						and offline.
					</SectionHead>
					<div className="home-test">
						<div className="home-test-editor">
							<div className="home-ide-tabs">
								<span className="home-ide-tab on">bns-names.test.ts</span>
								<span className="home-ide-tab">bns-names.ts</span>
							</div>
							<CodeBlock code={TESTING_SNIPPET} />
						</div>
						<TestRunPane />
					</div>
				</div>
			</div>
		</section>
	);
}
