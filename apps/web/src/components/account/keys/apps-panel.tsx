"use client";

import { displayClientName } from "@/app/(www)/cli/login/cli-login";
import { formatDate, revokeApp } from "@/lib/account-data";
import type { ConnectedApp } from "@/lib/types";
import { useState } from "react";
import { agoLong } from "./key-view";

/** One app's item, or its inline revoke confirm. */
function AppRow({ app, now }: { app: ConnectedApp; now: Date }) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const name = displayClientName(app.clientName);

	async function revoke() {
		setBusy(true);
		setError(null);
		try {
			await revokeApp(app.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't revoke that app");
			setBusy(false);
		}
	}

	if (confirming) {
		return (
			<div className="acct-revoke-confirm">
				<p>
					<strong>Revoke “{name}”?</strong> Its tokens stop working at once. To
					use it again, sign in from the app.
				</p>
				<div className="acct-row-actions">
					<button
						type="button"
						className="acct-btn danger small"
						onClick={revoke}
						disabled={busy}
					>
						{busy ? "Revoking…" : "Revoke app"}
					</button>
					<button
						type="button"
						className="acct-btn line small"
						onClick={() => setConfirming(false)}
						disabled={busy}
					>
						Cancel
					</button>
				</div>
				{error ? <p className="acct-error">{error}</p> : null}
			</div>
		);
	}
	// The API carries no verified flag: a name is the app's own claim, so every
	// app shows the unverified tag.
	return (
		<div className="ky-aitem">
			<span className="ky-aic" aria-hidden="true">
				{(name.trim()[0] ?? "?").toUpperCase()}
			</span>
			<div className="ky-amain">
				<div className="ky-aname">
					{name}
					<span className="ky-atag">name unverified</span>
				</div>
				<p className="ky-ameta">
					Allowed {formatDate(app.createdAt)}
					{app.lastUsedAt ? ` · last used ${agoLong(app.lastUsedAt, now)}` : ""}{" "}
					· uses your credits, can't make or revoke keys
				</p>
			</div>
			<button
				type="button"
				className="ky-abtn"
				onClick={() => setConfirming(true)}
			>
				Revoke
			</button>
		</div>
	);
}

/** Apps signed in to the hosted MCP with OAuth. Null until loaded. */
export function AppsPanel({
	apps,
	now,
}: {
	apps: ConnectedApp[] | null;
	now: Date;
}) {
	return (
		<section className="ky-apps" aria-labelledby="ky-apps-h">
			<h2 id="ky-apps-h" className="dash-label">
				Apps signed in as you
			</h2>
			{apps === null ? (
				<p className="ky-gone">Loading apps…</p>
			) : apps.length === 0 ? (
				<p className="ky-gone">
					No apps signed in. An MCP client you connect to
					api.secondlayer.tools/mcp shows up here.
				</p>
			) : (
				<div className="ky-apanel">
					{apps.map((a) => (
						<AppRow key={a.id} app={a} now={now} />
					))}
				</div>
			)}
		</section>
	);
}
