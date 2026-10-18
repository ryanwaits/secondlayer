"use client";

import { LazyBandBarChart } from "@/components/charts/lazy";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { PlaceholderRows } from "@/components/dashboard/shell/onboarding";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { useCompact } from "@/components/mobile/use-compact";
import {
	ensureApps,
	ensureKeys,
	formatDate,
	revokeKey,
	useAccountData,
} from "@/lib/account-data";
import { barsRows } from "@/lib/dashboard-charts";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import { keyState } from "@/lib/onboarding";
import { shortCount } from "@/lib/subgraph-view";
import type { ApiKey, ConnectedApp } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountCompactHeader } from "../compact-account";
import { AppsTable } from "./apps-table";
import { KeysCompact } from "./compact-keys";
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
import { NewKeyFlow } from "./new-key-flow";

/** How long a just-made key's row keeps its yellow dot. */
export const FRESH_MS = 9_000;
/** A key's prefix as the list shows it: `sk-sl_` plus 8 characters. */
const PREFIX_LENGTH = 14;

const FOOTER =
	"Lost a key? Revoke it and make another: we only ever show a key once.";

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
		return (
			<span className="ky-sub">
				<span className="dash-dot hi" />
				Unused for {flags.staleDays} days
			</span>
		);
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
}: {
	k: ApiKey;
	now: Date;
	onRevoke: () => void;
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
						<button
							type="button"
							className="acct-btn danger small"
							onClick={onRevoke}
						>
							Revoke
						</button>
						<p className="ky-faint">
							Stops working at once. Anything using it gets a 401.
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
}: {
	/** Null until the list has loaded. */
	keys: ApiKey[] | null;
	now: Date;
	/** The prefix of a key made a moment ago: first row, with a fading yellow dot. */
	freshPrefix?: string | null;
	initialOpen?: string | null;
	madeOpen?: boolean;
}) {
	const [open, setOpen] = useState<string | null>(initialOpen);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [revoked, setRevoked] = useState<
		{ id: string; name: string; at: number }[]
	>([]);
	if (keys === null) return <p className="acct-muted">Loading keys…</p>;
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
					<KeyPanel k={k} now={now} onRevoke={() => setConfirming(k.id)} />
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
}: KeysBodyProps) {
	const sentence =
		keys === null
			? { tone: "idle" as const, text: "Loading your keys.", sub: undefined }
			: keysSentence(keys, now, {
					revokedInUse: insights.some((i) => i.rule === "revoked_key_in_use"),
				});
	return (
		<div className="ky-body">
			<div className="ky-top">
				<StatusSentence tone={sentence.tone} sub={sentence.sub}>
					{sentence.text}
				</StatusSentence>
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
			/>
			{apps !== undefined ? <AppsTable apps={apps} now={now} /> : null}
		</div>
	);
}

/** The reasons the Keys tab shows. */
const KEY_RULES = ["key_unused", "revoked_key_in_use"];

/** /account/keys: every key on the account, and a new one when you need it. */
export function KeysScreen() {
	const { keys, apps } = useAccountData();
	const { data: allInsights } = useInsights();
	const compact = useCompact();
	const [creating, setCreating] = useState(false);
	const [freshPrefix, setFreshPrefix] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const now = new Date();

	useEffect(() => {
		ensureKeys();
		ensureApps();
	}, []);
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

	// An account that never made a key is offered the name step straight away.
	const firstRun = keyState(keys, now) === "first";
	const [offered, setOffered] = useState(false);
	if (firstRun && !offered) {
		setOffered(true);
		setCreating(true);
	}

	// The unused-key note is re-checked every 5 minutes; once no listed key is
	// stale (say, it was just revoked) it would only be out of date.
	const staleOwnKey = hasStaleOwnKey(keys, now);

	if (compact) {
		return (
			<>
				<AccountCompactHeader current="keys" />
				<KeysCompact keys={keys} now={now} />
			</>
		);
	}

	const existingNames = groupKeys(keys, now)
		.own.filter((k) => k.product !== "docs")
		.map((k) => k.name);
	const close = () => setCreating(false);

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
			onNew={() => setCreating(true)}
			flow={
				creating ? (
					<NewKeyFlow
						dismissible={!firstRun}
						existingNames={existingNames}
						onCreated={markFresh}
						onClose={close}
					/>
				) : null
			}
		/>
	);
}
