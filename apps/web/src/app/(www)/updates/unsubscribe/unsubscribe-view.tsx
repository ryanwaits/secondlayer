"use client";

import { Eyebrow } from "@/components/site";
import {
	forgetUpdates,
	rememberUpdates,
} from "@/components/writing/updates-memory";
import { PUBLIC_API_URL } from "@/lib/public-api";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type State =
	| { kind: "checking" }
	| { kind: "unsubscribed"; email: string; resubscribing: boolean }
	| { kind: "resubscribed"; email: string }
	| { kind: "invalid" };

async function post(path: string, token: string) {
	const res = await fetch(`${PUBLIC_API_URL}/api/public/updates/${path}`, {
		method: "POST",
		credentials: "omit",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token }),
	});
	const body = (await res.json().catch(() => null)) as {
		email?: string;
	} | null;
	return res.ok && body?.email ? body.email : null;
}

export function UnsubscribeView({ token }: { token?: string }) {
	const [state, setState] = useState<State>(
		token ? { kind: "checking" } : { kind: "invalid" },
	);
	const sent = useRef(false);

	useEffect(() => {
		// Strict mode runs effects twice; the request goes out once.
		if (!token || sent.current) return;
		sent.current = true;
		post("unsubscribe", token)
			.then((email) => {
				if (email) forgetUpdates();
				setState(
					email
						? { kind: "unsubscribed", email, resubscribing: false }
						: { kind: "invalid" },
				);
			})
			.catch(() => setState({ kind: "invalid" }));
	}, [token]);

	async function resubscribe() {
		if (!token || state.kind !== "unsubscribed") return;
		const { email } = state;
		setState({ kind: "unsubscribed", email, resubscribing: true });
		try {
			const confirmed = await post("resubscribe", token);
			if (confirmed) {
				rememberUpdates({ status: "confirmed", email: confirmed, token });
			}
			setState(
				confirmed
					? { kind: "resubscribed", email: confirmed }
					: { kind: "unsubscribed", email, resubscribing: false },
			);
		} catch {
			setState({ kind: "unsubscribed", email, resubscribing: false });
		}
	}

	return (
		<main className="site updates">
			<div className="shell">
				<Eyebrow noun="Updates" />
				{state.kind === "checking" && (
					<p className="updates-page-wait">Checking your link…</p>
				)}
				{state.kind === "unsubscribed" && (
					<>
						<h1>You're unsubscribed</h1>
						<p className="updates-page-text">
							{state.email} won't get posts or launch emails anymore. Account
							emails, like sign-in codes and alerts on your webhooks, still
							arrive.
						</p>
						<div className="updates-page-actions">
							<button
								type="button"
								className="btn btn-ghost"
								onClick={resubscribe}
								disabled={state.resubscribing}
							>
								Resubscribe
							</button>
							<Link href="/blog" className="btn btn-ghost">
								Back to the blog
							</Link>
						</div>
					</>
				)}
				{state.kind === "resubscribed" && (
					<>
						<h1>You're subscribed again</h1>
						<p className="updates-page-text">
							{state.email} gets new posts and launches. Every email has an
							unsubscribe link at the bottom.
						</p>
						<div className="updates-page-actions">
							<Link href="/blog" className="btn btn-ghost">
								Back to the blog
							</Link>
						</div>
					</>
				)}
				{state.kind === "invalid" && (
					<>
						<h1>This link isn't valid</h1>
						<p className="updates-page-text">
							It may be cut off by your mail app. Use the unsubscribe link in
							any recent email.
						</p>
					</>
				)}
			</div>
		</main>
	);
}
