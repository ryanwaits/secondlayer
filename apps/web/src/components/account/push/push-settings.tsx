"use client";

import { Skel } from "@/components/dashboard/shell/skel";
import {
	type PushState,
	readPushState,
	turnOffPush,
	turnOnPush,
} from "@/lib/push-client";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type PushPrefValues = {
	webhookFailing: boolean;
	subgraphStopped: boolean;
	subgraphNotServing: boolean;
	replayDone: boolean;
	spendCap: boolean;
	keyRepeat: boolean;
};

type Toggle = { key: keyof PushPrefValues; title: string; sub: string };

const INGESTION: Toggle[] = [
	{
		key: "webhookFailing",
		title: "A webhook is failing",
		sub: "Your server stops answering, or we pause it",
	},
	{
		key: "subgraphStopped",
		title: "A subgraph stops ingesting",
		sub: "It's halted or hits its error limit",
	},
	{
		key: "subgraphNotServing",
		title: "A subgraph stops serving",
		sub: "Reads to it fail",
	},
];
const STARTED: Toggle[] = [
	{
		key: "replayDone",
		title: "A replay finishes",
		sub: "With what got delivered and what gave up",
	},
];
const FEED_ONLY: Toggle[] = [
	{
		key: "spendCap",
		title: "Spend nears your cap",
		sub: "The 80% email still goes out",
	},
	{
		key: "keyRepeat",
		title: "A key reads on repeat",
		sub: "Polling the same rows",
	},
];

function Section({
	title,
	caption,
	toggles,
	prefs,
	onToggle,
}: {
	title: string;
	caption?: string;
	toggles: Toggle[];
	prefs: PushPrefValues;
	onToggle: (key: keyof PushPrefValues) => void;
}) {
	return (
		<>
			<div className="mac-sec">
				<b>{title}</b>
				{caption ? <span>{caption}</span> : null}
			</div>
			<div className="mac-group">
				{toggles.map((t) => (
					<button
						key={t.key}
						type="button"
						role="switch"
						aria-checked={prefs[t.key]}
						className="mac-tgrow"
						onClick={() => onToggle(t.key)}
					>
						<span className="mac-tgrow-main">
							<b>{t.title}</b>
							<span>{t.sub}</span>
						</span>
						<span className="mac-tg" aria-hidden="true" />
					</button>
				))}
			</div>
		</>
	);
}

function DeviceRow({
	state,
	busy,
	onTurnOn,
}: {
	state: PushState;
	busy: boolean;
	onTurnOn: () => void;
}): ReactNode {
	if (state === "unavailable") {
		return (
			<div className="mac-kv mac-sub">Push isn't set up on this server.</div>
		);
	}
	if (state === "unsupported") {
		return <div className="mac-kv mac-sub">This browser can't show push.</div>;
	}
	const dot =
		state === "on" ? (
			<span className="dash-dot" />
		) : state === "off" ? null : (
			<span className="mac-dot is-ring" />
		);
	return (
		<div className="mac-kv">
			<span className="mac-k mac-ink">
				{dot}
				This device
			</span>
			{state === "off" ? (
				<button
					type="button"
					className="mac-link"
					disabled={busy}
					onClick={onTurnOn}
				>
					Turn on
				</button>
			) : (
				<span className="mac-v mac-sub">
					{state === "on"
						? "push on"
						: state === "blocked"
							? "blocked in settings"
							: "add to Home Screen first"}
				</span>
			)}
		</div>
	);
}

/** The Push segment's markup without the fetching, so tests and the Lab render it. */
export function PushSettingsView({
	state,
	prefs,
	ios = false,
	busy = false,
	onToggle,
	onTurnOn,
	onTurnOff,
}: {
	state: PushState;
	prefs: PushPrefValues;
	/** On iOS the home-screen hint stays until push is on. */
	ios?: boolean;
	busy?: boolean;
	onToggle: (key: keyof PushPrefValues) => void;
	onTurnOn: () => void;
	onTurnOff: () => void;
}) {
	const switches = state !== "unavailable" && state !== "unsupported";
	return (
		<div className="mac">
			<div className="mac-group">
				<DeviceRow state={state} busy={busy} onTurnOn={onTurnOn} />
			</div>
			{state === "on" ? (
				<button
					type="button"
					className="mac-link mac-link-solo"
					disabled={busy}
					onClick={onTurnOff}
				>
					Turn off
				</button>
			) : null}
			{switches ? (
				<>
					<Section
						title="Ingestion"
						caption="on by default"
						toggles={INGESTION}
						prefs={prefs}
						onToggle={onToggle}
					/>
					<Section
						title="Things you started"
						toggles={STARTED}
						prefs={prefs}
						onToggle={onToggle}
					/>
					<Section
						title="Feed only"
						caption="off by default"
						toggles={FEED_ONLY}
						prefs={prefs}
						onToggle={onToggle}
					/>
				</>
			) : null}
			{state === "needs_install" || (ios && state !== "on") ? (
				<p className="m-sub mac-hint">
					Push needs the app on your home screen. On iPhone: Share, then Add to
					Home Screen.
				</p>
			) : null}
		</div>
	);
}

function PushSkeleton() {
	return (
		<div className="mac" aria-hidden="true">
			<div className="mac-group">
				<div className="mac-skel-row">
					<Skel width="40%" height={14} />
				</div>
			</div>
			<div className="mac-group">
				{[0, 1, 2].map((i) => (
					<div key={i} className="mac-skel-row">
						<span className="mac-skel-text">
							<Skel width="55%" height={14} />
							<Skel width="75%" height={12} />
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

type Loaded = { publicKey: string | null; prefs: PushPrefValues };

/** The phone's Push segment: this device's state and the six toggles. */
export function PushSettings() {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [state, setState] = useState<PushState>("off");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const ios =
		typeof navigator !== "undefined" &&
		/iPad|iPhone|iPod/.test(navigator.userAgent);

	useEffect(() => {
		let live = true;
		(async () => {
			try {
				const res = await fetch("/api/push/prefs");
				if (!res.ok) throw new Error("prefs");
				const data = (await res.json()) as Loaded;
				if (!live) return;
				setLoaded(data);
				setState(await readPushState(data.publicKey));
			} catch {
				if (live) setFailed(true);
			}
		})();
		return () => {
			live = false;
		};
	}, []);

	const toggle = useCallback(
		async (key: keyof PushPrefValues) => {
			if (!loaded) return;
			const before = loaded.prefs;
			const next = { ...before, [key]: !before[key] };
			setLoaded({ ...loaded, prefs: next });
			try {
				const res = await fetch("/api/push/prefs", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ [key]: next[key] }),
				});
				if (!res.ok) throw new Error("save");
			} catch {
				setLoaded((cur) => (cur ? { ...cur, prefs: before } : cur));
				toast.error("Couldn't save. Try again.");
			}
		},
		[loaded],
	);

	const run = useCallback(
		async (action: () => Promise<void>, message: string) => {
			setBusy(true);
			try {
				await action();
			} catch {
				toast.error(message);
			}
			setState(await readPushState(loaded?.publicKey ?? null));
			setBusy(false);
		},
		[loaded?.publicKey],
	);

	if (failed) {
		return (
			<div className="mac">
				<p className="m-sub">Couldn't load push settings. Try again.</p>
			</div>
		);
	}
	if (!loaded) return <PushSkeleton />;
	return (
		<PushSettingsView
			state={state}
			prefs={loaded.prefs}
			ios={ios}
			busy={busy}
			onToggle={toggle}
			onTurnOn={() => {
				const key = loaded.publicKey;
				if (key) run(() => turnOnPush(key), "Couldn't turn on push.");
			}}
			onTurnOff={() => run(turnOffPush, "Couldn't turn off push.")}
		/>
	);
}
