"use client";

import type { ReactNode } from "react";

interface DeploySuccessCardProps {
	name: string;
	version: string;
	onTrigger: () => void;
	onTail: () => void;
	testRunSent: boolean;
	tailOpen: boolean;
	tail?: ReactNode;
}

export function DeploySuccessCard({
	name,
	version,
	onTrigger,
	onTail,
	testRunSent,
	tailOpen,
	tail,
}: DeploySuccessCardProps) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Deployed {name} → v{version}
			</div>
			<div className="tool-card-footer">
				<button
					type="button"
					className="tool-btn ghost"
					disabled={testRunSent}
					onClick={onTrigger}
				>
					{testRunSent ? "Test run queued" : "Trigger test run"}
				</button>
				<button
					type="button"
					className="tool-btn ghost"
					disabled={tailOpen}
					onClick={onTail}
				>
					{tailOpen ? "Tailing…" : "Tail live runs"}
				</button>
			</div>
			{tail}
		</div>
	);
}
