"use client";

import { CopyButton } from "@/components/copy-button";
import { Evidence } from "@/components/dashboard/insight/evidence";
import { type Insight, causeText } from "@/lib/insights";
import { dismiss } from "@/lib/insights-store";
import type { WebhookTestResult } from "@secondlayer/sdk";
import { toast } from "sonner";
import type { Recovery } from "./use-recovery";

export interface TestState {
	busy: boolean;
	result: WebhookTestResult | null;
}

function testLabel(test: TestState): string {
	if (test.busy) return "Sending…";
	if (test.result === null) return "Send a test";
	return test.result.ok
		? `Test got ${test.result.statusCode}`
		: `Test failed: ${test.result.statusCode ?? "no answer"}`;
}

/**
 * The desktop webhook page's answer to "what is wrong": the top insight in
 * plain words with its evidence, a likely cause when the label is sure enough,
 * and the two jobs that fix it (a test, then the requeue). The insight's own
 * evidence is all it shows; it invents no checks.
 */
export function WhatsHappening({
	insight,
	recovery,
	onTest,
	test,
}: {
	insight: Insight;
	recovery: Recovery;
	onTest: () => void;
	test: TestState;
}) {
	const { dead, requeue } = recovery;
	const cause = causeText(insight.how);
	// "Got it" and "Dismiss" are the same action: hide it until the rule fires again.
	async function act() {
		if (!(await dismiss(insight.id))) toast.error("Couldn't update that note");
	}
	return (
		<section className="ov-note wd-why" aria-label="What's happening">
			<span className="dash-label">What's happening</span>
			<p className="ov-note-text">
				<span>
					<b>{insight.lead}</b> {insight.body}
				</span>
			</p>
			{insight.evidence.map((item) => (
				<Evidence key={`${item.kind}-${item.title}`} item={item} />
			))}
			{cause ? (
				<p className="wd-likely">
					<b>Likely:</b> {cause}
				</p>
			) : null}
			<div className="ov-note-acts">
				<button
					type="button"
					className="wd-btn"
					disabled={test.busy}
					onClick={onTest}
				>
					{testLabel(test)}
				</button>
				{requeue.requeued !== null ? (
					<span className="wd-btn wd-btn-done">
						Requeued {requeue.requeued.toLocaleString("en-US")}
					</span>
				) : dead && dead.count > 0 ? (
					<button
						type="button"
						className="wd-btn"
						disabled={requeue.busy}
						onClick={requeue.onRequeue}
					>
						{requeue.busy
							? "Requeuing…"
							: `Requeue ${dead.count.toLocaleString("en-US")}`}
					</button>
				) : null}
			</div>
			<p className="wd-faint wd-why-aside">
				<span className="ov-note-prompt">
					<CopyButton
						code={insight.handoff.prompt}
						label="Copy the fix as a prompt"
					/>
				</span>{" "}
				Requeue after a test answers 200.
			</p>
			<div className="ov-note-acts">
				<button type="button" className="ins-act" onClick={() => void act()}>
					Got it
				</button>
				<button type="button" className="ins-act" onClick={() => void act()}>
					Dismiss
				</button>
			</div>
		</section>
	);
}
