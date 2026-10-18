"use client";

import { displayClientName } from "@/app/(www)/cli/login/cli-login";
import { formatDate, revokeApp } from "@/lib/account-data";
import type { ConnectedApp } from "@/lib/types";
import { useState } from "react";
import { agoShort } from "./key-view";

/** One app's row, or its inline revoke confirm. */
function AppRow({ app, now }: { app: ConnectedApp; now: Date }) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const name = `“${displayClientName(app.clientName)}”`;

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
					<strong>Revoke {name}?</strong> Its tokens stop working at once. To
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
	return (
		<div className="ky-arow">
			<span className="ky-name">
				<span className="ky-nm">{name}</span>
				<span className="ky-faint">
					Allowed {formatDate(app.createdAt)} · name unverified
				</span>
			</span>
			<span className="ky-faint ky-r">{agoShort(app.lastUsedAt, now)}</span>
			<span className="ky-r">
				<button
					type="button"
					className="ky-link"
					onClick={() => setConfirming(true)}
				>
					Revoke
				</button>
			</span>
		</div>
	);
}

/** Apps signed in to the hosted MCP with OAuth. Null until loaded. */
export function AppsTable({
	apps,
	now,
}: {
	apps: ConnectedApp[] | null;
	now: Date;
}) {
	return (
		<section className="ky-apps" aria-labelledby="ky-apps-h">
			<h2 id="ky-apps-h" className="dash-label">
				Apps
			</h2>
			<div className="ky-table">
				<div className="ky-arow ky-head">
					<span>App</span>
					<span className="ky-r">Last used</span>
					<span />
				</div>
				{apps === null ? (
					<p className="ky-gone">Loading apps…</p>
				) : apps.length === 0 ? (
					<p className="ky-gone">
						No apps signed in. An MCP client you connect to
						api.secondlayer.tools/mcp shows up here.
					</p>
				) : (
					apps.map((a) => <AppRow key={a.id} app={a} now={now} />)
				)}
				<p className="ky-foot">
					An app signs in through your browser and uses your credits for the
					reads it makes. It can't make or revoke keys.
				</p>
			</div>
		</section>
	);
}
