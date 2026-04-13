"use client";

import { useEffect, useState } from "react";
import { StepFlow, type StepInfo } from "./step-flow";

interface StepEvent {
	id: string;
	stepIndex: number;
	stepId: string;
	stepType: string;
	status: string;
	error?: string | null;
	output?: unknown;
	ts: string;
}

type FinalStatus = "completed" | "failed" | "cancelled" | null;

interface StepFlowLiveProps {
	workflowName: string;
	runId: string;
}

function statusToState(status: string): StepInfo["state"] {
	if (status === "completed" || status === "success") return "complete";
	if (status === "failed" || status === "cancelled") return "complete";
	return "active";
}

function formatOutput(output: unknown): string | null {
	if (output == null) return null;
	if (typeof output === "string") return output;
	try {
		return JSON.stringify(output, null, 2);
	} catch {
		return String(output);
	}
}

function renderStepCard(event: StepEvent) {
	if (event.error) {
		return <div className="tool-error-body">{event.error}</div>;
	}
	if (event.status !== "completed" && event.status !== "success") {
		return undefined;
	}
	const formatted = formatOutput(event.output);
	if (!formatted) return undefined;
	return <pre className="tool-step-output">{formatted}</pre>;
}

function labelFor(event: StepEvent): string {
	const core = `${event.stepType}:${event.stepId}`;
	if (event.status === "failed") return `${core} — failed`;
	if (event.status === "completed") return `${core}`;
	return `${core} — ${event.status}`;
}

/**
 * Opens an SSE stream against /api/sessions/tail-workflow-run/:name/:runId and
 * renders the run's step timeline live. Diffs incoming events against the
 * current ordered step list so we don't duplicate entries on reconnect.
 */
export function StepFlowLive({ workflowName, runId }: StepFlowLiveProps) {
	const [events, setEvents] = useState<Map<string, StepEvent>>(new Map());
	const [order, setOrder] = useState<string[]>([]);
	const [finalStatus, setFinalStatus] = useState<FinalStatus>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		(async () => {
			try {
				const res = await fetch(
					`/api/sessions/tail-workflow-run/${workflowName}/${runId}`,
					{
						method: "GET",
						credentials: "same-origin",
						headers: { Accept: "text/event-stream" },
						signal: controller.signal,
					},
				);
				if (!res.ok || !res.body) {
					setError(`Stream failed (HTTP ${res.status})`);
					return;
				}
				const reader = res.body
					.pipeThrough(new TextDecoderStream())
					.getReader();
				let buffer = "";
				while (true) {
					const { value, done } = await reader.read();
					if (done) return;
					buffer += value;
					let sep = buffer.indexOf("\n\n");
					while (sep !== -1) {
						const chunk = buffer.slice(0, sep);
						buffer = buffer.slice(sep + 2);
						handleChunk(chunk);
						sep = buffer.indexOf("\n\n");
					}
				}
			} catch (err) {
				if (err instanceof Error && err.name !== "AbortError") {
					setError(err.message);
				}
			}
		})();

		function handleChunk(chunk: string) {
			let event = "message";
			const dataLines: string[] = [];
			for (const line of chunk.split("\n")) {
				if (line.startsWith("event:")) event = line.slice(6).trim();
				else if (line.startsWith("data:"))
					dataLines.push(line.slice(5).trimStart());
			}
			if (dataLines.length === 0) return;
			const data = dataLines.join("\n");
			try {
				const parsed = JSON.parse(data);
				if (event === "step") {
					const step = parsed as StepEvent;
					setEvents((prev) => {
						const next = new Map(prev);
						next.set(step.id, step);
						return next;
					});
					setOrder((prev) =>
						prev.includes(step.id) ? prev : [...prev, step.id],
					);
				} else if (event === "done") {
					setFinalStatus(
						(parsed as { status?: FinalStatus }).status ?? "completed",
					);
					controller.abort();
				} else if (event === "timeout") {
					setError("Stream timed out after 30 minutes");
				}
			} catch {
				// ignore parse errors
			}
		}

		return () => controller.abort();
	}, [workflowName, runId]);

	const steps: StepInfo[] = order.map((id) => {
		const event = events.get(id);
		if (!event) {
			return { label: id, state: "pending" as const };
		}
		return {
			label: labelFor(event),
			state: statusToState(event.status),
			card: renderStepCard(event),
		};
	});

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Run {runId.slice(0, 8)}
				{finalStatus ? ` · ${finalStatus}` : ""}
			</div>
			<StepFlow steps={steps} />
			{error && <div className="tool-error-body">{error}</div>}
		</div>
	);
}
