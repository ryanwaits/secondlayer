"use client";

import { useState } from "react";
import { CopyButton } from "./copy-button";
import { QUICKSTART_STEPS } from "./quickstart-data";

/** Compact embeddable Quickstart: a tabbed runner where each step shows a
 *  one-line description and its command (no output). Lives on the docs intro;
 *  the full walkthrough is /docs/quickstart. */
export function QuickstartPanel() {
	const [active, setActive] = useState(0);
	const step = QUICKSTART_STEPS[active];

	return (
		<div className="docs-qpanel">
			<div className="docs-qpanel-tabs" role="tablist" aria-label="Quickstart">
				{QUICKSTART_STEPS.map((s, i) => (
					<button
						key={s.n}
						type="button"
						role="tab"
						aria-selected={i === active}
						className="docs-qpanel-tab"
						onClick={() => setActive(i)}
					>
						<span className="n">{s.n}</span> {s.tab}
					</button>
				))}
			</div>
			<div className="docs-qpanel-body">
				<p className="docs-qpanel-label">{step.desc}</p>
				<div className="docs-qpanel-cmd">
					<span className="prompt">$</span>
					<span>
						<span className="kw">{step.kw}</span>
						<span className="rest">{step.rest}</span>
					</span>
					<CopyButton text={step.kw + step.rest} className="docs-qpanel-copy" />
				</div>
			</div>
		</div>
	);
}
