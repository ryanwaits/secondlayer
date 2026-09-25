"use client";

import type { DoctorIssue, WebhookDetail } from "@secondlayer/sdk";

/**
 * The web's own copy for each doctor issue code — the CLI prints a
 * `secondlayer webhooks ...` hint; the dashboard already has the button (or
 * points at the tab) that does the same thing.
 */

function diagnosisTitle(issues: DoctorIssue[]): string {
	const codes = new Set(issues.map((i) => i.code));
	if (codes.has("circuit")) return "Your receiver is failing";
	if (codes.has("paused")) return "This webhook is paused";
	if (codes.has("last_error")) return "The last delivery failed";
	if (codes.has("dead_letters")) return "Some events exhausted every retry";
	if (codes.has("warning")) return "This webhook can't fire yet";
	if (codes.has("subgraph_gaps")) return "The linked subgraph has gaps";
	if (codes.has("subgraph_catching_up")) {
		return "The linked subgraph is still catching up";
	}
	return "No deliveries yet";
}

function issueCopy(
	issue: DoctorIssue,
	webhook: WebhookDetail,
	deadCount: number,
): { text: string; command?: string } {
	switch (issue.code) {
		case "warning":
			return { text: issue.detail ?? "This webhook can't fire yet." };
		case "paused":
			return {
				text: "This webhook is paused, so nothing is being delivered. Resume it above when your receiver is healthy.",
			};
		case "last_error":
			return {
				text: `The last delivery failed: ${issue.detail ?? "unknown error"}. Send a test event to check whether it's still happening.`,
			};
		case "circuit":
			return {
				text: `Your receiver failed ${webhook.circuitFailures} times in a row, so deliveries are paused briefly between tries. Check your receiver's logs, then send a test event.`,
			};
		case "dead_letters":
			return {
				text: `${deadCount} event${deadCount === 1 ? "" : "s"} exhausted every retry and are waiting in Failed events, below.`,
			};
		case "subgraph_gaps":
			return {
				text: "The subgraph feeding this webhook has gaps in its data.",
				command: webhook.subgraphName
					? `secondlayer subgraphs gaps ${webhook.subgraphName}`
					: undefined,
			};
		case "subgraph_catching_up":
			return {
				text: "The subgraph feeding this webhook is still catching up to the chain tip; new matching rows may arrive later.",
			};
		case "no_deliveries":
			return {
				text: "No deliveries yet. Confirm your receiver is reachable, then send a test event.",
			};
		default:
			return { text: "" };
	}
}

export function DiagnosisPanel({
	webhook,
	issues,
	deadCount,
}: {
	webhook: WebhookDetail;
	issues: DoctorIssue[];
	deadCount: number;
}) {
	if (issues.length === 0) return null;
	const errBlock = [
		webhook.lastError ? `last_error: ${webhook.lastError}` : null,
		webhook.circuitOpenedAt
			? `circuit: open at ${webhook.circuitOpenedAt}`
			: webhook.circuitFailures > 0
				? `circuit: ${webhook.circuitFailures} failures`
				: null,
	].filter((line): line is string => line !== null);

	return (
		<section className="wh-diag" aria-label="Diagnosis">
			<div className="wh-diag-h">
				<p className="t">{diagnosisTitle(issues)}</p>
				<p className="l">Here's what to do about it.</p>
			</div>
			{errBlock.length > 0 ? (
				<pre className="wh-diag-err">{errBlock.join("\n")}</pre>
			) : null}
			<ol>
				{issues.map((issue) => {
					const { text, command } = issueCopy(issue, webhook, deadCount);
					return (
						<li key={issue.code}>
							{text}
							{command ? (
								<>
									{" "}
									<code className="wh-mono">{command}</code>
								</>
							) : null}
						</li>
					);
				})}
			</ol>
		</section>
	);
}
