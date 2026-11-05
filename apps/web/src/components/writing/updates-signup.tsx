"use client";

import { useAuth } from "@/lib/auth";
import { PUBLIC_API_URL } from "@/lib/public-api";
import { type FormEvent, useState } from "react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "invalid" }
	| { kind: "failed" }
	| { kind: "sent"; email: string };

/**
 * Email signup for new posts and launches. Double opt-in: the API sends a
 * confirmation link, and the sent state never says whether the address was
 * already on the list. A signed-in reader gets their address pre-filled;
 * nothing is sent until they click.
 */
export function UpdatesSignup({ heading = false }: { heading?: boolean }) {
	const { account } = useAuth();
	const [typed, setTyped] = useState<string | null>(null);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const email = typed ?? account?.email ?? "";

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const address = email.trim();
		if (!EMAIL.test(address)) {
			setStatus({ kind: "invalid" });
			return;
		}
		setStatus({ kind: "sending" });
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/public/updates`, {
				method: "POST",
				credentials: "omit",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: address,
					source_page: window.location.pathname,
					website: String(data.get("website") ?? ""),
				}),
			});
			if (res.status === 400) setStatus({ kind: "invalid" });
			else if (res.ok) setStatus({ kind: "sent", email: address });
			else setStatus({ kind: "failed" });
		} catch {
			setStatus({ kind: "failed" });
		}
	}

	const Heading = heading ? "h2" : "h3";
	const invalid = status.kind === "invalid";

	return (
		<section id="updates" className="updates-signup">
			<Heading className="updates-title">
				Get new posts and launches by email
			</Heading>
			{status.kind === "sent" ? (
				<output className="updates-sent">
					<span className="updates-line">
						<span className="updates-dot" aria-hidden="true" />
						Check {status.email} for a confirmation link.
					</span>
					<span className="updates-fine">
						Nothing arrives until you click it. No email? Check spam, or{" "}
						<button
							type="button"
							className="updates-link"
							onClick={() => {
								setTyped("");
								setStatus({ kind: "idle" });
							}}
						>
							try another address
						</button>
						.
					</span>
				</output>
			) : (
				<>
					<p className="updates-sub">
						One email when we publish or ship. Unsubscribe from any of them in
						one click.
					</p>
					<form className="updates-form" onSubmit={onSubmit} noValidate>
						<label htmlFor="updates-email" className="updates-sr">
							Email
						</label>
						<input
							id="updates-email"
							name="email"
							type="email"
							autoComplete="email"
							maxLength={254}
							placeholder="you@example.com"
							value={email}
							onChange={(e) => setTyped(e.target.value)}
							aria-invalid={invalid ? true : undefined}
							aria-describedby={
								invalid || status.kind === "failed"
									? "updates-message"
									: undefined
							}
						/>
						{/* Honeypot: people never see or fill it; bots do. */}
						<div className="updates-trap" aria-hidden="true">
							<label htmlFor="updates-website">Website</label>
							<input
								type="text"
								id="updates-website"
								name="website"
								tabIndex={-1}
								autoComplete="off"
							/>
						</div>
						<button
							type="submit"
							className="updates-button"
							disabled={status.kind === "sending"}
						>
							{status.kind === "sending" ? "Subscribing…" : "Subscribe"}
						</button>
					</form>
					{(invalid || status.kind === "failed") && (
						<p id="updates-message" className="updates-error" role="alert">
							{invalid
								? "Enter a full address, like you@example.com."
								: "Couldn't subscribe right now. Try again in a minute."}
						</p>
					)}
				</>
			)}
		</section>
	);
}
