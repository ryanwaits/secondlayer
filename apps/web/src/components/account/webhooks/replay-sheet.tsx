"use client";

import { Sheet } from "@/components/mobile/sheet";
import {
	estimateLine,
	isReplayActive,
	noteReplayStarted,
	replayPercent,
	useMinutesLeft,
} from "@/lib/replays";
import {
	getReplay,
	getReplays,
	requeueDead,
	startReplay,
} from "@/lib/webhooks-data";
import { poll } from "@/lib/webhooks-store";
import type { WebhookSummary } from "@secondlayer/sdk";
import type {
	ReplayProgress,
	ReplayRanges,
} from "@secondlayer/shared/schemas/webhooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { displayStatus } from "./shared";

const fmt = (n: number) => n.toLocaleString("en-US");
const POLL_MS = 2000;
const DEFAULT_PRESET = 1000;

export type ReplayWebhook = Pick<
	WebhookSummary,
	"id" | "name" | "status" | "circuitOpenedAt" | "circuitFailures"
>;

/** What the sheet shows right now. */
export type ReplayView =
	| { kind: "loading" }
	/** The server is still failing: a replay now would fail too. */
	| { kind: "gated" }
	| { kind: "picker"; ranges: ReplayRanges; selected: number; busy: boolean }
	| {
			kind: "progress";
			progress: ReplayProgress;
			minutesLeft: number | null;
			requeueBusy: boolean;
	  }
	| { kind: "error"; message: string };

export function replayTitle(view: ReplayView): string {
	if (view.kind !== "progress") return "Replay blocks";
	switch (view.progress.status) {
		case "done":
			return "Replay done";
		case "failed":
			return "Replay failed";
		default:
			return "Replay running";
	}
}

function Dot({ kind }: { kind: "ok" | "bad" | "run" | "ring" }) {
	return <span className={`mrp-dot is-${kind}`} aria-hidden="true" />;
}

function Bar({ pct }: { pct: number }) {
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: a read-only progress bar is not focusable
		<div
			className="mrp-track"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={pct}
		>
			<i style={{ width: `${pct}%` }} />
		</div>
	);
}

function Step({
	done,
	index,
	children,
	aside,
}: {
	done?: boolean;
	index: React.ReactNode;
	children: React.ReactNode;
	aside?: React.ReactNode;
}) {
	return (
		<div className={`mrp-step${done ? " is-done" : ""}`}>
			<span className="mrp-ix" aria-hidden="true">
				{done ? "✓" : index}
			</span>
			<span className="mrp-lbl">{children}</span>
			{aside ? <span className="mrp-aside">{aside}</span> : null}
		</div>
	);
}

/**
 * A replay's progress. Pure: the parent feeds it new values and the DOM only
 * updates text and bar width, so nothing re-mounts or re-animates.
 */
export function ReplayProgressView({
	progress,
	minutesLeft,
	onRequeue,
	requeueBusy = false,
}: {
	progress: ReplayProgress;
	minutesLeft: number | null;
	onRequeue: () => void;
	requeueBusy?: boolean;
}) {
	const pct = replayPercent(progress);
	const blocks = progress.toBlock - progress.fromBlock + 1;
	if (progress.status === "failed") {
		return (
			<div className="mrp-prog">
				<div className="mrp-s">
					The replay stopped: {progress.error ?? "unknown error"}
				</div>
			</div>
		);
	}
	if (progress.status === "done") {
		const gaveUp = progress.gaveUp ?? 0;
		return (
			<>
				<div className="mrp-prog">
					<div className="mrp-n">
						<span>{fmt(progress.delivered ?? 0)}</span>{" "}
						<small>
							delivered
							{gaveUp > 0 ? (
								<>
									{" · "}
									<span className="is-bad">{fmt(gaveUp)} gave up</span>
								</>
							) : null}
						</small>
					</div>
					<Bar pct={100} />
					<div className="mrp-s">
						{gaveUp > 0
							? "Requeue sends the ones that gave up again. They go out with live events."
							: "Everything was delivered."}
					</div>
				</div>
				{gaveUp > 0 ? (
					<button
						type="button"
						className="mrp-btn is-pri"
						disabled={requeueBusy}
						onClick={onRequeue}
					>
						{requeueBusy ? "Requeueing…" : `Requeue ${fmt(gaveUp)}`}
					</button>
				) : null}
			</>
		);
	}
	return (
		<>
			<div className="mrp-prog">
				<div className="mrp-n">
					<span>{fmt(progress.processed)}</span>{" "}
					<small>of {fmt(progress.total)} sent</small>
				</div>
				<Bar pct={pct} />
				<div className="mrp-s">
					{progress.status === "scanning"
						? "Finding the events in this range."
						: `${minutesLeft === null ? "" : `About ${minutesLeft} min left. `}You can leave; this keeps going.`}
				</div>
			</div>
			<div className="mrp-steps">
				<Step done index={1}>
					Queued {fmt(progress.total)} events from {fmt(blocks)} blocks
				</Step>
				<Step
					index={<Dot kind="run" />}
					aside={<span className="mrp-pct">{pct}%</span>}
				>
					Delivering
				</Step>
				<Step index={3}>
					<span className="mrp-dim">Done</span>
				</Step>
			</div>
		</>
	);
}

function Gate({ onClose }: { onClose: () => void }) {
	return (
		<>
			<div className="mrp-note">
				<b>
					<Dot kind="bad" />
					Your server is still failing
				</b>
				<span>
					A replay now would fail too. Send a test, then resume, then replay.
				</span>
			</div>
			<button type="button" className="mrp-btn" onClick={onClose}>
				Close
			</button>
		</>
	);
}

/** True when the preset reaches back past what the outbox keeps. */
const isLowerBound = (blocks: number) => blocks === 10000;

function Picker({
	ranges,
	selected,
	busy,
	onSelect,
	onStart,
}: {
	ranges: ReplayRanges;
	selected: number;
	busy: boolean;
	onSelect: (blocks: number) => void;
	onStart: () => void;
}) {
	if (ranges.tip === null || ranges.presets.length === 0) {
		return (
			<div className="mrp-note">
				<span>The webhook hasn't seen a block yet.</span>
			</div>
		);
	}
	const chosen =
		ranges.presets.find((p) => p.blocks === selected) ?? ranges.presets[0];
	return (
		<>
			<div
				className="mrp-radios"
				role="radiogroup"
				aria-label="Blocks to replay"
			>
				{ranges.presets.map((preset) => (
					<button
						key={preset.blocks}
						type="button"
						// biome-ignore lint/a11y/useSemanticElements: a styled row, not a native radio input
						role="radio"
						aria-checked={preset.blocks === chosen?.blocks}
						className="mrp-radio"
						onClick={() => onSelect(preset.blocks)}
					>
						<span className="mrp-ring" aria-hidden="true" />
						<span className="mrp-radio-text">
							<b>Last {fmt(preset.blocks)} blocks</b>
							<span>
								blocks {fmt(preset.fromBlock)} → {fmt(preset.toBlock)}
							</span>
						</span>
					</button>
				))}
			</div>
			{chosen ? (
				<p className="mrp-est">
					{estimateLine(chosen.knownEvents, isLowerBound(chosen.blocks))}
				</p>
			) : null}
			<p className="mrp-p">
				Live events go out first. The replay gets 10% of delivery speed. Pick
				exact blocks on desktop.
			</p>
			{chosen ? (
				<button
					type="button"
					className="mrp-btn is-pri"
					disabled={busy}
					onClick={onStart}
				>
					{busy ? "Starting…" : `Replay ${fmt(chosen.blocks)} blocks`}
				</button>
			) : null}
		</>
	);
}

/** The sheet's body for a view. Pure, so the Lab and tests render it directly. */
export function ReplayBody({
	view,
	onClose,
	onSelect,
	onStart,
	onRequeue,
}: {
	view: ReplayView;
	onClose: () => void;
	onSelect: (blocks: number) => void;
	onStart: () => void;
	onRequeue: () => void;
}) {
	switch (view.kind) {
		case "loading":
			return <p className="mrp-p">Loading…</p>;
		case "gated":
			return <Gate onClose={onClose} />;
		case "error":
			return (
				<>
					<p className="mrp-p">{view.message}</p>
					<button type="button" className="mrp-btn" onClick={onClose}>
						Close
					</button>
				</>
			);
		case "picker":
			return (
				<Picker
					ranges={view.ranges}
					selected={view.selected}
					busy={view.busy}
					onSelect={onSelect}
					onStart={onStart}
				/>
			);
		case "progress":
			return (
				<>
					<ReplayProgressView
						progress={view.progress}
						minutesLeft={view.minutesLeft}
						onRequeue={onRequeue}
						requeueBusy={view.requeueBusy}
					/>
					{view.progress.status === "failed" ? (
						<button type="button" className="mrp-btn" onClick={onClose}>
							Close
						</button>
					) : null}
				</>
			);
	}
}

/**
 * Requeue what a finished replay gave up. On success the replay's record goes
 * back to running; `onProgress` receives that so the view moves at once, and
 * the next poll corrects the counts.
 */
export function useReplayRequeue(
	progress: ReplayProgress | null,
	onProgress?: (next: ReplayProgress) => void,
): { busy: boolean; requeue: () => void } {
	const [busy, setBusy] = useState(false);
	const requeue = useCallback(async () => {
		if (!progress || busy) return;
		setBusy(true);
		const res = await requeueDead(progress.webhookId, {
			replayId: progress.replayId,
		});
		setBusy(false);
		if (res.kind !== "ok") {
			toast.error("Couldn't requeue", {
				description:
					res.kind === "error" ? res.message : "Try again in a moment.",
			});
			return;
		}
		toast.success(
			`Requeued ${fmt(res.data.requeued)}. They go out with live events.`,
		);
		if (res.data.requeued > 0) {
			const next: ReplayProgress = {
				...progress,
				status: "running",
				delivered: null,
				gaveUp: null,
				finishedAt: null,
				pending: res.data.requeued,
				processed: Math.max(0, progress.total - res.data.requeued),
			};
			noteReplayStarted(next);
			onProgress?.(next);
		}
	}, [progress, busy, onProgress]);
	return { busy, requeue };
}

/**
 * Start a replay of a block range and watch it finish, in one sheet. The sheet
 * stays mounted from picker to done; only the values inside it change.
 */
export function ReplaySheet({
	webhook,
	open,
	onClose,
}: {
	webhook: ReplayWebhook;
	open: boolean;
	onClose: () => void;
}) {
	const gated = displayStatus(webhook) === "error";
	const [loaded, setLoaded] = useState<
		{ ranges: ReplayRanges } | { error: string } | null
	>(null);
	const [selected, setSelected] = useState(DEFAULT_PRESET);
	const [starting, setStarting] = useState(false);
	const [progress, setProgress] = useState<ReplayProgress | null>(null);
	const minutesLeft = useMinutesLeft(progress);
	const webhookId = webhook.id;

	// Each time the sheet opens: forget the last run, then read this webhook's.
	useEffect(() => {
		if (!open || gated) return;
		let cancelled = false;
		setLoaded(null);
		setProgress(null);
		setSelected(DEFAULT_PRESET);
		getReplays(webhookId).then((res) => {
			if (cancelled) return;
			if (res.kind !== "ok") {
				setLoaded({ error: "Couldn't load the replay ranges. Try again." });
				return;
			}
			const newest = res.data.data[0];
			setLoaded({ ranges: res.data.ranges });
			if (newest && isReplayActive(newest)) setProgress(newest);
		});
		return () => {
			cancelled = true;
		};
	}, [open, gated, webhookId]);

	const replayId = progress?.replayId ?? null;
	const watching = progress !== null && isReplayActive(progress);
	useEffect(() => {
		if (!open || !replayId || !watching) return;
		let cancelled = false;
		const stop = poll(async () => {
			const res = await getReplay(webhookId, replayId);
			if (cancelled || res.kind !== "ok") return undefined;
			setProgress(res.data);
			noteReplayStarted(res.data);
			return undefined;
		}, POLL_MS);
		return () => {
			cancelled = true;
			stop();
		};
	}, [open, replayId, watching, webhookId]);

	const start = useCallback(async () => {
		if (!loaded || "error" in loaded) return;
		const preset = loaded.ranges.presets.find((p) => p.blocks === selected);
		if (!preset || starting) return;
		setStarting(true);
		const res = await startReplay(webhookId, {
			fromBlock: preset.fromBlock,
			toBlock: preset.toBlock,
		});
		setStarting(false);
		if (res.kind !== "ok") {
			toast.error("Couldn't start the replay", {
				description:
					res.kind === "error" ? res.message : "Try again in a moment.",
			});
			return;
		}
		const started: ReplayProgress = {
			replayId: res.data.replayId,
			webhookId,
			status: "scanning",
			fromBlock: preset.fromBlock,
			toBlock: preset.toBlock,
			total: res.data.enqueuedCount,
			processed: 0,
			pending: res.data.enqueuedCount,
			delivered: null,
			gaveUp: null,
			startedAt: new Date().toISOString(),
			finishedAt: null,
			error: null,
		};
		noteReplayStarted(started);
		setProgress(started);
	}, [loaded, selected, starting, webhookId]);

	const { busy: requeueBusy, requeue } = useReplayRequeue(
		progress,
		setProgress,
	);

	let view: ReplayView;
	if (progress) {
		view = { kind: "progress", progress, minutesLeft, requeueBusy };
	} else if (gated) {
		view = { kind: "gated" };
	} else if (loaded === null) {
		view = { kind: "loading" };
	} else if ("error" in loaded) {
		view = { kind: "error", message: loaded.error };
	} else {
		view = {
			kind: "picker",
			ranges: loaded.ranges,
			selected,
			busy: starting,
		};
	}

	return (
		<Sheet
			open={open}
			onClose={onClose}
			eyebrow={<span className="mrp-mono">{webhook.name}</span>}
			title={replayTitle(view)}
		>
			<div className="mrp">
				<ReplayBody
					view={view}
					onClose={onClose}
					onSelect={setSelected}
					onStart={start}
					onRequeue={requeue}
				/>
			</div>
		</Sheet>
	);
}
