"use client";

import {
	activeKeys,
	createKey,
	formatDate,
	refreshKeys,
	revokeKey,
	useAccountData,
} from "@/lib/account-data";
import { handOverNewKey } from "@/lib/new-key";
import type { ApiKey } from "@/lib/types";
import { useEffect, useState } from "react";
import { FloatingCard } from "./floating-card";

/** A new key, shown once, with the one thing to do about it: copy it. */
export function NewKeyCard({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="acct-result">
			<p className="acct-result-title">Your API key</p>
			<p className="acct-result-line">
				Copy it now. It isn't stored, so this is the only time it's shown.
			</p>
			<div className="acct-copyrow">
				<code className="acct-field">{value}</code>
				<button
					type="button"
					className="acct-btn line"
					onClick={() => {
						navigator.clipboard.writeText(value).catch(() => {});
						setCopied(true);
						setTimeout(() => setCopied(false), 1400);
					}}
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}

/** The active keys, each revocable after an inline confirm. */
export function KeyList({ keys }: { keys: ApiKey[] | null }) {
	const [confirming, setConfirming] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const list = activeKeys(keys);

	if (keys === null) return <p className="acct-muted">Loading keys...</p>;
	if (list.length === 0) return <p className="acct-muted">No keys yet.</p>;

	async function revoke(k: ApiKey) {
		setBusy(true);
		setError(null);
		try {
			await revokeKey(k.id);
			setConfirming(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't revoke that key");
		} finally {
			setBusy(false);
		}
	}

	return (
		<ul className="acct-keys">
			{list.map((k) =>
				confirming === k.id ? (
					<li key={k.id} className="acct-revoke-confirm">
						<p>
							<strong>Revoke {k.name}?</strong> Anything using it stops working
							right away. This can't be undone.
						</p>
						<div className="acct-row-actions">
							<button
								type="button"
								className="acct-btn danger small"
								onClick={() => revoke(k)}
								disabled={busy}
							>
								{busy ? "Revoking..." : "Revoke key"}
							</button>
							<button
								type="button"
								className="acct-btn line small"
								onClick={() => setConfirming(null)}
								disabled={busy}
							>
								Cancel
							</button>
						</div>
						{error ? <p className="acct-error">{error}</p> : null}
					</li>
				) : (
					<li key={k.id} className="acct-key">
						<div className="acct-key-main">
							<span className="acct-key-name">{k.name}</span>
							<code className="acct-key-prefix">{k.prefix}…</code>
							<span className="acct-key-meta">
								created {formatDate(k.createdAt)} · last used{" "}
								{formatDate(k.lastUsedAt)}
							</span>
						</div>
						<button
							type="button"
							className="acct-btn line small"
							onClick={() => {
								setError(null);
								setConfirming(k.id);
							}}
						>
							Revoke
						</button>
					</li>
				),
			)}
		</ul>
	);
}

/** Step 1 of creating a key: a name, so keys can be told apart later. */
function NameKeyForm({
	onCreated,
	onCancel,
	cancelLabel,
	inline = false,
}: {
	onCreated: (key: string, name: string) => void;
	onCancel: () => void;
	cancelLabel: string;
	inline?: boolean;
}) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			setError("Give the key a name");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			onCreated(await createKey(trimmed), trimmed);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't create a key");
			setBusy(false);
		}
	}

	return (
		<form
			className={inline ? "acct-name inline" : "acct-name"}
			onSubmit={submit}
		>
			<label htmlFor="acct-key-name">Name</label>
			<input
				id="acct-key-name"
				className="acct-input"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="my-indexer"
				maxLength={64}
				autoComplete="off"
			/>
			<p className="acct-muted">
				So you can tell your keys apart later. Only you see it.
			</p>
			{error ? <p className="acct-error">{error}</p> : null}
			<div className="acct-row-actions">
				<button type="submit" className="acct-btn solid" disabled={busy}>
					{busy ? "Creating..." : "Create key"}
				</button>
				<button
					type="button"
					className="acct-btn line"
					onClick={onCancel}
					disabled={busy}
				>
					{cancelLabel}
				</button>
			</div>
		</form>
	);
}

type CardStep =
	| { step: "list" }
	| { step: "name" }
	| { step: "reveal"; key: string; name: string };

/** The keys flow in a floating card: list, then name a key, then show it once. */
export function KeysCard({
	open,
	onClose,
}: { open: boolean; onClose: () => void }) {
	const { keys } = useAccountData();
	const [s, setS] = useState<CardStep>({ step: "list" });

	useEffect(() => {
		if (open) {
			setS({ step: "list" });
			refreshKeys();
		}
	}, [open]);

	if (s.step === "name") {
		return (
			<FloatingCard
				open={open}
				onClose={onClose}
				expandHref="/account/keys"
				title="Create a key"
				subtitle="Step 1 of 2"
			>
				<NameKeyForm
					onCreated={(key, name) => setS({ step: "reveal", key, name })}
					onCancel={() => setS({ step: "list" })}
					cancelLabel="Back to keys"
				/>
			</FloatingCard>
		);
	}

	if (s.step === "reveal") {
		return (
			<FloatingCard
				open={open}
				onClose={onClose}
				expandHref="/account/keys"
				// The key is shown once: carry it to the page instead of losing it.
				onExpand={() => handOverNewKey(s.key)}
				title="Your new key"
				subtitle="Step 2 of 2"
				footer={
					<div className="acct-card-row">
						<button type="button" className="acct-btn solid" onClick={onClose}>
							Done
						</button>
					</div>
				}
			>
				<NewKeyCard value={s.key} />
				<p className="acct-muted">
					Named <strong>{s.name}</strong>. Endpoints are in the{" "}
					<a href="/docs/api-reference">API reference</a>.
				</p>
			</FloatingCard>
		);
	}

	return (
		<FloatingCard
			open={open}
			onClose={onClose}
			expandHref="/account/keys"
			title="API keys"
			subtitle={
				<>
					Send a key as <code>Authorization: Bearer</code>
				</>
			}
			footer={
				<div className="acct-card-row">
					<button
						type="button"
						className="acct-btn solid"
						onClick={() => setS({ step: "name" })}
					>
						Create a key
					</button>
					<p className="acct-fine">The last 24 hours are free with any key.</p>
				</div>
			}
		>
			<KeyList keys={keys} />
		</FloatingCard>
	);
}

/** The keys flow on /account/keys: the same parts, inline on the page. */
export function KeysSection({ handedOver }: { handedOver: string | null }) {
	const { keys } = useAccountData();
	const [naming, setNaming] = useState(false);
	const [newKey, setNewKey] = useState<string | null>(handedOver);

	useEffect(() => setNewKey(handedOver), [handedOver]);
	useEffect(() => {
		refreshKeys();
	}, []);

	return (
		<>
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
			) : (
				<div className="acct-section-actions">
					<button
						type="button"
						className="acct-btn solid"
						onClick={() => setNaming(true)}
					>
						Create a key
					</button>
				</div>
			)}
			<KeyList keys={keys} />
			<p className="acct-fine left">
				Endpoints: <a href="/docs/api-reference">API reference</a>. The last 24
				hours of data are free with any key.
			</p>
		</>
	);
}
