"use client";

import {
	OperationResult,
	type OperationTone,
	formatBlockRange,
} from "@/components/console/operation-result";
import { consoleFetch } from "@/lib/client-fetch";
import { type ReactNode, useState } from "react";

interface SubgraphReindexFormProps {
	subgraphName: string;
}

// Accepts only digit strings so "12,000" (Number() -> NaN) and "-5" (not
// \d+) are rejected before they ever reach JSON.stringify, which would
// otherwise silently turn NaN into `null` in the request body.
export function parseBlockInput(raw: string): number | null {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const n = Number(trimmed);
	return Number.isSafeInteger(n) ? n : null;
}

export type BackfillRangeValidation =
	| { valid: true; fromBlock: number; toBlock: number }
	| { valid: false; error: string };

export function validateBackfillRange(
	fromRaw: string,
	toRaw: string,
): BackfillRangeValidation {
	const fromBlock = parseBlockInput(fromRaw);
	const toBlock = parseBlockInput(toRaw);
	if (fromBlock === null || toBlock === null) {
		return {
			valid: false,
			error: "From/to block must be whole numbers (e.g. 185000).",
		};
	}
	if (fromBlock > toBlock) {
		return { valid: false, error: "From block must not be after to block." };
	}
	return { valid: true, fromBlock, toBlock };
}

export function SubgraphReindexForm({
	subgraphName,
}: SubgraphReindexFormProps) {
	const [tab, setTab] = useState<"backfill" | "reindex">("backfill");
	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [outcome, setOutcome] = useState<{
		tone: OperationTone;
		body: ReactNode;
		hint?: ReactNode;
	} | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const rangeValidation = validateBackfillRange(fromBlock, toBlock);
	const rangeTouched = fromBlock.trim() !== "" || toBlock.trim() !== "";

	async function post(path: string, body?: unknown) {
		return consoleFetch(
			`/api/subgraphs/${encodeURIComponent(subgraphName)}/${path}`,
			{
				method: "POST",
				...(body !== undefined
					? {
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(body),
						}
					: {}),
			},
		);
	}

	async function handleBackfillSubmit() {
		if (!rangeValidation.valid) {
			setOutcome({ tone: "err", body: rangeValidation.error });
			return;
		}
		setOutcome(null);
		setSubmitting(true);
		try {
			const res = await post("backfill", {
				fromBlock: rangeValidation.fromBlock,
				toBlock: rangeValidation.toBlock,
			});
			if (!res.ok) throw new Error(await res.text());
			setOutcome({
				tone: "ok",
				body: (
					<>
						Queued a backfill across blocks{" "}
						{formatBlockRange(
							rangeValidation.fromBlock,
							rangeValidation.toBlock,
						)}
						.
					</>
				),
				hint: "Only blocks with no data are processed. Track its progress in the status pill.",
			});
		} catch (e) {
			setOutcome({
				tone: "err",
				body: (
					<>
						Couldn't start the backfill —{" "}
						<b>{e instanceof Error ? e.message : "unknown error"}</b>.
					</>
				),
				hint: "Nothing was queued. Try again in a moment.",
			});
		} finally {
			setSubmitting(false);
		}
	}

	async function handleReindexSubmit() {
		setOutcome(null);
		setSubmitting(true);
		try {
			// Reindex rebuilds the whole subgraph and takes no body — sending no
			// JSON body at all keeps the request shape honest about that (rather
			// than an empty `{}` implying a body was considered and cleared).
			const res = await post("reindex");
			if (!res.ok) throw new Error(await res.text());
			setOutcome({
				tone: "ok",
				body: <>Queued a full reindex from the subgraph's start block.</>,
				hint: "Tables rebuild as it walks to the chain tip. Track its progress in the status pill.",
			});
		} catch (e) {
			setOutcome({
				tone: "err",
				body: (
					<>
						Couldn't start the reindex —{" "}
						<b>{e instanceof Error ? e.message : "unknown error"}</b>.
					</>
				),
				hint: "Nothing was queued. Try again in a moment.",
			});
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<div className="sg-data-tabs">
				<button
					type="button"
					className={`sg-data-tab${tab === "backfill" ? " active" : ""}`}
					onClick={() => setTab("backfill")}
				>
					Backfill
				</button>
				<button
					type="button"
					className={`sg-data-tab${tab === "reindex" ? " active" : ""}`}
					onClick={() => setTab("reindex")}
				>
					Reindex
				</button>
			</div>

			{tab === "backfill" ? (
				<div className="sg-reindex-form">
					<p
						style={{
							fontSize: 13,
							color: "var(--text-muted)",
							lineHeight: 1.5,
							marginBottom: 16,
						}}
					>
						Fill in gaps where blocks were missed during syncing.
						Non-destructive &mdash; only processes blocks that have no data.
					</p>
					<div className="sg-reindex-fields">
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">From block</div>
							<input
								className="sg-reindex-input"
								type="text"
								placeholder="e.g. 185000"
								value={fromBlock}
								onChange={(e) => setFromBlock(e.target.value)}
							/>
						</div>
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">To block</div>
							<input
								className="sg-reindex-input"
								type="text"
								placeholder="e.g. 187421"
								value={toBlock}
								onChange={(e) => setToBlock(e.target.value)}
							/>
						</div>
					</div>
					<button
						type="button"
						className="sg-reindex-btn"
						disabled={!rangeValidation.valid || submitting}
						onClick={handleBackfillSubmit}
					>
						{submitting ? "Queuing…" : "Backfill gaps"}
					</button>
					{rangeTouched && !rangeValidation.valid && (
						<OperationResult tone="err">
							{rangeValidation.error}
						</OperationResult>
					)}
					{outcome && (
						<OperationResult tone={outcome.tone} hint={outcome.hint}>
							{outcome.body}
						</OperationResult>
					)}
				</div>
			) : (
				<div className="sg-reindex-form">
					<div className="sg-reindex-warning">
						<svg
							aria-hidden="true"
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							style={{ flexShrink: 0, marginTop: 1 }}
						>
							<path d="M8 1.5L1.5 13h13L8 1.5z" />
							<path d="M8 6v3" />
							<circle cx="8" cy="11" r="0.5" fill="currentColor" />
						</svg>
						<span>
							Reindexing is destructive. It drops and rebuilds the entire
							subgraph from its start block &mdash; there is no way to scope it
							to a range.
						</span>
					</div>
					<button
						type="button"
						className="sg-reindex-btn"
						disabled={submitting}
						onClick={handleReindexSubmit}
					>
						{submitting ? "Queuing…" : "Reindex"}
					</button>
					{outcome && (
						<OperationResult tone={outcome.tone} hint={outcome.hint}>
							{outcome.body}
						</OperationResult>
					)}
				</div>
			)}
		</>
	);
}
