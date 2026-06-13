"use client";

import { useAuth } from "@/lib/auth";
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
		<Link href="/" className={className}>
			Platform
		</Link>
	) : (
		<Link href="/login" className={className}>
			Get an API key
		</Link>
	);
}
