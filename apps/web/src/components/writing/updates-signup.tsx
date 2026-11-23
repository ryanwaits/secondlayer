"use client";

import type { AccountUpdates } from "@/app/api/updates/route";
import { notify } from "@/components/toast/notify";
import { useAuth } from "@/lib/auth";
import { PUBLIC_API_URL } from "@/lib/public-api";
import Link from "next/link";
import {
	type FormEvent,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type UpdatesMemory,
	forgetUpdates,
	postUpdatesToken,
	readUpdatesMemory,
	rememberUpdates,
} from "./updates-list";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const START_LINE =
	"Instant data for apps on Bitcoin. 1M rows free every month.";

type Status =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "invalid" }
	| { kind: "failed" }
	| { kind: "sent"; email: string };

type Confirmed = UpdatesMemory & { status: "confirmed" };

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

let known: UpdatesMemory | null | undefined;
let knownFor: boolean | undefined;
const listeners = new Set<() => void>();

function setKnown(next: UpdatesMemory | null) {
	known = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			known = undefined;
			knownFor = undefined;
		}
	};
}

function useKnown(): UpdatesMemory | null | undefined {
	const { account, loading } = useAuth();
	const signedIn = !!account;
	const value = useSyncExternalStore(
		subscribe,
		() => (knownFor === signedIn ? known : undefined),
		() => undefined,
	);

	useEffect(() => {
		if (loading || knownFor === signedIn) return;
		// Claimed before the fetch, so a second caller on the page waits for
		// this answer instead of asking again.
		knownFor = signedIn;
		known = undefined;
		if (!signedIn) {
			setKnown(readUpdatesMemory());
			return;
		}
		accountUpdates()
			.catch(() => readUpdatesMemory())
			.then((answer) => {
				if (knownFor === signedIn) setKnown(answer);
			});
	}, [loading, signedIn]);

	return loading ? undefined : value;
}

async function unsubscribe(memory: Confirmed) {
	const { email: address, token } = memory;
	const gone = await postUpdatesToken("unsubscribe", token).catch(() => null);
	if (!gone) {
		notify.fail("Couldn't unsubscribe", {
			desc: "Use the link at the bottom of any update email.",
		});
		return;
	}
	forgetUpdates();
	setKnown(null);
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
			setKnown(again);
			notify.done("Subscribed again", { quick: true });
		},
	});
}

/**
 * The sent state never says whether the address was
 * already on the list.
 */
export function UpdatesSignup({
	heading = false,
	inPost = false,
}: {
	heading?: boolean;
	inPost?: boolean;
}) {
	const { account } = useAuth();
	const memory = useKnown();
	if (memory === undefined) return null;
	return (
		<UpdatesSignupForm
			heading={heading}
			prefill={account?.email ?? undefined}
			memory={memory}
			start={inPost && !account}
			unsubscribeHere={!inPost}
		/>
	);
}

export function UpdatesUnsubscribe() {
	const memory = useKnown();
	if (memory?.status !== "confirmed") return null;
	return (
		<button
			type="button"
			className="writing-end-unsub"
			onClick={() => void unsubscribe(memory)}
		>
			Unsubscribe
		</button>
	);
}

function StartLine() {
	return (
		<p className="updates-start">
			{START_LINE} <Link href="/signin">Start free →</Link>
		</p>
	);
}

function UpdatesSignupForm({
	heading,
	prefill,
	memory,
	start,
	unsubscribeHere,
}: {
	heading: boolean;
	prefill?: string;
	memory: UpdatesMemory | null;
	start: boolean;
	unsubscribeHere: boolean;
}) {
	const [typed, setTyped] = useState<string | null>(null);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const email = typed ?? prefill ?? "";

	function startOver() {
		forgetUpdates();
		setKnown(null);
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

	if (memory?.status === "confirmed" && !unsubscribeHere) {
		return start ? (
			<section id="updates" className="updates-signup updates-quiet">
				<StartLine />
			</section>
		) : null;
	}

	if (memory) {
		return (
			<section id="updates" className="updates-signup updates-quiet">
				<p className="updates-fine">
					{memory.status === "confirmed" ? (
						<>
							You get new posts and launches at {memory.email}.{" "}
							<button
								type="button"
								className="updates-link"
								onClick={() => void unsubscribe(memory)}
							>
								Unsubscribe
							</button>
						</>
					) : (
						<>
							Check {memory.email} for the confirmation link.{" "}
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
				{start && <StartLine />}
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
			{start && <StartLine />}
		</section>
	);
}
