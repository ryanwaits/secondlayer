"use client";

import { CreditsSheet } from "@/components/account/credits-panel";
import { KeysSheet } from "@/components/account/keys-panel";
import {
	activeKeys,
	clearAccountData,
	formatUsd,
	refreshBilling,
	refreshKeys,
	useAccountData,
} from "@/lib/account-data";
import type { Account } from "@/lib/types";
import { useEffect, useId, useRef, useState } from "react";

const CLI_INSTALL = "bun add -g @secondlayer/cli";

export function AccountAvatar({
	account,
	size = 26,
}: {
	account: Account;
	size?: number;
}) {
	const initial = (account.displayName ?? account.email).trim()[0] ?? "?";
	return (
		<span
			className="acct-avatar"
			style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
			aria-hidden="true"
		>
			{initial.toUpperCase()}
		</span>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			className="acct-chip-chev"
			data-open={open ? "" : undefined}
			width="10"
			height="6"
			viewBox="0 0 10 6"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<path d="M1 1l4 4 4-4" />
		</svg>
	);
}

/**
 * Signed-in nav: an account chip (initial + balance) whose menu holds the
 * account at a glance and opens the keys and credits sheets in place.
 */
export function AccountMenu({
	account,
	onSignOut,
}: {
	account: Account;
	onSignOut: () => void;
}) {
	const { billing, keys } = useAccountData();
	const [open, setOpen] = useState(false);
	const [sheet, setSheet] = useState<"keys" | "credits" | null>(null);
	const [copied, setCopied] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	useEffect(() => {
		refreshBilling();
	}, []);

	useEffect(() => {
		if (!open) return;
		refreshKeys();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		const onClick = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [open]);

	const balance = billing ? formatUsd(billing.creditsUsdMicros) : null;
	const empty = billing !== null && Number(billing.creditsUsdMicros) <= 0;
	const keyCount = keys === null ? null : activeKeys(keys).length;

	function openSheet(which: "keys" | "credits") {
		setOpen(false);
		setSheet(which);
	}

	return (
		<div className="acct-menu" ref={rootRef}>
			<button
				type="button"
				className="acct-chip"
				aria-expanded={open}
				aria-controls={menuId}
				aria-label={`Account menu, ${account.email}${balance ? `, balance ${balance}` : ""}`}
				onClick={() => setOpen((v) => !v)}
			>
				<AccountAvatar account={account} />
				{empty ? <span className="acct-chip-dot" aria-hidden="true" /> : null}
				<span className="acct-chip-balance">{balance ?? "···"}</span>
				<Chevron open={open} />
			</button>
			{open ? (
				<div className="acct-panel" id={menuId}>
					<div className="acct-panel-head">
						<AccountAvatar account={account} size={32} />
						<div className="acct-panel-who">
							<span className="acct-panel-email">{account.email}</span>
							<span className="acct-muted">Hosted account</span>
						</div>
					</div>
					{empty ? (
						<div className="acct-empty">
							<p className="acct-empty-title">No credits left</p>
							<p className="acct-empty-line">
								The last 24 hours stay free. Older history needs credits.
							</p>
							<button
								type="button"
								className="acct-btn solid full small"
								onClick={() => openSheet("credits")}
							>
								Add credits
							</button>
						</div>
					) : (
						<>
							<div className="acct-panel-stats">
								<div className="acct-stat">
									<span className="acct-stat-k">Balance</span>
									<span className="acct-stat-v">{balance ?? "..."}</span>
								</div>
								<div className="acct-stat">
									<span className="acct-stat-k">Spent this month</span>
									<span className="acct-stat-v">
										{billing
											? formatUsd(billing.spentThisMonthUsdMicros)
											: "..."}
									</span>
								</div>
							</div>
							<button
								type="button"
								className="acct-panel-add"
								onClick={() => openSheet("credits")}
							>
								Add credits
							</button>
						</>
					)}
					<div className="mnav-rule" />
					<button
						type="button"
						className="acct-item"
						onClick={() => openSheet("keys")}
					>
						<span className="t">API keys</span>
						<span className="d">
							{keyCount === null
								? "Create or revoke"
								: `${keyCount} active · create or revoke`}
						</span>
					</button>
					<a href="/docs/api-reference" className="acct-item">
						<span className="t">API reference</span>
						<span className="d">Endpoints and auth</span>
					</a>
					<div className="mnav-rule" />
					<button
						type="button"
						className="acct-item"
						onClick={() => {
							navigator.clipboard.writeText(CLI_INSTALL).catch(() => {});
							setCopied(true);
							setTimeout(() => setCopied(false), 1200);
						}}
					>
						<span className="t">
							Install the CLI{copied ? " · copied" : ""}
						</span>
						<code className="d">{CLI_INSTALL}</code>
					</button>
					<div className="mnav-rule" />
					<button
						type="button"
						className="acct-item muted"
						onClick={() => {
							setOpen(false);
							clearAccountData();
							onSignOut();
						}}
					>
						<span className="t">Sign out</span>
					</button>
				</div>
			) : null}
			<KeysSheet open={sheet === "keys"} onClose={() => setSheet(null)} />
			<CreditsSheet
				open={sheet === "credits"}
				onClose={() => setSheet(null)}
				email={account.email}
			/>
		</div>
	);
}
