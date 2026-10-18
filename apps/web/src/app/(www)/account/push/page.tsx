"use client";

import { AccountCompactHeader } from "@/components/account/compact-account";
import { PushSettings } from "@/components/account/push/push-settings";
import { COMPACT_QUERY, useCompact } from "@/components/mobile/use-compact";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The phone's Push settings. Desktop has no such page: wider windows go to the Overview. */
export default function AccountPushPage() {
	const compact = useCompact();
	const router = useRouter();
	useEffect(() => {
		// Read the media query directly: useCompact() is false during hydration.
		if (!window.matchMedia(COMPACT_QUERY).matches) router.replace("/account");
	}, [router]);
	if (!compact) return null;
	return (
		<>
			<AccountCompactHeader current="push" />
			<PushSettings />
		</>
	);
}
