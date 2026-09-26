"use client";

import { clearAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

const TABS = [
	{ href: "/account/keys", label: "API keys" },
	{ href: "/account/credits", label: "Credits" },
	{ href: "/account/webhooks", label: "Webhooks" },
];

/**
 * The account pages: API keys and Credits under one side nav. The same flows
 * also open as sheets from the nav's account menu; these pages are the home
 * for them, and where Stripe returns a top-up.
 */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { account, loading, logout } = useAuth();
	const pathname = usePathname();

	// Signed out is the one case that still blocks: nothing account-specific
	// ever mounts for a visitor who isn't authenticated. While `loading` is
	// still resolving, though, the shell and its children render right away
	// instead of waiting on `/auth/me` — `children` start their own fetches
	// immediately, and a proxy 401 just reads as "signed out" once loading
	// catches up (each page's own store/notice handling covers that).
	if (!loading && !account) {
		return (
			<div className="login-page">
				<div className="login-card">
					<span className="login-eyebrow">Account</span>
					<h1 className="login-title">Sign in to get a key</h1>
					<p className="login-disclaimer">
						Your API key reads the hosted API at api.secondlayer.tools.
					</p>
					<a href="/login" className="login-submit account-link-button">
						Sign in
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="acct-page">
			<nav className="acct-side" aria-label="Account">
				<p className="acct-side-head">Account</p>
				{TABS.map((t) => (
					<Link
						key={t.href}
						href={t.href}
						className="acct-side-link"
						aria-current={
							pathname === t.href || pathname?.startsWith(`${t.href}/`)
								? "page"
								: undefined
						}
					>
						{t.label}
					</Link>
				))}
				{account ? (
					<p className="acct-side-email">{account.email}</p>
				) : (
					<p className="acct-side-email">
						<span
							className="wh-skel"
							aria-hidden="true"
							style={{ display: "inline-block", width: 130, height: 13 }}
						/>
					</p>
				)}
				<button
					type="button"
					className="acct-side-link quiet"
					onClick={() => {
						clearAccountData();
						logout();
					}}
				>
					Sign out
				</button>
			</nav>
			<main className="acct-main">{children}</main>
			<Toaster
				position="bottom-right"
				toastOptions={{
					unstyled: true,
					classNames: {
						toast: "wh-toast",
						title: "wh-toast-title",
						description: "wh-toast-desc",
						actionButton: "wh-toast-action",
						cancelButton: "wh-toast-cancel",
						error: "wh-toast-error",
						success: "wh-toast-success",
					},
				}}
			/>
		</div>
	);
}
