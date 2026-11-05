"use client";

import { useIntentPrefetch } from "@/lib/intent-prefetch";
import Link from "next/link";
import type { ReactNode } from "react";

/** Where the logo goes: a signed-in reader's Overview, everyone else's home. */
export const homeHref = (signedIn: boolean): string =>
	signedIn ? "/account" : "/";

/**
 * The logo link. Signed in, it goes straight to the Overview and prefetches it
 * on intent, like the Overview tab, instead of asking for `/` and following
 * the proxy's redirect (two round trips and nothing prefetched). The redirect
 * still covers typed URLs and links from elsewhere.
 */
export function HomeLink({
	signedIn,
	className,
	label,
	children,
}: {
	signedIn: boolean;
	className: string;
	/** Accessible name when the link shows only a mark. */
	label?: string;
	children: ReactNode;
}) {
	const intent = useIntentPrefetch();
	const href = homeHref(signedIn);
	return signedIn ? (
		<Link
			href={href}
			prefetch={false}
			{...intent(href)}
			className={className}
			aria-label={label}
		>
			{children}
		</Link>
	) : (
		<Link href={href} className={className} aria-label={label}>
			{children}
		</Link>
	);
}
