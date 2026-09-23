"use client";

import { type FormEvent, useState } from "react";

const ROLES = [
	{ value: "issuer", label: "Token issuer or team" },
	{ value: "builder", label: "Builder" },
	{ value: "holder", label: "Holder" },
] as const;

type Status =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "error"; message: string }
	| { kind: "done"; token: string; contact: string };

export function WaitlistForm() {
	const [status, setStatus] = useState<Status>({ kind: "idle" });

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);
		const field = (name: string) => String(data.get(name) ?? "").trim();
		const token = field("token");
		const contact = field("contact");

		if (!token || !contact) {
			setStatus({
				kind: "error",
				message:
					!token && !contact
						? "Add a token and a way to reach you."
						: !token
							? "Add the token you want bridged."
							: "Add a Telegram, X handle, or email so we can reach you.",
			});
			(
				form.elements.namedItem(token ? "contact" : "token") as HTMLElement
			)?.focus();
			return;
		}

		setStatus({ kind: "sending" });
		try {
			const res = await fetch("/api/public/waitlist", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					list: "robinhood",
					role: field("role"),
					token,
					contact,
					contract: field("contract"),
					note: field("note"),
				}),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				setStatus({
					kind: "error",
					message:
						res.status === 429
							? "Too many signups from this network. Try again in a minute."
							: (body?.error ?? "That didn't go through. Try again."),
				});
				return;
			}
			setStatus({ kind: "done", token, contact });
		} catch {
			setStatus({
				kind: "error",
				message: "Couldn't reach the server. Check your connection and retry.",
			});
		}
	}

	if (status.kind === "done") {
		return (
			<output className="rh-done">
				<span className="rh-done-title">You're on the list.</span>
				<span className="rh-done-body">
					We'll reach out on <code>{status.contact}</code> when{" "}
					{status.token.toUpperCase()} can join a test round.
				</span>
			</output>
		);
	}

	return (
		<form className="rh-form" onSubmit={onSubmit} noValidate>
			<fieldset className="rh-field">
				<legend className="rh-label">I'm a</legend>
				<div className="rh-seg">
					{ROLES.map((r, i) => (
						<label key={r.value}>
							<input
								type="radio"
								name="role"
								id={`role-${r.value}`}
								value={r.value}
								defaultChecked={i === 0}
							/>
							<span>{r.label}</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="rh-two">
				<div className="rh-field">
					<label className="rh-label" htmlFor="token">
						Token
					</label>
					<input
						type="text"
						id="token"
						name="token"
						maxLength={64}
						placeholder="WELSH, LEO, PEPE…"
						autoComplete="off"
					/>
				</div>
				<div className="rh-field">
					<label className="rh-label" htmlFor="contact">
						Telegram, X, or email
					</label>
					<input
						type="text"
						id="contact"
						name="contact"
						maxLength={254}
						placeholder="@handle or you@team.xyz"
						autoComplete="email"
					/>
				</div>
			</div>
			<div className="rh-field">
				<label className="rh-label" htmlFor="contract">
					Contract <span className="rh-opt">optional</span>
				</label>
				<input
					type="text"
					id="contract"
					name="contract"
					className="rh-mono"
					maxLength={160}
					placeholder="SP3NE50…welshcorgicoin-token"
					autoComplete="off"
					spellCheck={false}
				/>
			</div>
			<div className="rh-field">
				<label className="rh-label" htmlFor="note">
					What would you do with it on Robinhood Chain?{" "}
					<span className="rh-opt">optional</span>
				</label>
				<textarea
					id="note"
					name="note"
					maxLength={2000}
					placeholder="Liquidity, a listing, a community on the EVM side…"
				/>
			</div>
			{status.kind === "error" && (
				<p className="rh-err" role="alert">
					{status.message}
				</p>
			)}
			<div className="rh-form-foot">
				<p className="rh-fine">
					We'll only contact you about this bridge. No token is locked by
					signing up.
				</p>
				<button
					className="rh-btn"
					type="submit"
					disabled={status.kind === "sending"}
				>
					{status.kind === "sending" ? "Joining…" : "Join the waitlist"}
				</button>
			</div>
		</form>
	);
}
