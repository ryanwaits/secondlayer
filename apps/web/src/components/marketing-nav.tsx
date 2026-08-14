"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GITHUB_URL = "https://github.com/ryanwaits/secondlayer";

/**
 * Marketing bar (mock shell): brand left, quiet text links + the GitHub pill
 * right. Fixed 64px with the paper/85 + blur treatment from .marketing-nav.
 * Docs keeps its own chrome — this renders null there. The floating AuthBar
 * is hidden wherever this bar is present (globals.css), so the bar owns the
 * top edge alone.
 */
export function MarketingNav({ stars = null }: { stars?: number | null }) {
	const pathname = usePathname();
	if (pathname.startsWith("/docs")) return null;

	return (
		<nav className="marketing-nav" aria-label="Main">
			<Link href="/" className="marketing-nav-brand">
				<svg
					viewBox="4 7 40 28"
					width="22"
					height="15"
					fill="none"
					aria-hidden="true"
				>
					<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
					<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
				</svg>
				<span>secondlayer</span>
			</Link>
			<span className="marketing-nav-spacer" />
			<Link href="/docs" className="mnav-plain">
				Docs
			</Link>
			<Link
				href="/archive"
				className="mnav-plain"
				aria-current={pathname === "/archive" ? "page" : undefined}
			>
				Archive
			</Link>
			<Link
				href="/writing"
				className="mnav-plain"
				aria-current={pathname.startsWith("/writing") ? "page" : undefined}
			>
				Blog
			</Link>
			<a
				href={GITHUB_URL}
				className="mnav-pill line mnav-gh"
				target="_blank"
				rel="noopener noreferrer"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
				</svg>
				GitHub
				{stars !== null ? (
					<>
						<span className="mnav-gh-rule" aria-hidden="true" />
						<span className="mnav-gh-stars">
							<svg
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M8 .8 10.1 5l4.7.7-3.4 3.3.8 4.7L8 11.5l-4.2 2.2.8-4.7L1.2 5.7 5.9 5 8 .8Z" />
							</svg>
							{stars.toLocaleString("en-US")}
						</span>
					</>
				) : null}
			</a>
		</nav>
	);
}
