import { CodeBlock } from "@/components/code-block";
import { ASK_STEP, HARNESSES, READ_CMD } from "@/lib/home-quickstart";
import type { ReactNode } from "react";
import { HarnessPicker } from "./harness-picker";

/** Docs code block inside a titled window: dots + file name, then shiki. */
function Window({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="home-qs-win">
			<div className="home-qs-bar">
				<span className="home-qs-dots" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
				{title}
			</div>
			{children}
		</div>
	);
}

function Step({ children }: { children: ReactNode }) {
	return (
		<li className="home-qs-step">
			<div className="home-qs-body">{children}</div>
		</li>
	);
}

export function AgentQuickstart() {
	return (
		<section className="home-qs" aria-labelledby="home-qs-h">
			<div className="home-qs-in">
				<h2 id="home-qs-h">
					From a key to live PoX-5 data, with your agent driving.
				</h2>
				<p className="home-sub">
					The docs ship as a skill. Install it once and your harness knows every
					endpoint; you ask the question, it makes the calls.{" "}
					<a href="/login">Get a key</a> and the last 24 hours are free.
				</p>

				<ol className="home-qs-steps">
					<Step>
						<HarnessPicker
							options={HARNESSES.map(({ key, label, blurb }) => ({
								key,
								label,
								blurb,
							}))}
							panels={HARNESSES.map((h) => (
								<Window key={h.key} title={h.file}>
									<CodeBlock code={h.code} lang={h.lang} />
								</Window>
							))}
						/>
					</Step>

					<Step>
						<Window title="">
							<CodeBlock code={ASK_STEP} lang="markdown" />
						</Window>
					</Step>

					<Step>
						<Window title="terminal">
							<CodeBlock code={READ_CMD} lang="bash" />
						</Window>
					</Step>
				</ol>
			</div>
		</section>
	);
}
