"use client";

import { createKey } from "@/lib/account-data";
import { useState } from "react";

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

/** Step 1 of creating a key: a name, so keys can be told apart later. */
export function NameKeyForm({
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
