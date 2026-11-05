"use client";

import { Eyebrow } from "@/components/site";
import { UpdatesSignup } from "@/components/writing/updates-signup";
import { PUBLIC_API_URL } from "@/lib/public-api";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type State =
	| { kind: "checking" }
	| { kind: "confirmed"; email: string }
	| { kind: "expired" }
	| { kind: "invalid" };

export function ConfirmView({ token }: { token?: string }) {
	const [state, setState] = useState<State>(
		token ? { kind: "checking" } : { kind: "invalid" },
	);
	const sent = useRef(false);

	useEffect(() => {
		// Strict mode runs effects twice; the token must be spent once.
		if (!token || sent.current) return;
		sent.current = true;
		fetch(`${PUBLIC_API_URL}/api/public/updates/confirm`, {
			method: "POST",
			credentials: "omit",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token }),
		})
			.then(async (res) => {
				const body = (await res.json().catch(() => null)) as {
					email?: string;
				} | null;
				if (res.ok && body?.email) {
					setState({ kind: "confirmed", email: body.email });
				} else {
					setState({ kind: res.status === 410 ? "expired" : "invalid" });
				}
			})
			.catch(() => setState({ kind: "invalid" }));
	}, [token]);

	return (
		<main className="site updates">
			<div className="shell">
				<Eyebrow noun="Updates" />
				{state.kind === "checking" && (
					<p className="updates-page-wait">Checking your link…</p>
				)}
				{state.kind === "confirmed" && (
					<>
						<h1>You're subscribed</h1>
						<p className="updates-page-text">
							{state.email} gets new posts and launches. Every email has an
							unsubscribe link at the bottom.
						</p>
						<div className="updates-page-actions">
							<Link href="/blog" className="btn btn-pri">
								Read the blog
							</Link>
						</div>
					</>
				)}
				{state.kind === "expired" && (
					<>
						<h1>This link expired</h1>
						<p className="updates-page-text">
							Confirmation links work for 7 days. Subscribe again and we'll send
							a fresh one.
						</p>
						<UpdatesSignup />
					</>
				)}
				{state.kind === "invalid" && (
					<>
						<h1>This link isn't valid</h1>
						<p className="updates-page-text">
							It may be cut off by your mail app. Copy the whole link from the
							email, or subscribe again.
						</p>
						<UpdatesSignup />
					</>
				)}
			</div>
		</main>
	);
}
