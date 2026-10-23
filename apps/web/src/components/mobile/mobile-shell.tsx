"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatusPill } from "./status-pill";
import { useCompact } from "./use-compact";

/** Header for a path: the large title on Account; a back link on a webhook or subgraph page. */
export function mobileHeader(
	pathname: string,
):
	| { kind: "title"; title: string }
	| { kind: "back"; label: string; href: string } {
	if (
		pathname.startsWith("/account/webhooks/") ||
		pathname.startsWith("/account/subgraphs/")
	) {
		return { kind: "back", label: "Account", href: "/account" };
	}
	return { kind: "title", title: "Account" };
}

/** The status pill (running replay, chain problem). Phone only: nothing mounts, polls or subscribes above 640px. */
export function StatusPillSlot(): ReactNode {
	const compact = useCompact();
	return compact ? <StatusPill /> : null;
}

export function MobileHeader({ pathname }: { pathname: string }) {
	const header = mobileHeader(pathname);
	if (header.kind === "back") {
		return (
			<header className="m-head is-back">
				<Link className="m-back" href={header.href}>
					<svg
						width="11"
						height="18"
						viewBox="0 0 11 18"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M9 2L2 9l7 7" />
					</svg>
					<span>{header.label}</span>
				</Link>
				<StatusPillSlot />
			</header>
		);
	}
	return (
		<header className="m-head">
			<div className="m-head-row">
				<h1 className="m-title">{header.title}</h1>
				<StatusPillSlot />
			</div>
		</header>
	);
}

/**
 * Phone frame for /account: a large-title header on top, then the page. The
 * header is always rendered and hidden above 640px by CSS, so server and
 * client markup match.
 */
export function MobileShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	return (
		<>
			<MobileHeader pathname={pathname} />
			{children}
		</>
	);
}
