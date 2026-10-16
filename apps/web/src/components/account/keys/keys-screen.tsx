"use client";

import {
	formatDate,
	refreshKeys,
	revokeKey,
	useAccountData,
} from "@/lib/account-data";
import type { ApiKey } from "@/lib/types";
import { useEffect, useState } from "react";
import { NameKeyForm, NewKeyCard } from "../keys-panel";
import { ageShort } from "../webhooks/view";
import { groupKeys, keyFlags, keyForLabel } from "./key-view";

function KeyDetail({ k, now }: { k: ApiKey; now: Date }) {
	const flags = keyFlags(k, now);
	if (flags.expiresInHours !== undefined) {
		return (
			<span className="ky-sub">
				Expires in {flags.expiresInHours}h · read-only
			</span>
		);
	}
	return <span className="ky-faint">Created {formatDate(k.createdAt)}</span>;
}

function KeyRow({
	k,
	now,
	revocable,
	onRevoke,
}: {
	k: ApiKey;
	now: Date;
	revocable: boolean;
	onRevoke: () => void;
}) {
	const { staleDays } = revocable ? keyFlags(k, now) : {};
	return (
		<div className="ky-row">
			<span className="ky-name">
				<span className="ky-nm">{k.name}</span>
				{staleDays !== undefined ? (
					<span className="ky-sub">
						<span className="dash-dot idle" />
						Unused for {staleDays} days
						<button type="button" className="ky-link" onClick={onRevoke}>
							Revoke
						</button>
					</span>
				) : (
					<KeyDetail k={k} now={now} />
				)}
			</span>
			<code className="ky-prefix">{k.prefix}…</code>
			<span className="ky-faint">{keyForLabel(k.product)}</span>
			<span className="ky-faint ky-r">{ageShort(k.lastUsedAt)}</span>
			<span className="ky-r">
				{revocable && staleDays === undefined ? (
					<button type="button" className="ky-link" onClick={onRevoke}>
						Revoke
					</button>
				) : null}
			</span>
		</div>
	);
}

function RevokeConfirm({
	k,
	onDone,
}: {
	k: ApiKey;
	onDone: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function revoke() {
		setBusy(true);
		setError(null);
		try {
			await revokeKey(k.id);
			onDone();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't revoke that key");
			setBusy(false);
		}
	}
	return (
		<div className="acct-revoke-confirm">
			<p>
				<strong>Revoke {k.name}?</strong> Anything using it stops working right
				away. This can't be undone.
			</p>
			<div className="acct-row-actions">
				<button
					type="button"
					className="acct-btn danger small"
					onClick={revoke}
					disabled={busy}
				>
					{busy ? "Revoking..." : "Revoke key"}
				</button>
				<button
					type="button"
					className="acct-btn line small"
					onClick={onDone}
					disabled={busy}
				>
					Cancel
				</button>
			</div>
			{error ? <p className="acct-error">{error}</p> : null}
		</div>
	);
}

/** The keys table: yours first, then the ones made for you, which can't be revoked here. */
export function KeysTable({
	keys,
	now,
}: {
	/** Null until the list has loaded. */
	keys: ApiKey[] | null;
	now: Date;
}) {
	const [confirming, setConfirming] = useState<string | null>(null);
	if (keys === null) return <p className="acct-muted">Loading keys...</p>;
	const { own, madeForYou } = groupKeys(keys, now);

	const rows = (list: ApiKey[], revocable: boolean) =>
		list.map((k) =>
			confirming === k.id ? (
				<RevokeConfirm key={k.id} k={k} onDone={() => setConfirming(null)} />
			) : (
				<KeyRow
					key={k.id}
					k={k}
					now={now}
					revocable={revocable}
					onRevoke={() => setConfirming(k.id)}
				/>
			),
		);

	return (
		<div className="ky-table">
			<div className="ky-row ky-head">
				<span>Name</span>
				<span>Key</span>
				<span>For</span>
				<span className="ky-r">Last used</span>
				<span />
			</div>
			{own.length === 0 ? (
				<p className="acct-muted ky-empty">No keys yet.</p>
			) : null}
			{rows(own, true)}
			{madeForYou.length > 0 ? (
				<>
					<div className="ky-group">Made for you · can't be revoked here</div>
					{rows(madeForYou, false)}
				</>
			) : null}
		</div>
	);
}

/** /account/keys: every key on the account, and a new one when you need it. */
export function KeysScreen({ handedOver }: { handedOver: string | null }) {
	const { keys } = useAccountData();
	const [naming, setNaming] = useState(false);
	const [newKey, setNewKey] = useState<string | null>(handedOver);

	useEffect(() => setNewKey(handedOver), [handedOver]);
	useEffect(() => {
		refreshKeys();
	}, []);

	return (
		<div className="ky-body">
			<div className="ky-top">
				<div className="wl-head">
					<h1>Keys</h1>
					<p>
						Keys for the SDK, the CLI and your agents. Revoked keys are hidden.
					</p>
				</div>
				{naming ? null : (
					<button
						type="button"
						className="acct-btn solid small"
						onClick={() => setNaming(true)}
					>
						New key
					</button>
				)}
			</div>
			{newKey ? <NewKeyCard value={newKey} /> : null}
			{naming ? (
				<NameKeyForm
					inline
					onCreated={(key) => {
						setNewKey(key);
						setNaming(false);
					}}
					onCancel={() => setNaming(false)}
					cancelLabel="Cancel"
				/>
			) : null}
			<KeysTable keys={keys} now={new Date()} />
		</div>
	);
}
