"use client";

import { useAuth } from "@/lib/auth";
import { signInThen } from "@/lib/safe-next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** The product that started the sign-in; absent is `sl login`. */
export type CliProduct = "sentinel";

type View =
	| { kind: "loading" }
	| { kind: "review"; clientName: string; product?: CliProduct }
	| { kind: "approved"; clientName: string; product?: CliProduct }
	| { kind: "cancelled"; product?: CliProduct }
	| { kind: "expired"; product?: CliProduct };

const CLIENT_NAME_MAX = 64;

/** Control characters, zero-width marks and bidi overrides: they can hide or
 *  reorder what the reader sees, so a name can't pose as another. */
function isUnsafeCodePoint(cp: number): boolean {
	return (
		cp < 0x20 ||
		(cp >= 0x7f && cp <= 0x9f) ||
		cp === 0x061c ||
		(cp >= 0x200b && cp <= 0x200f) ||
		(cp >= 0x202a && cp <= 0x202e) ||
		(cp >= 0x2060 && cp <= 0x2069) ||
		cp === 0xfeff
	);
}

/**
 * `clientName` is whatever the requesting machine sent. Show it as plain
 * text: no control or bidi characters, whitespace collapsed, length capped.
 */
export function displayClientName(raw: string): string {
	// Line breaks and tabs become spaces first, so words stay apart.
	const kept = Array.from(raw.replace(/\s+/g, " "))
		.filter((ch) => !isUnsafeCodePoint(ch.codePointAt(0) ?? 0))
		.join("")
		.replace(/ {2,}/g, " ")
		.trim();
	const chars = Array.from(kept);
	if (chars.length === 0) return "an unnamed machine";
	return chars.length > CLIENT_NAME_MAX
		? `${chars.slice(0, CLIENT_NAME_MAX).join("")}…`
		: kept;
}

const COPY = {
	sl: { name: "sl", login: "sl login" },
	sentinel: { name: "Sentinel", login: "sentinel login" },
} as const;

const copyFor = (product?: CliProduct) => COPY[product ?? "sl"];

/** The card is pure so each state can be rendered and checked on its own. */
export function CliLoginCard({
	view,
	code,
	busy,
	error,
	onApprove,
	onCancel,
}: {
	view: View;
	code: string;
	busy: boolean;
	error: string | null;
	onApprove(): void;
	onCancel(): void;
}) {
	return (
		<div className="login-page">
			<div className="login-card">
				{view.kind === "review" && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onApprove();
						}}
					>
						<span className="login-eyebrow">Command line</span>
						{view.product === "sentinel" ? (
							<>
								<h1 className="login-title">
									Approve <strong>Sentinel</strong> on{" "}
									{displayClientName(view.clientName)}?
								</h1>
								<p className="cli-login-device">
									Machine name as reported by the device. It is not checked.
								</p>
								<p className="cli-login-lead">
									This signs Sentinel in with your account on that machine,
									until you run <code>sentinel logout</code> there.
								</p>
								<p className="cli-login-warn">
									Only approve a code you started. Check it matches your
									terminal.
								</p>
							</>
						) : (
							<>
								<h1 className="login-title">
									Approve sl on {displayClientName(view.clientName)}?
								</h1>
								<p className="cli-login-lead">
									This signs sl in with your account on that machine, until you
									run <code>sl logout</code> there. Check the code matches your
									terminal.
								</p>
							</>
						)}
						<span className="login-label">Code in your terminal</span>
						<p className="cli-login-code">{code}</p>
						{error && <p className="login-error">{error}</p>}
						<button type="submit" className="login-submit" disabled={busy}>
							{busy ? "Approving..." : "Approve"}
						</button>
						<button
							type="button"
							className="cli-login-cancel"
							onClick={onCancel}
							disabled={busy}
						>
							Cancel
						</button>
					</form>
				)}
				{view.kind === "approved" && (
					<div className="login-sent">
						<p className="login-sent-title">
							You're signed in on {displayClientName(view.clientName)}.
						</p>
						<p className="login-sent-desc">Close this tab.</p>
					</div>
				)}
				{view.kind === "cancelled" && (
					<div className="login-sent">
						<p className="login-sent-title">Cancelled.</p>
						<p className="login-sent-desc">
							{copyFor(view.product).name} stays signed out.
						</p>
					</div>
				)}
				{view.kind === "expired" && (
					<div className="login-sent">
						<p className="login-sent-title">This code expired.</p>
						<p className="login-sent-desc">
							Run <code>{copyFor(view.product).login}</code> again.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

export function CliLogin() {
	const { account, loading } = useAuth();
	const router = useRouter();
	const code = (useSearchParams().get("code") ?? "").toUpperCase();
	const [view, setView] = useState<View>({ kind: "loading" });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Signed out: sign in, then come back to this same code.
	useEffect(() => {
		if (!loading && !account) {
			router.replace(signInThen(`/cli/login?code=${encodeURIComponent(code)}`));
		}
	}, [loading, account, code, router]);

	useEffect(() => {
		if (!account) return;
		if (!code) {
			setView({ kind: "expired" });
			return;
		}
		let live = true;
		(async () => {
			try {
				const res = await fetch(`/api/cli/device/${encodeURIComponent(code)}`);
				if (!res.ok) throw new Error("gone");
				const attempt = (await res.json()) as {
					clientName: string;
					product?: string | null;
					status: string;
				};
				if (!live) return;
				const product = attempt.product === "sentinel" ? "sentinel" : undefined;
				if (attempt.status !== "pending") {
					setView({ kind: "expired", product });
					return;
				}
				setView({ kind: "review", clientName: attempt.clientName, product });
			} catch {
				if (live) setView({ kind: "expired" });
			}
		})();
		return () => {
			live = false;
		};
	}, [account, code]);

	const answer = useCallback(
		async (action: "approve" | "deny") => {
			if (view.kind !== "review") return;
			setBusy(true);
			setError(null);
			try {
				const res = await fetch(
					`/api/cli/device/${encodeURIComponent(code)}/${action}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: "{}",
					},
				);
				if (res.status === 404 || res.status === 409) {
					setView({ kind: "expired", product: view.product });
					return;
				}
				if (!res.ok) throw new Error("failed");
				setView(
					action === "approve"
						? {
								kind: "approved",
								clientName: view.clientName,
								product: view.product,
							}
						: { kind: "cancelled", product: view.product },
				);
			} catch {
				setError("Something went wrong. Try again.");
			} finally {
				setBusy(false);
			}
		},
		[code, view],
	);

	return (
		<CliLoginCard
			view={view}
			code={code}
			busy={busy}
			error={error}
			onApprove={() => answer("approve")}
			onCancel={() => answer("deny")}
		/>
	);
}
