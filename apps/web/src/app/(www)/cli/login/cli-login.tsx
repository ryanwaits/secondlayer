"use client";

import { useAuth } from "@/lib/auth";
import { signInThen } from "@/lib/safe-next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type View =
	| { kind: "loading" }
	| { kind: "review"; clientName: string }
	| { kind: "approved"; clientName: string }
	| { kind: "cancelled" }
	| { kind: "expired" };

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
						<h1 className="login-title">Approve sl on {view.clientName}?</h1>
						<p className="cli-login-lead">
							This signs sl in with your account on that machine, until you run{" "}
							<code>sl logout</code> there. Check the code matches your
							terminal.
						</p>
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
							You're signed in on {view.clientName}.
						</p>
						<p className="login-sent-desc">Close this tab.</p>
					</div>
				)}
				{view.kind === "cancelled" && (
					<div className="login-sent">
						<p className="login-sent-title">Cancelled.</p>
						<p className="login-sent-desc">sl stays signed out.</p>
					</div>
				)}
				{view.kind === "expired" && (
					<div className="login-sent">
						<p className="login-sent-title">This code expired.</p>
						<p className="login-sent-desc">
							Run <code>sl login</code> again.
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
					status: string;
				};
				if (!live) return;
				if (attempt.status !== "pending") {
					setView({ kind: "expired" });
					return;
				}
				setView({ kind: "review", clientName: attempt.clientName });
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
					setView({ kind: "expired" });
					return;
				}
				if (!res.ok) throw new Error("failed");
				setView(
					action === "approve"
						? { kind: "approved", clientName: view.clientName }
						: { kind: "cancelled" },
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
