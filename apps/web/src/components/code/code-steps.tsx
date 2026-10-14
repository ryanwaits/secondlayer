import { Children, type ReactNode, isValidElement } from "react";
import { Code } from "./code";
import { CodeScope } from "./code-scope";
import { fenceOf } from "./fence";

type StepProps = {
	/** The `!ref` name this step focuses and lights in the code. */
	ref: string;
	title: string;
	children?: ReactNode;
};

/** One step of a `<CodeSteps>`; it draws nothing itself, the wrapper lays steps out. */
export function Step(_props: StepProps) {
	return null;
}

/**
 * A walkthrough: the steps scroll past while one block stays put beside them.
 * The step in view focuses the rows and lights the tokens its `ref` names; a
 * click jumps to a step. Writing posts only (the budget test enforces it).
 *
 * ```mdx
 * <CodeSteps>
 * <Step ref="open" title="Start where you stopped">
 *
 * Load the cursor you saved last time.
 *
 * </Step>
 *
 * (the fence, annotated with `// !ref(1) open`)
 * </CodeSteps>
 * ```
 *
 * Without JavaScript the steps read as prose above a complete block.
 */
export async function CodeSteps({ children }: { children?: ReactNode }) {
	const nodes = Children.toArray(children);
	const steps = nodes.filter(
		(n): n is React.ReactElement<StepProps> =>
			isValidElement(n) && n.type === Step,
	);
	const fence = nodes.map(fenceOf).find((f) => f !== null);
	if (!fence || !steps.length) return null;
	return (
		<div className="cs" data-steps>
			<CodeScope />
			<div className="cs-list">
				{steps.map((step, i) => (
					<div
						key={step.props.ref}
						className="cs-step"
						data-step={step.props.ref}
					>
						<p className="cs-n">Step {i + 1}</p>
						<h3>{step.props.title}</h3>
						{step.props.children}
					</div>
				))}
			</div>
			<div className="cs-stick">
				<Code {...fence} />
			</div>
		</div>
	);
}
