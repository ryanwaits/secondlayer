"use client";

import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { Skel } from "@/components/dashboard/shell/skel";
import { HoldButton } from "@/components/mobile/hold-button";
import { Sheet } from "@/components/mobile/sheet";
import { SwipeGroup, SwipeRow } from "@/components/mobile/swipe-row";
import { formatDate, revokeKey } from "@/lib/account-data";
import { shortCount } from "@/lib/subgraph-view";
import type { ApiKey } from "@/lib/types";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { agoShort, groupKeys, keyFlags, revokedOwnKeys } from "./key-view";

const DAY = 86_400_000;
const CHART_DAYS = 30;

type KeyLook = { dot: "ok" | "ring" | "off"; line: string };

/** The dot and the one line a key shows: when it was last used, or why it is quiet. */
export function keyLook(k: ApiKey, now: Date): KeyLook {
	if (k.status === "revoked") return { dot: "off", line: "Revoked" };
	const { staleDays } = keyFlags(k, now);
	if (staleDays !== undefined) {
		return { dot: "ring", line: `Unused for ${staleDays} days` };
	}
	if (!k.lastUsedAt) return { dot: "ok", line: "Never used" };
	const used = `Used ${agoShort(k.lastUsedAt, now)} ago`;
	return {
		dot: "ok",
		line:
			k.rows30d === undefined
				? used
				: `${used} · ${shortCount(k.rows30d)} rows 30d`,
	};
}

/** The keys the phone lists: the ones you made, in use first, revoked last. */
export function phoneKeys(keys: ApiKey[], now: Date): ApiKey[] {
	return [
		...groupKeys(keys, now).own.filter((k) => k.product !== "docs"),
		...revokedOwnKeys(keys),
	];
}

function Dot({ dot }: { dot: KeyLook["dot"] }) {
	return <span className={dot === "ok" ? "dash-dot" : `mac-dot is-${dot}`} />;
}

function Chevron() {
	return (
		<svg
			className="mac-chev"
			width="8"
			height="14"
			viewBox="0 0 8 14"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M1 1l6 6-6 6" />
		</svg>
	);
}

function RowSkeleton() {
	return (
		<div className="mac-skel-row" aria-hidden="true">
			<Skel width={8} height={8} style={{ borderRadius: "50%" }} />
			<span className="mac-skel-text">
				<Skel width="46%" height={14} />
				<Skel width="72%" height={12} />
			</span>
		</div>
	);
}

function KeyFace({ k, now }: { k: ApiKey; now: Date }) {
	const look = keyLook(k, now);
	return (
		<div className="mac-key">
			<Dot dot={look.dot} />
			<span className="mac-key-main">
				<span
					className={`mac-key-name${k.status === "revoked" ? " is-revoked" : ""}`}
				>
					{k.name}
				</span>
				<span className="mac-key-prefix">{k.prefix}…</span>
				<span className="mac-faint">{look.line}</span>
			</span>
			<Chevron />
		</div>
	);
}

/** The phone's key list: tap or swipe a key to open its sheet. */
export function KeysCompactList({
	keys,
	now,
	onOpen,
}: {
	keys: ApiKey[] | null;
	now: Date;
	onOpen: (id: string) => void;
}) {
	if (keys === null) {
		return (
			<div className="mac">
				<div className="mac-group">
					<RowSkeleton />
					<RowSkeleton />
					<RowSkeleton />
				</div>
			</div>
		);
	}
	const listed = phoneKeys(keys, now);
	if (listed.length === 0) {
		return (
			<div className="mac">
				<div className="m-empty">
					<b>No keys yet</b>
					<p>Make your first key on desktop.</p>
				</div>
			</div>
		);
	}
	return (
		<div className="mac">
			<SwipeGroup>
				<div className="mac-group">
					{listed.map((k) =>
						k.status === "revoked" ? (
							<button
								key={k.id}
								type="button"
								className="mac-plain"
								onClick={() => onOpen(k.id)}
							>
								<KeyFace k={k} now={now} />
							</button>
						) : (
							<SwipeRow
								key={k.id}
								id={k.id}
								onTap={() => onOpen(k.id)}
								actions={[
									{
										label: "Revoke",
										tone: "alarm",
										onAction: () => onOpen(k.id),
									},
								]}
							>
								<KeyFace k={k} now={now} />
							</SwipeRow>
						),
					)}
				</div>
			</SwipeGroup>
			<p className="m-sub mac-hint">New keys are made on desktop.</p>
		</div>
	);
}

const shortDay = (date: Date) =>
	date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

/** The key sheet's contents: reads, facts, and the hold that revokes. */
export function KeySheetBody({
	k,
	now,
	busy = false,
	error = null,
	onRevoke,
}: {
	k: ApiKey;
	now: Date;
	busy?: boolean;
	error?: string | null;
	onRevoke: () => void;
}): ReactNode {
	const revoked = k.status === "revoked";
	const reads = k.rowsDaily?.some((n) => n > 0) ? k.rowsDaily : null;
	return (
		<>
			<div className="mac-group">
				<div className="mac-chart">
					<span className="mac-faint">Rows read per day, 30 days</span>
					{reads ? (
						<Sparkline
							points={reads}
							width={320}
							height={48}
							title={`${k.name}, rows read per day`}
						/>
					) : (
						<span className="mac-faint">No reads</span>
					)}
					<span className="mac-axis-row mac-faint">
						<span>
							{shortDay(new Date(now.getTime() - (CHART_DAYS - 1) * DAY))}
						</span>
						<span>today</span>
					</span>
				</div>
				<div className="mac-kv">
					<span className="mac-k">Key</span>
					<span className="mac-v mac-mono">{k.prefix}…</span>
				</div>
				<div className="mac-kv">
					<span className="mac-k">Last used</span>
					<span className="mac-v">
						{k.lastUsedAt ? `${agoShort(k.lastUsedAt, now)} ago` : "never"}
					</span>
				</div>
				<div className="mac-kv">
					<span className="mac-k">Created</span>
					<span className="mac-v">{formatDate(k.createdAt)}</span>
				</div>
			</div>
			{revoked ? (
				<p className="mac-fine">Calls with it get 401 KEY_REVOKED.</p>
			) : (
				<>
					<p className="mac-fine">
						Calls with this key get 401 KEY_REVOKED from the moment you revoke
						it. You can't undo this. Make a new key on desktop.
					</p>
					{error ? <p className="mac-error">{error}</p> : null}
					<HoldButton
						label={`Hold to revoke ${k.name}`}
						onConfirm={onRevoke}
						disabled={busy}
					/>
				</>
			)}
		</>
	);
}

/** Sheet title block: the dot and kind above, the name in mono below. */
export function keySheetHead(k: ApiKey, now: Date) {
	const look = keyLook(k, now);
	return {
		eyebrow: (
			<>
				<Dot dot={look.dot} />
				{k.status === "revoked" ? "Revoked" : "API key"}
			</>
		),
		title: <span className="mac-sheet-name">{k.name}</span>,
	};
}

function KeySheet({
	k,
	now,
	onClose,
}: {
	k: ApiKey;
	now: Date;
	onClose: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function revoke() {
		setBusy(true);
		setError(null);
		try {
			await revokeKey(k.id);
			toast.success(`Revoked ${k.name}. Calls with it now get 401.`);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't revoke that key");
			setBusy(false);
		}
	}
	return (
		<Sheet open onClose={onClose} {...keySheetHead(k, now)}>
			<KeySheetBody
				k={k}
				now={now}
				busy={busy}
				error={error}
				onRevoke={revoke}
			/>
		</Sheet>
	);
}

/** /account/keys on a phone: the list, and a sheet to revoke with a hold. */
export function KeysCompact({
	keys,
	now,
}: {
	keys: ApiKey[] | null;
	now: Date;
}) {
	const [openId, setOpenId] = useState<string | null>(null);
	const open = openId ? (keys ?? []).find((k) => k.id === openId) : undefined;
	return (
		<>
			<KeysCompactList keys={keys} now={now} onOpen={setOpenId} />
			{open ? (
				<KeySheet
					key={open.id}
					k={open}
					now={now}
					onClose={() => setOpenId(null)}
				/>
			) : null}
		</>
	);
}
