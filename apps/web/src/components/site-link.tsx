"use client";

import { useSiteHref } from "@/lib/auth";
import Link from "next/link";

export function SiteLink({
	href,
	...props
}: React.ComponentProps<typeof Link> & { href: string }) {
	const resolved = useSiteHref(href);
	return <Link {...props} href={resolved} />;
}
