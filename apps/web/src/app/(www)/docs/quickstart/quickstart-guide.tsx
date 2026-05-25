import Link from "next/link";
import { CopyButton } from "../copy-button";
import { QUICKSTART_STEPS } from "../quickstart-data";

/** Guided terminal session for /docs/quickstart: a numbered progress rail
 *  where each step pairs a one-line description with its command terminal.
 *  No sample output — the commands are the source of truth. */
export function QuickstartGuide() {
	return (
		<>
			<div className="docs-qs-meta">
				<span className="docs-qs-chip">
					<b>~2</b> min
				</span>
				<span className="docs-qs-chip">
					<b>{QUICKSTART_STEPS.length}</b> commands
				</span>
				<span className="docs-qs-chip">no key to read</span>
			</div>

			<div className="docs-qs-rail">
				{QUICKSTART_STEPS.map((s) => (
					<div key={s.n} className="docs-qs-step">
						<span className="docs-qs-dot">{Number(s.n)}</span>
						<h2 className="docs-qs-title">{s.title}</h2>
						<p className="docs-qs-desc">{s.desc}</p>
						<div className="docs-qs-term">
							<div className="docs-qs-term-top">
								<span className="lbl">terminal</span>
								<CopyButton
									text={s.kw + s.rest}
									className="docs-qs-term-copy"
								/>
							</div>
							<div className="docs-qs-term-in">
								<span className="prompt">$ </span>
								<span className="kw">{s.kw}</span>
								{s.rest}
							</div>
						</div>
					</div>
				))}
			</div>

			<div className="docs-qs-done">
				<strong>That&rsquo;s a live table.</strong>
				<p>
					Next: write your first <Link href="/docs/subgraphs">handler</Link>, or
					wire up <Link href="/docs/subscriptions">push delivery</Link>.
				</p>
			</div>
		</>
	);
}
