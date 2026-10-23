"use client";

import {
	type Activity,
	type ActivityDot,
	type ChainLevel,
	activities,
	activityDot,
	activityKey,
	chainLevel,
	nextDismissedLevel,
	pillLabel,
} from "@/lib/activity";
import { chainState, useChainTip } from "@/lib/chain-tip";
import { useRecentReplays } from "@/lib/replays";
import { useRequeuing } from "@/lib/requeuing";
import { useWebhooksCache } from "@/lib/webhooks-store";
import { useEffect, useMemo, useState } from "react";
import { ActivitySheet } from "./activity-sheet";

const DISMISSED_KEY = "sl.activity.chainDismissed";
const CLEARED_KEY = "sl.activity.cleared";

function readDismissed(): ChainLevel {
	try {
		const n = Number(sessionStorage.getItem(DISMISSED_KEY));
		return n >= 1 && n <= 4 ? (Math.floor(n) as ChainLevel) : 0;
	} catch {
		return 0;
	}
}

function readCleared(): ReadonlySet<string> {
	try {
		const raw = JSON.parse(sessionStorage.getItem(CLEARED_KEY) ?? "[]");
		return new Set(
			Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [],
		);
	} catch {
		return new Set();
	}
}

function write(key: string, value: string) {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		// Per-tab convenience only.
	}
}

/** The dot beside a pill or an activity: ok, bad, a hollow ring, or a spinner. */
export function PillDot({ kind }: { kind: ActivityDot }) {
	return <span className={`mrp-dot is-${kind}`} aria-hidden="true" />;
}

/**
 * The pill: the most urgent item's dot and short label, `+N` for the rest.
 * Hook-free so the Lab can render it with injected items. It animates in when
 * the set of items changes (a new key), never on a progress tick.
 */
export function StatusPillView({
	items,
	onOpen,
}: {
	items: readonly Activity[];
	onOpen: () => void;
}) {
	const first = items[0];
	if (!first) return null;
	const kinds = items
		.map((a) => (a.kind === "chain" ? `chain:${a.state.kind}` : activityKey(a)))
		.join(",");
	return (
		<button
			key={kinds}
			type="button"
			className="m-pill"
			aria-label="Activity"
			onClick={onOpen}
		>
			<PillDot kind={activityDot(first)} />
			<span>{pillLabel(first)}</span>
			{items.length > 1 ? (
				<span className="m-pill-more">+{items.length - 1}</span>
			) : null}
		</button>
	);
}

/** The status pill beside every phone screen title, with the Activity drawer behind it. */
export function StatusPill() {
	const tip = useChainTip();
	const replays = useRecentReplays();
	const requeuing = useRequeuing();
	const { list } = useWebhooksCache();
	const [now, setNow] = useState(() => Date.now());
	const [dismissedLevel, setDismissedLevel] =
		useState<ChainLevel>(readDismissed);
	const [cleared, setCleared] = useState<ReadonlySet<string>>(readCleared);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);

	const chain = chainState(tip, now);
	const chainKind = chain.kind;
	// Going live clears the dismissal; any other change keeps it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only the chain kind matters here
	useEffect(() => {
		setDismissedLevel((prev) => {
			const next = nextDismissedLevel(prev, chain);
			if (next !== prev) write(DISMISSED_KEY, String(next));
			return next;
		});
	}, [chainKind]);

	const items = useMemo(
		() =>
			activities({
				chain,
				dismissedLevel,
				replays: replays ?? [],
				cleared,
				now,
				requeuing,
			}),
		[chain, dismissedLevel, replays, cleared, now, requeuing],
	);

	// Nothing left to show: close the drawer.
	useEffect(() => {
		if (open && items.length === 0) setOpen(false);
	}, [open, items.length]);

	const names = useMemo(
		() => new Map((list?.data ?? []).map((w) => [w.id, w.name] as const)),
		[list],
	);

	return (
		<>
			<StatusPillView items={items} onOpen={() => setOpen(true)} />
			<ActivitySheet
				open={open}
				onClose={() => setOpen(false)}
				items={items}
				tip={tip}
				now={now}
				webhookName={(id) => names.get(id) ?? "webhook"}
				onDismissChain={() => {
					const level = chainLevel(chain);
					setDismissedLevel(level);
					write(DISMISSED_KEY, String(level));
				}}
				onClear={(replayId) => {
					const next = new Set(cleared).add(replayId);
					setCleared(next);
					write(CLEARED_KEY, JSON.stringify([...next]));
				}}
			/>
		</>
	);
}
