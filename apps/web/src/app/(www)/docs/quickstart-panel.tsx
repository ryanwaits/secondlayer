import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { QUICKSTART_STEPS } from "./quickstart-data";

/** Quickstart for the docs intro: one tab per step, each a command with a note under its first word. */
export function QuickstartPanel() {
	return (
		<CodeTabs>
			{QUICKSTART_STEPS.map((step) => (
				<Code
					key={step.n}
					lang="bash"
					title={`${step.n} ${step.tab}`}
					code={step.cmd}
				/>
			))}
		</CodeTabs>
	);
}
