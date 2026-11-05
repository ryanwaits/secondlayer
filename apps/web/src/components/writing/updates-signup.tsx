"use client";

import type { AccountUpdates } from "@/app/api/updates/route";
import { notify } from "@/components/toast/notify";
import { useAuth } from "@/lib/auth";
import { PUBLIC_API_URL } from "@/lib/public-api";
import { type FormEvent, useEffect, useState } from "react";
import {
	type UpdatesMemory,
	forgetUpdates,
	postUpdatesToken,
	readUpdatesMemory,
	rememberUpdates,
} from "./updates-list";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "invalid" }
	| { kind: "failed" }
	| { kind: "sent"; email: string }
	| UpdatesMemory;

/** The signed-in account's place on the list, as the form remembers it. */
async function accountUpdates(): Promise<UpdatesMemory | null> {
	const res = await fetch("/api/updates");
	if (!res.ok) throw new Error(`updates ${res.status}`);
	const body = (await res.json()) as AccountUpdates;
	if (!body.email) return null;
	if (body.status === "confirmed" && body.token) {
		return { status: "confirmed", email: body.email, token: body.token };
	}
	if (body.status === "pending")
		return { status: "pending", email: body.email };
	return null;
}

/**
 * Email signup for new posts and launches. Double opt-in: the API sends a
 * confirmation link, and the sent state never says whether the address was
 * already on the list. A signed-in reader gets their address pre-filled;
 * nothing is sent until they click. A reader already on the list, by their
 * account or by what this browser remembers, sees one quiet line instead.
 */
export function UpdatesSignup({ heading = false }: { heading?: boolean }) {
	const { account, loading } = useAuth();
	// undefined while still finding out, so the form never flashes first.
	const [known, setKnown] = useState<UpdatesMemory | null | undefined>();
	const signedIn = !!account;

	useEffect(() => {
		if (loading) return;
		if (!signedIn) {
			setKnown(readUpdatesMemory());
			return;
		}
		let live = true;
		accountUpdates()
			.catch(() => readUpdatesMemory())
			.then((answer) => live && setKnown(answer));
		return () => {
			live = false;
		};
	}, [loading, signedIn]);

	if (known === undefined) return null;
	return (
		<UpdatesSignupForm
			heading={heading}
			prefill={account?.email}
			known={known ?? undefined}
		/>
	);
}

/**
 * The form itself, given the address to pre-fill and what is already known
 * about the reader's place on the list (tests render this).
 */
export function UpdatesSignupForm({
	heading = false,
	prefill,
	known,
}: {
	heading?: boolean;
	prefill?: string;
	known?: UpdatesMemory;
}) {
	const [typed, setTyped] = useState<string | null>(null);
	const [status, setStatus] = useState<Status>(known ?? { kind: "idle" });
	const email = typed ?? prefill ?? "";

	function startOver() {
		forgetUpdates();
		setTyped("");
		setStatus({ kind: "idle" });
	}

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
			else if (res.ok) {
				rememberUpdates({ status: "pending", email: address });
				setStatus({ kind: "sent", email: address });
			} else setStatus({ kind: "failed" });
		} catch {
			setStatus({ kind: "failed" });
		}
	}

	/**
	 * Unsubscribes in place: the form comes back and a toast offers Undo
	 * (⌘Z), which puts the reader back on the list with the same token.
	 */
	async function unsubscribe(memory: UpdatesMemory & { status: "confirmed" }) {
		const { email: address, token } = memory;
		const gone = await postUpdatesToken("unsubscribe", token).catch(() => null);
		if (!gone) {
			notify.fail("Couldn't unsubscribe", {
				desc: "Use the link at the bottom of any update email.",
			});
			return;
		}
		forgetUpdates();
		setStatus({ kind: "idle" });
		notify.done("Unsubscribed", {
			desc: `${address} won't get posts or launch emails.`,
			undo: async () => {
				const back = await postUpdatesToken("resubscribe", token).catch(
					() => null,
				);
				if (!back) {
					notify.fail("Couldn't resubscribe", {
						desc: "Subscribe again with the form.",
					});
					return;
				}
				const again = { status: "confirmed", email: back, token } as const;
				rememberUpdates(again);
				setStatus(again);
				notify.done("Subscribed again", { quick: true });
			},
		});
	}

	if ("status" in status) {
		return (
			<section id="updates" className="updates-signup updates-quiet">
				<p className="updates-fine">
					{status.status === "confirmed" ? (
						<>
							You get new posts and launches at {status.email}.{" "}
							<button
								type="button"
								className="updates-link"
								onClick={() => void unsubscribe(status)}
							>
								Unsubscribe
							</button>
						</>
					) : (
						<>
							Check {status.email} for the confirmation link.{" "}
							<button
								type="button"
								className="updates-link"
								onClick={startOver}
							>
								Use another address
							</button>
						</>
					)}
				</p>
			</section>
		);
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
						<button type="button" className="updates-link" onClick={startOver}>
							try another address
						</button>
						.
					</span>
				</output>
			) : (
				<>
					<p className="updates-sub">
						One email when we publish or ship something new.
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
