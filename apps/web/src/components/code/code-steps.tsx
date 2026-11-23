import {
	Children,
	type ReactElement,
	type ReactNode,
	isValidElement,
} from "react";
import { Code } from "./code";
import { CodeScope } from "./code-scope";
import { fenceOf } from "./fence";

type StepProps = {
	ref: string;
	title: string;
	children?: ReactNode;
};

export function Step(_props: StepProps) {
	return null;
}

export async function CodeSteps({ children }: { children?: ReactNode }) {
	const nodes = Children.toArray(children);
	const isStep = (n: ReactNode): n is ReactElement<StepProps> =>
		isValidElement(n) && n.type === Step;
	const steps = nodes.filter(isStep);
	// A step's children are prose, which `fenceOf` would misread as code.
	const fence = nodes
		.filter((n) => !isStep(n))
		.map(fenceOf)
		.find(Boolean);
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
			<div className="cs-stick">{await Code(fence)}</div>
		</div>
	);
}
