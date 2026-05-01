"use client";

import type { ReactNode } from "react";

export interface StepInfo {
	label: string;
	state: "complete" | "active" | "pending";
	card?: ReactNode;
}

interface StepFlowProps {
	steps: StepInfo[];
}

export function StepFlow({ steps }: StepFlowProps) {
	return (
		<div className="step-flow">
			{steps.map((step, i) => (
				<div key={`${step.label}-${i}`} className={`step ${step.state}`}>
					<div className="step-line">
						<div className="step-dot" />
						{i < steps.length - 1 && <div className="step-connector" />}
					</div>
					<div className="step-content">
						<div className="step-label">{step.label}</div>
						{step.card}
					</div>
				</div>
			))}
		</div>
	);
}
