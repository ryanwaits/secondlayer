"use client";

interface DeploySuccessCardProps {
	name: string;
	version: string;
	onTrigger: () => void;
	onTail: () => void;
	testRunSent: boolean;
}

export function DeploySuccessCard({
	name,
	version,
	onTrigger,
	onTail,
	testRunSent,
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
				<button type="button" className="tool-btn ghost" onClick={onTail}>
					Tail live runs
				</button>
			</div>
		</div>
	);
}
