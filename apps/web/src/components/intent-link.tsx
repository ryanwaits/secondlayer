"use client";

import { useIntentPrefetch } from "@/lib/intent-prefetch";
import Link from "next/link";
import type { ComponentProps } from "react";

type IntentLinkProps = Omit<
	ComponentProps<typeof Link>,
	"href" | "prefetch"
> & {
	href: string;
};

/**
 * A `<Link>` that prefetches on pointer, focus or touch, never on viewport
 * entry. Next's default prefetches every link in view, so a page of links
 * (nav, footer, a table of rows) fires a burst of requests, each a full
 * server render for dynamic routes. Use this wherever a screen shows many
 * links at once.
 */
export function IntentLink({ href, ...props }: IntentLinkProps) {
	const intent = useIntentPrefetch();
	return <Link href={href} prefetch={false} {...intent(href)} {...props} />;
}
