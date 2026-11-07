"use client";

import { LazyBandBarChart } from "@/components/charts/lazy";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { PlaceholderRows } from "@/components/dashboard/shell/onboarding";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { Sheet } from "@/components/mobile/sheet";
import { useCompact } from "@/components/mobile/use-compact";
import {
	CreateKeyError,
	ensureApps,
	ensureKeys,
	formatDate,
	refreshApps,
	refreshKeys,
	revokeKey,
	rotateKey,
	useAccountData,
} from "@/lib/account-data";
import { barsRows } from "@/lib/dashboard-charts";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import { keyState } from "@/lib/onboarding";
import { shortCount } from "@/lib/subgraph-view";
import type { ApiKey, ConnectedApp } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountCompactHeader } from "../compact-account";
import { LoadFailed } from "../load-failed";
import { AppsPanel } from "./apps-panel";
import { KeysCompact } from "./compact-keys";
import {
	KEY_FLOW_IDLE,
	KEY_FLOW_NAMING,
	keyActionsBlocked,
	keyFlowOpen,
} from "./key-flow";
import {
	agoShort,
	dayLabels,
	groupKeys,
	hasStaleOwnKey,
	keyFlags,
	keyForLabel,
	keyWhy,
	keysSentence,
	revokedOwnKeys,
} from "./key-view";
import { NewKeyFlow, createErrorMessage, useKeyFlow } from "./new-key-flow";

/** How long a just-made key's row keeps its yellow dot. */
export const FRESH_MS = 9_000;
/** A key's prefix as the list shows it: `sk-sl_` plus 8 characters. */
const PREFIX_LENGTH = 14;

const FOOTER =
	"Lost a key? Rotate it for a new one: we only ever show a key once.";

function KeySub({
	k,
	now,
	fresh,
}: {
	k: ApiKey;
	now: Date;
	fresh: boolean;
}) {
	const flags = keyFlags(k, now);
	if (flags.staleDays !== undefined) {
		return <span className="ky-sub">Unused for {flags.staleDays} days</span>;
	}
	if (flags.expiresInHours !== undefined) {
		return (
			<span className="ky-sub">
				Expires in {flags.expiresInHours}h · read-only
			</span>
		);
	}
	if (fresh && !k.lastUsedAt) {
		return <span className="ky-faint">Waiting for its first read</span>;
	}
	return <span className="ky-faint">Created {formatDate(k.createdAt)}</span>;
}

function KeySpark({ k }: { k: ApiKey }) {
	const daily = k.rowsDaily;
	if (!daily) return null;
	if (daily.every((n) => n === 0)) {
		return <span className="ky-faint">no reads</span>;
	}
	return <Sparkline points={daily} title={`${k.name}, rows read per day`} />;
}

function KeyPanel({
	k,
	now,
	onRevoke,
	onRotate,
}: {
	k: ApiKey;
	now: Date;
	onRevoke: () => void;
	/** Omitted where a key can't be rotated. */
	onRotate?: () => void;
}) {
	const flags = keyFlags(k, now);
	const docs = k.product === "docs";
	return (
		<div className="ky-panel">
			<div className="ky-chart">
				{k.rowsDaily ? (
					<>
						<div className="ky-chart-h">
							<span className="dash-label">Rows · 30 days</span>
							<Link href="/account/rows" className="dash-link">
								Rows ›
							</Link>
						</div>
						<div className="dc-chart">
							<LazyBandBarChart
								rows={barsRows(k.rowsDaily.map((n) => ({ n })))}
								height={120}
								xLabels={[
									[0, "-30d"],
									[15, "-15d"],
									[k.rowsDaily.length - 1, "today"],
								]}
								pointLabels={dayLabels(now, k.rowsDaily.length)}
								seriesNames={{ n: "Rows", p: "Paid", f: "Failed" }}
							/>
						</div>
					</>
				) : (
					<p className="ky-faint">No daily reads from this API yet.</p>
				)}
			</div>
			<div className="ky-side">
				<dl className="rw-kv">
					<div>
						<dt>Key</dt>
						<dd className="ky-mono">{k.prefix}…</dd>
					</div>
					<div>
						<dt>Created</dt>
						<dd>{formatDate(k.createdAt)}</dd>
					</div>
					<div>
						<dt>Last read</dt>
						<dd>{k.lastUsedAt ? formatDate(k.lastUsedAt) : "never"}</dd>
					</div>
					{k.rows30d !== undefined ? (
						<div>
							<dt>Rows · 30d</dt>
							<dd>{k.rows30d.toLocaleString("en-US")}</dd>
						</div>
					) : null}
					{flags.expiresInHours !== undefined ? (
						<div>
							<dt>Expires</dt>
							<dd>in {flags.expiresInHours}h</dd>
						</div>
					) : null}
				</dl>
				{docs ? (
					<p className="ky-faint">{keyWhy(k.product)}</p>
				) : (
					<div className="ky-revoke">
						<div className="acct-row-actions">
							{onRotate ? (
								<button
									type="button"
									className="acct-btn line small"
									onClick={onRotate}
								>
									Rotate
								</button>
							) : null}
							<button
								type="button"
								className="acct-btn danger small"
								onClick={onRevoke}
							>
								Revoke
							</button>
						</div>
						<p className="ky-faint">
							{onRotate
								? "Rotate gives this key a new secret and keeps its name. Revoke stops it with no replacement. Either way, the old secret gets a 401 at once."
								: "Stops working at once. Anything using it gets a 401."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function KeyRow({
	k,
	now,
	open,
	fresh,
	onToggle,
}: {
	k: ApiKey;
	now: Date;
	open: boolean;
	fresh: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			className="ky-row ky-click"
			aria-expanded={open}
			onClick={onToggle}
		>
			<span className="ky-name">
				<span className="ky-nm">
					{fresh ? <span className="ky-new" /> : null}
					{k.name}
				</span>
				<KeySub k={k} now={now} fresh={fresh} />
			</span>
			<code className="ky-prefix">{k.prefix}…</code>
			<span className="ky-spark">
				<KeySpark k={k} />
			</span>
			<span className="ky-r ky-count">
				{k.rows30d === undefined ? "–" : shortCount(k.rows30d)}
			</span>
			<span className="ky-faint ky-r">{agoShort(k.lastUsedAt, now)}</span>
		</button>
	);
}

/** Inline confirm. `onDone(true)` once the key is revoked, `onDone(false)` on Cancel. */
export function RevokeConfirm({
	k,
	onDone,
}: {
	k: ApiKey;
	onDone: (revoked: boolean) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function revoke() {
		setBusy(true);
		setError(null);
		try {
			await revokeKey(k.id);
			onDone(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't revoke that key");
			setBusy(false);
		}
	}
	return (
		<div className="acct-revoke-confirm">
			<p>
				<strong>Revoke {k.name}?</strong> Anything using it gets a 401 at once.
				You can't undo this; you can make a new key.
			</p>
			<div className="acct-row-actions">
				<button
					type="button"
					className="acct-btn danger small"
					onClick={revoke}
					disabled={busy}
				>
					{busy ? "Revoking…" : "Revoke key"}
				</button>
				<button
					type="button"
					className="acct-btn line small"
					onClick={() => onDone(false)}
					disabled={busy}
				>
					Cancel
				</button>
			</div>
			{error ? <p className="acct-error">{error}</p> : null}
		</div>
	);
}

/**
 * Inline confirm. `onDone` gets the new key once it is rotated, or null on
 * Cancel.
 */
export function RotateConfirm({
	k,
	onDone,
}: {
	k: ApiKey;
	onDone: (rotated: { key: string; name: string } | null) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function rotate() {
		setBusy(true);
		setError(null);
		try {
			onDone(await rotateKey(k.id));
		} catch (e) {
			setError(
				e instanceof CreateKeyError && e.status === 429
					? createErrorMessage(e)
					: e instanceof Error && e.message
						? e.message
						: "Couldn't rotate that key",
			);
			setBusy(false);
		}
	}
	return (
		<div className="acct-revoke-confirm">
			<p>
				<strong>Rotate {k.name}?</strong> Anything using {k.prefix}… gets a 401
				at once. We'll show the new key once, keeping the name {k.name}.
			</p>
			<div className="acct-row-actions">
				<button
					type="button"
					className="acct-btn solid small"
					onClick={rotate}
					disabled={busy}
				>
					{busy ? "Rotating…" : "Rotate key"}
				</button>
				<button
					type="button"
					className="acct-btn line small"
					onClick={() => onDone(null)}
					disabled={busy}
				>
					Cancel
				</button>
			</div>
			{error ? <p className="acct-error">{error}</p> : null}
		</div>
	);
}

function MadeForYou({
	keys,
	now,
	defaultOpen,
}: {
	keys: ApiKey[];
	now: Date;
	defaultOpen: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	if (keys.length === 0) return null;
	return (
		<>
			<button
				type="button"
				className="ky-made"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span>
					{keys.length} {keys.length === 1 ? "key" : "keys"} made for you ·
					can't be revoked here
				</span>
			</button>
			{open
				? keys.map((k) => (
						<div key={k.id} className="ky-mrow">
							<span className="ky-name">
								<span className="ky-nm">{k.name}</span>
								<span className="ky-faint">{keyWhy(k.product)}</span>
							</span>
							<code className="ky-prefix">{k.prefix}…</code>
							<span className="ky-faint">{keyForLabel(k.product)}</span>
							<span className="ky-faint ky-r">
								{agoShort(k.lastUsedAt, now)}
							</span>
						</div>
					))
				: null}
		</>
	);
}

/** The empty row once every key is revoked, with the revoked ones a click away. */
function NoActiveRows({ keys }: { keys: ApiKey[] }) {
	const [open, setOpen] = useState(false);
	const gone = revokedOwnKeys(keys).sort((a, b) =>
		b.createdAt.localeCompare(a.createdAt),
	);
	return (
		<>
			<p className="ky-gone">Your next key shows up here.</p>
			<button
				type="button"
				className="ky-made"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span>{open ? "Hide revoked" : `Show ${gone.length} revoked`}</span>
			</button>
			{open
				? gone.map((k) => (
						<p key={k.id} className="ky-gone">
							{k.name} ({k.prefix}…)
						</p>
					))
				: null}
		</>
	);
}

/** The keys table: yours, then the ones made for you, which can't be revoked here. */
export function KeysTable({
	keys,
	now,
	freshPrefix = null,
	initialOpen = null,
	madeOpen = false,
	onRotated,
	onRotateBlocked,
	onRetry,
}: {
	/** Null until the list has loaded. */
	keys: ApiKey[] | null;
	now: Date;
	/** The prefix of a key made a moment ago: first row, with a fading yellow dot. */
	freshPrefix?: string | null;
	initialOpen?: string | null;
	madeOpen?: boolean;
	/** A key was rotated; omitted, rows offer no Rotate. */
	onRotated?: (key: string, name: string) => void;
	/** Set while a new key is unseen: Rotate calls it instead of asking to rotate. */
	onRotateBlocked?: () => void;
	/** Set when the list failed to load: shown with a Retry. */
	onRetry?: () => void;
}) {
	const [open, setOpen] = useState<string | null>(initialOpen);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [rotating, setRotating] = useState<string | null>(null);
	const [revoked, setRevoked] = useState<
		{ id: string; name: string; at: number }[]
	>([]);
	if (keys === null) {
		return onRetry ? (
			<LoadFailed what="your keys" onRetry={onRetry} />
		) : (
			<p className="acct-muted">Loading keys…</p>
		);
	}
	const state = keyState(keys, now);
	const grouped = groupKeys(keys, now);
	const own = [...grouped.own].sort(
		(a, b) =>
			Number(b.prefix === freshPrefix) - Number(a.prefix === freshPrefix),
	);

	const rows = own.map((k) => {
		if (confirming === k.id) {
			return (
				<RevokeConfirm
					key={k.id}
					k={k}
					onDone={(done) => {
						setConfirming(null);
						if (done) {
							setRevoked((r) => [
								...r,
								{ id: k.id, name: k.name, at: own.indexOf(k) },
							]);
						}
					}}
				/>
			);
		}
		if (rotating === k.id && onRotated) {
			return (
				<RotateConfirm
					key={k.id}
					k={k}
					onDone={(result) => {
						setRotating(null);
						if (result) onRotated(result.key, result.name);
					}}
				/>
			);
		}
		const isOpen = open === k.id;
		return (
			<div key={k.id}>
				<KeyRow
					k={k}
					now={now}
					open={isOpen}
					fresh={k.prefix === freshPrefix}
					onToggle={() => setOpen(isOpen ? null : k.id)}
				/>
				{isOpen ? (
					<KeyPanel
						k={k}
						now={now}
						onRevoke={() => setConfirming(k.id)}
						onRotate={
							onRotated && k.product === "account"
								? () =>
										onRotateBlocked ? onRotateBlocked() : setRotating(k.id)
								: undefined
						}
					/>
				) : null}
			</div>
		);
	});
	for (const line of [...revoked].sort((a, b) => b.at - a.at)) {
		rows.splice(
			Math.min(line.at, rows.length),
			0,
			<p key={`revoked-${line.id}`} className="ky-gone">
				{line.name} revoked.
			</p>,
		);
	}

	return (
		<div className="ky-table">
			<div className="ky-row ky-head">
				<span>Name</span>
				<span>Key</span>
				<span>Rows · 30d</span>
				<span className="ky-r">Count</span>
				<span className="ky-r">Last read</span>
			</div>
			{own.length === 0 && revoked.length === 0 && state === "first" ? (
				<PlaceholderRows rows={[{ name: "laptop" }, { name: "ci" }]} />
			) : null}
			{state === "none_active" && own.length === 0 ? (
				<NoActiveRows keys={keys} />
			) : null}
			{rows}
			<MadeForYou keys={grouped.madeForYou} now={now} defaultOpen={madeOpen} />
			<p className="ky-foot">{FOOTER}</p>
		</div>
	);
}

export interface KeysBodyProps {
	/** Null until the list has loaded. */
	keys: ApiKey[] | null;
	insights?: readonly Insight[];
	now: Date;
	freshPrefix?: string | null;
	/** Apps signed in to the hosted MCP; omitted, the section is not shown. */
	apps?: ConnectedApp[] | null;
	/** The create flow, when it is open. */
	flow?: React.ReactNode;
	onNew: () => void;
	initialOpen?: string | null;
	madeOpen?: boolean;
	/** A key was rotated: its new value, shown once. Omitted, rows offer no Rotate. */
	onRotated?: (key: string, name: string) => void;
	/** Set while a new key is unseen: Rotate calls it instead of asking to rotate. */
	onRotateBlocked?: () => void;
	/** Set when the keys failed to load: the list shows Retry, not "Loading". */
	onRetry?: () => void;
	/** Apps' load failed; set with `onRetryApps`. */
	appsFailed?: boolean;
	onRetryApps?: () => void;
}

/** Keys: one sentence, why a key went quiet, and a row per key. */
export function KeysBody({
	keys,
	insights = [],
	now,
	freshPrefix,
	apps,
	flow,
	onNew,
	initialOpen,
	madeOpen,
	onRotated,
	onRotateBlocked,
	onRetry,
	appsFailed,
	onRetryApps,
}: KeysBodyProps) {
	const sentence =
		keys === null
			? {
					text: onRetry ? "Your keys." : "Loading your keys.",
					sub: undefined,
				}
			: keysSentence(keys, now, {
					revokedInUse: insights.some((i) => i.rule === "revoked_key_in_use"),
				});
	return (
		<div className="ky-body">
			<div className="ky-top">
				<StatusSentence sub={sentence.sub}>{sentence.text}</StatusSentence>
				{flow ? null : (
					<button
						type="button"
						className="acct-btn solid small"
						onClick={onNew}
					>
						New key
					</button>
				)}
			</div>
			{flow}
			{insights.length > 0 ? (
				<div className="ky-notes">
					<ActionableInsights insights={insights} />
				</div>
			) : null}
			<KeysTable
				keys={keys}
				now={now}
				freshPrefix={freshPrefix}
				initialOpen={initialOpen}
				madeOpen={madeOpen}
				onRotated={onRotated}
				onRotateBlocked={onRotateBlocked}
				onRetry={onRetry}
			/>
			{keys !== null && apps !== undefined ? (
				<AppsPanel
					apps={apps}
					now={now}
					onRetry={appsFailed ? onRetryApps : undefined}
				/>
			) : null}
		</div>
	);
}

/** The reasons the Keys tab shows. */
const KEY_RULES = ["key_unused", "revoked_key_in_use"];

/** /account/keys: every key on the account, and a new one when you need it.
 *  `openNew` (`?new=1`, from the docs' "Make a lasting key") opens New key on
 *  load; the param is then dropped so a reload doesn't open it again. */
export function KeysScreen({ openNew = false }: { openNew?: boolean }) {
	const { keys, apps, status } = useAccountData();
	const { data: allInsights } = useInsights();
	const compact = useCompact();
	const router = useRouter();
	const now = new Date();
	// An account that never made a key is offered the name step straight away.
	const firstRun = keyState(keys, now) === "first";
	const [flow, dispatch] = useKeyFlow(
		openNew ? KEY_FLOW_NAMING : KEY_FLOW_IDLE,
		firstRun,
	);
	const flowTop = useRef<HTMLDivElement | null>(null);
	const [freshPrefix, setFreshPrefix] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		ensureKeys();
		ensureApps();
	}, []);
	useEffect(() => {
		if (openNew) router.replace("/account/keys", { scroll: false });
	}, [openNew, router]);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const markFresh = useCallback((key: string) => {
		setFreshPrefix(key.slice(0, PREFIX_LENGTH));
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setFreshPrefix(null), FRESH_MS);
	}, []);

	// The unused-key note is re-checked every 5 minutes; once no listed key is
	// stale (say, it was just revoked) it would only be out of date.
	const staleOwnKey = hasStaleOwnKey(keys, now);

	const existingNames = groupKeys(keys, now)
		.own.filter((k) => k.product !== "docs")
		.map((k) => k.name);
	const flowOpen = keyFlowOpen(flow);
	const newKeyFlow = (
		<NewKeyFlow
			flow={flow}
			dispatch={dispatch}
			dismissible={!firstRun}
			existingNames={existingNames}
			onCreated={markFresh}
		/>
	);

	// Phones list keys and leave making them to desktop, except where there is
	// no other way on: `?new=1` from the docs, or an account with no key yet.
	// Then the same flow opens in a sheet.
	if (compact) {
		return (
			<>
				<AccountCompactHeader current="keys" />
				<KeysCompact keys={keys} now={now} />
				{flowOpen ? (
					<Sheet
						open
						onClose={() => dispatch({ type: "close" })}
						eyebrow="API key"
						title="New key"
					>
						{newKeyFlow}
					</Sheet>
				) : null}
			</>
		);
	}

	return (
		<KeysBody
			keys={keys}
			insights={forAccountRules(
				allInsights,
				staleOwnKey ? KEY_RULES : ["revoked_key_in_use"],
			)}
			now={now}
			freshPrefix={freshPrefix}
			apps={apps}
			onRetry={status.keys === "error" ? refreshKeys : undefined}
			appsFailed={status.apps === "error"}
			onRetryApps={refreshApps}
			onNew={() => dispatch({ type: "open" })}
			onRotated={(key, name) => {
				markFresh(key);
				dispatch({ type: "rotated", key, name });
				requestAnimationFrame(() =>
					flowTop.current?.scrollIntoView({ block: "nearest" }),
				);
			}}
			onRotateBlocked={
				keyActionsBlocked(flow)
					? () => {
							dispatch({ type: "warn" });
							flowTop.current?.scrollIntoView({ block: "nearest" });
						}
					: undefined
			}
			flow={flowOpen ? <div ref={flowTop}>{newKeyFlow}</div> : null}
		/>
	);
}
