"use client";

import { useAuth } from "@/lib/auth";
import { appUrl } from "@/lib/urls";
import Link from "next/link";

/**
 * Auth-aware CTA for the mobile bars (marketing + docs). The floating
 * AuthBar is hidden on small screens, so this carries its primary action:
 * key signup for visitors, the platform for signed-in accounts.
 */
export function MobileNavCta({ className }: { className: string }) {
	const { account, loading } = useAuth();
	if (loading) return null;
	return account ? (
		<Link href={appUrl("/")} className={className}>
			Platform
		</Link>
	) : (
		<Link
			href={appUrl("/login")}
			className={className}
			data-umami-event="signup"
		>
			Get an API key
		</Link>
	);
}
